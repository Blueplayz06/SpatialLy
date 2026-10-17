from fastapi import APIRouter, HTTPException, Depends, Query
from fastapi.responses import StreamingResponse
from config import get_supabase
from middleware.auth import get_current_user, require_organizer
from pydantic import BaseModel
from typing import Optional, List, Any, Dict
from datetime import datetime, timezone, timedelta
from services import crowd_prediction
import csv
import io

router = APIRouter(prefix="/api/organizer", tags=["Organizer"])


# ═══════════════════════════════════════════════════════════════
# PYDANTIC MODELS
# ═══════════════════════════════════════════════════════════════

class IncidentCreate(BaseModel):
    event_id: str
    title: str
    description: Optional[str] = ""
    category: str = "other"
    priority: str = "routine"
    zone_name: Optional[str] = None

class IncidentUpdate(BaseModel):
    status: Optional[str] = None
    priority: Optional[str] = None
    assigned_to: Optional[str] = None
    resolution_notes: Optional[str] = None

class TaskCreate(BaseModel):
    event_id: str
    title: str
    description: Optional[str] = ""
    zone_id: Optional[str] = None
    zone_name: Optional[str] = None
    assigned_to: Optional[str] = None
    priority: str = "normal"

class TaskUpdate(BaseModel):
    status: Optional[str] = None
    priority: Optional[str] = None
    assigned_to: Optional[str] = None
    notes: Optional[str] = None

class MessageCreate(BaseModel):
    event_id: str
    content: str
    target_type: str = "broadcast"
    target_id: Optional[str] = None
    priority: str = "routine"
    requires_ack: bool = False

class ZoneCreate(BaseModel):
    event_id: str
    name: str
    code: Optional[str] = None
    floor_level: Optional[int] = 1
    level_id: Optional[str] = None
    capacity_limit: Optional[int] = None
    operating_capacity: Optional[int] = None
    warning_threshold: Optional[float] = 0.85
    critical_threshold: Optional[float] = 0.95
    advisory_threshold: Optional[float] = 0.70
    operational_status: Optional[str] = "open"
    is_crowd_monitored: bool = True

class ZoneUpdate(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None
    floor_level: Optional[int] = None
    level_id: Optional[str] = None
    capacity_limit: Optional[int] = None
    operating_capacity: Optional[int] = None
    warning_threshold: Optional[float] = None
    critical_threshold: Optional[float] = None
    advisory_threshold: Optional[float] = None
    operational_status: Optional[str] = None
    is_crowd_monitored: Optional[bool] = None
    is_active: Optional[bool] = None

class BoothCreate(BaseModel):
    event_id: str
    name: str
    description: Optional[str] = ""
    booth_number: Optional[str] = None
    zone_id: Optional[str] = None
    category: Optional[str] = None
    contact_name: Optional[str] = None
    contact_email: Optional[str] = None

class BoothUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    booth_number: Optional[str] = None
    zone_id: Optional[str] = None
    category: Optional[str] = None
    is_active: Optional[bool] = None

class SessionCreate(BaseModel):
    event_id: str
    title: str
    description: Optional[str] = ""
    speaker_name: Optional[str] = None
    zone_id: Optional[str] = None
    location: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    session_type: Optional[str] = "presentation"

class SessionUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    speaker_name: Optional[str] = None
    zone_id: Optional[str] = None
    location: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    status: Optional[str] = None


# ═══════════════════════════════════════════════════════════════
# HELPER: Verify organizer owns event
# ═══════════════════════════════════════════════════════════════

def verify_event_ownership(supabase, event_id: str, user_id: str):
    """Verify the organizer owns this event."""
    event = supabase.table("events").select("id, organizer_id").eq("id", event_id).execute()
    if not event.data:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.data[0].get("organizer_id") != user_id:
        raise HTTPException(status_code=403, detail="You do not own this event")
    return event.data[0]


# ═══════════════════════════════════════════════════════════════
# 1. OPERATIONAL HEALTH
# ═══════════════════════════════════════════════════════════════

@router.get("/health/{event_id}")
async def get_operational_health(event_id: str, current_user: dict = Depends(require_organizer)):
    supabase = get_supabase()
    verify_event_ownership(supabase, event_id, current_user["user_id"])
    
    # Try RPC first
    try:
        result = supabase.rpc("get_event_operational_health", {"p_event_id": event_id}).execute()
        if result.data:
            data = result.data
            # Enrich with tickets if missing
            if "tickets" not in data:
                try:
                    tickets_res = supabase.table("tickets").select("id, status, checked_in_at").eq("event_id", event_id).execute()
                    t_data = tickets_res.data or []
                    data["tickets"] = {
                        "total": len(t_data),
                        "checked_in": sum(1 for t in t_data if t.get("checked_in_at") or t.get("status") == "checked_in"),
                    }
                except Exception:
                    data["tickets"] = {"total": 0, "checked_in": 0}
            return {"health": data}
    except Exception as e:
        print(f"[organizer] get_event_operational_health RPC error ({e}), aggregating directly")

    # Authoritative direct fallback aggregation
    try:
        # Incidents
        incidents_res = supabase.table("operational_incidents").select("id, priority, status, category, created_at, zone_name").eq("event_id", event_id).execute()
        incidents = incidents_res.data or []
        active_incidents = [i for i in incidents if i.get("status") not in ("resolved", "closed")]
        urgent_incidents = [i for i in active_incidents if i.get("priority") in ("urgent", "critical")]
        resolved_incidents = [i for i in incidents if i.get("status") in ("resolved", "closed")]

        # Shifts
        shifts_res = supabase.table("volunteer_shifts").select("id, status, break_state, zone_id, zone_name").eq("event_id", event_id).execute()
        shifts = shifts_res.data or []
        active_shifts = [s for s in shifts if s.get("status") == "active"]
        on_break_shifts = [s for s in shifts if s.get("status") == "active" and s.get("break_state") in ("taking_break", "on_break")]

        # Coverage requests
        cov_res = supabase.table("coverage_requests").select("id, status").eq("event_id", event_id).execute()
        coverage = cov_res.data or []
        pending_cov = [c for c in coverage if c.get("status") == "pending"]

        # Tasks
        tasks_res = supabase.table("supervisor_tasks").select("id, status").eq("event_id", event_id).execute()
        tasks = tasks_res.data or []
        pending_tasks = [t for t in tasks if t.get("status") == "pending"]
        in_prog_tasks = [t for t in tasks if t.get("status") == "in_progress"]
        completed_tasks = [t for t in tasks if t.get("status") == "completed"]

        # Zones
        zones_res = supabase.table("event_zones").select("id, name, capacity_limit, operating_capacity").eq("event_id", event_id).execute()
        zones_data = zones_res.data or []
        
        # Try to get zone active crowd counts from snapshots or density
        zone_counts = {}
        try:
            snaps = supabase.table("crowd_zone_snapshots").select("zone_id, estimated_count, snapshot_at").eq("event_id", event_id).order("snapshot_at", desc=True).limit(50).execute()
            seen = set()
            for s in (snaps.data or []):
                zid = s.get("zone_id")
                if zid not in seen:
                    seen.add(zid)
                    zone_counts[zid] = s.get("estimated_count", 0)
        except Exception:
            pass

        zones_summary = []
        for z in zones_data:
            zid = z["id"]
            zname = z.get("name", "Zone")
            cnt = zone_counts.get(zid, 0)
            z_inc = [i for i in active_incidents if i.get("zone_name") == zname]
            z_staff = [s for s in active_shifts if s.get("zone_id") == zid or s.get("zone_name") == zname]
            zones_summary.append({
                "zone_id": zid,
                "zone_name": zname,
                "active_count": cnt,
                "operating_capacity": z.get("operating_capacity") or z.get("capacity_limit") or 100,
                "active_incidents": len(z_inc),
                "active_staff": len(z_staff),
                "is_monitored": True,
            })

        # Tickets
        tickets_summary = {"total": 0, "checked_in": 0}
        try:
            tickets_res = supabase.table("tickets").select("id, status, checked_in_at").eq("event_id", event_id).execute()
            t_data = tickets_res.data or []
            tickets_summary = {
                "total": len(t_data),
                "checked_in": sum(1 for t in t_data if t.get("checked_in_at") or t.get("status") == "checked_in"),
            }
        except Exception:
            pass

        # Overall operational status gauge calculation
        health_status = "healthy"
        if len(urgent_incidents) > 0:
            health_status = "critical"
        elif any((z["operating_capacity"] > 0 and (z["active_count"] / z["operating_capacity"]) > 0.85) for z in zones_summary) or len(active_incidents) > 0:
            health_status = "elevated"

        health_obj = {
            "event_id": event_id,
            "status": health_status,
            "computed_at": datetime.now(timezone.utc).isoformat(),
            "incidents": {
                "total": len(incidents),
                "active": len(active_incidents),
                "urgent": len(urgent_incidents),
                "resolved": len(resolved_incidents),
            },
            "shifts": {
                "total": len(shifts),
                "active": len(active_shifts),
                "on_break": len(on_break_shifts),
            },
            "coverage": {
                "total": len(coverage),
                "pending": len(pending_cov),
            },
            "tasks": {
                "total": len(tasks),
                "pending": len(pending_tasks),
                "in_progress": len(in_prog_tasks),
                "completed": len(completed_tasks),
            },
            "zones": zones_summary,
            "tickets": tickets_summary,
            "communications": {
                "total_messages": 0,
                "broadcasts": 0,
                "urgent": 0,
            }
        }
        return {"health": health_obj}
    except Exception as fallback_err:
        return {"health": None, "error": str(fallback_err)}


@router.get("/timeline/{event_id}")
async def get_operational_timeline(event_id: str, limit: int = Query(50, ge=1, le=200), current_user: dict = Depends(require_organizer)):
    supabase = get_supabase()
    verify_event_ownership(supabase, event_id, current_user["user_id"])
    try:
        result = supabase.rpc("get_event_operational_timeline", {"p_event_id": event_id, "p_limit": limit}).execute()
        return {"timeline": result.data}
    except Exception as e:
        return {"timeline": [], "error": str(e)}


# ═══════════════════════════════════════════════════════════════
# 2. INCIDENTS
# ═══════════════════════════════════════════════════════════════

@router.get("/incidents/{event_id}")
async def list_incidents(event_id: str, status: Optional[str] = None, current_user: dict = Depends(require_organizer)):
    supabase = get_supabase()
    verify_event_ownership(supabase, event_id, current_user["user_id"])
    query = supabase.table("operational_incidents").select("*").eq("event_id", event_id).order("created_at", desc=True)
    if status:
        query = query.eq("status", status)
    result = query.execute()
    return {"incidents": result.data}


@router.post("/incidents")
async def create_incident(data: IncidentCreate, current_user: dict = Depends(require_organizer)):
    supabase = get_supabase()
    verify_event_ownership(supabase, data.event_id, current_user["user_id"])
    try:
        result = supabase.rpc("report_operational_incident", {
            "p_event_id": data.event_id,
            "p_title": data.title,
            "p_description": data.description or "",
            "p_category": data.category,
            "p_priority": data.priority,
            "p_zone_name": data.zone_name or ""
        }).execute()
        return {"message": "Incident created", "data": result.data}
    except Exception as e:
        # Fallback: direct insert
        new_incident = {
            "event_id": data.event_id,
            "title": data.title,
            "description": data.description or "",
            "category": data.category,
            "priority": data.priority,
            "venue_zone_name": data.zone_name,
            "status": "reported",
            "reporter_id": current_user.get("id", current_user.get("user_id")),
        }
        result = supabase.table("operational_incidents").insert(new_incident).execute()
        return {"message": "Incident created", "data": result.data}


@router.put("/incidents/{incident_id}")
async def update_incident(incident_id: str, data: IncidentUpdate, current_user: dict = Depends(require_organizer)):
    supabase = get_supabase()
    # Verify incident exists
    existing = supabase.table("operational_incidents").select("*").eq("id", incident_id).execute()
    if not existing.data:
        raise HTTPException(status_code=404, detail="Incident not found")
    
    updates = {}
    if data.status:
        updates["status"] = data.status
    if data.priority:
        updates["priority"] = data.priority
    if data.assigned_to:
        updates["assigned_to"] = data.assigned_to
    if data.resolution_notes:
        updates["resolution_notes"] = data.resolution_notes
    
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    
    updates["updated_at"] = datetime.now(timezone.utc).isoformat()
    result = supabase.table("operational_incidents").update(updates).eq("id", incident_id).execute()
    return {"message": "Incident updated", "data": result.data}


# ═══════════════════════════════════════════════════════════════
# 3. VOLUNTEER SHIFTS & TEAMS
# ═══════════════════════════════════════════════════════════════

@router.get("/shifts/{event_id}")
async def list_shifts(event_id: str, current_user: dict = Depends(require_organizer)):
    try:
        supabase = get_supabase()
        verify_event_ownership(supabase, event_id, current_user["user_id"])
        shifts = supabase.table("volunteer_shifts").select("*").eq("event_id", event_id).order("created_at", desc=True).execute()
        return {"shifts": shifts.data}
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/teams/{event_id}")
async def list_teams(event_id: str, current_user: dict = Depends(require_organizer)):
    supabase = get_supabase()
    verify_event_ownership(supabase, event_id, current_user["user_id"])
    teams = supabase.table("event_teams").select("*").eq("event_id", event_id).execute()
    return {"teams": teams.data}


@router.get("/coverage/{event_id}")
async def list_coverage_requests(event_id: str, current_user: dict = Depends(require_organizer)):
    supabase = get_supabase()
    verify_event_ownership(supabase, event_id, current_user["user_id"])
    coverage = supabase.table("coverage_requests").select("*").eq("event_id", event_id).order("created_at", desc=True).execute()
    return {"coverage_requests": coverage.data}


@router.get("/volunteers/{event_id}")
async def list_event_volunteers(event_id: str, current_user: dict = Depends(require_organizer)):
    try:
        supabase = get_supabase()
        verify_event_ownership(supabase, event_id, current_user["user_id"])

        # Canonical assignment table only (web_volunteer_assignments retired)
        assignments = supabase.table("volunteer_assignments").select("*, volunteer:profiles(id, full_name, avatar_url)").eq("event_id", event_id).execute()
        shifts = supabase.table("volunteer_shifts").select("*").eq("event_id", event_id).order("scheduled_start").execute()

        return {
            "assignments": assignments.data,
            "shifts": shifts.data,
        }
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


# ═══════════════════════════════════════════════════════════════
# 4. TASKS
# ═══════════════════════════════════════════════════════════════

@router.get("/tasks/{event_id}")
async def list_tasks(event_id: str, status: Optional[str] = None, current_user: dict = Depends(require_organizer)):
    supabase = get_supabase()
    verify_event_ownership(supabase, event_id, current_user["user_id"])
    query = supabase.table("supervisor_tasks").select("*").eq("event_id", event_id).order("created_at", desc=True)
    if status:
        query = query.eq("status", status)
    result = query.execute()
    return {"tasks": result.data}


@router.post("/tasks")
async def create_task(data: TaskCreate, current_user: dict = Depends(require_organizer)):
    supabase = get_supabase()
    verify_event_ownership(supabase, data.event_id, current_user["user_id"])
    new_task = {
        "event_id": data.event_id,
        "title": data.title,
        "description": data.description or "",
        "priority": data.priority,
        "status": "pending",
        "created_by": current_user.get("id", current_user.get("user_id")),
    }
    if data.zone_id:
        new_task["zone_id"] = data.zone_id
    if data.zone_name:
        new_task["zone_name"] = data.zone_name
    if data.assigned_to:
        new_task["assigned_to"] = data.assigned_to
    
    result = supabase.table("supervisor_tasks").insert(new_task).execute()
    return {"message": "Task created", "data": result.data}


@router.put("/tasks/{task_id}")
async def update_task(task_id: str, data: TaskUpdate, current_user: dict = Depends(require_organizer)):
    supabase = get_supabase()
    existing = supabase.table("supervisor_tasks").select("*").eq("id", task_id).execute()
    if not existing.data:
        raise HTTPException(status_code=404, detail="Task not found")
    
    updates = {}
    if data.status:
        updates["status"] = data.status
    if data.priority:
        updates["priority"] = data.priority
    if data.assigned_to:
        updates["assigned_to"] = data.assigned_to
    if data.notes:
        updates["completion_notes"] = data.notes
    
    if updates:
        updates["updated_at"] = datetime.now(timezone.utc).isoformat()
        result = supabase.table("supervisor_tasks").update(updates).eq("id", task_id).execute()
        return {"message": "Task updated", "data": result.data}
    raise HTTPException(status_code=400, detail="No fields to update")


# ═══════════════════════════════════════════════════════════════
# 5. COMMUNICATIONS
# ═══════════════════════════════════════════════════════════════

@router.get("/comms/{event_id}")
async def list_communications(event_id: str, target_type: Optional[str] = None, current_user: dict = Depends(require_organizer)):
    supabase = get_supabase()
    verify_event_ownership(supabase, event_id, current_user["user_id"])
    query = supabase.table("operational_messages").select("*").eq("event_id", event_id).order("created_at", desc=True).limit(100)
    if target_type:
        query = query.eq("target_type", target_type)
    result = query.execute()
    return {"messages": result.data}


@router.post("/comms")
async def send_communication(data: MessageCreate, current_user: dict = Depends(require_organizer)):
    supabase = get_supabase()
    verify_event_ownership(supabase, data.event_id, current_user["user_id"])
    new_msg = {
        "event_id": data.event_id,
        "sender_id": current_user.get("id", current_user.get("user_id")),
        "sender_name": current_user.get("full_name", current_user.get("nickname", "Organizer")),
        "content": data.content,
        "target_type": data.target_type,
        "priority": data.priority,
        "requires_acknowledgment": data.requires_ack,
    }
    if data.target_id:
        new_msg["target_id"] = data.target_id
    
    result = supabase.table("operational_messages").insert(new_msg).execute()
    return {"message": "Message sent", "data": result.data}


# ═══════════════════════════════════════════════════════════════
# 6. CROWD MONITORING
# ═══════════════════════════════════════════════════════════════

@router.get("/crowd/{event_id}")
async def get_crowd_data(event_id: str, current_user: dict = Depends(require_organizer)):
    supabase = get_supabase()
    verify_event_ownership(supabase, event_id, current_user["user_id"])
    
    # Get live counts
    counts = supabase.table("volunteer_counts").select("*").eq("event_id", event_id).execute()
    
    # Get zones
    zones = supabase.table("event_zones").select("*").eq("event_id", event_id).execute()
    
    # Aggregate per zone
    zone_density = {}
    for z in zones.data:
        zone_name = z.get("name", "Unknown")
        zone_counts = [c for c in counts.data if c.get("zone") == zone_name or c.get("zone_id") == z.get("id")]
        total_active = sum(c.get("active_count", 0) for c in zone_counts)
        zone_density[zone_name] = {
            "active_count": total_active,
            "capacity_limit": z.get("capacity_limit"),
            "operating_capacity": z.get("operating_capacity"),
            "is_monitored": z.get("is_crowd_monitored", True),
            "volunteer_scanners": len(zone_counts),
        }
    
    return {
        "zone_density": zone_density,
        "raw_counts": counts.data,
        "zones": zones.data,
    }


SNAPSHOT_MIN_INTERVAL_SEC = 60
PREDICTION_HISTORY_MIN = 30
SNAPSHOT_RETENTION_HOURS = 24


@router.get("/crowd/{event_id}/predictions")
async def get_crowd_predictions(
    event_id: str,
    horizon: int = Query(15, ge=5, le=60),
    current_user: dict = Depends(require_organizer),
):
    """Algorithmic overcrowding forecast (graph-based, no ML). Organizer only."""
    supabase = get_supabase()
    verify_event_ownership(supabase, event_id, current_user["user_id"])
    now = datetime.now(timezone.utc)

    zones = supabase.table("event_zones").select("*").eq("event_id", event_id).execute().data or []
    counts = supabase.table("volunteer_counts").select("*").eq("event_id", event_id).execute().data or []

    # Live count per zone (sum across scanners, like /crowd/{event_id})
    current: Dict[str, Any] = {}
    for z in zones:
        zc = [c for c in counts if c.get("zone") == z.get("name") or c.get("zone_id") == z.get("id")]
        if zc:
            stamps = [crowd_prediction.parse_ts(c.get("updated_at")) for c in zc]
            stamps = [s for s in stamps if s]
            current[z["id"]] = (sum(c.get("active_count", 0) or 0 for c in zc), max(stamps) if stamps else now)

    # Recent history
    since = (now - timedelta(minutes=PREDICTION_HISTORY_MIN)).isoformat()
    history: Dict[str, list] = {}
    last_snapshot: Dict[str, Any] = {}
    try:
        snaps = (supabase.table("crowd_zone_snapshots").select("zone_id, estimated_count, snapshot_at")
                 .eq("event_id", event_id).gte("snapshot_at", since).order("snapshot_at").limit(3000).execute().data or [])
        for s in snaps:
            ts = crowd_prediction.parse_ts(s.get("snapshot_at"))
            if ts and s.get("zone_id"):
                history.setdefault(s["zone_id"], []).append((ts, float(s.get("estimated_count") or 0)))
                last_snapshot[s["zone_id"]] = ts
    except Exception:
        pass

    # Throttled auto-recorder: builds the history the forecast depends on
    try:
        rows = []
        for zid, (count, _) in current.items():
            last = last_snapshot.get(zid)
            if not last or (now - last).total_seconds() >= SNAPSHOT_MIN_INTERVAL_SEC:
                rows.append({"event_id": event_id, "zone_id": zid, "estimated_count": count,
                             "source": "auto", "snapshot_at": now.isoformat()})
                history.setdefault(zid, []).append((now, float(count)))
        if rows:
            supabase.table("crowd_zone_snapshots").insert(rows).execute()
            # Prune stale snapshots older than 24h
            cutoff = (now - timedelta(hours=SNAPSHOT_RETENTION_HOURS)).isoformat()
            supabase.table("crowd_zone_snapshots").delete().eq("event_id", event_id).lt("snapshot_at", cutoff).execute()
    except Exception:
        pass

    # Scheduled surges (sessions ending or starting within the horizon)
    sessions: list = []
    try:
        sessions = (supabase.table("sessions").select("zone_id, title, start_time, end_time")
                    .eq("event_id", event_id).gte("end_time", now.isoformat())
                    .lte("start_time", (now + timedelta(minutes=horizon)).isoformat()).execute().data or [])
    except Exception:
        pass

    # Gate check-in rate (last 10 min) mapped to zones by id or name
    arrivals: Dict[str, float] = {}
    try:
        tk = (supabase.table("tickets").select("checked_in_zone, check_in_at").eq("event_id", event_id)
              .gte("check_in_at", (now - timedelta(minutes=10)).isoformat()).execute().data or [])
        key = {}
        for z in zones:
            key[z["id"]] = z["id"]
            key[z.get("name")] = z["id"]
        for t in tk:
            zid = key.get(t.get("checked_in_zone"))
            if zid:
                arrivals[zid] = arrivals.get(zid, 0.0) + 0.1
    except Exception:
        pass

    predictions = crowd_prediction.predict(
        zones, history, current, sessions=sessions, arrivals_per_min=arrivals,
        horizon_min=horizon, now=now,
    )
    return {"event_id": event_id, "horizon_minutes": horizon, "computed_at": now.isoformat(),
            "predictions": predictions}


# ═══════════════════════════════════════════════════════════════
# 7. ZONES
# ═══════════════════════════════════════════════════════════════

@router.get("/zones/{event_id}")
async def list_zones(event_id: str, current_user: dict = Depends(require_organizer)):
    supabase = get_supabase()
    verify_event_ownership(supabase, event_id, current_user["user_id"])
    result = supabase.table("event_zones").select("*").eq("event_id", event_id).order("sort_order").execute()
    return {"zones": result.data}


@router.post("/zones")
async def create_zone(data: ZoneCreate, current_user: dict = Depends(require_organizer)):
    supabase = get_supabase()
    verify_event_ownership(supabase, data.event_id, current_user["user_id"])
    new_zone = {
        "event_id": data.event_id,
        "name": data.name,
        "code": data.code or data.name,
        "floor_level": data.floor_level or 1,
        "is_crowd_monitored": data.is_crowd_monitored,
    }
    if data.capacity_limit:
        new_zone["capacity_limit"] = data.capacity_limit
    if data.operating_capacity:
        new_zone["operating_capacity"] = data.operating_capacity
    
    result = supabase.table("event_zones").insert(new_zone).execute()
    
    # Also sync to events.zones text array
    event = supabase.table("events").select("zones").eq("id", data.event_id).execute()
    if event.data:
        current_zones = event.data[0].get("zones") or []
        if data.name not in current_zones:
            current_zones.append(data.name)
            supabase.table("events").update({"zones": current_zones}).eq("id", data.event_id).execute()
    
    return {"message": "Zone created", "data": result.data}


@router.put("/zones/{zone_id}")
async def update_zone(zone_id: str, data: ZoneUpdate, current_user: dict = Depends(require_organizer)):
    supabase = get_supabase()
    existing = supabase.table("event_zones").select("*").eq("id", zone_id).execute()
    if not existing.data:
        raise HTTPException(status_code=404, detail="Zone not found")

    updates = {k: v for k, v in data.model_dump(exclude_none=True).items()}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    result = supabase.table("event_zones").update(updates).eq("id", zone_id).execute()
    return {"message": "Zone updated", "data": result.data}


@router.delete("/zones/{zone_id}")
async def delete_zone(zone_id: str, current_user: dict = Depends(require_organizer)):
    """Delete a zone. Verifies event ownership first."""
    supabase = get_supabase()
    existing = supabase.table("event_zones").select("id, event_id, name").eq("id", zone_id).execute()
    if not existing.data:
        raise HTTPException(status_code=404, detail="Zone not found")
    zone = existing.data[0]
    verify_event_ownership(supabase, zone["event_id"], current_user["user_id"])

    supabase.table("event_zones").delete().eq("id", zone_id).execute()

    # Remove from events.zones text array too
    try:
        event = supabase.table("events").select("zones").eq("id", zone["event_id"]).execute()
        if event.data:
            current_zones = [z for z in (event.data[0].get("zones") or []) if z != zone["name"]]
            supabase.table("events").update({"zones": current_zones}).eq("id", zone["event_id"]).execute()
    except Exception:
        pass

    return {"message": f"Zone {zone['name']} deleted"}


# ═══════════════════════════════════════════════════════════════
# 8. BOOTHS
# ═══════════════════════════════════════════════════════════════

@router.get("/booths/{event_id}")
async def list_booths(event_id: str, current_user: dict = Depends(require_organizer)):
    supabase = get_supabase()
    verify_event_ownership(supabase, event_id, current_user["user_id"])
    result = supabase.table("booths").select("*").eq("event_id", event_id).order("created_at").execute()
    return {"booths": result.data}


@router.post("/booths")
async def create_booth(data: BoothCreate, current_user: dict = Depends(require_organizer)):
    supabase = get_supabase()
    verify_event_ownership(supabase, data.event_id, current_user["user_id"])
    new_booth = {
        "event_id": data.event_id,
        "name": data.name,
        "description": data.description or "",
    }
    if data.booth_number:
        new_booth["booth_number"] = data.booth_number
    if data.zone_id:
        new_booth["zone_id"] = data.zone_id
    if data.category:
        new_booth["category"] = data.category
    if data.contact_name:
        new_booth["contact_name"] = data.contact_name
    if data.contact_email:
        new_booth["contact_email"] = data.contact_email
    
    result = supabase.table("booths").insert(new_booth).execute()
    return {"message": "Booth created", "data": result.data}


@router.put("/booths/{booth_id}")
async def update_booth(booth_id: str, data: BoothUpdate, current_user: dict = Depends(require_organizer)):
    supabase = get_supabase()
    existing = supabase.table("booths").select("*").eq("id", booth_id).execute()
    if not existing.data:
        raise HTTPException(status_code=404, detail="Booth not found")
    
    updates = {k: v for k, v in data.model_dump(exclude_none=True).items()}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    
    result = supabase.table("booths").update(updates).eq("id", booth_id).execute()
    return {"message": "Booth updated", "data": result.data}


@router.delete("/booths/{booth_id}")
async def delete_booth(booth_id: str, current_user: dict = Depends(require_organizer)):
    supabase = get_supabase()
    existing = supabase.table("booths").select("*").eq("id", booth_id).execute()
    if not existing.data:
        raise HTTPException(status_code=404, detail="Booth not found")
    supabase.table("booths").delete().eq("id", booth_id).execute()
    return {"message": "Booth deleted"}


# ═══════════════════════════════════════════════════════════════
# 9. SESSIONS
# ═══════════════════════════════════════════════════════════════

@router.get("/sessions/{event_id}")
async def list_sessions(event_id: str, current_user: dict = Depends(require_organizer)):
    supabase = get_supabase()
    verify_event_ownership(supabase, event_id, current_user["user_id"])
    result = supabase.table("sessions").select("*").eq("event_id", event_id).order("start_time").execute()
    return {"sessions": result.data}


@router.post("/sessions")
async def create_session(data: SessionCreate, current_user: dict = Depends(require_organizer)):
    supabase = get_supabase()
    verify_event_ownership(supabase, data.event_id, current_user["user_id"])
    new_session = {
        "event_id": data.event_id,
        "title": data.title,
        "description": data.description or "",
    }
    if data.speaker_name:
        new_session["speaker_name"] = data.speaker_name
    if data.zone_id:
        new_session["zone_id"] = data.zone_id
    if data.location:
        new_session["location"] = data.location
    if data.start_time:
        new_session["start_time"] = data.start_time
    if data.end_time:
        new_session["end_time"] = data.end_time
    if data.session_type:
        new_session["session_type"] = data.session_type
    
    result = supabase.table("sessions").insert(new_session).execute()
    return {"message": "Session created", "data": result.data}


@router.put("/sessions/{session_id}")
async def update_session(session_id: str, data: SessionUpdate, current_user: dict = Depends(require_organizer)):
    supabase = get_supabase()
    existing = supabase.table("sessions").select("*").eq("id", session_id).execute()
    if not existing.data:
        raise HTTPException(status_code=404, detail="Session not found")
    
    updates = {k: v for k, v in data.model_dump(exclude_none=True).items()}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    
    result = supabase.table("sessions").update(updates).eq("id", session_id).execute()
    return {"message": "Session updated", "data": result.data}


@router.delete("/sessions/{session_id}")
async def delete_session(session_id: str, current_user: dict = Depends(require_organizer)):
    supabase = get_supabase()
    existing = supabase.table("sessions").select("*").eq("id", session_id).execute()
    if not existing.data:
        raise HTTPException(status_code=404, detail="Session not found")
    supabase.table("sessions").delete().eq("id", session_id).execute()
    return {"message": "Session deleted"}


# ═══════════════════════════════════════════════════════════════
# 10. ASSISTANCE
# ═══════════════════════════════════════════════════════════════

@router.get("/assistance/{event_id}")
async def list_assistance_requests(event_id: str, current_user: dict = Depends(require_organizer)):
    supabase = get_supabase()
    verify_event_ownership(supabase, event_id, current_user["user_id"])
    # Assistance requests are stored as incidents with category='assistance'
    result = (
        supabase.table("operational_incidents")
        .select("*")
        .eq("event_id", event_id)
        .eq("category", "assistance")
        .order("created_at", desc=True)
        .execute()
    )
    return {"assistance_requests": result.data}


# ═══════════════════════════════════════════════════════════════
# 11. ANALYTICS
# ═══════════════════════════════════════════════════════════════

@router.get("/analytics/{event_id}")
async def get_event_analytics(event_id: str, current_user: dict = Depends(require_organizer)):
    supabase = get_supabase()
    verify_event_ownership(supabase, event_id, current_user["user_id"])
    
    # Tickets
    total_tickets = supabase.table("tickets").select("id", count="exact").eq("event_id", event_id).execute()
    checked_in = supabase.table("tickets").select("id", count="exact").eq("event_id", event_id).eq("status", "checked_in").execute()
    
    # Incidents
    incidents = supabase.table("operational_incidents").select("*").eq("event_id", event_id).execute()
    total_incidents = len(incidents.data)
    resolved_incidents = len([i for i in incidents.data if i.get("status") in ("resolved", "closed")])
    urgent_incidents = len([i for i in incidents.data if i.get("priority") == "urgent"])
    
    # Tasks
    tasks = supabase.table("supervisor_tasks").select("*").eq("event_id", event_id).execute()
    total_tasks = len(tasks.data)
    completed_tasks = len([t for t in tasks.data if t.get("status") == "completed"])
    
    # Shifts
    shifts = supabase.table("volunteer_shifts").select("*").eq("event_id", event_id).execute()
    active_shifts = len([s for s in shifts.data if s.get("status") == "active"])
    
    # Booths
    booths = supabase.table("booths").select("id", count="exact").eq("event_id", event_id).execute()
    
    # Sessions
    sessions = supabase.table("sessions").select("id", count="exact").eq("event_id", event_id).execute()
    
    # Zones
    zones = supabase.table("event_zones").select("*").eq("event_id", event_id).execute()
    
    # Crowd data
    counts = supabase.table("volunteer_counts").select("*").eq("event_id", event_id).execute()
    total_crowd = sum(c.get("active_count", 0) for c in counts.data)
    
    # Messages
    messages = supabase.table("operational_messages").select("id", count="exact").eq("event_id", event_id).execute()
    
    # Incident categories breakdown
    incident_categories = {}
    for inc in incidents.data:
        cat = inc.get("category", "other")
        incident_categories[cat] = incident_categories.get(cat, 0) + 1
    
    # Incident priority breakdown
    incident_priorities = {}
    for inc in incidents.data:
        pri = inc.get("priority", "routine")
        incident_priorities[pri] = incident_priorities.get(pri, 0) + 1
    
    return {
        "attendance": {
            "total_tickets": total_tickets.count or 0,
            "checked_in": checked_in.count or 0,
            "check_in_rate": round((checked_in.count or 0) / max(total_tickets.count or 1, 1) * 100, 1),
        },
        "crowd": {
            "current_total": total_crowd,
            "zones_monitored": len([z for z in zones.data if z.get("is_crowd_monitored")]),
        },
        "incidents": {
            "total": total_incidents,
            "resolved": resolved_incidents,
            "urgent": urgent_incidents,
            "resolution_rate": round(resolved_incidents / max(total_incidents, 1) * 100, 1),
            "by_category": incident_categories,
            "by_priority": incident_priorities,
        },
        "tasks": {
            "total": total_tasks,
            "completed": completed_tasks,
            "completion_rate": round(completed_tasks / max(total_tasks, 1) * 100, 1),
        },
        "volunteers": {
            "active_shifts": active_shifts,
            "total_shifts": len(shifts.data),
        },
        "content": {
            "booths": booths.count or 0,
            "sessions": sessions.count or 0,
            "zones": len(zones.data),
        },
        "communications": {
            "total_messages": messages.count or 0,
        },
    }


# ═══════════════════════════════════════════════════════════════
# 12. EXPORT
# ═══════════════════════════════════════════════════════════════

@router.get("/export/{event_id}")
async def export_event_data(event_id: str, report_type: str = Query("summary"), current_user: dict = Depends(require_organizer)):
    supabase = get_supabase()
    verify_event_ownership(supabase, event_id, current_user["user_id"])
    
    event = supabase.table("events").select("*").eq("id", event_id).execute()
    
    if report_type == "incidents":
        data = supabase.table("operational_incidents").select("*").eq("event_id", event_id).order("created_at").execute()
        return {"report_type": "incidents", "event": event.data[0] if event.data else {}, "data": data.data}
    elif report_type == "attendance":
        data = supabase.table("tickets").select("*").eq("event_id", event_id).execute()
        return {"report_type": "attendance", "event": event.data[0] if event.data else {}, "data": data.data}
    elif report_type == "shifts":
        data = supabase.table("volunteer_shifts").select("*").eq("event_id", event_id).execute()
        return {"report_type": "shifts", "event": event.data[0] if event.data else {}, "data": data.data}
    elif report_type == "tasks":
        data = supabase.table("supervisor_tasks").select("*").eq("event_id", event_id).execute()
        return {"report_type": "tasks", "event": event.data[0] if event.data else {}, "data": data.data}
    else:
        # Summary: return analytics
        analytics = await get_event_analytics(event_id, current_user)
        return {"report_type": "summary", "event": event.data[0] if event.data else {}, "data": analytics}


# ═══════════════════════════════════════════════════════════════
# 13. LOST & FOUND
# ═══════════════════════════════════════════════════════════════

@router.get("/lost-found/{event_id}")
async def list_lost_found(event_id: str, current_user: dict = Depends(require_organizer)):
    supabase = get_supabase()
    verify_event_ownership(supabase, event_id, current_user["user_id"])
    result = supabase.table("lost_found_reports").select("*").eq("event_id", event_id).order("created_at", desc=True).execute()
    return {"items": result.data}


# ═══════════════════════════════════════════════════════════════
# 14. INCIDENT — ATOMIC DISPATCH + AUDIT LOGS
# ═══════════════════════════════════════════════════════════════

class IncidentAssignRequest(BaseModel):
    volunteer_id: str
    notes: Optional[str] = None


@router.post("/incidents/{incident_id}/assign")
async def assign_incident(incident_id: str, data: IncidentAssignRequest, current_user: dict = Depends(require_organizer)):
    """Atomic volunteer dispatch via assign_operational_incident RPC."""
    supabase = get_supabase()
    existing = supabase.table("operational_incidents").select("id, event_id").eq("id", incident_id).execute()
    if not existing.data:
        raise HTTPException(status_code=404, detail="Incident not found")
    verify_event_ownership(supabase, existing.data[0]["event_id"], current_user["user_id"])

    try:
        result = supabase.rpc("assign_operational_incident", {
            "p_incident_id": incident_id,
            "p_assignee_id": data.volunteer_id,
            "p_assigner_id": current_user["user_id"],
        }).execute()
        return {"message": "Incident assigned", "data": result.data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"RPC failed: {str(e)}")


@router.get("/incident-logs/{incident_id}")
async def get_incident_logs(incident_id: str, current_user: dict = Depends(require_organizer)):
    """Get audit trail for an incident."""
    supabase = get_supabase()
    existing = supabase.table("operational_incidents").select("id, event_id").eq("id", incident_id).execute()
    if not existing.data:
        raise HTTPException(status_code=404, detail="Incident not found")
    verify_event_ownership(supabase, existing.data[0]["event_id"], current_user["user_id"])

    logs = (
        supabase.table("operational_incident_logs")
        .select("*, actor:profiles(id, full_name)")
        .eq("incident_id", incident_id)
        .order("created_at")
        .execute()
    )
    return {"logs": logs.data}


# ═══════════════════════════════════════════════════════════════
# 15. SHIFTS CRUD
# ═══════════════════════════════════════════════════════════════

class ShiftCreate(BaseModel):
    event_id: str
    volunteer_id: str
    zone_id: Optional[str] = None
    zone_name: Optional[str] = None
    team_id: Optional[str] = None
    shift_name: str = "Operational Shift"
    scheduled_start: str
    scheduled_end: str
    notes: Optional[str] = None


class ShiftUpdate(BaseModel):
    zone_id: Optional[str] = None
    zone_name: Optional[str] = None
    status: Optional[str] = None
    scheduled_start: Optional[str] = None
    scheduled_end: Optional[str] = None
    notes: Optional[str] = None


@router.post("/shifts")
async def create_shift(data: ShiftCreate, current_user: dict = Depends(require_organizer)):
    supabase = get_supabase()
    verify_event_ownership(supabase, data.event_id, current_user["user_id"])
    new_shift = {
        "event_id": data.event_id,
        "volunteer_id": data.volunteer_id,
        "shift_name": data.shift_name,
        "scheduled_start": data.scheduled_start,
        "scheduled_end": data.scheduled_end,
        "status": "scheduled",
    }
    for field in ["zone_id", "zone_name", "team_id", "notes"]:
        v = getattr(data, field, None)
        if v:
            new_shift[field] = v
    result = supabase.table("volunteer_shifts").insert(new_shift).execute()
    return {"message": "Shift created", "data": result.data}


@router.put("/shifts/{shift_id}")
async def update_shift(shift_id: str, data: ShiftUpdate, current_user: dict = Depends(require_organizer)):
    supabase = get_supabase()
    existing = supabase.table("volunteer_shifts").select("id, event_id").eq("id", shift_id).execute()
    if not existing.data:
        raise HTTPException(status_code=404, detail="Shift not found")
    verify_event_ownership(supabase, existing.data[0]["event_id"], current_user["user_id"])
    updates = {k: v for k, v in data.model_dump(exclude_none=True).items()}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    updates["updated_at"] = datetime.now(timezone.utc).isoformat()
    result = supabase.table("volunteer_shifts").update(updates).eq("id", shift_id).execute()
    return {"message": "Shift updated", "data": result.data}


@router.delete("/shifts/{shift_id}")
async def delete_shift(shift_id: str, current_user: dict = Depends(require_organizer)):
    supabase = get_supabase()
    existing = supabase.table("volunteer_shifts").select("id, event_id").eq("id", shift_id).execute()
    if not existing.data:
        raise HTTPException(status_code=404, detail="Shift not found")
    verify_event_ownership(supabase, existing.data[0]["event_id"], current_user["user_id"])
    supabase.table("volunteer_shifts").delete().eq("id", shift_id).execute()
    return {"message": "Shift deleted"}


# ═══════════════════════════════════════════════════════════════
# 16. TEAMS CRUD
# ═══════════════════════════════════════════════════════════════

class TeamCreate(BaseModel):
    event_id: str
    name: str
    description: Optional[str] = None
    zone_id: Optional[str] = None
    zone_name: Optional[str] = None
    lead_id: Optional[str] = None


class TeamUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    zone_id: Optional[str] = None
    zone_name: Optional[str] = None
    lead_id: Optional[str] = None


@router.post("/teams")
async def create_team(data: TeamCreate, current_user: dict = Depends(require_organizer)):
    supabase = get_supabase()
    verify_event_ownership(supabase, data.event_id, current_user["user_id"])
    new_team = {"event_id": data.event_id, "name": data.name}
    for field in ["description", "zone_id", "zone_name", "lead_id"]:
        v = getattr(data, field, None)
        if v:
            new_team[field] = v
    result = supabase.table("event_teams").insert(new_team).execute()
    return {"message": "Team created", "data": result.data}


@router.put("/teams/{team_id}")
async def update_team(team_id: str, data: TeamUpdate, current_user: dict = Depends(require_organizer)):
    supabase = get_supabase()
    existing = supabase.table("event_teams").select("id, event_id").eq("id", team_id).execute()
    if not existing.data:
        raise HTTPException(status_code=404, detail="Team not found")
    verify_event_ownership(supabase, existing.data[0]["event_id"], current_user["user_id"])
    updates = {k: v for k, v in data.model_dump(exclude_none=True).items()}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    updates["updated_at"] = datetime.now(timezone.utc).isoformat()
    result = supabase.table("event_teams").update(updates).eq("id", team_id).execute()
    return {"message": "Team updated", "data": result.data}


@router.delete("/teams/{team_id}")
async def delete_team(team_id: str, current_user: dict = Depends(require_organizer)):
    supabase = get_supabase()
    existing = supabase.table("event_teams").select("id, event_id").eq("id", team_id).execute()
    if not existing.data:
        raise HTTPException(status_code=404, detail="Team not found")
    verify_event_ownership(supabase, existing.data[0]["event_id"], current_user["user_id"])
    supabase.table("event_teams").delete().eq("id", team_id).execute()
    return {"message": "Team deleted"}


# ═══════════════════════════════════════════════════════════════
# 17. ASSISTANCE — PROPER QUERY + ESCALATION
# ═══════════════════════════════════════════════════════════════

@router.get("/assistance/{event_id}")
async def list_assistance_requests(event_id: str, current_user: dict = Depends(require_organizer)):
    """List attendee assistance requests (not operational_incidents)."""
    supabase = get_supabase()
    verify_event_ownership(supabase, event_id, current_user["user_id"])
    # Query operational_incidents with category='attendee_assistance'
    result = (
        supabase.table("operational_incidents")
        .select("*")
        .eq("event_id", event_id)
        .eq("category", "attendee_assistance")
        .order("created_at", desc=True)
        .execute()
    )
    return {"assistance_requests": result.data}


@router.post("/assistance/{incident_id}/escalate")
async def escalate_assistance(incident_id: str, data: dict, current_user: dict = Depends(require_organizer)):
    """Escalate an attendee assistance request to a formal operational incident."""
    supabase = get_supabase()
    existing = supabase.table("operational_incidents").select("*").eq("id", incident_id).execute()
    if not existing.data:
        raise HTTPException(status_code=404, detail="Assistance request not found")
    inc = existing.data[0]
    verify_event_ownership(supabase, inc["event_id"], current_user["user_id"])

    # Promote category and priority
    updates = {
        "category": data.get("escalated_category", "safety"),
        "priority": data.get("priority", "important"),
        "status": "open",
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if data.get("notes"):
        updates["staff_notes"] = data["notes"]

    result = supabase.table("operational_incidents").update(updates).eq("id", incident_id).execute()

    # Log the escalation
    try:
        supabase.table("operational_incident_logs").insert({
            "incident_id": incident_id,
            "actor_id": current_user["user_id"],
            "action": "escalated",
            "notes": f"Escalated from assistance to {updates['category']}",
        }).execute()
    except Exception:
        pass

    return {"message": "Assistance request escalated", "data": result.data}


# ═══════════════════════════════════════════════════════════════
# 18. COVERAGE APPROVAL
# ═══════════════════════════════════════════════════════════════

@router.put("/coverage/{request_id}/approve")
async def approve_coverage(request_id: str, current_user: dict = Depends(require_organizer)):
    supabase = get_supabase()
    existing = supabase.table("coverage_requests").select("id, event_id").eq("id", request_id).execute()
    if not existing.data:
        raise HTTPException(status_code=404, detail="Coverage request not found")
    verify_event_ownership(supabase, existing.data[0]["event_id"], current_user["user_id"])
    result = supabase.table("coverage_requests").update({
        "status": "approved",
        "approved_by": current_user["user_id"],
        "approved_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", request_id).execute()
    return {"message": "Coverage request approved", "data": result.data}


# ═══════════════════════════════════════════════════════════════
# 19. SHIFT HANDOFF LOGS
# ═══════════════════════════════════════════════════════════════

@router.get("/handoffs/{event_id}")
async def list_handoffs(event_id: str, current_user: dict = Depends(require_organizer)):
    supabase = get_supabase()
    verify_event_ownership(supabase, event_id, current_user["user_id"])
    try:
        result = (
            supabase.table("shift_handoff_logs")
            .select("*, from_volunteer:profiles!from_volunteer_id(id, full_name), to_volunteer:profiles!to_volunteer_id(id, full_name)")
            .eq("event_id", event_id)
            .order("created_at", desc=True)
            .execute()
        )
        return {"handoffs": result.data}
    except Exception as e:
        # Table may not exist yet
        return {"handoffs": [], "error": str(e)}


# ═══════════════════════════════════════════════════════════════
# 20. COMMS RECEIPTS (ACK TRACKING)
# ═══════════════════════════════════════════════════════════════

@router.get("/comms/{msg_id}/receipts")
async def get_message_receipts(msg_id: str, current_user: dict = Depends(require_organizer)):
    supabase = get_supabase()
    msg = supabase.table("operational_messages").select("id, event_id").eq("id", msg_id).execute()
    if not msg.data:
        raise HTTPException(status_code=404, detail="Message not found")
    verify_event_ownership(supabase, msg.data[0]["event_id"], current_user["user_id"])
    try:
        receipts = (
            supabase.table("operational_message_receipts")
            .select("*, recipient:profiles(id, full_name)")
            .eq("message_id", msg_id)
            .order("acknowledged_at")
            .execute()
        )
        return {"receipts": receipts.data}
    except Exception as e:
        return {"receipts": [], "error": str(e)}


# ═══════════════════════════════════════════════════════════════
# 21. ACTIVITIES (GAMIFICATION) CRUD
# ═══════════════════════════════════════════════════════════════

class ActivityCreate(BaseModel):
    event_id: str
    title: str
    description: Optional[str] = None
    activity_type: str = "quest"
    points_value: int = 10
    max_completions: Optional[int] = None
    zone_id: Optional[str] = None
    checkpoint_code: Optional[str] = None
    is_active: bool = True


class ActivityUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    points_value: Optional[int] = None
    max_completions: Optional[int] = None
    zone_id: Optional[str] = None
    checkpoint_code: Optional[str] = None
    is_active: Optional[bool] = None


@router.get("/activities/{event_id}")
async def list_activities(event_id: str, current_user: dict = Depends(require_organizer)):
    supabase = get_supabase()
    verify_event_ownership(supabase, event_id, current_user["user_id"])
    result = supabase.table("activities").select("*").eq("event_id", event_id).order("created_at").execute()
    return {"activities": result.data}


@router.post("/activities")
async def create_activity(data: ActivityCreate, current_user: dict = Depends(require_organizer)):
    supabase = get_supabase()
    verify_event_ownership(supabase, data.event_id, current_user["user_id"])
    new_act = {
        "event_id": data.event_id,
        "title": data.title,
        "description": data.description or "",
        "activity_type": data.activity_type,
        "points_value": data.points_value,
        "is_active": data.is_active,
    }
    for field in ["max_completions", "zone_id", "checkpoint_code"]:
        v = getattr(data, field, None)
        if v is not None:
            new_act[field] = v
    result = supabase.table("activities").insert(new_act).execute()
    return {"message": "Activity created", "data": result.data}


@router.put("/activities/{activity_id}")
async def update_activity(activity_id: str, data: ActivityUpdate, current_user: dict = Depends(require_organizer)):
    supabase = get_supabase()
    existing = supabase.table("activities").select("id, event_id").eq("id", activity_id).execute()
    if not existing.data:
        raise HTTPException(status_code=404, detail="Activity not found")
    verify_event_ownership(supabase, existing.data[0]["event_id"], current_user["user_id"])
    updates = {k: v for k, v in data.model_dump(exclude_none=True).items()}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    result = supabase.table("activities").update(updates).eq("id", activity_id).execute()
    return {"message": "Activity updated", "data": result.data}


@router.delete("/activities/{activity_id}")
async def delete_activity(activity_id: str, current_user: dict = Depends(require_organizer)):
    supabase = get_supabase()
    existing = supabase.table("activities").select("id, event_id").eq("id", activity_id).execute()
    if not existing.data:
        raise HTTPException(status_code=404, detail="Activity not found")
    verify_event_ownership(supabase, existing.data[0]["event_id"], current_user["user_id"])
    supabase.table("activities").delete().eq("id", activity_id).execute()
    return {"message": "Activity deleted"}


# ═══════════════════════════════════════════════════════════════
# 22. CSV STREAMING EXPORT
# ═══════════════════════════════════════════════════════════════

@router.get("/export/{event_id}/csv")
async def export_csv(event_id: str, report_type: str = Query("attendance"), current_user: dict = Depends(require_organizer)):
    """Stream a CSV download of attendance or incident data."""
    supabase = get_supabase()
    verify_event_ownership(supabase, event_id, current_user["user_id"])

    if report_type == "incidents":
        rows = supabase.table("operational_incidents").select(
            "id, title, category, priority, status, venue_zone_name, created_at, resolved_at, resolution_notes"
        ).eq("event_id", event_id).order("created_at").execute().data
        fieldnames = ["id", "title", "category", "priority", "status", "venue_zone_name", "created_at", "resolved_at", "resolution_notes"]
        filename = f"incidents_{event_id[:8]}.csv"
    else:
        # Default: attendance
        rows = supabase.table("tickets").select(
            "id, attendee_id, user_id, ticket_type, status, created_at, claimed_at"
        ).eq("event_id", event_id).order("created_at").execute().data
        fieldnames = ["id", "attendee_id", "user_id", "ticket_type", "status", "created_at", "claimed_at"]
        filename = f"attendance_{event_id[:8]}.csv"

    def generate():
        buf = io.StringIO()
        writer = csv.DictWriter(buf, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        yield buf.getvalue()
        buf.truncate(0)
        buf.seek(0)
        for row in rows:
            writer.writerow(row)
            yield buf.getvalue()
            buf.truncate(0)
            buf.seek(0)

    return StreamingResponse(
        generate(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ═══════════════════════════════════════════════════════════════
# 23. CROWD CALIBRATION
# ═══════════════════════════════════════════════════════════════

class CrowdCalibrationRequest(BaseModel):
    zone_id: str
    manual_count: int
    notes: Optional[str] = None


@router.post("/crowd/calibrate")
async def calibrate_crowd(data: CrowdCalibrationRequest, event_id: str = Query(...), current_user: dict = Depends(require_organizer)):
    """Submit manual turnstile headcount calibration for a zone."""
    supabase = get_supabase()
    verify_event_ownership(supabase, event_id, current_user["user_id"])

    # Insert a calibration snapshot
    result = supabase.table("crowd_zone_snapshots").insert({
        "event_id": event_id,
        "zone_id": data.zone_id,
        "estimated_count": data.manual_count,
        "source": "manual_calibration",
        "notes": data.notes or "Manual headcount calibration",
        "snapshot_at": datetime.now(timezone.utc).isoformat(),
    }).execute()
    return {"message": "Calibration recorded", "data": result.data}


# ═══════════════════════════════════════════════════════════════
# 28. EMERGENCY ACTION PLAN (EAP)
# ═══════════════════════════════════════════════════════════════

@router.post("/eap/{event_id}/publish")
async def publish_eap(event_id: str, current_user: dict = Depends(require_organizer)):
    """Publish Emergency Action Plan (EAP) to event operational staff."""
    supabase = get_supabase()
    verify_event_ownership(supabase, event_id, current_user["user_id"])
    try:
        supabase.table("event_activity_logs").insert({
            "event_id": event_id,
            "action_type": "eap_publish",
            "description": "Emergency Action Plan published to operational staff",
            "actor_id": current_user["user_id"],
        }).execute()
    except Exception:
        pass
    return {"message": "Emergency Action Plan published to active event staff", "event_id": event_id}

