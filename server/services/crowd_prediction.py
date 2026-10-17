"""
Algorithmic (non-ML) overcrowding prediction.

Pipeline:
  1. build_zone_graph    - adjacency derived from zone bounds (same level).
  2. holt_forecast       - per-zone level + trend (double exponential smoothing).
  3. propagate_pressure  - spill/leak/session surges flow across the graph.
  4. score_zones         - risk level, ETA, confidence, drivers, suggested action.

Everything here is pure (no DB, no network) so it can be unit tested.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

ADJACENCY_EPS = 0.02        # max gap (normalized map units) for two zones to count as touching
WATCH_MARGIN = 0.15         # "watch" starts this far below the warning threshold
LEAK_FRACTION = 0.15        # share of a rising, busy zone's growth that moves onward
LEAK_MIN_RATIO = 0.70       # zone must be at least this full to leak
SESSION_DISPERSAL = 0.8     # share of a zone's crowd that leaves when a session ends
SESSION_PULL = 0.5          # max share of a neighbour's crowd pulled by a starting session
STALE_FULL_MIN = 2.0        # data younger than this is fully trusted
STALE_ZERO_MIN = 10.0       # data older than this has minimum freshness
RISK_ORDER = {"critical": 0, "warning": 1, "watch": 2, "normal": 3, "unknown": 4}


def parse_ts(value: Any) -> Optional[datetime]:
    """Parse an ISO string / datetime into an aware UTC datetime."""
    if value is None:
        return None
    if isinstance(value, datetime):
        dt = value
    else:
        try:
            dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def zone_capacity(zone: Dict[str, Any]) -> Optional[float]:
    cap = zone.get("operating_capacity") or zone.get("capacity_limit")
    try:
        cap = float(cap) if cap else None
    except (TypeError, ValueError):
        return None
    return cap if cap and cap > 0 else None


# ── 1. Zone graph ────────────────────────────────────────────────────────────

def _rect(zone: Dict[str, Any]) -> Optional[Tuple[float, float, float, float]]:
    b = zone.get("bounds")
    if not isinstance(b, dict):
        return None
    try:
        left, top = float(b["left"]), float(b["top"])
        return left, top, left + float(b["width"]), top + float(b["height"])
    except (KeyError, TypeError, ValueError):
        return None


def _shared_border(a: Tuple[float, float, float, float], b: Tuple[float, float, float, float]) -> float:
    """Length of the border two rectangles share (0 if not touching within ADJACENCY_EPS)."""
    ox = min(a[2], b[2]) - max(a[0], b[0])   # overlap along x (negative = gap)
    oy = min(a[3], b[3]) - max(a[1], b[1])   # overlap along y
    if ox >= -ADJACENCY_EPS and oy >= -ADJACENCY_EPS:
        if ox < 0 or oy < 0:
            return ADJACENCY_EPS  # corner-adjacent: weak link
        return max(ox, oy, ADJACENCY_EPS)
    return 0.0


def _level_key(zone: Dict[str, Any]) -> Any:
    return zone.get("level_id") or zone.get("floor_level") or 1


def build_zone_graph(
    zones: List[Dict[str, Any]],
    extra_links: Optional[List[Tuple[str, str]]] = None,
) -> Dict[str, Dict[str, float]]:
    """
    Undirected weighted adjacency {zone_id: {neighbour_id: weight}}.
    Zones on the same level link when their bounds touch; `extra_links` adds explicit
    connections (e.g. vertical connectors between levels). Weights are normalised
    per source so each row sums to 1.
    """
    raw: Dict[str, Dict[str, float]] = {z["id"]: {} for z in zones}
    rects = {z["id"]: _rect(z) for z in zones}
    by_id = {z["id"]: z for z in zones}
    ids = list(raw)
    for i, a in enumerate(ids):
        for b in ids[i + 1:]:
            ra, rb = rects[a], rects[b]
            if not ra or not rb or _level_key(by_id[a]) != _level_key(by_id[b]):
                continue
            w = _shared_border(ra, rb)
            if w > 0:
                raw[a][b] = w
                raw[b][a] = w
    for a, b in extra_links or []:
        if a in raw and b in raw and a != b:
            raw[a][b] = raw[a].get(b, 0.0) or 0.1
            raw[b][a] = raw[b].get(a, 0.0) or 0.1
    graph: Dict[str, Dict[str, float]] = {}
    for zid, nbrs in raw.items():
        total = sum(nbrs.values())
        graph[zid] = {n: w / total for n, w in nbrs.items()} if total else {}
    return graph


# ── 2. Per-zone trend ────────────────────────────────────────────────────────

def holt_forecast(
    series: List[Tuple[datetime, float]],
    alpha: float = 0.5,
    beta: float = 0.3,
) -> Tuple[float, float]:
    """
    Holt's linear smoothing over an irregularly sampled series.
    Returns (level, trend_per_minute). Needs >= 2 points for a non-zero trend.
    """
    if not series:
        return 0.0, 0.0
    pts = sorted(series, key=lambda p: p[0])
    level, trend = float(pts[0][1]), 0.0
    prev_t = pts[0][0]
    for t, v in pts[1:]:
        dt = max((t - prev_t).total_seconds() / 60.0, 1e-3)
        predicted = level + trend * dt
        new_level = alpha * float(v) + (1 - alpha) * predicted
        inst_trend = (new_level - level) / dt
        trend = beta * inst_trend + (1 - beta) * trend
        level, prev_t = new_level, t
    return max(level, 0.0), trend


# ── 3. Graph flow propagation ────────────────────────────────────────────────

def _distribute(
    amount: float,
    source: str,
    graph: Dict[str, Dict[str, float]],
    loads: Dict[str, float],
    caps: Dict[str, Optional[float]],
) -> Dict[str, float]:
    """Split `amount` across neighbours by edge weight x free capacity."""
    nbrs = graph.get(source, {})
    scores: Dict[str, float] = {}
    for n, w in nbrs.items():
        cap = caps.get(n)
        headroom = max(cap - loads[n], 0.0) if cap else 0.0
        scores[n] = w * (headroom + 1e-6)
    total = sum(scores.values())
    if not total:
        return {}
    return {n: amount * s / total for n, s in scores.items()}


def propagate_pressure(
    zones: List[Dict[str, Any]],
    graph: Dict[str, Dict[str, float]],
    levels: Dict[str, float],
    trends: Dict[str, float],
    horizon_min: float,
    arrivals_per_min: Optional[Dict[str, float]] = None,
    sessions: Optional[List[Dict[str, Any]]] = None,
    now: Optional[datetime] = None,
    hops: int = 2,
) -> Tuple[Dict[str, float], Dict[str, List[str]]]:
    """
    Project each zone's load at t+horizon, including crowd that flows in from neighbours.
    Crowd moved between zones is conserved (what leaves a zone arrives elsewhere).
    Returns (projected_load, drivers).
    """
    now = now or datetime.now(timezone.utc)
    by_id = {z["id"]: z for z in zones}
    caps = {zid: zone_capacity(z) for zid, z in by_id.items()}
    names = {zid: z.get("name", zid) for zid, z in by_id.items()}
    drivers: Dict[str, List[str]] = {zid: [] for zid in by_id}

    loads = {zid: max(levels.get(zid, 0.0) + trends.get(zid, 0.0) * horizon_min, 0.0) for zid in by_id}
    for zid in by_id:
        if abs(trends.get(zid, 0.0)) >= 0.5:
            drivers[zid].append(f"trend {trends[zid]:+.1f}/min")

    # Gate / check-in inflow (external, adds mass)
    for zid, rate in (arrivals_per_min or {}).items():
        if zid in loads and rate > 0:
            loads[zid] += rate * horizon_min
            drivers[zid].append(f"check-ins ~{rate:.1f}/min")

    # Scheduled surges (conserving transfers)
    for s in sessions or []:
        zid = s.get("zone_id")
        start, end = parse_ts(s.get("start_time")), parse_ts(s.get("end_time"))
        if zid not in by_id or not start or not end:
            continue
        title = s.get("title") or "Session"
        if now <= end and (end - now).total_seconds() / 60.0 <= horizon_min and start <= now:
            out = min(loads[zid], levels.get(zid, 0.0)) * SESSION_DISPERSAL
            mins = max(int((end - now).total_seconds() // 60), 0)
            shares = _distribute(out, zid, graph, loads, caps)
            for n, amt in shares.items():
                loads[n] += amt
                drivers[n].append(f"'{title}' ends in {mins}m ({names[zid]})")
            loads[zid] -= sum(shares.values())
        elif start > now and (start - now).total_seconds() / 60.0 <= horizon_min and caps.get(zid):
            want = max(caps[zid] - loads[zid], 0.0) * 0.6
            mins = max(int((start - now).total_seconds() // 60), 0)
            nbrs = graph.get(zid, {})
            avail = {n: loads[n] * SESSION_PULL * w for n, w in nbrs.items()}
            total_avail = sum(avail.values())
            if total_avail > 0:
                pulled = min(want, total_avail)
                for n, a in avail.items():
                    take = pulled * a / total_avail
                    loads[n] -= take
                    loads[zid] += take
                drivers[zid].append(f"'{title}' starts in {mins}m")

    # Spill / leak across the graph (conserving)
    for hop in range(hops):
        moved = False
        for zid in sorted(by_id, key=lambda z: -loads[z]):
            cap = caps.get(zid)
            if not cap or not graph.get(zid):
                continue
            crit = float(by_id[zid].get("critical_threshold") or 0.9)
            spill = max(loads[zid] - cap * crit, 0.0)
            if hop == 0 and loads[zid] / cap >= LEAK_MIN_RATIO:
                spill += LEAK_FRACTION * max(trends.get(zid, 0.0), 0.0) * horizon_min
            spill = min(spill, loads[zid])
            if spill < 1e-6:
                continue
            shares = _distribute(spill, zid, graph, loads, caps)
            for n, amt in shares.items():
                if amt >= 1.0:
                    drivers[n].append(f"inflow ~{amt:.0f} from {names[zid]}")
            loads[zid] -= sum(shares.values())
            for n, amt in shares.items():
                loads[n] += amt
            moved = moved or bool(shares)
        if not moved:
            break
    return loads, drivers


# ── 4. Scoring ───────────────────────────────────────────────────────────────

def _freshness(age_min: Optional[float]) -> float:
    if age_min is None:
        return 0.3
    if age_min <= STALE_FULL_MIN:
        return 1.0
    if age_min >= STALE_ZERO_MIN:
        return 0.3
    return 1.0 - 0.7 * (age_min - STALE_FULL_MIN) / (STALE_ZERO_MIN - STALE_FULL_MIN)


def score_zones(
    zones: List[Dict[str, Any]],
    graph: Dict[str, Dict[str, float]],
    levels: Dict[str, float],
    projected: Dict[str, float],
    drivers: Dict[str, List[str]],
    point_counts: Dict[str, int],
    latest_ts: Dict[str, Optional[datetime]],
    horizon_min: float,
    now: Optional[datetime] = None,
) -> List[Dict[str, Any]]:
    now = now or datetime.now(timezone.utc)
    by_id = {z["id"]: z for z in zones}
    results: List[Dict[str, Any]] = []
    ratios: Dict[str, float] = {}
    for zid, z in by_id.items():
        cap = zone_capacity(z)
        if cap:
            ratios[zid] = projected.get(zid, 0.0) / cap

    for zid, z in by_id.items():
        cap = zone_capacity(z)
        base = {"zone_id": zid, "zone_name": z.get("name"), "capacity": cap}
        if not cap or z.get("is_crowd_monitored") is False:
            results.append({**base, "risk": "unknown", "current_ratio": None, "projected_ratio": None,
                            "eta_minutes": None, "confidence": 0.0, "drivers": [],
                            "suggested_action": None})
            continue
        warn = float(z.get("warning_threshold") or 0.8)
        crit = float(z.get("critical_threshold") or 0.9)
        level = levels.get(zid, 0.0)
        cur_ratio = level / cap
        proj_ratio = ratios[zid]
        peak = max(cur_ratio, proj_ratio)
        if peak >= crit:
            risk = "critical"
        elif peak >= warn:
            risk = "warning"
        elif peak >= warn - WATCH_MARGIN:
            risk = "watch"
        else:
            risk = "normal"

        eff_trend = (projected.get(zid, 0.0) - level) / horizon_min if horizon_min else 0.0
        target = warn * cap
        if level >= target:
            eta: Optional[float] = 0.0
        elif eff_trend > 1e-6 and projected.get(zid, 0.0) >= target:
            eta = round(min((target - level) / eff_trend, horizon_min), 1)
        else:
            eta = None

        ts = latest_ts.get(zid)
        age = (now - ts).total_seconds() / 60.0 if ts else None
        confidence = round(_freshness(age) * (0.5 + 0.5 * min(1.0, point_counts.get(zid, 0) / 6.0)), 2)

        action = None
        if risk in ("warning", "critical"):
            options = [(ratios[n], n) for n in graph.get(zid, {}) if n in ratios]
            if options:
                _, best = min(options)
                action = (f"Redirect foot traffic from {z.get('name')} toward "
                          f"{by_id[best].get('name')}; stage volunteers at the {z.get('name')} entrance.")
            else:
                action = f"Throttle entry to {z.get('name')} and stage volunteers on crowd control."
        elif risk == "watch":
            action = f"Monitor {z.get('name')}; pre-position a volunteer nearby."

        results.append({
            **base,
            "risk": risk,
            "current_count": round(level),
            "current_ratio": round(cur_ratio, 3),
            "projected_ratio": round(proj_ratio, 3),
            "eta_minutes": eta,
            "confidence": confidence,
            "drivers": drivers.get(zid, [])[:5],
            "suggested_action": action,
        })
    results.sort(key=lambda r: (RISK_ORDER[r["risk"]], -(r.get("projected_ratio") or 0)))
    return results


# ── Orchestrator ─────────────────────────────────────────────────────────────

def predict(
    zones: List[Dict[str, Any]],
    history: Dict[str, List[Tuple[datetime, float]]],
    current: Dict[str, Tuple[float, Optional[datetime]]],
    sessions: Optional[List[Dict[str, Any]]] = None,
    arrivals_per_min: Optional[Dict[str, float]] = None,
    horizon_min: float = 15,
    now: Optional[datetime] = None,
    extra_links: Optional[List[Tuple[str, str]]] = None,
) -> List[Dict[str, Any]]:
    """
    history: {zone_id: [(ts, count), ...]} recent snapshots.
    current: {zone_id: (live_count, updated_at)} from volunteer_counts.
    arrivals_per_min: {zone_id: check-ins per minute}.
    """
    now = now or datetime.now(timezone.utc)
    graph = build_zone_graph(zones, extra_links)
    levels: Dict[str, float] = {}
    trends: Dict[str, float] = {}
    counts: Dict[str, int] = {}
    latest: Dict[str, Optional[datetime]] = {}
    for z in zones:
        zid = z["id"]
        series = list(history.get(zid, []))
        live = current.get(zid)
        if live and (not series or (live[1] and live[1] > series[-1][0])):
            series.append((live[1] or now, float(live[0])))
        series = [p for p in series if (now - p[0]).total_seconds() <= 30 * 60]
        series.sort(key=lambda p: p[0])
        level, trend = holt_forecast(series)
        # Prefer the freshest raw reading as the current level when available.
        if series:
            level = max(level, 0.0) if len(series) > 1 else series[-1][1]
        levels[zid], trends[zid] = level, trend
        counts[zid] = len(series)
        latest[zid] = series[-1][0] if series else None
    projected, drivers = propagate_pressure(
        zones, graph, levels, trends, horizon_min, arrivals_per_min, sessions, now)
    return score_zones(zones, graph, levels, projected, drivers, counts, latest, horizon_min, now)
