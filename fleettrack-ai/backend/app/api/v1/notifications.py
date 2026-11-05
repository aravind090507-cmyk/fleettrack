import uuid
from typing import List
from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user
from app.database.session import get_db
from app.models.user import User
from app.repositories.notification_repo import NotificationRepository

router = APIRouter()


@router.get("")
async def list_notifications(
    limit: int = Query(50, le=200),
    unread_only: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    repo = NotificationRepository(db)
    notifications = await repo.get_for_user(current_user.id, limit=limit, unread_only=unread_only)
    unread_count = await repo.count_unread(current_user.id)
    return {
        "notifications": [
            {
                "id": str(n.id),
                "vehicle_id": str(n.vehicle_id) if n.vehicle_id else None,
                "event_type": n.event_type,
                "message": n.message,
                "is_read": n.is_read,
                "created_at": n.created_at.isoformat(),
            }
            for n in notifications
        ],
        "unread_count": unread_count,
    }


@router.post("/{notification_id}/read", status_code=status.HTTP_200_OK)
async def mark_read(
    notification_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    repo = NotificationRepository(db)
    await repo.mark_read(notification_id, current_user.id)
    return {"success": True}


@router.post("/read-all", status_code=status.HTTP_200_OK)
async def mark_all_read(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    repo = NotificationRepository(db)
    await repo.mark_all_read(current_user.id)
    return {"success": True}
