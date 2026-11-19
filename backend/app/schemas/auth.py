"""Pydantic schemas for authentication and user accounts."""
from __future__ import annotations

from datetime import datetime
from typing import Optional
from pydantic import BaseModel, EmailStr, Field, field_validator


class LoginRequest(BaseModel):
    email: str = Field(..., min_length=3, max_length=255)
    password: str = Field(..., min_length=4)


class RegisterRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=255)
    email: EmailStr = Field(..., max_length=255)
    password: str = Field(..., min_length=6)
    role: Optional[str] = Field(default="DRIVER")  # DRIVER | FLEET_MANAGER
    invite_code: Optional[str] = None
    company_name: Optional[str] = None

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        clean = v.strip()
        if len(clean) < 2:
            raise ValueError("Full name must be at least 2 characters")
        return clean

    @field_validator("role")
    @classmethod
    def validate_role(cls, v: Optional[str]) -> str:
        if v is None:
            return "DRIVER"
        clean = v.strip().upper()
        if clean not in ("DRIVER", "FLEET_MANAGER", "ADMIN"):
            raise ValueError("Invalid role: must be 'DRIVER' or 'FLEET_MANAGER'")
        return clean


class InviteUserRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=255)
    email: str = Field(..., min_length=3, max_length=255)
    role: str = Field(default="DRIVER")  # DRIVER | FLEET_MANAGER


class UserProfile(BaseModel):
    id: str
    company_id: Optional[str] = None
    company_name: Optional[str] = None
    name: str
    email: str
    role: str
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserProfile
