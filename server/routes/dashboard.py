from fastapi import APIRouter, HTTPException, Depends, Query
from config import get_supabase
from middleware.auth import get_current_user, require_organizer

router = APIRouter(prefix="/api/dashboard", tags=["Dashboard"])


@router.get("/user")
async def user_dashboard(current_user: dict = Depends(get_current_user)):
    if current_user["user_type"] != "user":
        raise HTTPException(status_code=403, detail="User access required")

    supabase = get_supabase()

    registrations = (
        supabase.table("user_event_registrations")
        .select("event_id")
        .eq("user_id", current_user["user_id"])
        .eq("status", "registered")
        .execute()
    )

    registered_ids = [r["event_id"] for r in registrations.data]

    registered_events = []
    if registered_ids:
        registered_events = (
            supabase.table("events")
            .select("*")
            .in_("id", registered_ids)
            .order("event_date", desc=False)
            .execute()
        ).data

    upcoming_events = (
        supabase.table("events")
        .select("*")
        .in_("status", ["upcoming", "live"])
        .order("event_date", desc=False)
        .limit(10)
        .execute()
    )

    live_count = sum(1 for e in registered_events if e.get("status") == "live")
    upcoming_count = sum(1 for e in registered_events if e.get("status") == "upcoming")

    return {
        "stats": {
            "total_registered": len(registered_ids),
            "live_events": live_count,
            "upcoming_events": upcoming_count,
        },
        "registered_events": registered_events,
        "upcoming_events": upcoming_events.data,
    }


@router.get("/volunteer")
async def volunteer_dashboard(current_user: dict = Depends(get_current_user)):
    if current_user["user_type"] != "volunteer":
        raise HTTPException(status_code=403, detail="Volunteer access required")

    supabase = get_supabase()

    assignments = (
        supabase.table("volunteer_assignments")
        .select("event_id")
        .eq("volunteer_id", current_user["user_id"])
        .execute()
    )

    assigned_ids = list(set(a["event_id"] for a in assignments.data))

    assigned_events = []
    if assigned_ids:
        assigned_events = (
            supabase.table("events")
            .select("*")
            .in_("id", assigned_ids)
            .order("event_date", desc=False)
            .execute()
        ).data

    pending_invitations = (
        supabase.table("event_invitations")
        .select("*")
        .eq("volunteer_user_id", current_user["user_id"])
        .eq("status", "pending")
        .execute()
    )

    live_events = [e for e in assigned_events if e.get("status") == "live"]
    upcoming_events = [e for e in assigned_events if e.get("status") == "upcoming"]

    total_observations = 0
    for eid in assigned_ids:
        obs = (
            supabase.table("observations")
            .select("id", count="exact")
            .eq("event_id", eid)
            .execute()
        )
        total_observations += obs.count or 0

    return {
        "stats": {
            "total_assignments": len(assigned_ids),
            "live_events": len(live_events),
            "upcoming_events": len(upcoming_events),
            "total_observations": total_observations,
            "pending_invitations": len(pending_invitations.data),
        },
        "assigned_events": assigned_events,
        "assignments": assignments.data,
        "pending_invitations": pending_invitations.data,
    }


@router.get("/organizer")
async def organizer_dashboard(current_user: dict = Depends(require_organizer)):
    supabase = get_supabase()

    my_events = (
        supabase.table("events")
        .select("*")
        .eq("organizer_id", current_user["user_id"])
        .order("event_date", desc=False)
        .execute()
    )

    event_ids = [e["id"] for e in my_events.data]

    total_tickets = 0
    total_checkins = 0
    total_volunteers = 0
    total_observations = 0

    for eid in event_ids:
        tickets = (
            supabase.table("tickets")
            .select("id", count="exact")
            .eq("event_id", eid)
            .execute()
        )
        total_tickets += tickets.count or 0

        checkins = (
            supabase.table("tickets")
            .select("id", count="exact")
            .eq("event_id", eid)
            .eq("status", "checked_in")
            .execute()
        )
        total_checkins += checkins.count or 0

        vols = (
            supabase.table("volunteer_assignments")
            .select("id", count="exact")
            .eq("event_id", eid)
            .execute()
        )
        total_volunteers += vols.count or 0

        obs = (
            supabase.table("observations")
            .select("id", count="exact")
            .eq("event_id", eid)
            .execute()
        )
        total_observations += obs.count or 0

    live_events = [e for e in my_events.data if e.get("status") == "live"]
    upcoming_events = [e for e in my_events.data if e.get("status") == "upcoming"]
    ended_events = [e for e in my_events.data if e.get("status") == "ended"]

    user_registrations = []
    for eid in event_ids:
        regs = (
            supabase.table("user_event_registrations")
            .select("*", count="exact")
            .eq("event_id", eid)
            .eq("status", "registered")
            .execute()
        )
        user_registrations.append({"event_id": eid, "count": regs.count or 0})

    return {
        "stats": {
            "total_events": len(my_events.data),
            "live_events": len(live_events),
            "upcoming_events": len(upcoming_events),
            "ended_events": len(ended_events),
            "total_tickets": total_tickets,
            "total_checkins": total_checkins,
            "total_volunteers": total_volunteers,
            "total_observations": total_observations,
        },
        "events": my_events.data,
        "user_registrations": user_registrations,
    }


@router.get("/crowd-data/{event_id}")
async def get_crowd_data(event_id: str, current_user: dict = Depends(get_current_user)):
    supabase = get_supabase()

    event = supabase.table("events").select("zones").eq("id", event_id).execute()
    if not event.data:
        raise HTTPException(status_code=404, detail="Event not found")

    counts = (
        supabase.table("volunteer_counts")
        .select("*")
        .eq("event_id", event_id)
        .execute()
    )

    zones = event.data[0].get("zones", [])
    zone_data = {}
    for zone in zones:
        zone_counts = [c for c in counts.data if c.get("zone") == zone]
        total = sum(c.get("active_count", 0) for c in zone_counts)
        zone_data[zone] = {
            "active_count": total,
            "volunteer_count": len(zone_counts),
        }

    recent_observations = (
        supabase.table("observations")
        .select("zone, scanned_at, ephemeral_id")
        .eq("event_id", event_id)
        .eq("is_spatially_device", True)
        .order("scanned_at", desc=True)
        .limit(200)
        .execute()
    )

    hourly_data = {}
    for obs in recent_observations.data:
        ts = obs.get("scanned_at", "")
        if ts:
            hour = ts[:13]
            zone = obs.get("zone", "Unknown")
            key = f"{hour}|{zone}"
            if key not in hourly_data:
                hourly_data[key] = {"hour": hour, "zone": zone, "unique_devices": set()}
            hourly_data[key]["unique_devices"].add(obs.get("ephemeral_id", ""))

    timeline = []
    for entry in hourly_data.values():
        timeline.append({
            "hour": entry["hour"],
            "zone": entry["zone"],
            "count": len(entry["unique_devices"]),
        })

    timeline.sort(key=lambda x: x["hour"])

    return {
        "zone_data": zone_data,
        "timeline": timeline,
        "raw_counts": counts.data,
    }
