from datetime import datetime, timedelta, timezone
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from services.crowd_prediction import (  # noqa: E402
    build_zone_graph, holt_forecast, propagate_pressure, predict,
)

NOW = datetime(2026, 10, 4, 12, 0, tzinfo=timezone.utc)


def zone(zid, left, top, cap=100, w=0.2, h=0.2, **kw):
    return {"id": zid, "name": zid.upper(), "bounds": {"left": left, "top": top, "width": w, "height": h},
            "operating_capacity": cap, "warning_threshold": 0.8, "critical_threshold": 0.9,
            "is_crowd_monitored": True, "floor_level": 1, **kw}


def ramp(start, step, n=8):
    return [(NOW - timedelta(minutes=n - 1 - i), start + step * i) for i in range(n)]


def test_graph_adjacency_same_level_only():
    zs = [zone("a", 0, 0), zone("b", 0.2, 0), zone("c", 0.8, 0.8), zone("d", 0.2, 0, floor_level=2)]
    g = build_zone_graph(zs)
    assert "b" in g["a"] and "a" in g["b"]
    assert g["c"] == {}
    assert "d" not in g["a"]
    assert abs(sum(g["a"].values()) - 1.0) < 1e-9


def test_holt_detects_rise_and_flat():
    _, up = holt_forecast(ramp(10, 5))
    _, flat = holt_forecast(ramp(50, 0))
    assert up > 3
    assert abs(flat) < 0.1


def test_ramp_triggers_warning_with_eta():
    zs = [zone("a", 0, 0)]
    res = predict(zs, {"a": ramp(30, 6)}, {}, horizon_min=15, now=NOW)
    r = res[0]
    assert r["risk"] in ("warning", "critical")
    assert r["eta_minutes"] is not None and r["eta_minutes"] <= 15


def test_quiet_zone_is_normal():
    res = predict([zone("a", 0, 0)], {"a": ramp(10, 0)}, {}, now=NOW)
    assert res[0]["risk"] == "normal"


def test_spill_conserves_mass_and_flows_to_free_neighbour():
    zs = [zone("a", 0, 0), zone("b", 0.2, 0), zone("c", 0.4, 0)]
    graph = build_zone_graph(zs)
    levels = {"a": 100.0, "b": 10.0, "c": 95.0}
    loads, _ = propagate_pressure(zs, graph, levels, {}, 10, now=NOW)
    assert abs(sum(loads.values()) - sum(levels.values())) < 1e-6
    assert loads["a"] < 100.0


def test_session_end_disperses_without_creating_crowd():
    zs = [zone("a", 0, 0), zone("b", 0.2, 0)]
    graph = build_zone_graph(zs)
    sessions = [{"zone_id": "a", "title": "Keynote", "start_time": (NOW - timedelta(hours=1)).isoformat(),
                 "end_time": (NOW + timedelta(minutes=5)).isoformat()}]
    levels = {"a": 80.0, "b": 10.0}
    loads, drivers = propagate_pressure(zs, graph, levels, {}, 15, sessions=sessions, now=NOW)
    assert abs(sum(loads.values()) - 90.0) < 1e-6
    assert loads["b"] > 60
    assert any("Keynote" in d for d in drivers["b"])


def test_stale_data_lowers_confidence():
    zs = [zone("a", 0, 0)]
    fresh = predict(zs, {"a": ramp(30, 2)}, {}, now=NOW)[0]["confidence"]
    stale_hist = [(t - timedelta(minutes=15), v) for t, v in ramp(30, 2)]
    stale = predict(zs, {"a": stale_hist}, {}, now=NOW)[0]["confidence"]
    assert stale < fresh


def test_unconfigured_capacity_is_unknown():
    z = zone("a", 0, 0, cap=None)
    z["capacity_limit"] = None
    assert predict([z], {}, {}, now=NOW)[0]["risk"] == "unknown"
