import uuid
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user, require_admin
from app.database.session import get_db
from app.models.user import User
from app.repositories.vehicle_repo import VehicleRepository
from app.repositories.location_repo import LocationRepository
from app.schemas.vehicle import VehicleCreate, VehicleUpdate, VehicleResponse

router = APIRouter()


def _check_vehicle_access(vehicle, current_user: User):
    """Fleet managers can only access their assigned vehicles."""
    if current_user.role == "admin":
        return
    if vehicle.assigned_manager_id != current_user.id:
        raise HTTPException(status_code=403, detail="Access denied to this vehicle")


@router.get("", response_model=List[VehicleResponse])
async def list_vehicles(
    status_filter: Optional[str] = Query(None, alias="status"),
    vehicle_type: Optional[str] = Query(None),
    project_id: Optional[uuid.UUID] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    repo = VehicleRepository(db)
    if current_user.role == "admin":
        vehicles = await repo.get_all(status_filter=status_filter, vehicle_type=vehicle_type, project_id=project_id)
    else:
        vehicles = await repo.get_by_manager(
            current_user.id,
            status_filter=status_filter,
            vehicle_type=vehicle_type,
            project_id=project_id,
        )
    return vehicles


@router.post("", response_model=VehicleResponse, status_code=status.HTTP_201_CREATED)
async def create_vehicle(
    data: VehicleCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    repo = VehicleRepository(db)
    existing = await repo.get_by_registration(data.registration_number)
    if existing:
        raise HTTPException(status_code=400, detail="Registration number already exists")
    return await repo.create(data)


@router.get("/events", response_model=List[dict])
async def get_vehicle_events(
    limit: int = Query(20, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get recent vehicle events for the activity feed."""
    from sqlalchemy import select, desc
    from app.models.vehicle_event import VehicleEvent
    from app.models.vehicle import Vehicle

    query = select(VehicleEvent, Vehicle.registration_number).join(
        Vehicle, Vehicle.id == VehicleEvent.vehicle_id
    ).order_by(desc(VehicleEvent.occurred_at)).limit(limit)

    if current_user.role != "admin":
        query = query.where(Vehicle.assigned_manager_id == current_user.id)

    result = await db.execute(query)
    rows = result.all()
    return [
        {
            "id": str(row[0].id),
            "vehicle_id": str(row[0].vehicle_id),
            "registration_number": row[1],
            "event_type": row[0].event_type,
            "description": row[0].description,
            "occurred_at": row[0].occurred_at.isoformat(),
        }
        for row in rows
    ]


@router.get("/{vehicle_id}", response_model=VehicleResponse)
async def get_vehicle(
    vehicle_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    repo = VehicleRepository(db)
    vehicle = await repo.get_by_id(vehicle_id)
    if not vehicle:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    _check_vehicle_access(vehicle, current_user)
    return vehicle


@router.patch("/{vehicle_id}", response_model=VehicleResponse)
async def update_vehicle(
    vehicle_id: uuid.UUID,
    data: VehicleUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    repo = VehicleRepository(db)
    vehicle = await repo.get_by_id(vehicle_id)
    if not vehicle:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    if data.registration_number:
        existing = await repo.get_by_registration(data.registration_number)
        if existing and existing.id != vehicle_id:
            raise HTTPException(status_code=400, detail="Registration number already taken")
    return await repo.update(vehicle, data.model_dump(exclude_unset=True))


@router.delete("/{vehicle_id}", status_code=status.HTTP_204_NO_CONTENT)
async def deactivate_vehicle(
    vehicle_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    repo = VehicleRepository(db)
    vehicle = await repo.get_by_id(vehicle_id)
    if not vehicle:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    await repo.update(vehicle, {"is_active": False, "status": "offline"})


@router.get("/{vehicle_id}/location")
async def get_vehicle_location(
    vehicle_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from app.repositories.location_repo import LocationRepository
    vehicle_repo = VehicleRepository(db)
    vehicle = await vehicle_repo.get_by_id(vehicle_id)
    if not vehicle:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    _check_vehicle_access(vehicle, current_user)

    loc_repo = LocationRepository(db)
    loc = await loc_repo.get_latest(vehicle_id)
    if not loc:
        raise HTTPException(status_code=404, detail="No location data for this vehicle")
    return {
        "vehicle_id": str(vehicle_id),
        "latitude": loc.latitude,
        "longitude": loc.longitude,
        "speed": loc.speed,
        "heading": loc.heading,
        "recorded_at": loc.recorded_at.isoformat(),
        "is_simulated": loc.is_simulated,
    }


@router.get("/{vehicle_id}/history")
async def get_vehicle_history(
    vehicle_id: uuid.UUID,
    start_time: Optional[str] = Query(None),
    end_time: Optional[str] = Query(None),
    limit: int = Query(500, le=2000),
    page: int = Query(1, ge=1),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from datetime import datetime, timezone
    vehicle_repo = VehicleRepository(db)
    vehicle = await vehicle_repo.get_by_id(vehicle_id)
    if not vehicle:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    _check_vehicle_access(vehicle, current_user)

    loc_repo = LocationRepository(db)
    start_dt = datetime.fromisoformat(start_time) if start_time else None
    end_dt = datetime.fromisoformat(end_time) if end_time else None
    locations = await loc_repo.get_history(vehicle_id, start_dt, end_dt, limit, page)
    return {
        "vehicle_id": str(vehicle_id),
        "page": page,
        "limit": limit,
        "count": len(locations),
        "locations": locations,
    }


@router.get("/{vehicle_id}/eta")
async def get_vehicle_eta(
    vehicle_id: uuid.UUID,
    dest_lat: float = Query(...),
    dest_lng: float = Query(...),
    dest_name: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from app.repositories.location_repo import LocationRepository
    from app.services.eta_service import ETAService

    vehicle_repo = VehicleRepository(db)
    vehicle = await vehicle_repo.get_by_id(vehicle_id)
    if not vehicle:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    _check_vehicle_access(vehicle, current_user)

    loc_repo = LocationRepository(db)
    loc = await loc_repo.get_latest(vehicle_id)
    if not loc:
        raise HTTPException(status_code=404, detail="No current location for this vehicle")

    eta_service = ETAService()
    result = await eta_service.calculate_eta(
        origin_lat=loc.latitude,
        origin_lng=loc.longitude,
        dest_lat=dest_lat,
        dest_lng=dest_lng,
        dest_name=dest_name or f"{dest_lat:.4f},{dest_lng:.4f}",
    )
    return result
