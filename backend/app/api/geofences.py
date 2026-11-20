"""Geofence management and device association endpoints."""

from typing import List, Optional, Dict, Any
import uuid
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from app.database.session import get_db
from app.models.geofence import Geofence
from app.models.user import User
from app.security.dependencies import get_current_user
from app.pipeline.geo import parse_geometry, GeofenceCircle, GeofencePolygon, GeofencePolyline

router = APIRouter(prefix="/api/geofences", tags=["Geofences"])


def resolve_geofence_geometry(
    kind: Optional[str],
    geometry: Optional[Dict[str, Any]],
    area: Optional[str],
) -> tuple[str, Dict[str, Any]]:
    """Resolves geofence representation to kind and normalized geometry dict."""
    if geometry:
        resolved_kind = (kind or geometry.get("type", "polygon")).lower()
        if resolved_kind == "circle" or geometry.get("type", "").lower() == "circle":
            return "circle", geometry
        elif resolved_kind == "polygon" or geometry.get("type", "").lower() == "polygon":
            return "polygon", geometry
        elif resolved_kind == "linestring" or geometry.get("type", "").lower() == "linestring":
            return "linestring", geometry
        return resolved_kind, geometry

    if area:
        try:
            evaluator = parse_geometry(area)
            if isinstance(evaluator, GeofenceCircle):
                return "circle", {
                    "type": "circle",
                    "center": [evaluator.center_lat, evaluator.center_lon],
                    "radius": evaluator.radius_m,
                }
            elif isinstance(evaluator, GeofencePolygon):
                coords = [[lon, lat] for lat, lon in evaluator.coordinates]
                if coords and coords[0] != coords[-1]:
                    coords.append(coords[0])
                return "polygon", {
                    "type": "Polygon",
                    "coordinates": [coords],
                }
            elif isinstance(evaluator, GeofencePolyline):
                pts = [[lon, lat] for lat, lon in evaluator.coordinates]
                return "linestring", {
                    "type": "LineString",
                    "coordinates": pts,
                    "radius": evaluator.distance_m,
                }
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Invalid geofence area definition: {str(e)}")

    raise HTTPException(status_code=400, detail="Missing required 'geometry' or 'area' definition")


class GeofenceCreate(BaseModel):
    name: str
    description: Optional[str] = None
    kind: Optional[str] = None  # circle | polygon | linestring
    geometry: Optional[Dict[str, Any]] = None  # GeoJSON representation
    area: Optional[str] = None  # WKT representation
    attributes: Optional[Dict[str, Any]] = None


class GeofenceUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    kind: Optional[str] = None
    geometry: Optional[Dict[str, Any]] = None
    area: Optional[str] = None
    attributes: Optional[Dict[str, Any]] = None


class GeofenceResponse(BaseModel):
    id: str
    company_id: str
    name: str
    description: Optional[str] = None
    kind: str
    geometry: Dict[str, Any]
    area: Optional[str] = None
    attributes: Optional[Dict[str, Any]] = None
    created_at: datetime

    model_config = {"from_attributes": True}


@router.get("", response_model=List[GeofenceResponse])
async def list_geofences(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Geofence)
    if current_user.company_id:
        stmt = stmt.where(Geofence.company_id == current_user.company_id)
    stmt = stmt.order_by(Geofence.name.asc())
    result = await db.execute(stmt)
    return result.scalars().all()


@router.post("", response_model=GeofenceResponse, status_code=status.HTTP_201_CREATED)
async def create_geofence(
    payload: GeofenceCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not current_user.company_id:
        raise HTTPException(status_code=400, detail="User must belong to a company to create geofences")

    kind, geometry = resolve_geofence_geometry(payload.kind, payload.geometry, payload.area)

    cleaned_name = payload.name.strip()[:255] if payload.name else "Unnamed Geofence"
    cleaned_desc = payload.description.strip() if payload.description else None

    gf = Geofence(
        id=str(uuid.uuid4()),
        company_id=current_user.company_id,
        name=cleaned_name,
        description=cleaned_desc,
        kind=kind.lower()[:20],
        geometry=geometry,
        attributes=payload.attributes or {},
    )
    db.add(gf)
    await db.commit()
    await db.refresh(gf)
    return gf


@router.get("/{geofence_id}", response_model=GeofenceResponse)
async def get_geofence(
    geofence_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Geofence).where(Geofence.id == geofence_id)
    gf = (await db.execute(stmt)).scalars().first()
    if not gf:
        raise HTTPException(status_code=404, detail="Geofence not found")
    if current_user.company_id and gf.company_id != current_user.company_id:
        raise HTTPException(status_code=403, detail="Access denied")
    return gf


@router.put("/{geofence_id}", response_model=GeofenceResponse)
async def update_geofence(
    geofence_id: str,
    payload: GeofenceUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Geofence).where(Geofence.id == geofence_id)
    gf = (await db.execute(stmt)).scalars().first()
    if not gf:
        raise HTTPException(status_code=404, detail="Geofence not found")
    if current_user.company_id and gf.company_id != current_user.company_id:
        raise HTTPException(status_code=403, detail="Access denied")

    if payload.name is not None:
        gf.name = payload.name.strip()[:255]
    if payload.description is not None:
        gf.description = payload.description.strip() if payload.description else None

    if payload.geometry is not None or payload.area is not None:
        resolved_kind, resolved_geom = resolve_geofence_geometry(
            payload.kind or gf.kind,
            payload.geometry,
            payload.area,
        )
        gf.kind = resolved_kind
        gf.geometry = resolved_geom
    elif payload.kind is not None:
        gf.kind = payload.kind.lower()

    if payload.attributes is not None:
        gf.attributes = payload.attributes

    await db.commit()
    await db.refresh(gf)
    return gf


@router.delete("/{geofence_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_geofence(
    geofence_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Geofence).where(Geofence.id == geofence_id)
    gf = (await db.execute(stmt)).scalars().first()
    if not gf:
        raise HTTPException(status_code=404, detail="Geofence not found")
    if current_user.company_id and gf.company_id != current_user.company_id:
        raise HTTPException(status_code=403, detail="Access denied")

    await db.delete(gf)
    await db.commit()
    return None
