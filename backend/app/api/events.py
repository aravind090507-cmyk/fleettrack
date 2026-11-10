"""Telematics Events API with multi-tenant company scoping."""

from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from app.database.session import get_db
from app.models.event import Event
from app.models.user import User
from app.security.dependencies import get_current_user

router = APIRouter(prefix="/api/events", tags=["Telematics Events"])


class EventItem(BaseModel):
    id: str
    company_id: str
    device_id: str
    journey_id: Optional[str] = None
    geofence_id: Optional[str] = None
    type: str
    event_time: datetime
    attributes: Optional[dict] = None
    created_at: datetime

    model_config = {"from_attributes": True}


@router.get("", response_model=List[EventItem])
async def list_events(
    device_id: Optional[str] = Query(None),
    journey_id: Optional[str] = Query(None),
    event_type: Optional[str] = Query(None, alias="type"),
    from_time: Optional[datetime] = Query(None, alias="from"),
    to_time: Optional[datetime] = Query(None, alias="to"),
    limit: int = Query(200, ge=1, le=1000),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Retrieve company-scoped telematics events (motion, overspeed, geofences, alarms)."""
    stmt = select(Event)
    if current_user.company_id:
        stmt = stmt.where(Event.company_id == current_user.company_id)

    if device_id:
        stmt = stmt.where(Event.device_id == device_id)
    if journey_id:
        stmt = stmt.where(Event.journey_id == journey_id)
    if event_type:
        stmt = stmt.where(Event.type == event_type)
    if from_time:
        stmt = stmt.where(Event.event_time >= from_time)
    if to_time:
        stmt = stmt.where(Event.event_time <= to_time)

    stmt = stmt.order_by(Event.event_time.desc()).limit(limit)
    result = await db.execute(stmt)
    return result.scalars().all()
