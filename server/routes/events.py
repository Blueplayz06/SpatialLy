from fastapi import APIRouter, HTTPException, Depends
from models import EventCreate, EventUpdate
from config import get_supabase
from middleware.auth import get_current_user, require_organizer
from datetime import datetime, timezone

router = APIRouter(prefix="/api/events", tags=["Events"])


@router.get("/public")
async def list_public_events():
    supabase = get_supabase()
    result = (
        supabase.table("events")
        .select("*")
        .in_("status", ["upcoming", "live"])
        .order("event_date", desc=False)
        .execute()
    )
    return {"events": result.data}


@router.get("/all")
async def list_all_events(current_user: dict = Depends(get_current_user)):
    supabase = get_supabase()
    result = (
        supabase.table("events")
        .select("*")
        .order("event_date", desc=False)
        .execute()
    )
    return {"events": result.data}


@router.get("/organizer/mine")
async def list_organizer_events(current_user: dict = Depends(require_organizer)):
    supabase = get_supabase()
    result = (
        supabase.table("events")
        .select("*")
        .eq("organizer_id", current_user["user_id"])
        .order("event_date", desc=False)
        .execute()
    )
    return {"events": result.data}


@router.get("/user/registered")
async def list_user_registered_events(current_user: dict = Depends(get_current_user)):
    supabase = get_supabase()

    registrations = (
        supabase.table("user_event_registrations")
        .select("event_id")
        .eq("user_id", current_user["user_id"])
        .eq("status", "registered")
        .execute()
    )

    if not registrations.data:
        return {"events": []}

    event_ids = [r["event_id"] for r in registrations.data]
    events = (
        supabase.table("events")
        .select("*")
        .in_("id", event_ids)
        .order("event_date", desc=False)
        .execute()
    )

    return {"events": events.data}


@router.get("/volunteer/assigned")
async def list_volunteer_assigned_events(
    current_user: dict = Depends(get_current_user),
):
    supabase = get_supabase()

    if current_user["user_type"] != "volunteer":
        raise HTTPException(status_code=403, detail="Volunteer access required")

    assignments = (
        supabase.table("volunteer_assignments")
        .select("event_id")
        .eq("volunteer_id", current_user["user_id"])
        .execute()
    )

    if not assignments.data:
        return {"events": [], "assignments": []}

    event_ids = list(set(a["event_id"] for a in assignments.data))
    events = (
        supabase.table("events")
        .select("*")
        .in_("id", event_ids)
        .order("event_date", desc=False)
        .execute()
    )

    return {"events": events.data, "assignments": assignments.data}


@router.get("/{event_id}")
async def get_event(event_id: str, current_user: dict = Depends(get_current_user)):
    supabase = get_supabase()
    result = supabase.table("events").select("*").eq("id", event_id).execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Event not found")

    event = result.data[0]

    ticket_count = (
        supabase.table("tickets")
        .select("id", count="exact")
        .eq("event_id", event_id)
        .execute()
    )

    checkin_count = (
        supabase.table("tickets")
        .select("id", count="exact")
        .eq("event_id", event_id)
        .eq("status", "checked_in")
        .execute()
    )

    volunteer_count = (
        supabase.table("volunteer_assignments")
        .select("id", count="exact")
        .eq("event_id", event_id)
        .execute()
    )

    event["ticket_count"] = ticket_count.count or 0
    event["checkin_count"] = checkin_count.count or 0
    event["volunteer_count"] = volunteer_count.count or 0

    return {"event": event}


@router.post("/")
async def create_event(data: EventCreate, current_user: dict = Depends(require_organizer)):
    supabase = get_supabase()

    existing = (
        supabase.table("events")
        .select("id, event_date, start_time, end_time")
        .eq("organizer_id", current_user["user_id"])
        .execute()
    )

    for ev in existing.data:
        if ev.get("event_date") and data.event_date:
            existing_date = ev["event_date"][:10] if ev["event_date"] else ""
            new_date = data.event_date[:10] if data.event_date else ""

            if existing_date == new_date:
                if data.start_time and data.end_time and ev.get("start_time") and ev.get("end_time"):
                    if not (data.end_time <= ev["start_time"] or data.start_time >= ev["end_time"]):
                        raise HTTPException(
                            status_code=409,
                            detail=f"You already have an event scheduled on {new_date} that overlaps with this time slot",
                        )
                else:
                    raise HTTPException(
                        status_code=409,
                        detail=f"You already have an event scheduled on {new_date}. Specify start and end times to allow multiple events per day.",
                    )

    new_event = {
        "name": data.name,
        "venue": data.venue,
        "event_date": data.event_date,
        "status": "upcoming",
        "zones": data.zones,
        "description": data.description or "",
        "capacity": data.capacity or 0,
        "organizer_id": current_user["user_id"],
        "organizer_name": data.organizer_name or "",
        "start_time": data.start_time,
        "end_time": data.end_time,
        "location_address": data.location_address or "",
    }
    if data.venue_id:
        new_event["venue_id"] = data.venue_id

    result = supabase.table("events").insert(new_event).execute()

    return {"message": "Event created successfully", "event": result.data[0]}


@router.put("/{event_id}")
async def update_event(
    event_id: str, data: EventUpdate, current_user: dict = Depends(require_organizer)
):
    supabase = get_supabase()

    existing = supabase.table("events").select("*").eq("id", event_id).execute()
    if not existing.data:
        raise HTTPException(status_code=404, detail="Event not found")

    event = existing.data[0]
    if event.get("organizer_id") != current_user["user_id"]:
        raise HTTPException(status_code=403, detail="You can only update your own events")

    updates = {}
    for field, value in data.model_dump(exclude_none=True).items():
        updates[field] = value

    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    result = supabase.table("events").update(updates).eq("id", event_id).execute()

    return {"message": "Event updated successfully", "event": result.data[0]}


@router.put("/{event_id}/status")
async def update_event_status(
    event_id: str, data: dict, current_user: dict = Depends(require_organizer)
):
    supabase = get_supabase()
    existing = supabase.table("events").select("id, organizer_id").eq("id", event_id).execute()
    if not existing.data:
        raise HTTPException(status_code=404, detail="Event not found")
    if existing.data[0].get("organizer_id") != current_user["user_id"]:
        raise HTTPException(status_code=403, detail="You can only update your own events")

    new_status = data.get("status")
    valid_statuses = ["draft", "upcoming", "published", "live", "paused", "ended"]
    if not new_status or new_status not in valid_statuses:
        raise HTTPException(status_code=400, detail=f"Invalid status '{new_status}'. Allowed: {valid_statuses}")

    result = supabase.table("events").update({"status": new_status}).eq("id", event_id).execute()
    return {"message": f"Event status updated to {new_status}", "event": result.data[0]}


@router.delete("/{event_id}")
async def delete_event(event_id: str, current_user: dict = Depends(require_organizer)):
    supabase = get_supabase()

    existing = supabase.table("events").select("*").eq("id", event_id).execute()
    if not existing.data:
        raise HTTPException(status_code=404, detail="Event not found")

    if existing.data[0].get("organizer_id") != current_user["user_id"]:
        raise HTTPException(status_code=403, detail="You can only delete your own events")

    supabase.table("events").delete().eq("id", event_id).execute()

    return {"message": "Event deleted successfully"}


@router.post("/{event_id}/register")
async def register_for_event(
    event_id: str, current_user: dict = Depends(get_current_user)
):
    if current_user["user_type"] != "user":
        raise HTTPException(status_code=403, detail="Only users can register for events")

    supabase = get_supabase()

    event = supabase.table("events").select("*").eq("id", event_id).execute()
    if not event.data:
        raise HTTPException(status_code=404, detail="Event not found")

    ev = event.data[0]
    if ev.get("status") == "ended":
        raise HTTPException(status_code=400, detail="Cannot register for an ended event")

    existing = (
        supabase.table("user_event_registrations")
        .select("id, status")
        .eq("user_id", current_user["user_id"])
        .eq("event_id", event_id)
        .execute()
    )
    
    if existing.data:
        if existing.data[0].get("status") == "registered":
            raise HTTPException(status_code=409, detail="You are already registered for this event")
        else:
            # Check capacity if re-registering
            if ev.get("capacity") and ev["capacity"] > 0:
                reg_count = (
                    supabase.table("user_event_registrations")
                    .select("id", count="exact")
                    .eq("event_id", event_id)
                    .eq("status", "registered")
                    .execute()
                )
                if (reg_count.count or 0) >= ev["capacity"]:
                    raise HTTPException(status_code=409, detail="Event has reached maximum capacity")
            
            # Re-register by updating status
            supabase.table("user_event_registrations").update(
                {"status": "registered"}
            ).eq("user_id", current_user["user_id"]).eq("event_id", event_id).execute()
            
            return {"message": "Successfully registered for the event"}

    if ev.get("capacity") and ev["capacity"] > 0:
        reg_count = (
            supabase.table("user_event_registrations")
            .select("id", count="exact")
            .eq("event_id", event_id)
            .eq("status", "registered")
            .execute()
        )
        if (reg_count.count or 0) >= ev["capacity"]:
            raise HTTPException(status_code=409, detail="Event has reached maximum capacity")

    supabase.table("user_event_registrations").insert(
        {
            "user_id": current_user["user_id"],
            "event_id": event_id,
            "status": "registered",
        }
    ).execute()

    return {"message": "Successfully registered for the event"}


@router.delete("/{event_id}/register")
async def cancel_registration(
    event_id: str, current_user: dict = Depends(get_current_user)
):
    supabase = get_supabase()

    existing = (
        supabase.table("user_event_registrations")
        .select("id")
        .eq("user_id", current_user["user_id"])
        .eq("event_id", event_id)
        .eq("status", "registered")
        .execute()
    )

    if not existing.data:
        raise HTTPException(status_code=404, detail="Registration not found")

    supabase.table("user_event_registrations").update(
        {"status": "cancelled"}
    ).eq("user_id", current_user["user_id"]).eq("event_id", event_id).execute()

    return {"message": "Registration cancelled successfully"}


# ═══════════════════════════════════════════════════════════════
# VENUES ENDPOINT
# ═══════════════════════════════════════════════════════════════

venues_router = APIRouter(prefix="/api/venues", tags=["Venues"])


@venues_router.get("")
async def list_venues():
    supabase = get_supabase()
    result = supabase.table("venues").select("id, name, address, venue_type, default_capacity").order("name").execute()
    return {"venues": result.data or []}

