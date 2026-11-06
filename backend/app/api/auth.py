"""Authentication router, role management, and multi-tenant user registration."""
from __future__ import annotations

import logging
import uuid
from datetime import timedelta
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database.session import get_db
from app.models.company import Company
from app.models.user import User
from app.schemas.auth import (
    InviteUserRequest,
    LoginRequest,
    RegisterRequest,
    TokenResponse,
    UserProfile,
)
from app.security.dependencies import get_current_user, require_fleet_manager
from app.security.jwt import create_access_token
from app.security.passwords import hash_password, verify_password

logger = logging.getLogger("fleettrack.auth")
router = APIRouter(prefix="/api/auth", tags=["Authentication"])


async def get_or_create_default_company(db: AsyncSession) -> Company:
    """Retrieve or create the primary corporate fleet organization."""
    stmt = select(Company).where(Company.name == "FleetCorp Logistics")
    res = await db.execute(stmt)
    comp = res.scalar_one_or_none()
    if not comp:
        comp = Company(
            id=str(uuid.uuid4()),
            name="FleetCorp Logistics",
            invite_code="FLEETCORP-2026",
        )
        db.add(comp)
        await db.commit()
        await db.refresh(comp)
    return comp


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def register(payload: RegisterRequest, db: AsyncSession = Depends(get_db)):
    """
    Public registration endpoint.
    SECURITY LOCKDOWN: Client CANNOT supply arbitrary roles.
    - Standard signups are strictly granted role="DRIVER".
    - If company_name is provided (and user is creating their own fleet org), they become FLEET_MANAGER of that new company.
    - If invite_code is provided, the driver joins that existing company.
    """
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

    # Multi-tenant company resolution
    assigned_company: Company | None = None
    role_to_grant = "DRIVER"

    if payload.company_name and payload.company_name.strip():
        # Tenant Owner creation flow
        comp_name = payload.company_name.strip()
        comp_code = f"{comp_name[:6].upper().replace(' ', '')}-{uuid.uuid4().hex[:6].upper()}"
        assigned_company = Company(
            id=str(uuid.uuid4()),
            name=comp_name,
            invite_code=comp_code,
        )
        db.add(assigned_company)
        await db.flush()
        role_to_grant = "FLEET_MANAGER"
    elif payload.invite_code and payload.invite_code.strip():
        # Driver joining an existing company via invite code
        c_stmt = select(Company).where(Company.invite_code == payload.invite_code.strip().upper())
        c_res = await db.execute(c_stmt)
        assigned_company = c_res.scalar_one_or_none()
        if not assigned_company:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid company invite code. Please request a valid code from your fleet manager.",
            )
        role_to_grant = "DRIVER"
    else:
        # Default company assignment
        assigned_company = await get_or_create_default_company(db)
        role_to_grant = "DRIVER"

    new_user = User(
        company_id=assigned_company.id if assigned_company else None,
        name=payload.name.strip(),
        email=email_clean,
        password_hash=hash_password(payload.password),
        role=role_to_grant,
        is_active=True,
    )
    db.add(new_user)
    await db.commit()
    await db.refresh(new_user)

    logger.info("New %s registered: %s (Company: %s)", new_user.role, new_user.email, assigned_company.name if assigned_company else "None")

    access_token = create_access_token(
        data={
            "sub": new_user.id,
            "cid": new_user.company_id,
            "email": new_user.email,
            "role": new_user.role,
            "name": new_user.name,
        }
    )

    user_profile = UserProfile(
        id=new_user.id,
        company_id=new_user.company_id,
        company_name=assigned_company.name if assigned_company else None,
        name=new_user.name,
        email=new_user.email,
        role=new_user.role,
        is_active=new_user.is_active,
        created_at=new_user.created_at,
    )

    return TokenResponse(
        access_token=access_token,
        token_type="bearer",
        user=user_profile,
    )


@router.post("/invite", response_model=UserProfile, status_code=status.HTTP_201_CREATED)
async def invite_user_to_company(
    payload: InviteUserRequest,
    current_user: User = Depends(require_fleet_manager),
    db: AsyncSession = Depends(get_db),
):
    """
    Managers invite or provision new users strictly within their own company.
    Restricted to FLEET_MANAGER and ADMIN roles.
    """
    clean_email = payload.email.lower().strip()
    stmt = select(User).where(User.email == clean_email)
    res = await db.execute(stmt)
    if res.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A user with this email address already exists.",
        )

    role_val = payload.role.upper()
    if role_val not in ("DRIVER", "FLEET_MANAGER"):
        role_val = "DRIVER"

    # Only ADMIN can create other managers; FLEET_MANAGER can only create DRIVERs
    if current_user.role == "FLEET_MANAGER" and role_val != "DRIVER":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Fleet Managers can only provision driver accounts.",
        )

    invited = User(
        company_id=current_user.company_id,
        name=payload.name.strip(),
        email=clean_email,
        password_hash=hash_password("WelcomeFleet2026!"),
        role=role_val,
        is_active=True,
    )
    db.add(invited)
    await db.commit()
    await db.refresh(invited)

    return UserProfile(
        id=invited.id,
        company_id=invited.company_id,
        company_name=current_user.company.name if current_user.company else None,
        name=invited.name,
        email=invited.email,
        role=invited.role,
        is_active=invited.is_active,
        created_at=invited.created_at,
    )


@router.post("/login", response_model=TokenResponse)
async def login(credentials: LoginRequest, db: AsyncSession = Depends(get_db)):
    """Authenticate user with corporate credentials and issue Bearer JWT."""
    stmt = (
        select(User)
        .options(selectinload(User.company))
        .where(User.email == credentials.email.lower().strip())
    )
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
            "cid": user.company_id,
            "email": user.email,
            "role": user.role,
            "name": user.name,
        }
    )

    user_profile = UserProfile(
        id=user.id,
        company_id=user.company_id,
        company_name=user.company.name if user.company else None,
        name=user.name,
        email=user.email,
        role=user.role,
        is_active=user.is_active,
        created_at=user.created_at,
    )

    return TokenResponse(
        access_token=access_token,
        token_type="bearer",
        user=user_profile,
    )


@router.post("/logout")
async def logout(current_user: User = Depends(get_current_user)):
    """Client-side token disposal endpoint."""
    return {"message": "Logged out successfully"}


@router.get("/me", response_model=UserProfile)
async def get_me(current_user: User = Depends(get_current_user)):
    """Return authenticated profile information with company details."""
    return UserProfile(
        id=current_user.id,
        company_id=current_user.company_id,
        company_name=current_user.company.name if current_user.company else None,
        name=current_user.name,
        email=current_user.email,
        role=current_user.role,
        is_active=current_user.is_active,
        created_at=current_user.created_at,
    )


async def seed_demo_users(db: AsyncSession):
    """Seed multi-tenant companies and demo users if not present."""
    from app.security.passwords import hash_password

    # 1. Seed Company 1: FleetCorp Logistics
    c1_stmt = select(Company).where(Company.name == "FleetCorp Logistics")
    c1_res = await db.execute(c1_stmt)
    c1 = c1_res.scalar_one_or_none()
    if not c1:
        c1 = Company(
            id=str(uuid.uuid4()),
            name="FleetCorp Logistics",
            invite_code="FLEETCORP-2026",
        )
        db.add(c1)
        await db.flush()

    # 2. Seed Company 2: Apex Freight Global (for multi-tenant isolation testing)
    c2_stmt = select(Company).where(Company.name == "Apex Freight Global")
    c2_res = await db.execute(c2_stmt)
    c2 = c2_res.scalar_one_or_none()
    if not c2:
        c2 = Company(
            id=str(uuid.uuid4()),
            name="Apex Freight Global",
            invite_code="APEX-2026",
        )
        db.add(c2)
        await db.flush()

    demo_accounts = [
        ("driver1@fleetcorp.com", "Password123!", "DRIVER", "Alex Rivera (Driver)", c1.id),
        ("driver2@fleetcorp.com", "Password123!", "DRIVER", "Priya Sharma (Driver)", c1.id),
        ("manager@fleetcorp.com", "Password123!", "FLEET_MANAGER", "Operations Fleet Manager", c1.id),
        ("admin@fleetcorp.com", "Password123!", "ADMIN", "Enterprise System Admin", c1.id),
        # Company 2 Users:
        ("driver@apex.com", "Password123!", "DRIVER", "Carlos Ortiz (Apex Driver)", c2.id),
        ("manager@apex.com", "Password123!", "FLEET_MANAGER", "Apex Fleet Manager", c2.id),
    ]

    for email, pwd, role, name, comp_id in demo_accounts:
        stmt = select(User).where(User.email == email)
        res = await db.execute(stmt)
        existing = res.scalar_one_or_none()
        if not existing:
            u = User(
                company_id=comp_id,
                email=email,
                name=name,
                password_hash=hash_password(pwd),
                role=role,
                is_active=True,
            )
            db.add(u)
        else:
            existing.company_id = comp_id
            existing.password_hash = hash_password(pwd)
            existing.is_active = True
    await db.commit()
