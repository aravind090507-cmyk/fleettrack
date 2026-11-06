"""Pydantic schemas for authentication and user accounts."""
from __future__ import annotations

from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    email: str = Field(..., min_length=3, max_length=255)
    password: str = Field(..., min_length=4)


class RegisterRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=255)
    email: str = Field(..., min_length=3, max_length=255)
    password: str = Field(..., min_length=6)
    invite_code: Optional[str] = None
    company_name: Optional[str] = None


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
