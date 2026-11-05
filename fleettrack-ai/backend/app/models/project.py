import uuid
from datetime import date, datetime
from typing import TYPE_CHECKING, List, Optional
from sqlalchemy import Date, DateTime, Float, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from geoalchemy2 import Geography

from app.database.session import Base

if TYPE_CHECKING:
    from app.models.user import User
    from app.models.vehicle import Vehicle
    from app.models.geofence import Geofence


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    address: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)

    latitude: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    longitude: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    location: Mapped[Optional[Geography]] = mapped_column(
        Geography(geometry_type="POINT", srid=4326, nullable=True),
        nullable=True,
    )
    boundary: Mapped[Optional[Geography]] = mapped_column(
        Geography(geometry_type="POLYGON", srid=4326, nullable=True),
        nullable=True,
    )

    status: Mapped[str] = mapped_column(String(50), default="active", nullable=False)  # planning, active, completed, on_hold
    start_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    end_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)

    assigned_manager_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=func.now(),
        server_default=func.now(),
        nullable=False,
    )

    # Relationships
    manager: Mapped[Optional["User"]] = relationship(
        "User",
        back_populates="managed_projects",
        foreign_keys=[assigned_manager_id],
    )
    vehicles: Mapped[List["Vehicle"]] = relationship(
        "Vehicle",
        back_populates="project",
    )
    geofences: Mapped[List["Geofence"]] = relationship(
        "Geofence",
        back_populates="project",
        cascade="all, delete-orphan",
    )
