"""Location telemetry ingestion endpoints."""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database.session import get_db
from app.models.journey import Journey
from app.models.location import Location
from app.models.user import User
from app.schemas.location import LocationBatch, LocationIngestResult, LocationPing, LocationResponse
from app.security.dependencies import get_current_user, require_driver
from app.services.gps_service import ingest_location_batch, ingest_location_ping
from app.services.redis_service import get_redis_service
from app.websocket.manager import get_ws_manager

logger = logging.getLogger("fleettrack.location")
router = APIRouter(prefix="/api/journeys", tags=["GPS Telemetry"])


@router.post("/{journey_id}/location", response_model=LocationIngestResult)
async def post_single_location_ping(
    journey_id: str,
    ping: LocationPing,
    current_user: User = Depends(require_driver),
    db: AsyncSession = Depends(get_db),
):
    """
    Ingest real-time GPS coordinate ping from driver mobile device.
    Validates accuracy and speed, updates live cache, and triggers WebSocket push.
    """
    stmt = select(Journey).where(Journey.id == journey_id)
    result = await db.execute(stmt)
    journey = result.scalar_one_or_none()

    if not journey:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Journey not found")

    if journey.status != "IN_PROGRESS":
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="Cannot upload GPS telemetry for a completed or inactive journey",
        )

    if current_user.role == "DRIVER" and journey.driver_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot upload GPS for another driver's journey")

    redis_svc = get_redis_service()
    ws_mgr = get_ws_manager()

    loc = await ingest_location_ping(
        db=db,
        journey=journey,
        ping=ping,
        redis_svc=redis_svc,
        ws_mgr=ws_mgr,
    )

    return LocationIngestResult(
        status="recorded" if loc else "filtered_noise",
        pings_processed=1,
        received_at=datetime.now(timezone.utc),
    )


@router.post("/{journey_id}/location/batch", response_model=LocationIngestResult)
async def post_batch_location_pings(
    journey_id: str,
    batch: LocationBatch,
    current_user: User = Depends(require_driver),
    db: AsyncSession = Depends(get_db),
):
    """
    Synchronize accumulated offline telemetry after network reconnection.
    Preserves chronological order and filters anomalies.
    """
    stmt = select(Journey).where(Journey.id == journey_id)
    result = await db.execute(stmt)
    journey = result.scalar_one_or_none()

    if not journey:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Journey not found")

    if current_user.role == "DRIVER" and journey.driver_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Unauthorized")

    redis_svc = get_redis_service()
    ws_mgr = get_ws_manager()

    saved_count = await ingest_location_batch(
        db=db,
        journey=journey,
        pings=batch.pings,
        redis_svc=redis_svc,
        ws_mgr=ws_mgr,
    )

    return LocationIngestResult(
        status="batch_recorded",
        pings_processed=saved_count,
        received_at=datetime.now(timezone.utc),
    )


@router.get("/{journey_id}/location", response_model=List[LocationResponse])
async def get_journey_location_history(
    journey_id: str,
    skip: int = Query(0, ge=0),
    limit: int = Query(1000, ge=1, le=5000),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Retrieve historical GPS track for route reconstruction and playback."""
    stmt = (
        select(Location)
        .where(Location.journey_id == journey_id)
        .order_by(Location.recorded_at.asc())
        .offset(skip)
        .limit(limit)
    )
    result = await db.execute(stmt)
    locations = result.scalars().all()
    return [LocationResponse.model_validate(loc) for loc in locations]


@router.get("/{journey_id}/location/latest", response_model=Optional[LocationResponse])
async def get_journey_latest_location(
    journey_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Retrieve the most recent coordinate point for a journey."""
    stmt = (
        select(Location)
        .where(Location.journey_id == journey_id)
        .order_by(Location.recorded_at.desc())
        .limit(1)
    )
    result = await db.execute(stmt)
    loc = result.scalar_one_or_none()
    return LocationResponse.model_validate(loc) if loc else None


# Dedicated Location Search & Geocoding Router
search_router = APIRouter(prefix="/api/locations", tags=["Geocoding & Location Search"])


@search_router.get("/search")
async def search_places(q: str = Query(..., min_length=1)):
    """
    Search locations by name, landmark, city, or address using OpenStreetMap Nominatim.
    Also parses direct lat,lng coordinate strings.
    """
    import re
    import httpx

    query = q.strip()

    # 1. Parse direct coordinate input (e.g. "12.9716, 77.5946")
    coord_pattern = r"^[-+]?([1-8]?\d(\.\d+)?|90(\.0+)?)[,\s]+[-+]?(180(\.0+)?|((1[0-7]\d)|([1-9]?\d))(\.\d+)?)$"
    if re.match(coord_pattern, query):
        parts = re.split(r"[,\s]+", query)
        try:
            lat = float(parts[0])
            lon = float(parts[1])
            return [
                {
                    "display_name": f"Coordinates: {lat:.6f}, {lon:.6f}",
                    "lat": lat,
                    "lon": lon,
                    "type": "coordinate",
                }
            ]
        except (ValueError, IndexError):
            pass

    # 2. Query OpenStreetMap Nominatim
    url = "https://nominatim.openstreetmap.org/search"
    params = {
        "q": query,
        "format": "json",
        "limit": 6,
        "addressdetails": 1,
    }
    headers = {
        "User-Agent": "FleetTrackEnterprise/1.0 (geospatial-fleet-geocoder)",
    }

    try:
        async with httpx.AsyncClient(timeout=6.0) as client:
            resp = await client.get(url, params=params, headers=headers)
            if resp.status_code == 200:
                data = resp.json()
                results = []
                for item in data:
                    try:
                        results.append({
                            "display_name": item.get("display_name", query),
                            "lat": float(item["lat"]),
                            "lon": float(item["lon"]),
                            "type": item.get("type", "place"),
                        })
                    except (KeyError, ValueError):
                        continue
                return results
    except Exception as exc:
        logger.warning("Geocoding lookup failed for query '%s': %s", query, exc)

    return []
