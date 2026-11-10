"""Devices management and telematics diagnostics endpoint."""

from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from datetime import datetime

from app.database.session import get_db
from app.models.device import Device
from app.models.user import User
from app.security.dependencies import get_current_user
from app.pipeline.state import DeviceStateManager

router = APIRouter(prefix="/api/devices", tags=["Telematics Devices"])


class DeviceCreate(BaseModel):
    name: str
    unique_id: str
    vehicle_id: Optional[str] = None
    attributes: Optional[Dict[str, Any]] = None


class DeviceResponse(BaseModel):
    id: str
    company_id: str
    unique_id: str
    name: str
    vehicle_id: Optional[str] = None
    status: str
    last_update: Optional[datetime] = None
    disabled: bool
    attributes: Optional[Dict[str, Any]] = None

    model_config = {"from_attributes": True}


class DeviceDiagnostics(BaseModel):
    device_id: str
    unique_id: str
    status: str
    last_update: Optional[datetime] = None
    accepted_count: int
    rejected_count: int
    filtered_count: int
    reason_counters: Dict[str, int]
    last_ingest_lag_ms: float
    clock_skew_ms: float
    rejected_samples: List[Dict[str, Any]]


@router.get("", response_model=List[DeviceResponse])
async def list_devices(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Device)
    if current_user.company_id:
        stmt = stmt.where(Device.company_id == current_user.company_id)
    result = await db.execute(stmt)
    return result.scalars().all()


@router.post("", response_model=DeviceResponse, status_code=status.HTTP_201_CREATED)
async def create_device(
    payload: DeviceCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not current_user.company_id:
        raise HTTPException(status_code=400, detail="User must belong to a company to register devices")

    # Check unique_id
    stmt = select(Device).where(Device.unique_id == payload.unique_id)
    existing = (await db.execute(stmt)).scalars().first()
    if existing:
        raise HTTPException(status_code=400, detail="Device unique_id already registered")

    import uuid
    device = Device(
        id=str(uuid.uuid4()),
        company_id=current_user.company_id,
        unique_id=payload.unique_id,
        name=payload.name,
        vehicle_id=payload.vehicle_id,
        status="unknown",
        attributes=payload.attributes or {},
    )
    db.add(device)
    await db.commit()
    await db.refresh(device)
    return device


@router.get("/{device_id}/diagnostics", response_model=DeviceDiagnostics)
async def get_device_diagnostics(
    device_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Device).where(Device.id == device_id)
    device = (await db.execute(stmt)).scalars().first()
    if not device:
        # Check by unique_id
        stmt2 = select(Device).where(Device.unique_id == device_id)
        device = (await db.execute(stmt2)).scalars().first()

    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    if current_user.company_id and device.company_id != current_user.company_id:
        raise HTTPException(status_code=403, detail="Access denied")

    state_mgr = DeviceStateManager.get_instance()
    runtime_state = await state_mgr.get_state(device.id)

    return DeviceDiagnostics(
        device_id=device.id,
        unique_id=device.unique_id,
        status=device.status,
        last_update=device.last_update,
        accepted_count=runtime_state.accepted_count,
        rejected_count=runtime_state.rejected_count,
        filtered_count=runtime_state.filtered_count,
        reason_counters=dict(runtime_state.reason_counters),
        last_ingest_lag_ms=runtime_state.last_ingest_lag_ms,
        clock_skew_ms=runtime_state.clock_skew_ms,
        rejected_samples=list(runtime_state.rejected_samples),
    )
