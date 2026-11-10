"""Positions query API with cursor and range pagination."""

from typing import List, Optional
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from app.database.session import get_db
from app.models.location import Location
from app.models.device import Device
from app.models.user import User
from app.security.dependencies import get_current_user

router = APIRouter(prefix="/api/positions", tags=["Positions & Tracks"])


class PositionItem(BaseModel):
    id: int
    device_id: Optional[str] = None
    journey_id: Optional[str] = None
    latitude: float
    longitude: float
    speed: float
    heading: float
    accuracy: float
    altitude: Optional[float] = None
    valid: bool
    outdated: bool
    protocol: str
    distance_m: float
    total_distance_m: float
    motion: bool
    geofence_ids: Optional[List[str]] = None
    attributes: Optional[dict] = None
    recorded_at: datetime
    server_received_at: datetime

    model_config = {"from_attributes": True}


@router.get("", response_model=List[PositionItem])
async def get_positions(
    device_id: Optional[str] = Query(None),
    journey_id: Optional[str] = Query(None),
    from_time: Optional[datetime] = Query(None, alias="from"),
    to_time: Optional[datetime] = Query(None, alias="to"),
    cursor: Optional[int] = Query(None, description="Starting ID for pagination"),
    limit: int = Query(500, ge=1, le=5000),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Retrieve telematics positions with high-volume range filtering (limit <= 5000)."""
    stmt = select(Location)

    # Multi-tenant company security check
    if current_user.company_id:
        # Join Device to enforce company boundary
        stmt = stmt.join(Device, Location.device_id == Device.id).where(
            Device.company_id == current_user.company_id
        )

    if device_id:
        stmt = stmt.where(Location.device_id == device_id)
    if journey_id:
        stmt = stmt.where(Location.journey_id == journey_id)
    if from_time:
        stmt = stmt.where(Location.recorded_at >= from_time)
    if to_time:
        stmt = stmt.where(Location.recorded_at <= to_time)
    if cursor is not None:
        stmt = stmt.where(Location.id > cursor)

    stmt = stmt.order_by(Location.recorded_at.asc(), Location.id.asc()).limit(limit)
    result = await db.execute(stmt)
    return result.scalars().all()
