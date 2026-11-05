"""Authentication router and user registration."""
from __future__ import annotations

import logging
from datetime import timedelta
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database.session import get_db
from app.models.user import User
from app.schemas.auth import LoginRequest, RegisterRequest, TokenResponse, UserProfile
from app.security.dependencies import get_current_user
from app.security.jwt import create_access_token
from app.security.passwords import hash_password, verify_password

logger = logging.getLogger("fleettrack.auth")
router = APIRouter(prefix="/api/auth", tags=["Authentication"])


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def register(payload: RegisterRequest, db: AsyncSession = Depends(get_db)):
    """Register a new real user account directly from mobile or web."""
    email_clean = payload.email.lower().strip()
    
    # Check if user already exists
    stmt = select(User).where(User.email == email_clean)
    result = await db.execute(stmt)
    existing = result.scalar_one_or_none()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email address already exists. Please log in.",
        )

    role_val = payload.role.upper()
    if role_val not in ("DRIVER", "FLEET_MANAGER", "ADMIN"):
        role_val = "DRIVER"

    new_user = User(
        name=payload.name.strip(),
        email=email_clean,
        password_hash=hash_password(payload.password),
        role=role_val,
        is_active=True,
    )
    db.add(new_user)
    await db.commit()
    await db.refresh(new_user)

    logger.info("New user registered: %s (%s)", new_user.email, new_user.role)

    access_token = create_access_token(
        data={
            "sub": new_user.id,
            "email": new_user.email,
            "role": new_user.role,
            "name": new_user.name,
        }
    )

    return TokenResponse(
        access_token=access_token,
        token_type="bearer",
        user=UserProfile.model_validate(new_user),
    )


@router.post("/login", response_model=TokenResponse)
async def login(credentials: LoginRequest, db: AsyncSession = Depends(get_db)):
    """Authenticate user with corporate credentials and issue Bearer JWT."""
    stmt = select(User).where(User.email == credentials.email.lower().strip())
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()

    if not user or not verify_password(credentials.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account has been suspended or deactivated",
        )

    access_token = create_access_token(
        data={
            "sub": user.id,
            "email": user.email,
            "role": user.role,
            "name": user.name,
        }
    )

    return TokenResponse(
        access_token=access_token,
        token_type="bearer",
        user=UserProfile.model_validate(user),
    )


@router.post("/logout")
async def logout(current_user: User = Depends(get_current_user)):
    """Client-side token disposal endpoint."""
    return {"message": "Logged out successfully"}


@router.get("/me", response_model=UserProfile)
async def get_me(current_user: User = Depends(get_current_user)):
    """Return authenticated profile information."""
    return UserProfile.model_validate(current_user)


async def seed_demo_users(db: AsyncSession):
    """Seed standard demo accounts if not already present."""
    from app.security.passwords import hash_password

    demo_accounts = [
        ("driver1@fleetcorp.com", "Password123!", "DRIVER", "Ramesh Kumar (Driver)"),
        ("driver2@fleetcorp.com", "Password123!", "DRIVER", "Priya Sharma (Driver)"),
        ("manager@fleetcorp.com", "Password123!", "FLEET_MANAGER", "Operations Fleet Manager"),
        ("admin@fleetcorp.com", "Password123!", "ADMIN", "Enterprise System Admin"),
    ]

    for email, pwd, role, name in demo_accounts:
        stmt = select(User).where(User.email == email)
        res = await db.execute(stmt)
        existing = res.scalar_one_or_none()
        if not existing:
            u = User(
                email=email,
                name=name,
                password_hash=hash_password(pwd),
                role=role,
                is_active=True,
            )
            db.add(u)
        else:
            # Update password hash so demo password always works
            existing.password_hash = hash_password(pwd)
            existing.is_active = True
    await db.commit()
