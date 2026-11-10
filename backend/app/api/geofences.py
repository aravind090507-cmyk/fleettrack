"""Geofence management and device association endpoints."""

from typing import List, Optional, Dict, Any
import uuid
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from app.database.session import get_db
from app.models.geofence import Geofence, DeviceGeofence
from app.models.user import User
from app.security.dependencies import get_current_user

router = APIRouter(prefix="/api/geofences", tags=["Geofences"])


class GeofenceCreate(BaseModel):
    name: str
    description: Optional[str] = None
    kind: str = "polygon"  # circle | polygon | linestring
    geometry: Dict[str, Any]  # GeoJSON representation
    attributes: Optional[Dict[str, Any]] = None


class GeofenceUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    kind: Optional[str] = None
    geometry: Optional[Dict[str, Any]] = None
    attributes: Optional[Dict[str, Any]] = None


class GeofenceResponse(BaseModel):
    id: str
    company_id: str
    name: str
    description: Optional[str] = None
    kind: str
    geometry: Dict[str, Any]
    attributes: Optional[Dict[str, Any]] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class LinkDevicesPayload(BaseModel):
    device_ids: List[str]
    all_devices: bool = False


@router.get("", response_model=List[GeofenceResponse])
async def list_geofences(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Geofence)
    if current_user.company_id:
        stmt = stmt.where(Geofence.company_id == current_user.company_id)
    stmt = stmt.order_by(Geofence.name.asc())
    result = await db.execute(stmt)
    return result.scalars().all()


@router.post("", response_model=GeofenceResponse, status_code=status.HTTP_201_CREATED)
async def create_geofence(
    payload: GeofenceCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not current_user.company_id:
        raise HTTPException(status_code=400, detail="User must belong to a company to create geofences")

    gf = Geofence(
        id=f"gf-{uuid.uuid4()}",
        company_id=current_user.company_id,
        name=payload.name,
        description=payload.description,
        kind=payload.kind.lower(),
        geometry=payload.geometry,
        attributes=payload.attributes or {},
    )
    db.add(gf)
    await db.commit()
    await db.refresh(gf)
    return gf


@router.get("/{geofence_id}", response_model=GeofenceResponse)
async def get_geofence(
    geofence_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Geofence).where(Geofence.id == geofence_id)
    gf = (await db.execute(stmt)).scalars().first()
    if not gf:
        raise HTTPException(status_code=404, detail="Geofence not found")
    if current_user.company_id and gf.company_id != current_user.company_id:
        raise HTTPException(status_code=403, detail="Access denied")
    return gf


@router.put("/{geofence_id}", response_model=GeofenceResponse)
async def update_geofence(
    geofence_id: str,
    payload: GeofenceUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Geofence).where(Geofence.id == geofence_id)
    gf = (await db.execute(stmt)).scalars().first()
    if not gf:
        raise HTTPException(status_code=404, detail="Geofence not found")
    if current_user.company_id and gf.company_id != current_user.company_id:
        raise HTTPException(status_code=403, detail="Access denied")

    if payload.name is not None:
        gf.name = payload.name
    if payload.description is not None:
        gf.description = payload.description
    if payload.kind is not None:
        gf.kind = payload.kind.lower()
    if payload.geometry is not None:
        gf.geometry = payload.geometry
    if payload.attributes is not None:
        gf.attributes = payload.attributes

    await db.commit()
    await db.refresh(gf)
    return gf


@router.delete("/{geofence_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_geofence(
    geofence_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Geofence).where(Geofence.id == geofence_id)
    gf = (await db.execute(stmt)).scalars().first()
    if not gf:
        raise HTTPException(status_code=404, detail="Geofence not found")
    if current_user.company_id and gf.company_id != current_user.company_id:
        raise HTTPException(status_code=403, detail="Access denied")

    await db.delete(gf)
    await db.commit()
    return None


@router.post("/{geofence_id}/devices")
async def link_devices_to_geofence(
    geofence_id: str,
    payload: LinkDevicesPayload,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Geofence).where(Geofence.id == geofence_id)
    gf = (await db.execute(stmt)).scalars().first()
    if not gf:
        raise HTTPException(status_code=404, detail="Geofence not found")
    if current_user.company_id and gf.company_id != current_user.company_id:
        raise HTTPException(status_code=403, detail="Access denied")

    # Clear existing links
    await db.execute(delete(DeviceGeofence).where(DeviceGeofence.geofence_id == geofence_id))

    if payload.all_devices:
        link = DeviceGeofence(geofence_id=geofence_id, all_devices=True)
        db.add(link)
    else:
        for did in payload.device_ids:
            link = DeviceGeofence(geofence_id=geofence_id, device_id=did, all_devices=False)
            db.add(link)

    await db.commit()
    return {"status": "linked", "geofence_id": geofence_id}
