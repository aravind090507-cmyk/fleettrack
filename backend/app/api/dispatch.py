"""
Dispatch, Driver Availability, and Delivery Assignment API endpoints.
Enables fleet managers to dispatch delivery tasks to available company drivers,
and drivers to manage their availability and complete assigned deliveries.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import inspect, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sqlalchemy.orm.attributes import NO_VALUE

from app.database.session import get_db
from app.models.delivery_assignment import DeliveryAssignment
from app.models.journey import Journey
from app.models.user import User
from app.models.vehicle import Vehicle
from app.schemas.dispatch import (
    DeliveryAssignmentCreate,
    DeliveryAssignmentResponse,
    DeliveryStartRequest,
    DeliveryStartResponse,
    DispatchDriverItem,
    DriverAvailabilityResponse,
    DriverAvailabilityUpdate,
)
from app.security.dependencies import get_current_user, require_driver
from app.services.journey_service import create_journey, end_journey
from app.services.redis_service import get_redis_service
from app.websocket.manager import get_ws_manager

logger = logging.getLogger("fleettrack.dispatch")

router = APIRouter(tags=["Dispatch & Delivery Management"])


def _build_assignment_response(asg: DeliveryAssignment, tracking_url: Optional[str] = None) -> DeliveryAssignmentResponse:
    t_url = tracking_url
    v_reg = None
    v_model = None
    o_name = None
    o_lat = None
    o_lng = None

    ins = inspect(asg)
    mgr_name = asg.manager.name if ins.attrs.manager.loaded_value is not NO_VALUE and asg.manager else None
    drv_name = asg.driver.name if ins.attrs.driver.loaded_value is not NO_VALUE and asg.driver else None

    if ins.attrs.journey.loaded_value is not NO_VALUE and asg.journey:
        o_name = asg.journey.origin_name
        o_lat = asg.journey.origin_lat
        o_lng = asg.journey.origin_lng
        j_ins = inspect(asg.journey)
        if j_ins.attrs.vehicle.loaded_value is not NO_VALUE and asg.journey.vehicle:
            v_reg = asg.journey.vehicle.registration_number
            v_model = asg.journey.vehicle.model
        if not t_url and j_ins.attrs.tracking_links.loaded_value is not NO_VALUE and asg.journey.tracking_links:
            active_link = next((l for l in asg.journey.tracking_links if not l.revoked_at), None)
            if active_link:
                t_url = f"/track/{active_link.id}"

    return DeliveryAssignmentResponse(
        id=asg.id,
        company_id=asg.company_id,
        manager_id=asg.manager_id,
        manager_name=mgr_name,
        driver_id=asg.driver_id,
        driver_name=drv_name,
        destination_name=asg.destination_name,
        destination_lat=asg.destination_lat,
        destination_lng=asg.destination_lng,
        instructions=asg.instructions,
        status=asg.status,
        journey_id=asg.journey_id,
        created_at=asg.created_at,
        accepted_at=asg.accepted_at,
        rejected_at=asg.rejected_at,
        started_at=asg.started_at,
        completed_at=asg.completed_at,
        cancelled_at=asg.cancelled_at,
        tracking_url=t_url,
        vehicle_registration=v_reg,
        vehicle_model=v_model,
        origin_name=o_name,
        origin_lat=o_lat,
        origin_lng=o_lng,
    )


# ==============================================================================
# DRIVER AVAILABILITY ENDPOINTS
# ==============================================================================

@router.get("/api/driver/availability", response_model=DriverAvailabilityResponse)
async def get_driver_availability(
    current_user: User = Depends(require_driver),
):
    """Retrieve the authenticated driver's current availability state."""
    return DriverAvailabilityResponse(
        driver_id=current_user.id,
        driver_name=current_user.name,
        availability=current_user.availability or "AVAILABLE",
        availability_preference=current_user.availability_preference or "AVAILABLE",
        availability_updated_at=current_user.availability_updated_at or current_user.created_at,
    )


@router.put("/api/driver/availability", response_model=DriverAvailabilityResponse)
async def update_driver_availability(
    payload: DriverAvailabilityUpdate,
    current_user: User = Depends(require_driver),
    db: AsyncSession = Depends(get_db),
):
    """
    Driver manually switches availability between AVAILABLE and UNAVAILABLE.
    Reject manual changes if driver is handling an active delivery (status BUSY).
    """
    # Check if driver has an active delivery (ACCEPTED or IN_PROGRESS)
    active_stmt = (
        select(DeliveryAssignment)
        .where(
            DeliveryAssignment.driver_id == current_user.id,
            DeliveryAssignment.status.in_(["ACCEPTED", "IN_PROGRESS"]),
        )
    )
    active_res = await db.execute(active_stmt)
    active_asg = active_res.scalar_one_or_none()

    if active_asg:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot manually change availability while handling an active delivery assignment.",
        )

    current_user.availability = payload.availability
    current_user.availability_preference = payload.availability
    current_user.availability_updated_at = datetime.now(timezone.utc).replace(tzinfo=None)

    await db.commit()
    await db.refresh(current_user)

    # Real-time WebSocket broadcast to manager console
    ws_mgr = get_ws_manager()
    if current_user.company_id:
        await ws_mgr.broadcast_to_fleet({
            "type": "DRIVER_AVAILABILITY_CHANGED",
            "driver_id": current_user.id,
            "driver_name": current_user.name,
            "availability": current_user.availability,
            "company_id": current_user.company_id,
        }, company_id=current_user.company_id)

    return DriverAvailabilityResponse(
        driver_id=current_user.id,
        driver_name=current_user.name,
        availability=current_user.availability,
        availability_preference=current_user.availability_preference,
        availability_updated_at=current_user.availability_updated_at,
    )


# ==============================================================================
# MANAGER DISPATCH ENDPOINTS
# ==============================================================================

@router.get("/api/dispatch/drivers", response_model=List[DispatchDriverItem])
async def list_company_dispatch_drivers(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Manager view of all drivers in the company with real-time availability and current assignment.
    """
    if not current_user.company_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Manager must be associated with a company.")

    # Retrieve company drivers
    stmt = (
        select(User)
        .where(User.company_id == current_user.company_id, User.role == "DRIVER")
        .options(selectinload(User.vehicles))
        .order_by(User.name.asc())
    )
    res = await db.execute(stmt)
    drivers = res.scalars().all()

    # Query active/pending delivery assignments for these drivers
    driver_ids = [d.id for d in drivers]
    active_assignments_by_driver = {}
    if driver_ids:
        asg_stmt = (
            select(DeliveryAssignment)
            .where(
                DeliveryAssignment.driver_id.in_(driver_ids),
                DeliveryAssignment.status.in_(["PENDING", "ACCEPTED", "IN_PROGRESS"]),
            )
            .options(selectinload(DeliveryAssignment.manager), selectinload(DeliveryAssignment.driver))
        )
        asg_res = await db.execute(asg_stmt)
        for asg in asg_res.scalars().all():
            active_assignments_by_driver[asg.driver_id] = asg

    items = []
    for d in drivers:
        current_asg = active_assignments_by_driver.get(d.id)
        # Driver is busy if they have an accepted/in_progress assignment
        effective_avail = d.availability or "AVAILABLE"
        if current_asg and current_asg.status in ("ACCEPTED", "IN_PROGRESS"):
            effective_avail = "BUSY"

        # Can only assign if driver is AVAILABLE and has no PENDING/ACTIVE assignment
        can_assign = (effective_avail == "AVAILABLE" and current_asg is None)

        assigned_v = d.vehicles[0] if d.vehicles else None

        items.append(
            DispatchDriverItem(
                id=d.id,
                name=d.name,
                email=d.email,
                role=d.role,
                availability=effective_avail,
                availability_preference=d.availability_preference or "AVAILABLE",
                availability_updated_at=d.availability_updated_at,
                assigned_vehicle_reg=assigned_v.registration_number if assigned_v else None,
                assigned_vehicle_model=assigned_v.model if assigned_v else None,
                can_assign=can_assign,
                current_assignment=_build_assignment_response(current_asg) if current_asg else None,
            )
        )

    return items


@router.post("/api/dispatch/assignments", response_model=DeliveryAssignmentResponse, status_code=status.HTTP_201_CREATED)
async def create_delivery_assignment(
    payload: DeliveryAssignmentCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Manager assigns a delivery to an available driver.
    Enforces concurrency-safe driver reservation and validates company boundaries.
    """
    if current_user.role not in ("FLEET_MANAGER", "ADMIN"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only Fleet Managers can create delivery assignments.")

    if not current_user.company_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Manager must belong to a company to dispatch deliveries.")

    # 1. Validate driver exists and belongs to manager's company
    d_stmt = select(User).where(User.id == payload.driver_id, User.company_id == current_user.company_id)
    d_res = await db.execute(d_stmt)
    driver = d_res.scalar_one_or_none()
    if not driver:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Driver not found in your company.")

    # 2. Concurrency-safe check: Driver must not have any PENDING, ACCEPTED, or IN_PROGRESS assignment
    active_stmt = (
        select(DeliveryAssignment)
        .where(
            DeliveryAssignment.driver_id == driver.id,
            DeliveryAssignment.status.in_(["PENDING", "ACCEPTED", "IN_PROGRESS"]),
        )
    )
    active_res = await db.execute(active_stmt)
    existing_active = active_res.scalar_one_or_none()
    if existing_active:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Driver '{driver.name}' already has an active assignment (Status: {existing_active.status}).",
        )

    # 3. Check driver availability
    if driver.availability != "AVAILABLE":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Driver '{driver.name}' is currently {driver.availability} and cannot receive new assignments.",
        )

    # 4. Create DeliveryAssignment record (PENDING)
    asg = DeliveryAssignment(
        id=str(uuid.uuid4()),
        company_id=current_user.company_id,
        manager_id=current_user.id,
        driver_id=driver.id,
        destination_name=payload.destination_name.strip(),
        destination_lat=payload.destination_lat,
        destination_lng=payload.destination_lng,
        instructions=payload.instructions.strip() if payload.instructions else None,
        status="PENDING",
    )
    db.add(asg)
    await db.commit()
    await db.refresh(asg)

    # Load relationships for response DTO
    asg.manager = current_user
    asg.driver = driver

    # 5. Real-time Notifications: Push to assigned driver and company console
    v_res = await db.execute(select(Vehicle).where(Vehicle.assigned_driver_id == driver.id))
    assigned_v = v_res.scalars().first()
    ws_mgr = get_ws_manager()
    dispatch_msg = {
        "type": "DELIVERY_ASSIGNED",
        "assignment_id": asg.id,
        "driver_id": driver.id,
        "driver_name": driver.name,
        "manager_name": current_user.name,
        "destination_name": asg.destination_name,
        "destination_lat": asg.destination_lat,
        "destination_lng": asg.destination_lng,
        "instructions": asg.instructions,
        "status": asg.status,
        "created_at": asg.created_at.isoformat(),
        "vehicle_id": assigned_v.id if assigned_v else None,
        "vehicle_reg": assigned_v.registration_number if assigned_v else None,
    }
    # Notify dedicated driver socket
    await ws_mgr.broadcast_to_driver(driver.id, dispatch_msg)
    # Notify company management console
    await ws_mgr.broadcast_to_fleet(dispatch_msg, company_id=current_user.company_id)

    return _build_assignment_response(asg)


@router.get("/api/dispatch/assignments", response_model=List[DeliveryAssignmentResponse])
async def list_company_assignments(
    status_filter: Optional[str] = Query(None, alias="status"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Manager view of delivery assignments for monitoring and audit log.
    """
    if not current_user.company_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Must belong to a company.")

    stmt = (
        select(DeliveryAssignment)
        .where(DeliveryAssignment.company_id == current_user.company_id)
        .options(
            selectinload(DeliveryAssignment.manager),
            selectinload(DeliveryAssignment.driver),
            selectinload(DeliveryAssignment.journey).selectinload(Journey.vehicle),
            selectinload(DeliveryAssignment.journey).selectinload(Journey.tracking_links),
        )
        .order_by(DeliveryAssignment.created_at.desc())
    )
    if status_filter:
        stmt = stmt.where(DeliveryAssignment.status == status_filter.upper())

    res = await db.execute(stmt)
    assignments = res.scalars().all()
    return [_build_assignment_response(a) for a in assignments]


@router.get("/api/dispatch/assignments/{assignment_id}", response_model=DeliveryAssignmentResponse)
async def get_delivery_assignment_by_id(
    assignment_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Retrieve full delivery assignment details for live monitoring."""
    stmt = (
        select(DeliveryAssignment)
        .where(DeliveryAssignment.id == assignment_id)
        .options(
            selectinload(DeliveryAssignment.manager),
            selectinload(DeliveryAssignment.driver),
            selectinload(DeliveryAssignment.journey).selectinload(Journey.vehicle),
            selectinload(DeliveryAssignment.journey).selectinload(Journey.tracking_links),
        )
    )
    res = await db.execute(stmt)
    asg = res.scalar_one_or_none()
    if not asg:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Delivery assignment not found.")
    if current_user.company_id and asg.company_id != current_user.company_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied to this company delivery.")

    return _build_assignment_response(asg)


@router.post("/api/dispatch/assignments/{assignment_id}/cancel", response_model=DeliveryAssignmentResponse)
async def cancel_delivery_assignment(
    assignment_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Manager cancels a PENDING or ACCEPTED delivery assignment.
    Releases driver reservation and restores driver availability preference.
    """
    stmt = (
        select(DeliveryAssignment)
        .where(DeliveryAssignment.id == assignment_id)
        .options(selectinload(DeliveryAssignment.driver), selectinload(DeliveryAssignment.manager))
    )
    res = await db.execute(stmt)
    asg = res.scalar_one_or_none()
    if not asg:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found.")

    if current_user.company_id and asg.company_id != current_user.company_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied.")

    if asg.status in ("COMPLETED", "CANCELLED"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Cannot cancel assignment in '{asg.status}' state.")

    asg.status = "CANCELLED"
    asg.cancelled_at = datetime.now(timezone.utc).replace(tzinfo=None)

    # Restore driver availability if they were marked busy
    if asg.driver:
        asg.driver.availability = asg.driver.availability_preference or "AVAILABLE"
        asg.driver.availability_updated_at = datetime.now(timezone.utc).replace(tzinfo=None)

    await db.commit()
    await db.refresh(asg)

    # Broadcast notification
    ws_mgr = get_ws_manager()
    cancel_msg = {
        "type": "DELIVERY_CANCELLED",
        "assignment_id": asg.id,
        "driver_id": asg.driver_id,
        "company_id": asg.company_id,
        "status": "CANCELLED",
    }
    await ws_mgr.broadcast_to_driver(asg.driver_id, cancel_msg)
    await ws_mgr.broadcast_to_fleet(cancel_msg, company_id=asg.company_id)

    return _build_assignment_response(asg)


# ==============================================================================
# DRIVER DELIVERY EXECUTION ENDPOINTS
# ==============================================================================

@router.get("/api/driver/assignments", response_model=List[DeliveryAssignmentResponse])
async def list_driver_assignments(
    current_user: User = Depends(require_driver),
    db: AsyncSession = Depends(get_db),
):
    """List historical and active delivery assignments for the authenticated driver."""
    stmt = (
        select(DeliveryAssignment)
        .where(DeliveryAssignment.driver_id == current_user.id)
        .options(selectinload(DeliveryAssignment.manager), selectinload(DeliveryAssignment.driver))
        .order_by(DeliveryAssignment.created_at.desc())
        .limit(50)
    )
    res = await db.execute(stmt)
    assignments = res.scalars().all()
    return [_build_assignment_response(a) for a in assignments]


@router.get("/api/driver/assignments/active", response_model=Optional[DeliveryAssignmentResponse])
async def get_active_driver_assignment(
    current_user: User = Depends(require_driver),
    db: AsyncSession = Depends(get_db),
):
    """
    Retrieve current pending, accepted, or in-progress assignment for the authenticated driver.
    Ensures state is fully retrievable after page refresh or network reconnect.
    """
    stmt = (
        select(DeliveryAssignment)
        .where(
            DeliveryAssignment.driver_id == current_user.id,
            DeliveryAssignment.status.in_(["PENDING", "ACCEPTED", "IN_PROGRESS"]),
        )
        .options(selectinload(DeliveryAssignment.manager), selectinload(DeliveryAssignment.driver))
        .order_by(DeliveryAssignment.created_at.desc())
    )
    res = await db.execute(stmt)
    asg = res.scalar_one_or_none()
    if not asg:
        return None

    tracking_url = None
    if asg.journey_id:
        from app.models.tracking_link import TrackingLink
        tl_stmt = select(TrackingLink).where(TrackingLink.journey_id == asg.journey_id, TrackingLink.revoked_at.is_(None))
        tl_res = await db.execute(tl_stmt)
        tl = tl_res.scalar_one_or_none()
        if tl:
            tracking_url = f"/track/{tl.token_hash}"

    return _build_assignment_response(asg, tracking_url=tracking_url)


@router.post("/api/driver/assignments/{assignment_id}/accept", response_model=DeliveryAssignmentResponse)
async def accept_delivery_assignment(
    assignment_id: str,
    current_user: User = Depends(require_driver),
    db: AsyncSession = Depends(get_db),
):
    """
    Driver accepts an incoming pending delivery assignment.
    Transitions state to ACCEPTED and marks driver as BUSY.
    """
    stmt = (
        select(DeliveryAssignment)
        .where(DeliveryAssignment.id == assignment_id, DeliveryAssignment.driver_id == current_user.id)
        .options(
            selectinload(DeliveryAssignment.manager),
            selectinload(DeliveryAssignment.driver),
            selectinload(DeliveryAssignment.journey),
        )
    )
    res = await db.execute(stmt)
    asg = res.scalar_one_or_none()
    if not asg:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found.")

    if asg.status != "PENDING":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Cannot accept assignment in '{asg.status}' status.")

    asg.status = "ACCEPTED"
    asg.accepted_at = datetime.now(timezone.utc).replace(tzinfo=None)

    # Driver becomes BUSY
    current_user.availability = "BUSY"
    current_user.availability_updated_at = datetime.now(timezone.utc).replace(tzinfo=None)

    await db.commit()
    await db.refresh(asg)

    # Notify manager via WebSocket
    v_res = await db.execute(select(Vehicle).where(Vehicle.assigned_driver_id == current_user.id))
    assigned_v = v_res.scalars().first()
    ws_mgr = get_ws_manager()
    accept_msg = {
        "type": "DELIVERY_ACCEPTED",
        "assignment_id": asg.id,
        "driver_id": current_user.id,
        "driver_name": current_user.name,
        "status": "ACCEPTED",
        "company_id": asg.company_id,
        "vehicle_id": assigned_v.id if assigned_v else None,
        "vehicle_reg": assigned_v.registration_number if assigned_v else None,
    }
    await ws_mgr.broadcast_to_fleet(accept_msg, company_id=asg.company_id)
    await ws_mgr.broadcast_to_driver(current_user.id, accept_msg)

    return _build_assignment_response(asg)


@router.post("/api/driver/assignments/{assignment_id}/reject", response_model=DeliveryAssignmentResponse)
async def reject_delivery_assignment(
    assignment_id: str,
    current_user: User = Depends(require_driver),
    db: AsyncSession = Depends(get_db),
):
    """
    Driver rejects an incoming delivery assignment.
    Releases the driver reservation and notifies the manager to reassign.
    """
    stmt = (
        select(DeliveryAssignment)
        .where(DeliveryAssignment.id == assignment_id, DeliveryAssignment.driver_id == current_user.id)
        .options(
            selectinload(DeliveryAssignment.manager),
            selectinload(DeliveryAssignment.driver),
            selectinload(DeliveryAssignment.journey),
        )
    )
    res = await db.execute(stmt)
    asg = res.scalar_one_or_none()
    if not asg:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found.")

    if asg.status != "PENDING":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Cannot reject assignment in '{asg.status}' status.")

    asg.status = "REJECTED"
    asg.rejected_at = datetime.now(timezone.utc).replace(tzinfo=None)

    # Restore driver availability to their preferred state
    current_user.availability = current_user.availability_preference or "AVAILABLE"
    current_user.availability_updated_at = datetime.now(timezone.utc).replace(tzinfo=None)

    await db.commit()
    await db.refresh(asg)

    # Notify manager via WebSocket
    ws_mgr = get_ws_manager()
    reject_msg = {
        "type": "DELIVERY_REJECTED",
        "assignment_id": asg.id,
        "driver_id": current_user.id,
        "driver_name": current_user.name,
        "status": "REJECTED",
        "company_id": asg.company_id,
    }
    await ws_mgr.broadcast_to_fleet(reject_msg, company_id=asg.company_id)
    await ws_mgr.broadcast_to_driver(current_user.id, reject_msg)

    return _build_assignment_response(asg)


@router.post("/api/driver/assignments/{assignment_id}/start", response_model=DeliveryStartResponse)
async def start_delivery_assignment(
    assignment_id: str,
    payload: DeliveryStartRequest,
    current_user: User = Depends(require_driver),
    db: AsyncSession = Depends(get_db),
):
    """
    Driver begins delivery execution.
    Creates and initiates an existing FleetTrack Journey record,
    associates it with the assignment, and generates the ephemeral tracking link.
    """
    stmt = (
        select(DeliveryAssignment)
        .where(DeliveryAssignment.id == assignment_id, DeliveryAssignment.driver_id == current_user.id)
        .options(
            selectinload(DeliveryAssignment.manager),
            selectinload(DeliveryAssignment.driver),
            selectinload(DeliveryAssignment.journey),
        )
    )
    res = await db.execute(stmt)
    asg = res.scalar_one_or_none()
    if not asg:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found.")

    if asg.status != "ACCEPTED":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Cannot start delivery in '{asg.status}' status. Must be ACCEPTED.")

    # 1. Resolve vehicle
    vehicle = None
    if payload.vehicle_id:
        v_stmt = select(Vehicle).where(Vehicle.id == payload.vehicle_id)
        v_res = await db.execute(v_stmt)
        vehicle = v_res.scalar_one_or_none()

    if not vehicle:
        # Check vehicle assigned to driver
        assigned_stmt = select(Vehicle).where(Vehicle.assigned_driver_id == current_user.id)
        a_res = await db.execute(assigned_stmt)
        vehicle = a_res.scalar_one_or_none()

    if not vehicle:
        # Check any available vehicle in company
        if current_user.company_id:
            c_stmt = select(Vehicle).where(Vehicle.company_id == current_user.company_id, Vehicle.status == "AVAILABLE").limit(1)
            c_res = await db.execute(c_stmt)
            vehicle = c_res.scalar_one_or_none()

    if not vehicle:
        # Create a default delivery fleet asset
        import random
        vehicle = Vehicle(
            company_id=current_user.company_id,
            registration_number=f"DLV-{random.randint(100, 999)}-{datetime.now().strftime('%S')}",
            model="Delivery Transit Van",
            vehicle_type="VAN",
            status="AVAILABLE",
            battery_or_fuel_level=100.0,
        )
        db.add(vehicle)
        await db.commit()
        await db.refresh(vehicle)

    # 2. Origin resolution (defaults to current driver GPS or office)
    origin_name = payload.origin_name or "Dispatch Origin Depot"
    origin_lat = payload.origin_lat if payload.origin_lat is not None else 13.020767
    origin_lng = payload.origin_lng if payload.origin_lng is not None else 80.178377

    # 3. Reuse existing create_journey service
    redis_svc = get_redis_service()
    journey, raw_token, tracking_url = await create_journey(
        db=db,
        driver_id=current_user.id,
        vehicle_id=vehicle.id,
        origin_name=origin_name,
        origin_lat=origin_lat,
        origin_lng=origin_lng,
        destination_name=asg.destination_name,
        destination_lat=asg.destination_lat,
        destination_lng=asg.destination_lng,
        description=asg.instructions,
        redis_svc=redis_svc,
        company_id=current_user.company_id,
    )

    # 4. Link Journey to DeliveryAssignment and update status
    asg.journey_id = journey.id
    asg.status = "IN_PROGRESS"
    asg.started_at = datetime.now(timezone.utc).replace(tzinfo=None)
    current_user.availability = "BUSY"

    await db.commit()
    await db.refresh(asg)

    # 5. Notify Manager Console
    ws_mgr = get_ws_manager()
    start_msg = {
        "type": "DELIVERY_STARTED",
        "assignment_id": asg.id,
        "journey_id": journey.id,
        "vehicle_id": vehicle.id,
        "vehicle_reg": vehicle.registration_number,
        "driver_id": current_user.id,
        "driver_name": current_user.name,
        "origin_name": origin_name,
        "destination_name": asg.destination_name,
        "tracking_url": tracking_url,
        "status": "IN_PROGRESS",
        "company_id": asg.company_id,
    }
    await ws_mgr.broadcast_to_fleet(start_msg, company_id=asg.company_id)
    await ws_mgr.broadcast_to_driver(current_user.id, start_msg)

    return DeliveryStartResponse(
        assignment=_build_assignment_response(asg, tracking_url=tracking_url),
        journey_id=journey.id,
        tracking_url=tracking_url,
        tracking_token=raw_token,
    )


@router.post("/api/driver/assignments/{assignment_id}/complete", response_model=DeliveryAssignmentResponse)
async def complete_delivery_assignment(
    assignment_id: str,
    current_user: User = Depends(require_driver),
    db: AsyncSession = Depends(get_db),
):
    """
    Driver completes delivery.
    Terminates the associated journey, marks assignment COMPLETED,
    and restores driver availability.
    """
    stmt = (
        select(DeliveryAssignment)
        .where(DeliveryAssignment.id == assignment_id, DeliveryAssignment.driver_id == current_user.id)
        .options(
            selectinload(DeliveryAssignment.manager),
            selectinload(DeliveryAssignment.driver),
            selectinload(DeliveryAssignment.journey),
        )
    )
    res = await db.execute(stmt)
    asg = res.scalar_one_or_none()
    if not asg:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found.")

    if asg.status == "COMPLETED":
        # Idempotent completion: already completed safely (e.g. via automatic arrival detection)
        return _build_assignment_response(asg)

    if asg.status != "IN_PROGRESS":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Cannot complete delivery in '{asg.status}' status. Must be IN_PROGRESS.")

    redis_svc = get_redis_service()
    ws_mgr = get_ws_manager()

    # 1. Complete existing journey lifecycle
    if asg.journey_id:
        try:
            await end_journey(
                db=db,
                journey_id=asg.journey_id,
                driver_id=current_user.id,
                redis_svc=redis_svc,
                ws_mgr=ws_mgr,
            )
        except Exception as e:
            logger.warning("Notice on completing journey %s: %s", asg.journey_id, e)

    # 2. Update assignment status
    asg.status = "COMPLETED"
    asg.completed_at = datetime.now(timezone.utc).replace(tzinfo=None)

    # 3. Restore driver availability preference
    current_user.availability = current_user.availability_preference or "AVAILABLE"
    current_user.availability_updated_at = datetime.now(timezone.utc).replace(tzinfo=None)

    await db.commit()
    await db.refresh(asg)

    # 4. Notify manager console
    v_id = None
    if asg.journey_id:
        j_res = await db.execute(select(Journey.vehicle_id).where(Journey.id == asg.journey_id))
        v_id = j_res.scalar_one_or_none()
    if not v_id:
        v_res = await db.execute(select(Vehicle.id).where(Vehicle.assigned_driver_id == current_user.id))
        v_id = v_res.scalars().first()

    complete_msg = {
        "type": "DELIVERY_COMPLETED",
        "assignment_id": asg.id,
        "journey_id": asg.journey_id,
        "vehicle_id": v_id,
        "driver_id": current_user.id,
        "driver_name": current_user.name,
        "status": "COMPLETED",
        "company_id": asg.company_id,
    }
    await ws_mgr.broadcast_to_fleet(complete_msg, company_id=asg.company_id)
    await ws_mgr.broadcast_to_driver(current_user.id, complete_msg)

    return _build_assignment_response(asg)
