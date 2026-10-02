from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, EmailStr, field_validator
from models import InviteByIdRequest, InviteByEmailRequest, InviteBulkRequest
from config import get_supabase
from middleware.auth import require_organizer, get_current_user
from services.email import send_volunteer_invitation_email

router = APIRouter(prefix="/api/volunteers", tags=["Volunteers"])


@router.post("/invite-bulk")
async def invite_bulk_volunteers(
    data: InviteBulkRequest, current_user: dict = Depends(require_organizer)
):
    supabase = get_supabase()

    event = supabase.table("events").select("*").eq("id", data.event_id).execute()
    if not event.data:
        raise HTTPException(status_code=404, detail="Event not found")

    if event.data[0].get("organizer_id") != current_user["user_id"]:
        raise HTTPException(status_code=403, detail="You can only invite volunteers to your own events")

    results = {"success": [], "failed": []}

    for vid in data.volunteer_ids:
        try:
            volunteer = (
                supabase.table("profiles")
                .select("id, email, full_name")
                .eq("id", vid)
                .eq("role", "volunteer")
                .execute()
            )

            if not volunteer.data:
                results["failed"].append({"id": vid, "reason": "Not found"})
                continue

            existing_invite = (
                supabase.table("event_invitations")
                .select("id, status")
                .eq("volunteer_user_id", vid)
                .eq("event_id", data.event_id)
                .execute()
            )

            if existing_invite.data:
                invite_status = existing_invite.data[0]["status"]
                if invite_status == "accepted":
                    results["failed"].append({"id": vid, "reason": "Already assigned"})
                    continue
                elif invite_status == "pending":
                    results["failed"].append({"id": vid, "reason": "Already invited (Pending)"})
                    continue
                elif invite_status == "declined":
                    supabase.table("event_invitations").update(
                        {"status": "pending"}
                    ).eq("id", existing_invite.data[0]["id"]).execute()
                    results["success"].append(vid)
                    continue

            supabase.table("event_invitations").insert(
                {
                    "event_id": data.event_id,
                    "volunteer_email": volunteer.data[0]["email"],
                    "volunteer_user_id": vid,
                    "status": "pending",
                    "invited_by": current_user["user_id"],
                }
            ).execute()

            results["success"].append(vid)
        except Exception as e:
            results["failed"].append({"id": vid, "reason": str(e)})

    if results["success"]:
        supabase.table("event_activity_logs").insert({
            "event_id": data.event_id,
            "action_type": "invite",
            "description": f"Invited {len(results['success'])} volunteers",
            "actor_id": current_user["user_id"]
        }).execute()

    return {
        "message": f"Successfully assigned {len(results['success'])} volunteers. {len(results['failed'])} failed.",
        "results": results
    }


@router.post("/invite-by-id")
async def invite_existing_volunteer(
    data: InviteByIdRequest, current_user: dict = Depends(require_organizer)
):
    supabase = get_supabase()

    volunteer = (
        supabase.table("profiles")
        .select("id, email, full_name")
        .eq("id", data.volunteer_id)
        .eq("role", "volunteer")
        .execute()
    )

    if not volunteer.data:
        raise HTTPException(
            status_code=404,
            detail=f"Volunteer {data.volunteer_id} not found. Use the email invitation to invite new volunteers.",
        )

    event = supabase.table("events").select("*").eq("id", data.event_id).execute()
    if not event.data:
        raise HTTPException(status_code=404, detail="Event not found")

    if event.data[0].get("organizer_id") != current_user["user_id"]:
        raise HTTPException(status_code=403, detail="You can only invite volunteers to your own events")

    existing_invite = (
        supabase.table("event_invitations")
        .select("id, status")
        .eq("volunteer_user_id", data.volunteer_id)
        .eq("event_id", data.event_id)
        .execute()
    )

    if existing_invite.data:
        invite_status = existing_invite.data[0]["status"]
        if invite_status == "accepted":
            raise HTTPException(
                status_code=409,
                detail=f"Volunteer {data.volunteer_id} is already assigned to this event",
            )
        elif invite_status == "pending":
            raise HTTPException(
                status_code=409,
                detail=f"Volunteer {data.volunteer_id} has already been invited (Pending)",
            )
        elif invite_status == "declined":
            supabase.table("event_invitations").update(
                {"status": "pending"}
            ).eq("id", existing_invite.data[0]["id"]).execute()
        return {
            "message": f"Invitation resent to Volunteer {data.volunteer_id}",
            "volunteer": {
                "user_id": volunteer.data[0]["id"],
                "full_name": volunteer.data[0].get("full_name", ""),
                "email": volunteer.data[0].get("email", ""),
            },
        }

    supabase.table("event_invitations").insert(
        {
            "event_id": data.event_id,
            "volunteer_email": volunteer.data[0]["email"],
            "volunteer_user_id": data.volunteer_id,
            "status": "pending",
            "invited_by": current_user["user_id"],
        }
    ).execute()

    supabase.table("event_activity_logs").insert({
        "event_id": data.event_id,
        "action_type": "invite",
        "description": f"Invited volunteer {data.volunteer_id}",
        "actor_id": current_user["user_id"]
    }).execute()

    return {
        "message": f"Volunteer {data.volunteer_id} has been assigned to the event",
        "volunteer": {
            "user_id": volunteer.data[0]["user_id"],
            "full_name": volunteer.data[0].get("full_name", ""),
            "email": volunteer.data[0]["email"],
        },
    }


@router.post("/invite-by-email")
async def invite_new_volunteer(
    data: InviteByEmailRequest, current_user: dict = Depends(require_organizer)
):
    supabase = get_supabase()

    existing_user = (
        supabase.table("profiles")
        .select("id, role")
        .eq("email", data.email)
        .execute()
    )

    if existing_user.data:
        user = existing_user.data[0]
        if user["role"] == "volunteer":
            raise HTTPException(
                status_code=409,
                detail=f"A volunteer account with this email already exists (ID: {user['id']}). Use the 'Invite by ID' option instead.",
            )
        else:
            raise HTTPException(
                status_code=409,
                detail=f"An account with this email already exists as a {user['role']}. Cannot send volunteer invitation.",
            )

    event = supabase.table("events").select("*").eq("id", data.event_id).execute()
    if not event.data:
        raise HTTPException(status_code=404, detail="Event not found")

    if event.data[0].get("organizer_id") != current_user["user_id"]:
        raise HTTPException(status_code=403, detail="You can only invite volunteers to your own events")

    existing_invite = (
        supabase.table("event_invitations")
        .select("id, status")
        .eq("volunteer_email", data.email)
        .eq("event_id", data.event_id)
        .execute()
    )

    if existing_invite.data:
        inv_status = existing_invite.data[0]["status"]
        if inv_status == "accepted":
            raise HTTPException(
                status_code=409,
                detail="This email is already assigned to the event",
            )
        elif inv_status == "pending":
            raise HTTPException(
                status_code=409,
                detail="An invitation has already been sent to this email for this event",
            )
        elif inv_status == "declined":
            supabase.table("event_invitations").update(
                {"status": "pending"}
            ).eq("id", existing_invite.data[0]["id"]).execute()
            invitation_id = existing_invite.data[0]["id"]
            
            await send_volunteer_invitation_email(
                to_email=data.email,
                organizer_name=current_user.get("full_name", current_user["user_id"]),
                event_name=event.data[0]["name"],
                invitation_id=invitation_id,
            )
            return {"message": f"Invitation resent to {data.email}"}

    invitation = (
        supabase.table("event_invitations")
        .insert(
            {
                "event_id": data.event_id,
                "volunteer_email": data.email,
                "status": "pending",
                "invited_by": current_user["user_id"],
            }
        )
        .execute()
    )

    invitation_id = invitation.data[0]["id"]

    await send_volunteer_invitation_email(
        to_email=data.email,
        organizer_name=current_user.get("full_name", current_user["user_id"]),
        event_name=event.data[0]["name"],
        invitation_id=invitation_id,
    )

    supabase.table("event_activity_logs").insert({
        "event_id": data.event_id,
        "action_type": "invite",
        "description": f"Invited volunteer via email ({data.email})",
        "actor_id": current_user["user_id"]
    }).execute()

    return {"message": f"Invitation email sent to {data.email}"}


@router.get("/event/{event_id}/assignments")
async def get_event_volunteers(
    event_id: str, current_user: dict = Depends(require_organizer)
):
    supabase = get_supabase()

    assignments = (
        supabase.table("volunteer_assignments")
        .select("*")
        .eq("event_id", event_id)
        .execute()
    )

    invitations = (
        supabase.table("event_invitations")
        .select("*")
        .eq("event_id", event_id)
        .execute()
    )

    volunteer_ids = set()
    for a in assignments.data:
        if a.get("volunteer_id"):
            volunteer_ids.add(a["volunteer_id"])
    for i in invitations.data:
        if i.get("volunteer_user_id"):
            volunteer_ids.add(i["volunteer_user_id"])

    volunteers = []
    if volunteer_ids:
        vols = (
            supabase.table("profiles")
            .select("id, email, full_name, avatar_url")
            .in_("id", list(volunteer_ids))
            .execute()
        )
        volunteers = vols.data

    return {
        "volunteers": volunteers,
        "invitations": invitations.data,
        "assignments": assignments.data,
    }


@router.get("/my-invitations")
async def get_my_invitations(current_user: dict = Depends(get_current_user)):
    if current_user["user_type"] != "volunteer":
        raise HTTPException(status_code=403, detail="Volunteer access required")

    supabase = get_supabase()

    invitations = (
        supabase.table("event_invitations")
        .select("*")
        .eq("volunteer_user_id", current_user["user_id"])
        .eq("status", "pending")
        .execute()
    )

    if not invitations.data:
        return {"invitations": []}

    event_ids = [inv["event_id"] for inv in invitations.data]
    events = (
        supabase.table("events")
        .select("*")
        .in_("id", event_ids)
        .execute()
    )

    events_map = {e["id"]: e for e in events.data}
    enriched = []
    for inv in invitations.data:
        inv["event"] = events_map.get(inv["event_id"])
        enriched.append(inv)

    return {"invitations": enriched}


@router.post("/invitations/{invitation_id}/accept")
async def accept_invitation(
    invitation_id: str, current_user: dict = Depends(get_current_user)
):
    if current_user["user_type"] != "volunteer":
        raise HTTPException(status_code=403, detail="Volunteer access required")

    supabase = get_supabase()

    inv = (
        supabase.table("event_invitations")
        .select("*")
        .eq("id", invitation_id)
        .eq("volunteer_user_id", current_user["user_id"])
        .eq("status", "pending")
        .execute()
    )

    if not inv.data:
        raise HTTPException(status_code=404, detail="Invitation not found or already processed")

    invitation = inv.data[0]

    supabase.table("event_invitations").update({"status": "accepted"}).eq(
        "id", invitation_id
    ).execute()

    existing = (
        supabase.table("volunteer_assignments")
        .select("id")
        .eq("volunteer_id", current_user["user_id"])
        .eq("event_id", invitation["event_id"])
        .execute()
    )

    if not existing.data:
        supabase.table("volunteer_assignments").insert(
            {
                "volunteer_id": current_user["user_id"],
                "event_id": invitation["event_id"],
                "status": "confirmed",
            }
        ).execute()

        supabase.table("event_activity_logs").insert({
            "event_id": invitation["event_id"],
            "action_type": "assignment",
            "description": f"Volunteer {current_user['user_id']} accepted invitation and was assigned to the event",
            "actor_id": current_user["user_id"]
        }).execute()

    return {"message": "Invitation accepted. You have been assigned to the event."}


@router.post("/invitations/{invitation_id}/decline")
async def decline_invitation(
    invitation_id: str, current_user: dict = Depends(get_current_user)
):
    if current_user["user_type"] != "volunteer":
        raise HTTPException(status_code=403, detail="Volunteer access required")

    supabase = get_supabase()

    supabase.table("event_invitations").update({"status": "declined"}).eq(
        "id", invitation_id
    ).eq("volunteer_user_id", current_user["user_id"]).execute()

    return {"message": "Invitation declined"}


@router.get("/search")
async def search_volunteers(q: str, current_user: dict = Depends(require_organizer)):
    supabase = get_supabase()

    q_clean = q.strip()

    # Search profiles by full_name or email
    result = (
        supabase.table("profiles")
        .select("id, email, full_name, avatar_url, role")
        .eq("role", "volunteer")
        .ilike("full_name", f"%{q_clean}%")
        .limit(20)
        .execute()
    )

    # Normalize to expected shape
    volunteers = [
        {"user_id": v["id"], "email": v.get("email", ""), "full_name": v.get("full_name", ""), "avatar_url": v.get("avatar_url")}
        for v in result.data
    ]

    return {"volunteers": volunteers}
