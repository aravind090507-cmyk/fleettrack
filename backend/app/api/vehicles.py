"""Vehicle management endpoints and fleet asset catalog."""
from __future__ import annotations

import logging
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, update, delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database.session import get_db
from app.models.user import User
from app.models.vehicle import Vehicle
from app.schemas.vehicle import VehicleCreate, VehicleListResponse, VehicleResponse, VehicleUpdate
from app.security.dependencies import get_current_user

logger = logging.getLogger("fleettrack.vehicles")
router = APIRouter(prefix="/api/vehicles", tags=["Vehicles"])


@router.get("", response_model=VehicleListResponse)
async def list_vehicles(
    status: Optional[str] = Query(None, description="Filter by vehicle status"),
    vehicle_type: Optional[str] = Query(None, description="Filter by vehicle type"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List vehicles. Available to all authenticated drivers and managers."""
    stmt = select(Vehicle).options(selectinload(Vehicle.assigned_driver))

    if current_user.role == "DRIVER":
        # Show all available vehicles or vehicles assigned to this driver
        stmt = stmt.where((Vehicle.assigned_driver_id == current_user.id) | (Vehicle.status == "AVAILABLE"))
    elif status:
        stmt = stmt.where(Vehicle.status == status.upper())

    if vehicle_type:
        stmt = stmt.where(Vehicle.vehicle_type == vehicle_type.upper())

    stmt = stmt.order_by(Vehicle.created_at.desc())
    result = await db.execute(stmt)
    vehicles = result.scalars().all()

    items = []
    for v in vehicles:
        resp = VehicleResponse.model_validate(v)
        if v.assigned_driver:
            resp.assigned_driver_name = v.assigned_driver.name
        items.append(resp)

    return VehicleListResponse(items=items, total=len(items))


@router.post("", response_model=VehicleResponse, status_code=status.HTTP_201_CREATED)
async def create_vehicle(
    payload: VehicleCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Add a vehicle asset to the fleet. Allowed for drivers (from phone) and managers."""
    reg_clean = payload.registration_number.upper().strip()

    # Check registration uniqueness
    existing = await db.execute(
        select(Vehicle).where(Vehicle.registration_number == reg_clean)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Vehicle with registration {reg_clean} already exists",
        )

    # If created by a driver and no driver assigned, assign to self
    assigned_id = payload.assigned_driver_id
    if not assigned_id and current_user.role == "DRIVER":
        assigned_id = current_user.id

    vehicle = Vehicle(
        registration_number=reg_clean,
        model=payload.model.strip(),
        vehicle_type=payload.vehicle_type.upper(),
        assigned_driver_id=assigned_id,
        status="AVAILABLE",
        battery_or_fuel_level=payload.battery_or_fuel_level,
    )
    db.add(vehicle)
    await db.commit()
    await db.refresh(vehicle)
    return VehicleResponse.model_validate(vehicle)


@router.get("/{vehicle_id}", response_model=VehicleResponse)
async def get_vehicle(
    vehicle_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Retrieve detailed vehicle telemetry and assignment status."""
    stmt = (
        select(Vehicle)
        .where(Vehicle.id == vehicle_id)
        .options(selectinload(Vehicle.assigned_driver))
    )
    result = await db.execute(stmt)
    vehicle = result.scalar_one_or_none()
    if not vehicle:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vehicle not found")

    resp = VehicleResponse.model_validate(vehicle)
    if vehicle.assigned_driver:
        resp.assigned_driver_name = vehicle.assigned_driver.name
    return resp


@router.put("/{vehicle_id}", response_model=VehicleResponse)
async def update_vehicle(
    vehicle_id: str,
    payload: VehicleUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update vehicle specifications or status."""
    stmt = select(Vehicle).where(Vehicle.id == vehicle_id)
    result = await db.execute(stmt)
    vehicle = result.scalar_one_or_none()
    if not vehicle:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vehicle not found")

    update_data = payload.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        if value is not None:
            if field in ("registration_number", "vehicle_type", "status"):
                setattr(vehicle, field, value.upper())
            else:
                setattr(vehicle, field, value)

    await db.commit()
    await db.refresh(vehicle)
    return VehicleResponse.model_validate(vehicle)


@router.delete("/{vehicle_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_vehicle(
    vehicle_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Decommission a vehicle asset from the fleet."""
    stmt = select(Vehicle).where(Vehicle.id == vehicle_id)
    result = await db.execute(stmt)
    vehicle = result.scalar_one_or_none()
    if not vehicle:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vehicle not found")

    await db.delete(vehicle)
    await db.commit()


async def seed_demo_vehicles(db: AsyncSession):
    """Optional demonstration seeds."""
    pass
