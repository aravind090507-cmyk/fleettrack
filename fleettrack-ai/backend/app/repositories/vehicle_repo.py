import uuid
from typing import Dict, List, Optional
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.gps_device import GPSDevice
from app.models.location import VehicleLatestLocation
from app.models.project import Project
from app.models.user import User
from app.models.vehicle import Vehicle
from app.schemas.vehicle import VehicleCreate, VehicleUpdate


class VehicleRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_by_id(self, vehicle_id: uuid.UUID) -> Optional[Vehicle]:
        query = (
            select(Vehicle)
            .where(Vehicle.id == vehicle_id)
            .options(
                selectinload(Vehicle.latest_location),
                selectinload(Vehicle.manager),
                selectinload(Vehicle.project),
                selectinload(Vehicle.device),
            )
        )
        result = await self.db.execute(query)
        return result.scalar_one_or_none()

    async def get_by_registration(self, reg_number: str) -> Optional[Vehicle]:
        query = (
            select(Vehicle)
            .where(Vehicle.registration_number == reg_number.strip().upper())
            .options(
                selectinload(Vehicle.latest_location),
                selectinload(Vehicle.manager),
                selectinload(Vehicle.project),
                selectinload(Vehicle.device),
            )
        )
        result = await self.db.execute(query)
        return result.scalar_one_or_none()

    async def get_all(
        self,
        status_filter: Optional[str] = None,
        vehicle_type: Optional[str] = None,
        project_id: Optional[uuid.UUID] = None,
        skip: int = 0,
        limit: int = 100,
    ) -> List[Vehicle]:
        query = (
            select(Vehicle)
            .options(
                selectinload(Vehicle.latest_location),
                selectinload(Vehicle.manager),
                selectinload(Vehicle.project),
                selectinload(Vehicle.device),
            )
            .where(Vehicle.is_active == True)
        )
        if status_filter:
            query = query.where(Vehicle.status == status_filter)
        if vehicle_type:
            query = query.where(Vehicle.vehicle_type == vehicle_type)
        if project_id:
            query = query.where(Vehicle.assigned_project_id == project_id)

        query = query.order_by(Vehicle.created_at.desc()).offset(skip).limit(limit)
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_by_manager(
        self,
        manager_id: uuid.UUID,
        status_filter: Optional[str] = None,
        vehicle_type: Optional[str] = None,
        project_id: Optional[uuid.UUID] = None,
        skip: int = 0,
        limit: int = 100,
    ) -> List[Vehicle]:
        query = (
            select(Vehicle)
            .options(
                selectinload(Vehicle.latest_location),
                selectinload(Vehicle.manager),
                selectinload(Vehicle.project),
                selectinload(Vehicle.device),
            )
            .where(Vehicle.assigned_manager_id == manager_id, Vehicle.is_active == True)
        )
        if status_filter:
            query = query.where(Vehicle.status == status_filter)
        if vehicle_type:
            query = query.where(Vehicle.vehicle_type == vehicle_type)
        if project_id:
            query = query.where(Vehicle.assigned_project_id == project_id)

        query = query.order_by(Vehicle.created_at.desc()).offset(skip).limit(limit)
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def create(self, vehicle_in: VehicleCreate) -> Vehicle:
        vehicle = Vehicle(
            registration_number=vehicle_in.registration_number.strip().upper(),
            vehicle_type=vehicle_in.vehicle_type,
            status=vehicle_in.status,
            device_id=vehicle_in.device_id,
            assigned_manager_id=vehicle_in.assigned_manager_id,
            assigned_project_id=vehicle_in.assigned_project_id,
            is_active=vehicle_in.is_active,
        )
        self.db.add(vehicle)
        await self.db.flush()
        return await self.get_by_id(vehicle.id)  # type: ignore

    async def update(self, vehicle: Vehicle, update_data: dict) -> Vehicle:
        if "registration_number" in update_data and update_data["registration_number"]:
            update_data["registration_number"] = update_data["registration_number"].strip().upper()

        for field, value in update_data.items():
            setattr(vehicle, field, value)

        await self.db.flush()
        return await self.get_by_id(vehicle.id)  # type: ignore

    async def delete(self, vehicle: Vehicle) -> None:
        await self.db.delete(vehicle)
        await self.db.flush()

    # Static wrappers
    @staticmethod
    async def fetch_by_id(db: AsyncSession, vehicle_id: uuid.UUID) -> Optional[Vehicle]:
        return await VehicleRepository(db).get_by_id(vehicle_id)

    @staticmethod
    async def fetch_by_registration(db: AsyncSession, reg_number: str) -> Optional[Vehicle]:
        return await VehicleRepository(db).get_by_registration(reg_number)

    @staticmethod
    async def list_vehicles(
        db: AsyncSession,
        manager_id: Optional[uuid.UUID] = None,
        project_id: Optional[uuid.UUID] = None,
        status: Optional[str] = None,
        skip: int = 0,
        limit: int = 100,
    ) -> List[Vehicle]:
        repo = VehicleRepository(db)
        if manager_id:
            return await repo.get_by_manager(manager_id, status_filter=status, project_id=project_id, skip=skip, limit=limit)
        return await repo.get_all(status_filter=status, project_id=project_id, skip=skip, limit=limit)

    @staticmethod
    async def create_vehicle(db: AsyncSession, vehicle_in: VehicleCreate) -> Vehicle:
        return await VehicleRepository(db).create(vehicle_in)

    @staticmethod
    async def update_vehicle(db: AsyncSession, vehicle: Vehicle, vehicle_in: VehicleUpdate) -> Vehicle:
        return await VehicleRepository(db).update(vehicle, vehicle_in.model_dump(exclude_unset=True))

    @staticmethod
    async def delete_vehicle(db: AsyncSession, vehicle: Vehicle) -> None:
        await VehicleRepository(db).delete(vehicle)
