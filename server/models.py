from pydantic import BaseModel, EmailStr, field_validator
from typing import Optional, List
import re


PASSWORD_PATTERN_UPPER = re.compile(r'[A-Z]')
PASSWORD_PATTERN_LOWER = re.compile(r'[a-z]')
PASSWORD_PATTERN_DIGIT = re.compile(r'[0-9]')
PASSWORD_PATTERN_SPECIAL = re.compile(r'[#@$]')
PASSWORD_ALLOWED_CHARS = re.compile(r'^[a-zA-Z0-9#@$]+$')


def validate_password_strength(password: str) -> str:
    if len(password) < 8:
        raise ValueError("Password must be at least 8 characters long")
    if not PASSWORD_PATTERN_UPPER.search(password):
        raise ValueError("Password must contain at least one uppercase letter")
    if not PASSWORD_PATTERN_LOWER.search(password):
        raise ValueError("Password must contain at least one lowercase letter")
    if not PASSWORD_PATTERN_DIGIT.search(password):
        raise ValueError("Password must contain at least one number")
    if not PASSWORD_PATTERN_SPECIAL.search(password):
        raise ValueError("Password must contain at least one special character (#, @, or $)")
    if not PASSWORD_ALLOWED_CHARS.match(password):
        raise ValueError("Password can only contain letters, numbers, and special characters (#, @, $)")
    return password


class LoginRequest(BaseModel):
    email: EmailStr
    password: str

    @field_validator("password")
    @classmethod
    def check_password_not_empty(cls, v):
        if not v or not v.strip():
            raise ValueError("Password cannot be empty")
        return v


class SignupRequest(BaseModel):
    email: EmailStr
    password: str
    full_name: str
    nickname: Optional[str] = ""

    @field_validator("password")
    @classmethod
    def check_password(cls, v):
        return validate_password_strength(v)

    @field_validator("full_name")
    @classmethod
    def check_name(cls, v):
        if not v or not v.strip():
            raise ValueError("Full name is required")
        if len(v.strip()) < 2:
            raise ValueError("Full name must be at least 2 characters")
        return v.strip()


class VolunteerSignupRequest(BaseModel):
    email: EmailStr
    password: str
    full_name: str
    nickname: Optional[str] = ""
    invitation_token: str

    @field_validator("password")
    @classmethod
    def check_password(cls, v):
        return validate_password_strength(v)

    @field_validator("full_name")
    @classmethod
    def check_name(cls, v):
        if not v or not v.strip():
            raise ValueError("Full name is required")
        return v.strip()


class EventCreate(BaseModel):
    name: str
    venue: str
    venue_id: Optional[str] = None
    event_date: str
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    description: Optional[str] = ""
    capacity: Optional[int] = 0
    zones: List[str] = []
    location_address: Optional[str] = ""
    organizer_name: Optional[str] = ""

    @field_validator("name")
    @classmethod
    def check_name(cls, v):
        if not v or not v.strip():
            raise ValueError("Event name is required")
        return v.strip()

    @field_validator("venue")
    @classmethod
    def check_venue(cls, v):
        if not v or not v.strip():
            raise ValueError("Venue is required")
        return v.strip()

    @field_validator("event_date")
    @classmethod
    def check_date(cls, v):
        if not v or not v.strip():
            raise ValueError("Event date is required")
        return v.strip()


class EventUpdate(BaseModel):
    name: Optional[str] = None
    venue: Optional[str] = None
    venue_id: Optional[str] = None
    event_date: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    description: Optional[str] = None
    capacity: Optional[int] = None
    zones: Optional[List[str]] = None
    status: Optional[str] = None
    location_address: Optional[str] = None
    organizer_name: Optional[str] = None


class InviteByIdRequest(BaseModel):
    event_id: str
    volunteer_id: str

    @field_validator("volunteer_id")
    @classmethod
    def check_volunteer_id(cls, v):
        if not v or not v.strip():
            raise ValueError("Volunteer ID is required")
        v = v.strip().upper()
        if not v.startswith("V") or not v[1:].isdigit():
            raise ValueError("Volunteer ID must be in format V1, V2, etc.")
        return v


class InviteByEmailRequest(BaseModel):
    event_id: str
    email: EmailStr


class InviteBulkRequest(BaseModel):
    event_id: str
    volunteer_ids: List[str]

    @field_validator("volunteer_ids")
    @classmethod
    def check_volunteer_ids(cls, v):
        if not v:
            raise ValueError("At least one Volunteer ID is required")
        for i, val in enumerate(v):
            val = val.strip().upper()
            if not val.startswith("V") or not val[1:].isdigit():
                raise ValueError(f"Volunteer ID '{val}' must be in format V1, V2, etc.")
            v[i] = val
        return v


class ProfileUpdate(BaseModel):
    full_name: Optional[str] = None
    nickname: Optional[str] = None


class UpdatePasswordRequest(BaseModel):
    current_password: str
    new_password: str
    confirm_password: str

    @field_validator("new_password")
    @classmethod
    def check_password(cls, v):
        return validate_password_strength(v)


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str
    confirm_password: str

    @field_validator("new_password")
    @classmethod
    def check_password(cls, v):
        return validate_password_strength(v)


class AssignPositionRequest(BaseModel):
    volunteer_user_id: str
    zone: str
    pos_x: float = 50.0
    pos_y: float = 50.0

    @field_validator("zone")
    @classmethod
    def check_zone(cls, v):
        if not v or not v.strip():
            raise ValueError("Zone is required")
        return v.strip()

    @field_validator("pos_x", "pos_y")
    @classmethod
    def check_position(cls, v):
        if v < 0 or v > 100:
            raise ValueError("Position must be between 0 and 100")
        return v


class UpdatePositionRequest(BaseModel):
    volunteer_user_id: str
    zone: str
    pos_x: float
    pos_y: float

    @field_validator("pos_x", "pos_y")
    @classmethod
    def check_position(cls, v):
        if v < 0 or v > 100:
            raise ValueError("Position must be between 0 and 100")
        return v


class SwitchPositionRequest(BaseModel):
    target_volunteer_id: str

    @field_validator("target_volunteer_id")
    @classmethod
    def check_target(cls, v):
        if not v or not v.strip():
            raise ValueError("Target volunteer ID is required")
        return v.strip()


class ZoneLayoutItem(BaseModel):
    zone: str
    x: float
    y: float

class ZoneLayoutRequest(BaseModel):
    layout: List[ZoneLayoutItem]
