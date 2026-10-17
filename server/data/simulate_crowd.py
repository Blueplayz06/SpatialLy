"""
Realistic Crowd Simulation & Replay Harness.

Generates realistic time-series snapshots and updates live counts for an event
to demonstrate and verify the algorithmic overcrowding prediction engine
without physical BLE hardware.

Usage:
  python server/data/simulate_crowd.py [--event-id UUID] [--pattern ramp|surge|dispersal|plateau] [--minutes INT]
"""

import argparse
import sys
import os
from datetime import datetime, timezone, timedelta
from typing import List, Dict, Any, Tuple

# Add parent directory to path so imports work when run as standalone script
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

try:
    from config import get_supabase
except ImportError:
    get_supabase = None


def generate_pattern_series(
    capacity: int,
    pattern: str = "ramp",
    minutes: int = 20,
    end_time: datetime = None
) -> List[Tuple[datetime, int]]:
    """
    Generate an array of (timestamp, estimated_count) tuples for a zone
    based on a designated crowd behavior pattern.
    """
    end_time = end_time or datetime.now(timezone.utc)
    series = []
    cap = max(capacity or 100, 20)

    for i in range(minutes, -1, -1):
        ts = end_time - timedelta(minutes=i)
        progress = 1.0 - (i / max(minutes, 1))

        if pattern == "ramp":
            # Start at 25% capacity, steadily ramp to 92% (triggers Warning & Critical thresholds)
            ratio = 0.25 + (0.67 * progress)
            count = int(cap * ratio)
        elif pattern == "surge":
            # Sudden influx halfway through
            if progress < 0.5:
                ratio = 0.35 + (0.1 * progress)
            else:
                ratio = 0.45 + (0.45 * (progress - 0.5) * 2)
            count = int(cap * ratio)
        elif pattern == "dispersal":
            # High initial concentration dispersing outward down to 15%
            ratio = max(0.85 - (0.70 * progress), 0.15)
            count = int(cap * ratio)
        elif pattern == "plateau":
            # Normal steady operation around 40-50%
            ratio = 0.42 + (0.05 * (i % 3 - 1))
            count = int(cap * ratio)
        else:
            ratio = 0.35
            count = int(cap * ratio)

        series.append((ts, max(count, 0)))

    return series


def run_simulation(
    event_id: str,
    pattern: str = "ramp",
    minutes: int = 20,
    target_zone_id: str = None
) -> Dict[str, Any]:
    """
    Runs simulation against Supabase for the specified event:
    1. Fetches event zones
    2. Generates time-series snapshots
    3. Writes to crowd_zone_snapshots table
    4. Updates volunteer_counts for current live presence
    """
    if not get_supabase:
        raise RuntimeError("Supabase client not configured.")

    supabase = get_supabase()

    # Verify event exists
    event_res = supabase.table("events").select("id, name").eq("id", event_id).execute()
    if not event_res.data:
        raise ValueError(f"Event {event_id} not found.")

    event_name = event_res.data[0]["name"]
    print(f"-> Simulating '{pattern}' crowd pattern on event '{event_name}' ({event_id})...")

    # Fetch zones for event
    zones_res = supabase.table("event_zones").select("*").eq("event_id", event_id).execute()
    zones = zones_res.data or []
    if not zones:
        raise ValueError(f"No zones configured for event {event_id}.")

    now = datetime.now(timezone.utc)
    inserted_snapshots = 0
    updated_counts = 0

    # Pick target zone for the heavy pattern; secondary zones get modest spill/baseline
    primary_zone = None
    if target_zone_id:
        primary_zone = next((z for z in zones if z["id"] == target_zone_id), None)
    if not primary_zone:
        # Default to first monitored zone with a capacity limit
        primary_zone = next((z for z in zones if z.get("is_crowd_monitored", True) and (z.get("operating_capacity") or z.get("capacity_limit"))), zones[0])

    print(f"-> Primary surge zone: {primary_zone.get('name')} (cap: {primary_zone.get('operating_capacity') or primary_zone.get('capacity_limit') or 100})")

    for z in zones:
        zid = z["id"]
        zname = z.get("name")
        cap = z.get("operating_capacity") or z.get("capacity_limit") or 100
        is_primary = (zid == primary_zone["id"])

        z_pattern = pattern if is_primary else ("plateau" if pattern != "dispersal" else "ramp")
        series = generate_pattern_series(cap, pattern=z_pattern, minutes=minutes, end_time=now)

        # Batch insert snapshots
        rows = [
            {
                "event_id": event_id,
                "zone_id": zid,
                "estimated_count": count,
                "source": "simulation",
                "notes": f"Simulated {z_pattern} profile ({i}m ago)",
                "snapshot_at": ts.isoformat()
            }
            for ts, count in series
        ]

        if rows:
            supabase.table("crowd_zone_snapshots").insert(rows).execute()
            inserted_snapshots += len(rows)

        # Update volunteer_counts for current live representation
        latest_count = series[-1][1] if series else 0
        try:
            # Check if count row exists
            existing_vc = supabase.table("volunteer_counts").select("id").eq("event_id", event_id).eq("zone", zname).execute()
            if existing_vc.data:
                supabase.table("volunteer_counts").update({
                    "active_count": latest_count,
                    "zone_id": zid,
                    "updated_at": now.isoformat()
                }).eq("id", existing_vc.data[0]["id"]).execute()
            else:
                supabase.table("volunteer_counts").insert({
                    "event_id": event_id,
                    "zone": zname,
                    "zone_id": zid,
                    "active_count": latest_count,
                    "updated_at": now.isoformat()
                }).execute()
            updated_counts += 1
        except Exception as e:
            print(f"Warning updating volunteer_counts for {zname}: {e}")

    print(f"[OK] Simulation completed: inserted {inserted_snapshots} snapshots and updated {updated_counts} zone counts.")
    return {
        "event_id": event_id,
        "event_name": event_name,
        "pattern": pattern,
        "primary_zone": primary_zone.get("name"),
        "snapshots_inserted": inserted_snapshots,
        "zones_updated": updated_counts
    }


def main():
    parser = argparse.ArgumentParser(description="Simulate crowd telemetry for Spatially")
    parser.add_argument("--event-id", type=str, help="UUID of the event to simulate (defaults to first active event)")
    parser.add_argument("--pattern", choices=["ramp", "surge", "dispersal", "plateau"], default="ramp", help="Pattern to simulate")
    parser.add_argument("--minutes", type=int, default=20, help="Number of simulated historical minutes")
    parser.add_argument("--zone-id", type=str, help="Target zone UUID to concentrate surge")
    args = parser.parse_args()

    if not get_supabase:
        print("Error: config.get_supabase is unavailable.")
        sys.exit(1)

    supabase = get_supabase()
    target_event_id = args.event_id

    if not target_event_id:
        # Auto-pick the first active or upcoming event
        events = supabase.table("events").select("id, name, status").order("created_at", desc=True).limit(5).execute()
        if not events.data:
            print("No events found in database. Create an event first.")
            sys.exit(1)
        target_event_id = events.data[0]["id"]
        print(f"Auto-selected event '{events.data[0]['name']}' ({target_event_id})")

    try:
        run_simulation(target_event_id, pattern=args.pattern, minutes=args.minutes, target_zone_id=args.zone_id)
    except Exception as e:
        print(f"Simulation failed: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
