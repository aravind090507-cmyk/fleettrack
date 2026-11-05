import uuid
from datetime import datetime
from typing import TYPE_CHECKING, List, Optional
from sqlalchemy import Boolean, DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.session import Base

if TYPE_CHECKING:
    from app.models.user import User
    from app.models.gps_device import GPSDevice
    from app.models.project import Project
    from app.models.location import VehicleLocation, VehicleLatestLocation
    from app.models.geofence import GeofenceEvent
    from app.models.vehicle_event import VehicleEvent


class Vehicle(Base):
    __tablename__ = "vehicles"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    registration_number: Mapped[str] = mapped_column(
        String(50),
        unique=True,
        index=True,
        nullable=False,
    )
    vehicle_type: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
    )  # 'dump_truck', 'excavator', 'concrete_mixer', 'loader', 'crane_truck'
    device_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("gps_devices.id", ondelete="SET NULL", use_alter=True, name="fk_vehicles_device_id"),
        nullable=True,
    )
    assigned_manager_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    assigned_project_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="SET NULL"),
        nullable=True,
    )
    status: Mapped[str] = mapped_column(
        String(50),
        default="idle",
        nullable=False,
    )  # 'active', 'idle', 'moving', 'offline', 'maintenance'
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=func.now(),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=func.now(),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    # Relationships
    device: Mapped[Optional["GPSDevice"]] = relationship(
        "GPSDevice",
        back_populates="vehicle",
        foreign_keys=[device_id],
        post_update=True,
    )
    manager: Mapped[Optional["User"]] = relationship(
        "User",
        back_populates="assigned_vehicles",
        foreign_keys=[assigned_manager_id],
    )
    project: Mapped[Optional["Project"]] = relationship(
        "Project",
        back_populates="vehicles",
        foreign_keys=[assigned_project_id],
    )
    locations: Mapped[List["VehicleLocation"]] = relationship(
        "VehicleLocation",
        back_populates="vehicle",
        cascade="all, delete-orphan",
        order_by="desc(VehicleLocation.recorded_at)",
    )
    latest_location: Mapped[Optional["VehicleLatestLocation"]] = relationship(
        "VehicleLatestLocation",
        back_populates="vehicle",
        uselist=False,
        cascade="all, delete-orphan",
    )
    events: Mapped[List["VehicleEvent"]] = relationship(
        "VehicleEvent",
        back_populates="vehicle",
        cascade="all, delete-orphan",
    )
    geofence_events: Mapped[List["GeofenceEvent"]] = relationship(
        "GeofenceEvent",
        back_populates="vehicle",
        cascade="all, delete-orphan",
    )
