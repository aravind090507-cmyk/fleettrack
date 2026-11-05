import uuid
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user, require_admin
from app.database.session import get_db
from app.models.user import User
from app.repositories.geofence_repo import GeofenceRepository
from app.schemas.geofence import GeofenceCreate, GeofenceUpdate, GeofenceResponse

router = APIRouter()


@router.get("", response_model=List[GeofenceResponse])
async def list_geofences(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    repo = GeofenceRepository(db)
    return await repo.get_all()


@router.post("", response_model=GeofenceResponse, status_code=status.HTTP_201_CREATED)
async def create_geofence(
    data: GeofenceCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    repo = GeofenceRepository(db)
    return await repo.create(data)


@router.patch("/{geofence_id}", response_model=GeofenceResponse)
async def update_geofence(
    geofence_id: uuid.UUID,
    data: GeofenceUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    repo = GeofenceRepository(db)
    geofence = await repo.get_by_id(geofence_id)
    if not geofence:
        raise HTTPException(status_code=404, detail="Geofence not found")
    return await repo.update(geofence, data.model_dump(exclude_unset=True))


@router.delete("/{geofence_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_geofence(
    geofence_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    repo = GeofenceRepository(db)
    geofence = await repo.get_by_id(geofence_id)
    if not geofence:
        raise HTTPException(status_code=404, detail="Geofence not found")
    await repo.delete(geofence)
