import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user
from app.database.session import get_db
from app.models.user import User
from app.models.vehicle import Vehicle
from app.models.location import VehicleLocation, VehicleLatestLocation

router = APIRouter()


@router.get("/fleet-summary")
async def fleet_summary(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return live fleet status counts from the database."""
    query = select(Vehicle).where(Vehicle.is_active == True)
    if current_user.role != "admin":
        query = query.where(Vehicle.assigned_manager_id == current_user.id)

    result = await db.execute(query)
    vehicles = result.scalars().all()

    counts = {
        "total_vehicles": len(vehicles),
        "active_vehicles": sum(1 for v in vehicles if v.status in ("active", "idle", "moving")),
        "moving_vehicles": sum(1 for v in vehicles if v.status == "moving"),
        "idle_vehicles": sum(1 for v in vehicles if v.status == "idle"),
        "offline_vehicles": sum(1 for v in vehicles if v.status == "offline"),
        "maintenance_vehicles": sum(1 for v in vehicles if v.status == "maintenance"),
    }
    return counts


@router.get("/vehicle-activity")
async def vehicle_activity(
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    vehicle_id: Optional[uuid.UUID] = Query(None),
    project_id: Optional[uuid.UUID] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Per-vehicle activity metrics for the given date range."""
    now = datetime.now(timezone.utc)
    start_dt = datetime.fromisoformat(start_date) if start_date else now - timedelta(days=7)
    end_dt = datetime.fromisoformat(end_date) if end_date else now

    # Get authorized vehicles
    v_query = select(Vehicle).where(Vehicle.is_active == True)
    if current_user.role != "admin":
        v_query = v_query.where(Vehicle.assigned_manager_id == current_user.id)
    if vehicle_id:
        v_query = v_query.where(Vehicle.id == vehicle_id)
    if project_id:
        v_query = v_query.where(Vehicle.assigned_project_id == project_id)

    v_result = await db.execute(v_query)
    vehicles = v_result.scalars().all()

    activity = []
    for v in vehicles:
        loc_query = (
            select(VehicleLocation)
            .where(
                VehicleLocation.vehicle_id == v.id,
                VehicleLocation.recorded_at >= start_dt,
                VehicleLocation.recorded_at <= end_dt,
            )
            .order_by(VehicleLocation.recorded_at)
        )
        loc_result = await db.execute(loc_query)
        locs = loc_result.scalars().all()

        total_distance = 0.0
        max_speed = 0.0
        speed_sum = 0.0
        moving_count = 0

        for i in range(1, len(locs)):
            prev = locs[i - 1]
            curr = locs[i]
            # Haversine approximation
            import math
            lat1, lon1 = math.radians(prev.latitude), math.radians(prev.longitude)
            lat2, lon2 = math.radians(curr.latitude), math.radians(curr.longitude)
            dlat, dlon = lat2 - lat1, lon2 - lon1
            a = math.sin(dlat/2)**2 + math.cos(lat1)*math.cos(lat2)*math.sin(dlon/2)**2
            dist_km = 6371 * 2 * math.asin(math.sqrt(a))
            total_distance += dist_km

        for loc in locs:
            if loc.speed > max_speed:
                max_speed = loc.speed
            speed_sum += loc.speed
            if loc.speed > 2:
                moving_count += 1

        count = len(locs)
        avg_speed = speed_sum / count if count > 0 else 0
        total_hours = (end_dt - start_dt).total_seconds() / 3600
        moving_hours = moving_count * 5 / 3600  # 5 sec intervals

        activity.append({
            "vehicle_id": str(v.id),
            "registration_number": v.registration_number,
            "vehicle_type": v.vehicle_type,
            "total_distance_km": round(total_distance, 2),
            "max_speed": round(max_speed, 1),
            "avg_speed": round(avg_speed, 1),
            "moving_hours": round(moving_hours, 2),
            "idle_hours": round(max(0, total_hours - moving_hours), 2),
            "location_count": count,
        })

    return activity


@router.get("/daily-distance")
async def daily_distance(
    days: int = Query(30, ge=1, le=90),
    vehicle_id: Optional[uuid.UUID] = Query(None),
    project_id: Optional[uuid.UUID] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Daily total distance for chart rendering."""
    import math
    from collections import defaultdict

    now = datetime.now(timezone.utc)
    start_dt = now - timedelta(days=days)

    # Get authorized vehicles
    v_query = select(Vehicle).where(Vehicle.is_active == True)
    if current_user.role != "admin":
        v_query = v_query.where(Vehicle.assigned_manager_id == current_user.id)
    if vehicle_id:
        v_query = v_query.where(Vehicle.id == vehicle_id)
    if project_id:
        v_query = v_query.where(Vehicle.assigned_project_id == project_id)

    v_result = await db.execute(v_query)
    vehicle_ids = [v.id for v in v_result.scalars().all()]

    if not vehicle_ids:
        return []

    loc_query = (
        select(VehicleLocation)
        .where(
            VehicleLocation.vehicle_id.in_(vehicle_ids),
            VehicleLocation.recorded_at >= start_dt,
        )
        .order_by(VehicleLocation.vehicle_id, VehicleLocation.recorded_at)
    )
    loc_result = await db.execute(loc_query)
    all_locs = loc_result.scalars().all()

    # Group by vehicle, then compute per-day distances
    by_vehicle = defaultdict(list)
    for loc in all_locs:
        by_vehicle[loc.vehicle_id].append(loc)

    daily = defaultdict(float)
    for vid, locs in by_vehicle.items():
        for i in range(1, len(locs)):
            prev, curr = locs[i-1], locs[i]
            lat1, lon1 = math.radians(prev.latitude), math.radians(prev.longitude)
            lat2, lon2 = math.radians(curr.latitude), math.radians(curr.longitude)
            dlat, dlon = lat2 - lat1, lon2 - lon1
            a = math.sin(dlat/2)**2 + math.cos(lat1)*math.cos(lat2)*math.sin(dlon/2)**2
            dist = 6371 * 2 * math.asin(math.sqrt(max(0, a)))
            day_key = curr.recorded_at.strftime("%Y-%m-%d")
            daily[day_key] += dist

    result = [
        {"date": k, "distance_km": round(v, 2)}
        for k, v in sorted(daily.items())
    ]
    return result
