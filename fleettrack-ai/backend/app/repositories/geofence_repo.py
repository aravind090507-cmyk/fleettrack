import uuid
from datetime import datetime, timedelta, timezone
from typing import List, Optional
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.geofence import Geofence, GeofenceEvent
from app.models.project import Project
from app.models.vehicle import Vehicle
from app.schemas.geofence import GeofenceCreate, GeofenceUpdate


class GeofenceRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_all(self, project_id: Optional[uuid.UUID] = None, active_only: bool = False) -> List[Geofence]:
        return await GeofenceRepository.list_geofences(self.db, project_id=project_id, active_only=active_only)

    async def get_by_id(self, geofence_id: uuid.UUID) -> Optional[Geofence]:
        return await GeofenceRepository.fetch_by_id(self.db, geofence_id)

    async def create(self, geofence_in: GeofenceCreate) -> Geofence:
        return await GeofenceRepository.create_geofence(self.db, geofence_in)

    async def update(self, geofence: Geofence, update_data: dict) -> Geofence:
        for field, value in update_data.items():
            setattr(geofence, field, value)
        await self.db.flush()
        return await GeofenceRepository.fetch_by_id(self.db, geofence.id)

    async def delete(self, geofence: Geofence) -> None:
        return await GeofenceRepository.delete_geofence(self.db, geofence)

    @staticmethod
    async def fetch_by_id(db: AsyncSession, geofence_id: uuid.UUID) -> Optional[Geofence]:
        query = (
            select(Geofence)
            .where(Geofence.id == geofence_id)
            .options(selectinload(Geofence.project))
        )
        result = await db.execute(query)
        return result.scalar_one_or_none()

    @staticmethod
    async def list_geofences(
        db: AsyncSession,
        project_id: Optional[uuid.UUID] = None,
        active_only: bool = False,
        skip: int = 0,
        limit: int = 100,
    ) -> List[Geofence]:
        query = select(Geofence).options(selectinload(Geofence.project))
        if project_id:
            query = query.where(Geofence.project_id == project_id)
        if active_only:
            query = query.where(Geofence.is_active == True)

        query = query.order_by(Geofence.created_at.desc()).offset(skip).limit(limit)
        result = await db.execute(query)
        return list(result.scalars().all())

    @staticmethod
    async def create_geofence(db: AsyncSession, geofence_in: GeofenceCreate) -> Geofence:
        geofence = Geofence(
            name=geofence_in.name,
            project_id=geofence_in.project_id,
            geofence_type=geofence_in.geofence_type,
            center_latitude=geofence_in.center_latitude,
            center_longitude=geofence_in.center_longitude,
            radius_meters=geofence_in.radius_meters,
            polygon_coordinates=geofence_in.polygon_coordinates,
            is_active=geofence_in.is_active,
        )
        db.add(geofence)
        await db.flush()
        return await GeofenceRepository.fetch_by_id(db, geofence.id)  # type: ignore

    @staticmethod
    async def update_geofence(db: AsyncSession, geofence: Geofence, geofence_in: GeofenceUpdate) -> Geofence:
        update_data = geofence_in.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(geofence, field, value)

        await db.flush()
        return await GeofenceRepository.fetch_by_id(db, geofence.id)  # type: ignore

    @staticmethod
    async def delete_geofence(db: AsyncSession, geofence: Geofence) -> None:
        await db.delete(geofence)
        await db.flush()

    @staticmethod
    async def record_event(
        db: AsyncSession,
        vehicle_id: uuid.UUID,
        geofence_id: uuid.UUID,
        event_type: str,
        latitude: Optional[float] = None,
        longitude: Optional[float] = None,
    ) -> GeofenceEvent:
        event = GeofenceEvent(
            vehicle_id=vehicle_id,
            geofence_id=geofence_id,
            event_type=event_type,
            latitude=latitude,
            longitude=longitude,
        )
        db.add(event)
        await db.flush()
        return event

    @staticmethod
    async def get_last_event_for_vehicle(
        db: AsyncSession,
        vehicle_id: uuid.UUID,
        geofence_id: uuid.UUID,
    ) -> Optional[GeofenceEvent]:
        query = (
            select(GeofenceEvent)
            .where(
                GeofenceEvent.vehicle_id == vehicle_id,
                GeofenceEvent.geofence_id == geofence_id,
            )
            .order_by(desc(GeofenceEvent.occurred_at))
            .limit(1)
        )
        result = await db.execute(query)
        return result.scalar_one_or_none()

    @staticmethod
    async def list_events(
        db: AsyncSession,
        vehicle_id: Optional[uuid.UUID] = None,
        geofence_id: Optional[uuid.UUID] = None,
        hours: int = 24,
        limit: int = 100,
    ) -> List[GeofenceEvent]:
        query = (
            select(GeofenceEvent)
            .options(
                selectinload(GeofenceEvent.vehicle),
                selectinload(GeofenceEvent.geofence),
            )
        )
        if vehicle_id:
            query = query.where(GeofenceEvent.vehicle_id == vehicle_id)
        if geofence_id:
            query = query.where(GeofenceEvent.geofence_id == geofence_id)
        if hours > 0:
            cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
            query = query.where(GeofenceEvent.occurred_at >= cutoff)

        query = query.order_by(desc(GeofenceEvent.occurred_at)).limit(limit)
        result = await db.execute(query)
        return list(result.scalars().all())
