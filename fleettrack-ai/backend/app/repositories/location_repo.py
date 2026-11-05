import uuid
from datetime import datetime
from typing import List, Optional
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession
from geoalchemy2.functions import ST_SetSRID, ST_MakePoint

from app.models.gps_device import GPSDevice
from app.models.location import VehicleLatestLocation, VehicleLocation


class LocationRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def store_location(
        self,
        vehicle_id: uuid.UUID,
        latitude: float,
        longitude: float,
        speed: float,
        heading: float,
        recorded_at: datetime,
        is_simulated: bool = False,
    ) -> VehicleLocation:
        # Record location history
        loc = await LocationRepository.record_location(
            self.db, vehicle_id, latitude, longitude, speed, heading, recorded_at, is_simulated
        )
        # Upsert latest location
        await LocationRepository.upsert_latest_location(
            self.db, vehicle_id, latitude, longitude, speed, heading, recorded_at, is_simulated
        )
        return loc

    async def get_latest(self, vehicle_id: uuid.UUID) -> Optional[VehicleLatestLocation]:
        return await LocationRepository.get_latest_location(self.db, vehicle_id)

    async def get_history(
        self,
        vehicle_id: uuid.UUID,
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None,
        limit: int = 500,
        page: int = 1,
    ) -> List[VehicleLocation]:
        return await LocationRepository.fetch_history(self.db, vehicle_id, start_time, end_time, limit, page)

    @staticmethod
    async def get_device_by_id(db: AsyncSession, device_id: uuid.UUID) -> Optional[GPSDevice]:
        query = select(GPSDevice).where(GPSDevice.id == device_id)
        result = await db.execute(query)
        return result.scalar_one_or_none()

    @staticmethod
    async def get_device_by_identifier(db: AsyncSession, identifier: str) -> Optional[GPSDevice]:
        query = select(GPSDevice).where(GPSDevice.device_identifier == identifier.strip())
        result = await db.execute(query)
        return result.scalar_one_or_none()

    @staticmethod
    async def update_device_last_seen(db: AsyncSession, device_id: uuid.UUID, seen_at: datetime) -> None:
        device = await db.get(GPSDevice, device_id)
        if device:
            device.last_seen_at = seen_at
            await db.flush()

    @staticmethod
    async def record_location(
        db: AsyncSession,
        vehicle_id: uuid.UUID,
        latitude: float,
        longitude: float,
        speed: float,
        heading: float,
        recorded_at: datetime,
        is_simulated: bool = False,
    ) -> VehicleLocation:
        point_geom = None
        try:
            bind = db.get_bind()
            if bind.dialect.name == "postgresql":
                point_geom = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)
        except Exception:
            pass

        location_record = VehicleLocation(
            vehicle_id=vehicle_id,
            latitude=latitude,
            longitude=longitude,
            location=point_geom,
            speed=speed,
            heading=heading,
            recorded_at=recorded_at,
            is_simulated=is_simulated,
        )
        db.add(location_record)
        await db.flush()
        return location_record

    @staticmethod
    async def upsert_latest_location(
        db: AsyncSession,
        vehicle_id: uuid.UUID,
        latitude: float,
        longitude: float,
        speed: float,
        heading: float,
        recorded_at: datetime,
        is_simulated: bool = False,
    ) -> VehicleLatestLocation:
        is_postgres = False
        try:
            bind = db.get_bind()
            is_postgres = bind.dialect.name == "postgresql"
        except Exception:
            pass

        existing = await db.get(VehicleLatestLocation, vehicle_id)
        if existing:
            existing.latitude = latitude
            existing.longitude = longitude
            if is_postgres:
                existing.location = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)
            existing.speed = speed
            existing.heading = heading
            existing.recorded_at = recorded_at
            existing.is_simulated = is_simulated
            await db.flush()
            return existing
        else:
            new_latest = VehicleLatestLocation(
                vehicle_id=vehicle_id,
                latitude=latitude,
                longitude=longitude,
                location=ST_SetSRID(ST_MakePoint(longitude, latitude), 4326) if is_postgres else None,
                speed=speed,
                heading=heading,
                recorded_at=recorded_at,
                is_simulated=is_simulated,
            )
            db.add(new_latest)
            await db.flush()
            return new_latest

    @staticmethod
    async def get_latest_location(db: AsyncSession, vehicle_id: uuid.UUID) -> Optional[VehicleLatestLocation]:
        query = select(VehicleLatestLocation).where(VehicleLatestLocation.vehicle_id == vehicle_id)
        result = await db.execute(query)
        return result.scalar_one_or_none()

    @staticmethod
    async def get_latest_locations_for_vehicles(
        db: AsyncSession,
        vehicle_ids: Optional[List[uuid.UUID]] = None,
    ) -> List[VehicleLatestLocation]:
        query = select(VehicleLatestLocation)
        if vehicle_ids:
            query = query.where(VehicleLatestLocation.vehicle_id.in_(vehicle_ids))
        result = await db.execute(query)
        return list(result.scalars().all())

    @staticmethod
    async def fetch_history(
        db: AsyncSession,
        vehicle_id: uuid.UUID,
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None,
        limit: int = 500,
        page: int = 1,
    ) -> List[VehicleLocation]:
        query = select(VehicleLocation).where(VehicleLocation.vehicle_id == vehicle_id)
        if start_time:
            query = query.where(VehicleLocation.recorded_at >= start_time)
        if end_time:
            query = query.where(VehicleLocation.recorded_at <= end_time)

        skip = (page - 1) * limit
        query = query.order_by(desc(VehicleLocation.recorded_at)).offset(skip).limit(limit)
        result = await db.execute(query)
        return list(result.scalars().all())
