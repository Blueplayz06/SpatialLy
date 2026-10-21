"""
Realistic Volunteer Telemetry, Proximity & Incident Simulation Harness.

Simulates real-time volunteer activity, proximity counts of nearby attendees,
event squad assignments, shift lifecycles, and a live overcrowding scenario
with instant volunteer alerts and notifications for demo presentations.

Usage:
  python server/data/simulate_volunteers.py [--event-id UUID] [--loop] [--interval SEC]
"""

import argparse
import sys
import os
import time
import random
import uuid
from datetime import datetime, timezone, timedelta
from typing import List, Dict, Any, Optional

# Add parent directory to path so imports work when run as standalone script
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

try:
    from config import get_supabase
except ImportError:
    get_supabase = None


DEMO_VOLUNTEER_SEEDS = [
    {"name": "Aarav Sharma", "email": "aarav.volunteer@spatially.demo"},
    {"name": "Priya Patel", "email": "priya.volunteer@spatially.demo"},
    {"name": "Rohan Desai", "email": "rohan.volunteer@spatially.demo"},
    {"name": "Sneha Kulkarni", "email": "sneha.volunteer@spatially.demo"},
    {"name": "Vikram Mehta", "email": "vikram.volunteer@spatially.demo"},
    {"name": "Ananya Iyer", "email": "ananya.volunteer@spatially.demo"},
]

STANDARD_TEAMS = [
    {"name": "Crowd Safety Squad", "description": "Monitors attendee density and egress routes", "color": "#EF4444"},
    {"name": "Medical Rapid Response", "description": "First-aid, triage and health assistance", "color": "#10B981"},
    {"name": "Registration & Ushers", "description": "Turnstile check-in and attendee guidance", "color": "#3B82F6"},
    {"name": "Floor Operations", "description": "Exhibition booths, speaker flow and logistics", "color": "#F59E0B"},
]


def resolve_or_create_event(supabase, target_event_id: Optional[str] = None) -> Dict[str, Any]:
    """Finds an existing event or creates a high-fidelity Demo Showcase Event."""
    if target_event_id:
        res = supabase.table("events").select("*").eq("id", target_event_id).execute()
        if res.data:
            return res.data[0]
        print(f"[!] Specified event {target_event_id} not found. Searching active events...")

    # Look for live or upcoming events with existing zones
    events_res = supabase.table("events").select("*").order("created_at", desc=True).limit(10).execute()
    for ev in (events_res.data or []):
        zones_check = supabase.table("event_zones").select("id").eq("event_id", ev["id"]).execute()
        if zones_check.data and len(zones_check.data) >= 2:
            return ev

    if events_res.data:
        return events_res.data[0]

    # Create fresh demo event if none exists
    print("[*] Creating dedicated 'National Tech Summit 2026 - Live Showcase' event...")
    now = datetime.now(timezone.utc)
    new_event = {
        "name": "National Tech Summit 2026 - Live Showcase",
        "status": "live",
        "event_date": now.isoformat(),
        "start_time": (now - timedelta(hours=1)).strftime("%H:%M"),
        "end_time": (now + timedelta(hours=8)).strftime("%H:%M"),
        "location": "Convention Center - Grand Hall",
        "description": "Live production demonstration environment for Spatially judges review."
    }
    created = supabase.table("events").insert(new_event).execute()
    return created.data[0]


def ensure_event_zones(supabase, event_id: str) -> List[Dict[str, Any]]:
    """Ensures the event has realistic operational zones with capacities."""
    zones_res = supabase.table("event_zones").select("*").eq("event_id", event_id).execute()
    zones = zones_res.data or []
    if len(zones) >= 3:
        return zones

    print(f"[*] Provisioning operational demo zones for event {event_id}...")
    default_zones = [
        {"name": "Main Stage", "capacity_limit": 200, "operating_capacity": 180, "is_crowd_monitored": True},
        {"name": "Exhibition Hall A", "capacity_limit": 150, "operating_capacity": 130, "is_crowd_monitored": True},
        {"name": "Exhibition Hall B", "capacity_limit": 120, "operating_capacity": 100, "is_crowd_monitored": True},
        {"name": "Registration Entrance", "capacity_limit": 100, "operating_capacity": 80, "is_crowd_monitored": True},
        {"name": "Food & Networking Plaza", "capacity_limit": 140, "operating_capacity": 110, "is_crowd_monitored": True},
    ]

    inserted = []
    for dz in default_zones:
        dz["event_id"] = event_id
        try:
            r = supabase.table("event_zones").insert(dz).execute()
            if r.data:
                inserted.extend(r.data)
        except Exception as e:
            print(f"    Zone insert warning: {e}")

    return inserted if inserted else zones


def resolve_volunteers(supabase) -> List[Dict[str, Any]]:
    """Finds existing volunteer profiles or attaches demo volunteers."""
    vol_res = supabase.table("profiles").select("id, full_name, email, role").eq("role", "volunteer").execute()
    volunteers = vol_res.data or []

    if len(volunteers) >= 4:
        return volunteers

    # Check all profiles to see if we can recruit or supplement
    all_profiles = supabase.table("profiles").select("id, full_name, email, role").execute().data or []
    
    # If any profiles exist, promote or use them
    for p in all_profiles:
        if p["id"] not in [v["id"] for v in volunteers]:
            volunteers.append({
                "id": p["id"],
                "full_name": p.get("full_name") or p.get("email", "Volunteer Staff"),
                "email": p.get("email"),
                "role": "volunteer"
            })
            if len(volunteers) >= 6:
                break

    # If still fewer than 4, create stub UUID profiles if auth permits
    if len(volunteers) < 4:
        for seed in DEMO_VOLUNTEER_SEEDS:
            if len(volunteers) >= 6:
                break
            try:
                # Attempt to register user in auth admin
                auth_user = supabase.auth.admin.create_user({
                    "email": seed["email"],
                    "password": "Password123!",
                    "email_confirm": True,
                    "user_metadata": {"full_name": seed["name"], "role": "volunteer"}
                })
                uid = auth_user.user.id
                supabase.table("profiles").upsert({
                    "id": uid,
                    "email": seed["email"],
                    "full_name": seed["name"],
                    "role": "volunteer"
                }).execute()
                volunteers.append({"id": uid, "full_name": seed["name"], "email": seed["email"], "role": "volunteer"})
            except Exception:
                # If cannot create via auth admin, try direct profiles row
                try:
                    uid = str(uuid.uuid4())
                    supabase.table("profiles").insert({
                        "id": uid,
                        "email": seed["email"],
                        "full_name": seed["name"],
                        "role": "volunteer"
                    }).execute()
                    volunteers.append({"id": uid, "full_name": seed["name"], "email": seed["email"], "role": "volunteer"})
                except Exception:
                    pass

    return volunteers


def ensure_event_teams(supabase, event_id: str, volunteers: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Ensures operational squads/teams exist for this event."""
    teams_res = supabase.table("event_teams").select("*").eq("event_id", event_id).execute()
    teams = teams_res.data or []

    if not teams:
        print("[*] Configuring Event Tactical Squads...")
        created_teams = []
        for idx, t in enumerate(STANDARD_TEAMS):
            lead = volunteers[idx % len(volunteers)] if volunteers else None
            team_payload = {
                "event_id": event_id,
                "name": t["name"],
                "description": t["description"],
                "lead_id": lead["id"] if lead else None,
            }
            try:
                res = supabase.table("event_teams").insert(team_payload).execute()
                if res.data:
                    created_teams.append(res.data[0])
            except Exception as e:
                print(f"    Warning creating team {t['name']}: {e}")
        teams = created_teams

    return teams


def seed_shifts_and_roster(
    supabase,
    event_id: str,
    volunteers: List[Dict[str, Any]],
    zones: List[Dict[str, Any]],
    teams: List[Dict[str, Any]]
) -> List[Dict[str, Any]]:
    """Seeds active shifts, assigns volunteers to zones, and establishes break statuses."""
    now = datetime.now(timezone.utc)
    shift_start = now - timedelta(hours=2)
    shift_end = now + timedelta(hours=4)

    active_shifts = []
    
    # Clean previous demo shifts for this event to avoid stale duplicates
    try:
        supabase.table("volunteer_shifts").delete().eq("event_id", event_id).execute()
    except Exception:
        pass

    for idx, vol in enumerate(volunteers):
        zone = zones[idx % len(zones)]
        team = teams[idx % len(teams)] if teams else None
        
        # 1 volunteer on break, rest active
        if idx == 1:
            status = "on_break"
            break_state = "on_break"
        elif idx == len(volunteers) - 1 and len(volunteers) > 4:
            status = "scheduled"
            break_state = "none"
        else:
            status = "active"
            break_state = "none"

        shift_record = {
            "event_id": event_id,
            "volunteer_id": vol["id"],
            "team_id": team["id"] if team else None,
            "zone_id": zone["id"],
            "zone_name": zone.get("name"),
            "shift_name": f"{zone.get('name')} Operations",
            "scheduled_start": shift_start.isoformat(),
            "scheduled_end": shift_end.isoformat(),
            "actual_start": shift_start.isoformat() if status != "scheduled" else None,
            "status": status,
            "break_state": break_state,
            "notes": f"Tactical volunteer deployment at {zone.get('name')}",
            "updated_at": now.isoformat()
        }

        try:
            res = supabase.table("volunteer_shifts").insert(shift_record).execute()
            if res.data:
                shift_data = res.data[0]
                shift_data["volunteer_name"] = vol.get("full_name") or vol.get("email")
                active_shifts.append(shift_data)

                # If on break, seed shift_breaks record
                if status == "on_break":
                    try:
                        supabase.table("shift_breaks").insert({
                            "shift_id": shift_data["id"],
                            "event_id": event_id,
                            "volunteer_id": vol["id"],
                            "start_time": (now - timedelta(minutes=10)).isoformat(),
                            "expected_return": (now + timedelta(minutes=10)).isoformat(),
                            "reason": "Mid-shift refreshment"
                        }).execute()
                    except Exception:
                        pass
        except Exception as e:
            print(f"    Shift creation warning for {vol.get('full_name')}: {e}")

    # Seed 1 Coverage Request for the on-break volunteer
    if active_shifts:
        try:
            break_shift = next((s for s in active_shifts if s.get("status") == "on_break"), active_shifts[0])
            supabase.table("coverage_requests").delete().eq("event_id", event_id).execute()
            supabase.table("coverage_requests").insert({
                "event_id": event_id,
                "shift_id": break_shift["id"],
                "requester_id": break_shift["volunteer_id"],
                "requester_name": break_shift.get("volunteer_name", "Volunteer Staff"),
                "zone_id": break_shift.get("zone_id"),
                "zone_name": break_shift.get("zone_name"),
                "reason": "break",
                "notes": "Requesting 15m relief for quick water break at station.",
                "priority": "normal",
                "status": "requested",
                "created_at": (now - timedelta(minutes=5)).isoformat(),
                "updated_at": now.isoformat()
            }).execute()
        except Exception as e:
            print(f"    Coverage request seeding warning: {e}")

    return active_shifts


def update_volunteer_proximity_telemetry(
    supabase,
    event_id: str,
    zones: List[Dict[str, Any]],
    active_shifts: List[Dict[str, Any]],
    overcrowded_zone_id: Optional[str] = None,
    overcrowded_ratio: float = 0.96
) -> Dict[str, int]:
    """
    Updates the live count of attendees/users detected near each volunteer station.
    Populates volunteer_counts and crowd_zone_snapshots tables.
    """
    now = datetime.now(timezone.utc)
    zone_counts = {}

    for z in zones:
        zid = z["id"]
        zname = z.get("name", "Zone")
        cap = z.get("operating_capacity") or z.get("capacity_limit") or 100
        is_overcrowded = (zid == overcrowded_zone_id)

        # Calculate count near volunteers in this zone
        if is_overcrowded:
            # Overcrowded: 95% - 98% of capacity
            count = int(cap * overcrowded_ratio)
        else:
            # Normal healthy traffic: 30% - 55% of capacity
            jitter = random.randint(-4, 4)
            count = max(int(cap * 0.42) + jitter, 15)

        zone_counts[zname] = count

        # Find volunteers assigned to this zone
        assigned_vols = [s for s in active_shifts if s.get("zone_id") == zid and s.get("status") == "active"]

        # Update volunteer_counts table (keyed on volunteer_id per active scanner)
        for vol_shift in assigned_vols:
            vol_id = vol_shift.get("volunteer_id")
            if vol_id:
                try:
                    # Scanner count near this specific volunteer
                    vol_cnt = count // max(len(assigned_vols), 1)
                    supabase.table("volunteer_counts").upsert({
                        "volunteer_id": vol_id,
                        "event_id": event_id,
                        "zone": zname,
                        "active_count": vol_cnt,
                        "updated_at": now.isoformat()
                    }).execute()
                except Exception as e:
                    print(f"    Volunteer count upsert warning for {vol_id}: {e}")

        # Insert snapshot into crowd_zone_snapshots for historical Recharts graph
        try:
            supabase.table("crowd_zone_snapshots").insert({
                "event_id": event_id,
                "zone_id": zid,
                "estimated_count": count,
                "source": "volunteer_telemetry",
                "notes": f"Real-time volunteer BLE count ({len(assigned_vols)} active scanner(s))",
                "snapshot_at": now.isoformat()
            }).execute()
        except Exception:
            pass

    return zone_counts


def trigger_overcrowding_incident(
    supabase,
    event_id: str,
    target_zone: Dict[str, Any],
    assigned_shift: Optional[Dict[str, Any]]
) -> Dict[str, Any]:
    """
    Simulates a critical overcrowding scenario:
    1. Records an urgent operational incident in operational_incidents
    2. Sends high-priority push notification in event_notifications
    3. Dispatches a supervisor task to the assigned volunteer in supervisor_tasks
    """
    now = datetime.now(timezone.utc)
    zname = target_zone.get("name", "Main Stage")
    zid = target_zone["id"]
    cap = target_zone.get("operating_capacity") or target_zone.get("capacity_limit") or 200
    current_density = int(cap * 0.96)

    assigned_vol_id = assigned_shift.get("volunteer_id") if assigned_shift else None
    assigned_vol_name = assigned_shift.get("volunteer_name", "Volunteer Lead") if assigned_shift else "Lead Volunteer"

    # 1. Operational Incident
    inc_payload = {
        "event_id": event_id,
        "category": "crowd",
        "priority": "urgent",
        "status": "assigned",
        "title": f"CRITICAL: Overcrowding Surge at {zname} ({current_density}/{cap} - 96%)",
        "description": f"Attendee density reached dangerous 96% threshold at {zname}. Volunteer scanners indicate severe pinch point. Immediate crowd diversion and entrance throttle required.",
        "zone_id": zid,
        "venue_zone_name": zname,
        "assigned_to_id": assigned_vol_id,
        "assigned_to_name": assigned_vol_name,
        "reporter_type": "volunteer",
        "reporter_name": "Spatially Intelligence Engine",
        "created_at": now.isoformat(),
        "updated_at": now.isoformat()
    }

    incident_id = None
    try:
        # Clear previous active crowd incidents for clean presentation
        supabase.table("operational_incidents").delete().eq("event_id", event_id).eq("category", "crowd").execute()
        res = supabase.table("operational_incidents").insert(inc_payload).execute()
        if res.data:
            incident_id = res.data[0]["id"]
            print(f"[!] Urgent Incident Logged: {inc_payload['title']} (ID: {incident_id})")
    except Exception as e:
        print(f"    Incident trigger warning: {e}")

    # 2. In-App Push Notification (event_notifications)
    try:
        notif_payload = {
            "event_id": event_id,
            "title": f"⚠️ URGENT: Overcrowding at {zname}",
            "body": f"Density reached 96%. Assigned volunteer {assigned_vol_name}: initiate diversion protocol to West Wing Corridor immediately.",
            "category": "urgent",
            "is_active": True,
            "target_user_id": assigned_vol_id,
            "created_at": now.isoformat()
        }
        supabase.table("event_notifications").insert(notif_payload).execute()
        print(f"[*] Push Alert Dispatched to Volunteer: '{assigned_vol_name}'")
    except Exception as e:
        print(f"    Notification trigger warning: {e}")

    # 3. Supervisor Task (supervisor_tasks)
    try:
        task_payload = {
            "event_id": event_id,
            "title": f"Execute Crowd Diversion Protocol - {zname}",
            "description": "Throttle incoming flow at main portal; direct excess attendee traffic toward secondary exhibition hall.",
            "status": "in_progress",
            "priority": "urgent",
            "assigned_to_id": assigned_vol_id,
            "assigned_to_name": assigned_vol_name,
            "supervisor_id": assigned_vol_id,
            "supervisor_name": "Operations Lead",
            "zone_id": zid,
            "zone_name": zname,
            "created_at": now.isoformat(),
            "updated_at": now.isoformat()
        }
        supabase.table("supervisor_tasks").insert(task_payload).execute()
        print(f"[*] Dispatch Task Assigned: '{task_payload['title']}' -> {assigned_vol_name}")
    except Exception as e:
        print(f"    Task trigger warning: {e}")

    return {
        "incident_id": incident_id,
        "zone": zname,
        "density": current_density,
        "capacity": cap,
        "assigned_to": assigned_vol_name
    }


def resolve_overcrowding_scenario(
    supabase,
    event_id: str,
    incident_info: Dict[str, Any],
    target_zone: Dict[str, Any]
):
    """Simulates volunteer response and subsequent crowd relief/resolution."""
    now = datetime.now(timezone.utc)
    zid = target_zone["id"]
    zname = target_zone.get("name", "Main Stage")
    cap = target_zone.get("operating_capacity") or target_zone.get("capacity_limit") or 200
    safe_count = int(cap * 0.68)  # Drops to comfortable 68%

    print(f"\n[*] Volunteer '{incident_info['assigned_to']}' executed crowd diversion at {zname}...")
    print(f"[*] Diverted excess traffic -> Density decreased to safe {safe_count}/{cap} (68% capacity).")

    # Update counts
    try:
        supabase.table("volunteer_counts").update({
            "active_count": safe_count,
            "updated_at": now.isoformat()
        }).eq("event_id", event_id).eq("zone", zname).execute()

        supabase.table("crowd_zone_snapshots").insert({
            "event_id": event_id,
            "zone_id": zid,
            "estimated_count": safe_count,
            "source": "volunteer_telemetry",
            "notes": "Post-diversion crowd stabilization by on-ground volunteers",
            "snapshot_at": now.isoformat()
        }).execute()
    except Exception as e:
        print(f"    Count relief warning: {e}")

    # Mark incident resolved
    if incident_info.get("incident_id"):
        try:
            supabase.table("operational_incidents").update({
                "status": "resolved",
                "resolved_at": now.isoformat(),
                "resolution_notes": f"Volunteers successfully diverted attendee flow to South Exit. Bottleneck cleared by {incident_info['assigned_to']}.",
                "updated_at": now.isoformat()
            }).eq("id", incident_info["incident_id"]).execute()
            print(f"[OK] Operational Incident marked RESOLVED on Admin Dashboard.")
        except Exception as e:
            print(f"    Incident resolution warning: {e}")

    # Mark supervisor task completed
    try:
        supabase.table("supervisor_tasks").update({
            "status": "completed",
            "updated_at": now.isoformat()
        }).eq("event_id", event_id).eq("zone_id", zid).execute()
        print(f"[OK] Supervisor Task marked COMPLETED.")
    except Exception as e:
        print(f"    Task completion warning: {e}")


def print_banner(event_name: str, event_id: str):
    print("\n" + "=" * 68)
    print("        SPATIALLY VOLUNTEER & REAL-TIME DEMO HARNESS")
    print("=" * 68)
    print(f"  Target Event : {event_name}")
    print(f"  Event UUID   : {event_id}")
    print("=" * 68)


def main():
    parser = argparse.ArgumentParser(description="Simulate volunteer presence, proximity counts and overcrowding incidents")
    parser.add_argument("--event-id", type=str, help="Target event UUID (auto-detected if omitted)")
    parser.add_argument("--loop", action="store_true", help="Run in continuous live loop without asking")
    parser.add_argument("--seed-only", action="store_true", help="Seed baseline metrics and exit immediately")
    parser.add_argument("--interval", type=int, default=8, help="Loop tick interval in seconds (default: 8)")
    args = parser.parse_args()

    if not get_supabase:
        print("[ERROR] Supabase client is unconfigured. Verify server/.env configuration.")
        sys.exit(1)

    supabase = get_supabase()

    # 1. Resolve or Create Event
    event = resolve_or_create_event(supabase, args.event_id)
    event_id = event["id"]
    event_name = event.get("name", "Spatially Event")

    print_banner(event_name, event_id)

    # 2. Ensure Zones
    zones = ensure_event_zones(supabase, event_id)
    print(f"[OK] {len(zones)} Operational Zones loaded:")
    for z in zones:
        cap = z.get("operating_capacity") or z.get("capacity_limit") or 100
        print(f"     - {z.get('name')}: Operating Capacity = {cap}")

    # 3. Resolve Volunteers
    volunteers = resolve_volunteers(supabase)
    print(f"\n[OK] {len(volunteers)} Volunteer Profiles enrolled:")
    for v in volunteers:
        print(f"     - {v.get('full_name')} ({v.get('email')})")

    # 4. Configure Squads
    teams = ensure_event_teams(supabase, event_id, volunteers)
    print(f"\n[OK] {len(teams)} Event Squads active:")
    for t in teams:
        print(f"     - {t.get('name')}: {t.get('description', '')}")

    # 5. Seed Shifts & Roster
    active_shifts = seed_shifts_and_roster(supabase, event_id, volunteers, zones, teams)
    on_duty_count = sum(1 for s in active_shifts if s.get("status") == "active")
    on_break_count = sum(1 for s in active_shifts if s.get("status") == "on_break")
    print(f"\n[OK] Shifts Seeded: {on_duty_count} on duty, {on_break_count} on break.")

    # 6. Target primary zone for overcrowding test (Pick first monitored zone with highest capacity)
    primary_zone = max(zones, key=lambda z: (z.get("operating_capacity") or z.get("capacity_limit") or 100))
    assigned_primary_shift = next((s for s in active_shifts if s.get("zone_id") == primary_zone["id"]), active_shifts[0] if active_shifts else None)

    # 7. Initial Telemetry: Update proximity counts across all volunteers
    print(f"\n[*] Generating Live Attendee Proximity Telemetry per Volunteer Station...")
    zone_counts = update_volunteer_proximity_telemetry(
        supabase,
        event_id,
        zones,
        active_shifts,
        overcrowded_zone_id=primary_zone["id"],
        overcrowded_ratio=0.96
    )

    print("\n" + "-" * 68)
    print("  LIVE VOLUNTEER PROXIMITY TELEMETRY TABLE (Near Volunteers)")
    print("-" * 68)
    for z in zones:
        zname = z.get("name")
        cap = z.get("operating_capacity") or z.get("capacity_limit") or 100
        cnt = zone_counts.get(zname, 0)
        pct = int((cnt / cap) * 100) if cap else 0
        status_tag = "[CRITICAL 96%]" if z["id"] == primary_zone["id"] else "[NORMAL]"
        assigned_names = [s.get("volunteer_name") for s in active_shifts if s.get("zone_id") == z["id"] and s.get("status") == "active"]
        vol_str = ", ".join(assigned_names) if assigned_names else "Station Unit"
        print(f"  {zname:<24} : {cnt:>3} / {cap:<3} attendees ({pct:>2}%)  {status_tag:<14} Vol: {vol_str}")
    print("-" * 68)

    # 8. Trigger Overcrowding Incident & Alerts
    print("\n[*] Triggering Simulated Overcrowding Incident & Volunteer Notification...")
    incident_info = trigger_overcrowding_incident(supabase, event_id, primary_zone, assigned_primary_shift)

    print("\n" + "=" * 68)
    print("  >>> INITIAL BASELINE SEED COMPLETE! <<<")
    print("  Check your Admin Dashboard at: http://localhost:5173")
    print("  - Operational Health Gauge will show: CRITICAL (Red)")
    print("  - Active Incident ticker will display: Overcrowding at " + primary_zone.get("name"))
    print("  - Assigned Volunteer has received the incident dispatch.")
    print("=" * 68)

    # Hybrid Decision: Run live loop?
    should_loop = args.loop
    if not should_loop and not args.seed_only:
        try:
            choice = input("\nRun continuous live simulation loop for your presentation? [Y/n] (default Y): ").strip().lower()
            should_loop = (choice == "" or choice == "y" or choice == "yes")
        except EOFError:
            should_loop = False

    if not should_loop:
        print("[*] Simulation complete. Exiting.")
        return

    print(f"\n[*] Starting Real-time Ticker Loop (every {args.interval}s). Press Ctrl+C to stop.")
    print("    Phase 1: Overcrowding alert active with live volunteer scanner jitter.")
    print("    Phase 2: After 30s, volunteer resolves the bottleneck and density stabilizes.\n")

    tick = 0
    resolved = False

    try:
        while True:
            tick += 1
            time.sleep(args.interval)
            elapsed = tick * args.interval

            # After 30 seconds, simulate the volunteer resolving the bottleneck
            if elapsed >= 30 and not resolved:
                resolve_overcrowding_scenario(supabase, event_id, incident_info, primary_zone)
                resolved = True

            # In loop, jitter proximity counts to demonstrate live Supabase CDC updates
            curr_overcrowd_id = None if resolved else primary_zone["id"]
            zone_counts = update_volunteer_proximity_telemetry(
                supabase,
                event_id,
                zones,
                active_shifts,
                overcrowded_zone_id=curr_overcrowd_id,
                overcrowded_ratio=0.96
            )

            primary_cnt = zone_counts.get(primary_zone.get("name"), 0)
            primary_cap = primary_zone.get("operating_capacity") or primary_zone.get("capacity_limit") or 200
            pct = int((primary_cnt / primary_cap) * 100)
            state_label = "STABILIZED" if resolved else "OVERCROWDED (ALERT ACTIVE)"
            print(f"[{datetime.now().strftime('%H:%M:%S')}] Tick #{tick} (+{elapsed}s) | {primary_zone.get('name')}: {primary_cnt}/{primary_cap} ({pct}%) [{state_label}] | Health: {'HEALTHY' if resolved else 'CRITICAL'}")

    except KeyboardInterrupt:
        print("\n[*] Live simulation loop stopped by user. Dashboard remains in current state.")


if __name__ == "__main__":
    main()
