import logging
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database.session import get_db
from app.repositories.vehicle_repo import VehicleRepository
from app.repositories.location_repo import LocationRepository
from app.repositories.notification_repo import NotificationRepository
from app.schemas.location import LocationIngestRequest, LocationIngestResponse
from app.core.security import verify_device_token
from app.websocket.manager import ws_manager

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("", response_model=LocationIngestResponse)
async def ingest_location(
    request: LocationIngestRequest,
    db: AsyncSession = Depends(get_db),
):
    """Receive GPS location from a device. Authenticates via device token."""
    # Find device
    from sqlalchemy import select
    from app.models.gps_device import GPSDevice

    device_query = select(GPSDevice).where(
        GPSDevice.device_identifier == request.device_id,
        GPSDevice.is_active == True,
    )
    result = await db.execute(device_query)
    device = result.scalar_one_or_none()

    if not device:
        raise HTTPException(status_code=401, detail="Unknown or inactive device")

    # Verify device token (skip for simulator internal calls which use empty token)
    if request.device_token and device.device_token_hash:
        if not verify_device_token(request.device_token, device.device_token_hash):
            raise HTTPException(status_code=401, detail="Invalid device token")

    if not device.vehicle_id:
        raise HTTPException(status_code=422, detail="Device not assigned to any vehicle")

    vehicle_repo = VehicleRepository(db)
    vehicle = await vehicle_repo.get_by_id(device.vehicle_id)
    if not vehicle or not vehicle.is_active:
        raise HTTPException(status_code=422, detail="Associated vehicle is inactive")

    # Store location
    loc_repo = LocationRepository(db)
    location = await loc_repo.store_location(
        vehicle_id=vehicle.id,
        latitude=request.latitude,
        longitude=request.longitude,
        speed=request.speed,
        heading=request.heading,
        recorded_at=request.recorded_at,
        is_simulated=request.is_simulated,
    )

    # Update vehicle status based on speed
    new_status = "moving" if request.speed > 2.0 else "idle"
    await vehicle_repo.update(vehicle, {"status": new_status})

    # Update device last seen
    from datetime import datetime, timezone
    from sqlalchemy import update as sql_update
    await db.execute(
        sql_update(GPSDevice)
        .where(GPSDevice.id == device.id)
        .values(last_seen_at=datetime.now(timezone.utc))
    )
    await db.commit()

    # Broadcast via WebSocket
    ws_payload = {
        "type": "vehicle_location",
        "vehicle_id": str(vehicle.id),
        "registration_number": vehicle.registration_number,
        "vehicle_type": vehicle.vehicle_type,
        "latitude": request.latitude,
        "longitude": request.longitude,
        "speed": request.speed,
        "heading": request.heading,
        "status": new_status,
        "recorded_at": request.recorded_at.isoformat(),
        "is_simulated": request.is_simulated,
    }
    await ws_manager.broadcast_vehicle_location(str(vehicle.id), ws_payload)

    # Check geofences asynchronously (fire and forget)
    import asyncio
    asyncio.create_task(_check_geofences(db, vehicle.id, request.latitude, request.longitude))

    return LocationIngestResponse(
        success=True,
        message="Location stored successfully",
        vehicle_id=vehicle.id,
        status=new_status,
    )


async def _check_geofences(db: AsyncSession, vehicle_id, latitude: float, longitude: float):
    """Check if vehicle entered or exited any geofences."""
    try:
        from app.services.geofence_service import GeofenceService
        svc = GeofenceService(db)
        await svc.check_vehicle_geofences(vehicle_id, latitude, longitude)
    except Exception as e:
        logger.error(f"Geofence check error for vehicle {vehicle_id}: {e}")
