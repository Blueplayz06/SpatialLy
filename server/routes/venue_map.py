from fastapi import APIRouter, HTTPException, Depends, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from config import get_supabase
from middleware.auth import get_current_user, require_organizer, require_volunteer

router = APIRouter(prefix="/api/venue-map", tags=["Venue Map"])


# ═══════════════════════════════════════════════════════════════
# PYDANTIC MODELS
# ═══════════════════════════════════════════════════════════════

class ZoneBoundsUpdate(BaseModel):
    zone_id: str
    bounds: Dict[str, float]  # {left, top, width, height}


class ZoneLayoutBoundsRequest(BaseModel):
    layout: List[ZoneBoundsUpdate]


class SwitchPositionRequest(BaseModel):
    target_volunteer_id: str


# ═══════════════════════════════════════════════════════════════
# DENSITY / CROWD
# ═══════════════════════════════════════════════════════════════

@router.get("/{event_id}/density")
async def get_zone_density(event_id: str, current_user: dict = Depends(get_current_user)):
    """Get crowd density per zone from crowd_zone_snapshots / BLE crowd_data table."""
    supabase = get_supabase()

    # Verify event exists and get event_zones
    zones_res = (
        supabase.table("event_zones")
        .select("id, name, code, capacity_limit, operating_capacity, warning_threshold, critical_threshold, operational_status")
        .eq("event_id", event_id)
        .eq("is_active", True)
        .execute()
    )

    density = {}
    zone_meta = {}

    for z in zones_res.data:
        zone_meta[z["name"]] = z
        density[z["name"]] = 0

    # Try RPC first for live crowd data
    try:
        crowd = supabase.rpc("get_zone_crowd_summary", {"p_event_id": event_id}).execute()
        for row in crowd.data:
            zone = row.get("zone_name", "unknown")
            count = row.get("active_count", 0)
            density[zone] = count
    except Exception as e:
        print(f"[venue_map] RPC crowd summary failed, falling back: {e}")
        # Fallback: query crowd_zone_snapshots for latest per zone
        try:
            snaps = (
                supabase.table("crowd_zone_snapshots")
                .select("zone_id, estimated_count, snapshot_at")
                .eq("event_id", event_id)
                .order("snapshot_at", desc=True)
                .limit(100)
                .execute()
            )
            seen_zones = set()
            for row in snaps.data:
                zid = row["zone_id"]
                if zid not in seen_zones:
                    seen_zones.add(zid)
                    # Map zone_id back to name
                    for z in zones_res.data:
                        if z["id"] == zid:
                            density[z["name"]] = row.get("estimated_count", 0)
                            break
        except Exception as e2:
            print(f"[venue_map] Snapshot fallback also failed: {e2}")

    return {
        "event_id": event_id,
        "zones": [z["name"] for z in zones_res.data],
        "density": density,
        "zone_meta": zone_meta,
    }


# ═══════════════════════════════════════════════════════════════
# LAYOUT (from DB — no flat file)
# ═══════════════════════════════════════════════════════════════

@router.get("/{event_id}/layout")
async def get_zone_layout(
    event_id: str,
    level_id: Optional[str] = Query(None),
    current_user: dict = Depends(get_current_user),
):
    """Get zone layout from event_zones joined to venue_zones for polygon + bounds data."""
    supabase = get_supabase()

    query = (
        supabase.table("event_zones")
        .select(
            "id, name, code, floor_level, capacity_limit, operating_capacity, "
            "bounds, entrance_point, operational_status, warning_threshold, critical_threshold, "
            "level_id, venue_zone_id, "
            "venue_zone:venue_zones(id, code, name, polygon, bounds, entrance_point)"
        )
        .eq("event_id", event_id)
        .eq("is_active", True)
    )

    if level_id:
        query = query.eq("level_id", level_id)

    result = query.execute()

    # Normalize into a layout array for the frontend
    layout = []
    for z in result.data:
        venue_zone = z.get("venue_zone") or {}
        # Prefer venue_zone polygon, fall back to bounds-derived rect
        polygon = venue_zone.get("polygon")
        bounds = z.get("bounds") or venue_zone.get("bounds") or {
            "left": 0.1, "top": 0.1, "width": 0.2, "height": 0.2
        }
        entrance = z.get("entrance_point") or venue_zone.get("entrance_point") or {
            "x": bounds.get("left", 0.1) + bounds.get("width", 0.2) / 2,
            "y": bounds.get("top", 0.1) + bounds.get("height", 0.2) / 2,
        }

        layout.append({
            "zone_id": z["id"],
            "zone": z["name"],
            "code": z["code"],
            "level_id": z.get("level_id"),
            "venue_zone_id": z.get("venue_zone_id"),
            "polygon": polygon,
            "bounds": bounds,
            "entrance_point": entrance,
            # centroid x/y for backward compat with frontend pin placement
            "x": entrance["x"],
            "y": entrance["y"],
            "capacity_limit": z.get("capacity_limit"),
            "operating_capacity": z.get("operating_capacity"),
            "warning_threshold": z.get("warning_threshold", 0.80),
            "critical_threshold": z.get("critical_threshold", 0.90),
            "operational_status": z.get("operational_status", "active"),
        })

    return {"event_id": event_id, "layout": layout}


@router.post("/{event_id}/layout")
async def save_zone_layout(
    event_id: str,
    data: ZoneLayoutBoundsRequest,
    current_user: dict = Depends(require_organizer),
):
    """Save custom zone centroid/bounds positions to event_zones in DB (not flat file)."""
    supabase = get_supabase()

    # Verify ownership
    event = supabase.table("events").select("id, organizer_id").eq("id", event_id).execute()
    if not event.data or event.data[0].get("organizer_id") != current_user["user_id"]:
        raise HTTPException(status_code=403, detail="Not authorized to edit zones for this event")

    for item in data.layout:
        supabase.table("event_zones").update({
            "bounds": item.bounds,
        }).eq("id", item.zone_id).eq("event_id", event_id).execute()

    return {"message": "Layout saved successfully"}


# ═══════════════════════════════════════════════════════════════
# LEVELS
# ═══════════════════════════════════════════════════════════════

@router.get("/{event_id}/levels")
async def get_event_levels(event_id: str, current_user: dict = Depends(get_current_user)):
    """Get venue floor levels for an event (from venue_levels via events.venue_id)."""
    supabase = get_supabase()

    # Get event's venue_id
    event = supabase.table("events").select("id, venue_id").eq("id", event_id).execute()
    if not event.data:
        raise HTTPException(status_code=404, detail="Event not found")

    venue_id = event.data[0].get("venue_id")
    if not venue_id:
        return {"levels": []}

    levels = (
        supabase.table("venue_levels")
        .select("id, level_index, name, short_code, level_type, map_asset_url, aspect_ratio, display_order")
        .eq("venue_id", venue_id)
        .order("display_order")
        .execute()
    )

    return {"venue_id": venue_id, "levels": levels.data}


# ═══════════════════════════════════════════════════════════════
# VOLUNTEERS (from volunteer_shifts — not legacy volunteer_map_positions)
# ═══════════════════════════════════════════════════════════════

@router.get("/{event_id}/volunteers")
async def get_volunteer_positions(event_id: str, current_user: dict = Depends(get_current_user)):
    """Get all active volunteer positions for this event from volunteer_shifts."""
    supabase = get_supabase()

    # Get active/scheduled shifts for this event
    shifts = (
        supabase.table("volunteer_shifts")
        .select("id, volunteer_id, zone_id, zone_name, status, break_state, scheduled_start, scheduled_end")
        .eq("event_id", event_id)
        .in_("status", ["scheduled", "active", "on_break"])
        .execute()
    )

    if not shifts.data:
        return {"positions": []}

    # Enrich with volunteer profile names
    vol_ids = list(set(s["volunteer_id"] for s in shifts.data if s.get("volunteer_id")))
    vol_map = {}
    if vol_ids:
        profiles = (
            supabase.table("profiles")
            .select("id, full_name, avatar_url")
            .in_("id", vol_ids)
            .execute()
        )
        vol_map = {p["id"]: p for p in profiles.data}

    # Get zone centroids for pin placement
    zone_ids = list(set(s["zone_id"] for s in shifts.data if s.get("zone_id")))
    zone_map = {}
    if zone_ids:
        zones = (
            supabase.table("event_zones")
            .select("id, name, bounds, entrance_point")
            .in_("id", zone_ids)
            .execute()
        )
        for z in zones.data:
            ep = z.get("entrance_point") or {}
            b = z.get("bounds") or {}
            zone_map[z["id"]] = {
                "name": z["name"],
                "x": ep.get("x", b.get("left", 0.1) + b.get("width", 0.2) / 2) * 100,
                "y": ep.get("y", b.get("top", 0.1) + b.get("height", 0.2) / 2) * 100,
            }

    enriched = []
    for shift in shifts.data:
        vol_profile = vol_map.get(shift["volunteer_id"], {})
        zone_info = zone_map.get(shift["zone_id"], {})

        enriched.append({
            "volunteer_user_id": shift["volunteer_id"],
            "volunteer_name": vol_profile.get("full_name", "Unknown"),
            "avatar_url": vol_profile.get("avatar_url"),
            "zone": shift.get("zone_name") or zone_info.get("name", "Unknown"),
            "zone_id": shift.get("zone_id"),
            "pos_x": zone_info.get("x", 50.0),
            "pos_y": zone_info.get("y", 50.0),
            "status": shift.get("status"),
            "break_state": shift.get("break_state"),
            "shift_id": shift["id"],
        })

    return {"positions": enriched}


# ═══════════════════════════════════════════════════════════════
# VOLUNTEER ZONE ASSIGNMENT (via volunteer_shifts)
# ═══════════════════════════════════════════════════════════════

@router.post("/{event_id}/assign-position")
async def assign_volunteer_zone(
    event_id: str,
    data: dict,
    current_user: dict = Depends(require_organizer),
):
    """Organizer assigns a volunteer to a zone by updating their active shift's zone_id."""
    supabase = get_supabase()

    volunteer_id = data.get("volunteer_user_id") or data.get("volunteer_id")
    zone_id = data.get("zone_id")
    zone_name = data.get("zone")

    if not volunteer_id:
        raise HTTPException(status_code=400, detail="volunteer_user_id is required")

    event = supabase.table("events").select("id, organizer_id").eq("id", event_id).execute()
    if not event.data or event.data[0].get("organizer_id") != current_user["user_id"]:
        raise HTTPException(status_code=403, detail="You can only manage your own events")

    # Verify volunteer is assigned to this event
    assignment = (
        supabase.table("volunteer_assignments")
        .select("id")
        .eq("event_id", event_id)
        .eq("volunteer_id", volunteer_id)
        .execute()
    )
    if not assignment.data:
        raise HTTPException(status_code=400, detail="Volunteer is not assigned to this event")

    # Update or create shift with zone
    existing_shift = (
        supabase.table("volunteer_shifts")
        .select("id")
        .eq("event_id", event_id)
        .eq("volunteer_id", volunteer_id)
        .in_("status", ["scheduled", "active", "on_break"])
        .execute()
    )

    update_data = {}
    if zone_id:
        update_data["zone_id"] = zone_id
    if zone_name:
        update_data["zone_name"] = zone_name

    if existing_shift.data:
        supabase.table("volunteer_shifts").update(update_data).eq(
            "id", existing_shift.data[0]["id"]
        ).execute()
    else:
        raise HTTPException(status_code=404, detail="No active shift found for this volunteer")

    try:
        supabase.table("event_activity_logs").insert({
            "event_id": event_id,
            "action_type": "placement",
            "description": f"Assigned volunteer {volunteer_id} to zone {zone_name or zone_id}",
            "actor_id": current_user["user_id"],
        }).execute()
    except Exception:
        pass

    return {"message": f"Volunteer {volunteer_id} assigned to zone {zone_name or zone_id}"}


@router.put("/{event_id}/update-position")
async def update_volunteer_zone(
    event_id: str,
    data: dict,
    current_user: dict = Depends(require_organizer),
):
    """Organizer moves a volunteer's zone assignment."""
    supabase = get_supabase()

    volunteer_id = data.get("volunteer_user_id") or data.get("volunteer_id")
    zone_id = data.get("zone_id")
    zone_name = data.get("zone")

    event = supabase.table("events").select("id, organizer_id").eq("id", event_id).execute()
    if not event.data or event.data[0].get("organizer_id") != current_user["user_id"]:
        raise HTTPException(status_code=403, detail="You can only manage your own events")

    existing_shift = (
        supabase.table("volunteer_shifts")
        .select("id")
        .eq("event_id", event_id)
        .eq("volunteer_id", volunteer_id)
        .in_("status", ["scheduled", "active", "on_break"])
        .execute()
    )

    if not existing_shift.data:
        raise HTTPException(status_code=404, detail="No active shift found for volunteer")

    update_data = {}
    if zone_id:
        update_data["zone_id"] = zone_id
    if zone_name:
        update_data["zone_name"] = zone_name

    supabase.table("volunteer_shifts").update(update_data).eq(
        "id", existing_shift.data[0]["id"]
    ).execute()

    return {"message": "Zone assignment updated"}


@router.delete("/{event_id}/remove-position/{volunteer_id}")
async def remove_volunteer_zone(
    event_id: str,
    volunteer_id: str,
    current_user: dict = Depends(require_organizer),
):
    """Remove volunteer's zone assignment from their active shift."""
    supabase = get_supabase()

    event = supabase.table("events").select("id, organizer_id").eq("id", event_id).execute()
    if not event.data or event.data[0].get("organizer_id") != current_user["user_id"]:
        raise HTTPException(status_code=403, detail="You can only manage your own events")

    existing_shift = (
        supabase.table("volunteer_shifts")
        .select("id")
        .eq("event_id", event_id)
        .eq("volunteer_id", volunteer_id)
        .in_("status", ["scheduled", "active", "on_break"])
        .execute()
    )

    if not existing_shift.data:
        raise HTTPException(status_code=404, detail="No active shift found for volunteer")

    supabase.table("volunteer_shifts").update({
        "zone_id": None,
        "zone_name": None,
    }).eq("id", existing_shift.data[0]["id"]).execute()

    return {"message": "Zone assignment removed"}


# ═══════════════════════════════════════════════════════════════
# SWITCH REQUESTS (zone_name-based swaps via volunteer_shifts)
# ═══════════════════════════════════════════════════════════════

@router.post("/{event_id}/switch-request")
async def create_switch_request(
    event_id: str,
    data: SwitchPositionRequest,
    current_user: dict = Depends(require_volunteer),
):
    """Volunteer requests to switch zone with another volunteer."""
    supabase = get_supabase()

    if current_user["user_id"] == data.target_volunteer_id:
        raise HTTPException(status_code=400, detail="Cannot switch with yourself")

    requester_shift = (
        supabase.table("volunteer_shifts")
        .select("id")
        .eq("event_id", event_id)
        .eq("volunteer_id", current_user["user_id"])
        .in_("status", ["scheduled", "active", "on_break"])
        .execute()
    )
    target_shift = (
        supabase.table("volunteer_shifts")
        .select("id")
        .eq("event_id", event_id)
        .eq("volunteer_id", data.target_volunteer_id)
        .in_("status", ["scheduled", "active", "on_break"])
        .execute()
    )

    if not requester_shift.data:
        raise HTTPException(status_code=400, detail="You don't have an active shift on this event")
    if not target_shift.data:
        raise HTTPException(status_code=400, detail="Target volunteer doesn't have an active shift")

    # Check for existing pending request
    existing = (
        supabase.table("volunteer_switch_requests")
        .select("id")
        .eq("event_id", event_id)
        .eq("requester_id", current_user["user_id"])
        .eq("target_id", data.target_volunteer_id)
        .eq("status", "pending")
        .execute()
    )

    if existing.data:
        raise HTTPException(status_code=409, detail="You already have a pending switch request with this volunteer")

    supabase.table("volunteer_switch_requests").insert({
        "event_id": event_id,
        "requester_id": current_user["user_id"],
        "target_id": data.target_volunteer_id,
        "status": "pending",
    }).execute()

    return {"message": f"Switch request sent to {data.target_volunteer_id}"}


@router.get("/my-switch-requests")
async def get_my_switch_requests(current_user: dict = Depends(require_volunteer)):
    """Get all pending switch requests involving this volunteer."""
    supabase = get_supabase()

    incoming = (
        supabase.table("volunteer_switch_requests")
        .select("*")
        .eq("target_id", current_user["user_id"])
        .eq("status", "pending")
        .execute()
    )

    outgoing = (
        supabase.table("volunteer_switch_requests")
        .select("*")
        .eq("requester_id", current_user["user_id"])
        .eq("status", "pending")
        .execute()
    )

    all_ids = set()
    for r in incoming.data + outgoing.data:
        all_ids.add(r["requester_id"])
        all_ids.add(r["target_id"])

    vol_names = {}
    if all_ids:
        profiles = (
            supabase.table("profiles")
            .select("id, full_name")
            .in_("id", list(all_ids))
            .execute()
        )
        vol_names = {p["id"]: p["full_name"] for p in profiles.data}

    for r in incoming.data:
        r["requester_name"] = vol_names.get(r["requester_id"], r["requester_id"])
    for r in outgoing.data:
        r["target_name"] = vol_names.get(r["target_id"], r["target_id"])

    event_ids = set(r["event_id"] for r in incoming.data + outgoing.data)
    event_names = {}
    if event_ids:
        evts = (
            supabase.table("events")
            .select("id, name")
            .in_("id", list(event_ids))
            .execute()
        )
        event_names = {e["id"]: e["name"] for e in evts.data}

    for r in incoming.data + outgoing.data:
        r["event_name"] = event_names.get(r["event_id"], "Unknown Event")

    return {"incoming": incoming.data, "outgoing": outgoing.data}


@router.post("/switch-request/{request_id}/accept")
async def accept_switch_request(request_id: str, current_user: dict = Depends(require_volunteer)):
    """Accept a switch request — swaps both volunteers' zone assignments in their shifts."""
    supabase = get_supabase()

    req = (
        supabase.table("volunteer_switch_requests")
        .select("*")
        .eq("id", request_id)
        .eq("target_id", current_user["user_id"])
        .eq("status", "pending")
        .execute()
    )

    if not req.data:
        raise HTTPException(status_code=404, detail="Switch request not found or already processed")

    switch_req = req.data[0]

    requester_shift = (
        supabase.table("volunteer_shifts")
        .select("id, zone_id, zone_name")
        .eq("event_id", switch_req["event_id"])
        .eq("volunteer_id", switch_req["requester_id"])
        .in_("status", ["scheduled", "active", "on_break"])
        .execute()
    )
    target_shift = (
        supabase.table("volunteer_shifts")
        .select("id, zone_id, zone_name")
        .eq("event_id", switch_req["event_id"])
        .eq("volunteer_id", switch_req["target_id"])
        .in_("status", ["scheduled", "active", "on_break"])
        .execute()
    )

    if not requester_shift.data or not target_shift.data:
        raise HTTPException(status_code=400, detail="One or both volunteers no longer have active shifts")

    rs = requester_shift.data[0]
    ts = target_shift.data[0]

    # Swap zones
    supabase.table("volunteer_shifts").update({
        "zone_id": ts["zone_id"],
        "zone_name": ts["zone_name"],
    }).eq("id", rs["id"]).execute()

    supabase.table("volunteer_shifts").update({
        "zone_id": rs["zone_id"],
        "zone_name": rs["zone_name"],
    }).eq("id", ts["id"]).execute()

    supabase.table("volunteer_switch_requests").update(
        {"status": "accepted"}
    ).eq("id", request_id).execute()

    try:
        supabase.table("event_activity_logs").insert({
            "event_id": switch_req["event_id"],
            "action_type": "switch",
            "description": f"Volunteers {switch_req['requester_id']} and {switch_req['target_id']} swapped zones",
            "actor_id": current_user["user_id"],
        }).execute()
    except Exception:
        pass

    return {"message": "Zone assignments swapped successfully"}


@router.post("/switch-request/{request_id}/decline")
async def decline_switch_request(request_id: str, current_user: dict = Depends(require_volunteer)):
    """Decline a switch request."""
    supabase = get_supabase()

    req = (
        supabase.table("volunteer_switch_requests")
        .select("id")
        .eq("id", request_id)
        .eq("target_id", current_user["user_id"])
        .eq("status", "pending")
        .execute()
    )

    if not req.data:
        raise HTTPException(status_code=404, detail="Switch request not found or already processed")

    supabase.table("volunteer_switch_requests").update(
        {"status": "declined"}
    ).eq("id", request_id).execute()

    return {"message": "Switch request declined"}
