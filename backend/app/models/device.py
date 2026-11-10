"""Device ORM model — telematics tracking device associated with a vehicle."""
from __future__ import annotations

import secrets
import uuid

from sqlalchemy import (
    BigInteger,
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    JSON,
    String,
    func,
)
from sqlalchemy.orm import relationship

from app.database.base import Base


def generate_unique_id() -> str:
    """Generate high-entropy unique device identifier (>= 16 chars)."""
    return secrets.token_hex(12)  # 24 chars


class Device(Base):
    __tablename__ = "devices"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    company_id = Column(String(36), ForeignKey("companies.id"), nullable=False, index=True)
    unique_id = Column(String(100), unique=True, index=True, nullable=False, default=generate_unique_id)
    name = Column(String(255), nullable=False)
    vehicle_id = Column(String(36), ForeignKey("vehicles.id"), unique=True, nullable=True)

    status = Column(String(20), nullable=False, default="unknown")  # online | offline | unknown
    last_update = Column(DateTime, nullable=True)
    position_id = Column(BigInteger, nullable=True)
    disabled = Column(Boolean, default=False, nullable=False)
    attributes = Column(JSON, nullable=True, default=dict)

    # Traccar state fields for NewMotionProcessor and OverspeedProcessor
    motion_streak = Column(Boolean, default=False, nullable=False)
    motion_state = Column(Boolean, default=False, nullable=False)
    motion_position_id = Column(BigInteger, nullable=True)
    motion_time = Column(DateTime, nullable=True)
    motion_distance_m = Column(Float, default=0.0, nullable=False)
    motion_lat = Column(Float, nullable=True)
    motion_lng = Column(Float, nullable=True)

    overspeed_state = Column(Boolean, default=False, nullable=False)
    overspeed_time = Column(DateTime, nullable=True)
    overspeed_geofence_id = Column(String(36), nullable=True)

    created_at = Column(DateTime, server_default=func.now(), nullable=False)

    # Relationships
    company = relationship("Company")
    vehicle = relationship("Vehicle")
    locations = relationship("Location", back_populates="device")
    events = relationship("Event", back_populates="device")
