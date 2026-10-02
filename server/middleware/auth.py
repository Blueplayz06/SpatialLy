from fastapi import HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import jwt, JWTError, ExpiredSignatureError
from config import JWT_SECRET, JWT_ALGORITHM, get_supabase

security = HTTPBearer()


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
):
    token = credentials.credentials
    supabase = get_supabase()
    
    try:
        response = supabase.auth.get_user(token)
        user = response.user
    except Exception as e:
        raise HTTPException(status_code=401, detail="Invalid authentication token")

    if not user:
        raise HTTPException(status_code=401, detail="Account not found in Supabase Auth")

    # Check if they exist in canonical profiles table
    profile_data = {}
    try:
        profile_res = supabase.table("profiles").select("*").eq("id", user.id).execute()
        if profile_res.data and len(profile_res.data) > 0:
            profile_data = profile_res.data[0]
    except Exception:
        # Table might not exist or connection error; fall through to metadata
        pass

    metadata = user.user_metadata or {}
    user_type = profile_data.get("role") or metadata.get("user_type") or metadata.get("role") or "organizer"

    return {
        "id": user.id,
        "user_id": profile_data.get("id") or metadata.get("user_id") or str(user.id),
        "email": user.email,
        "user_type": user_type,
        "role": user_type,
        "full_name": profile_data.get("full_name") or metadata.get("full_name", ""),
        "nickname": profile_data.get("nickname") or metadata.get("nickname", ""),
        "avatar_url": profile_data.get("avatar_url") or metadata.get("avatar_url", ""),
        "organization_id": profile_data.get("organization_id"),
        "staff_permissions": profile_data.get("staff_permissions", []),
    }


async def require_organizer(
    current_user: dict = Depends(get_current_user),
):
    if current_user.get("user_type") != "organizer":
        raise HTTPException(status_code=403, detail="Organizer access required")
    return current_user


async def require_volunteer(
    current_user: dict = Depends(get_current_user),
):
    if current_user.get("user_type") != "volunteer":
        raise HTTPException(status_code=403, detail="Volunteer access required")
    return current_user


async def require_user(
    current_user: dict = Depends(get_current_user),
):
    if current_user.get("user_type") != "user":
        raise HTTPException(status_code=403, detail="User access required")
    return current_user
