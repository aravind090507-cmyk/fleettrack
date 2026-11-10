"""Geofence and DeviceGeofence ORM models."""
from __future__ import annotations

import uuid

from sqlalchemy import (
    BigInteger,
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    JSON,
    String,
    Text,
    func,
)
from sqlalchemy.orm import relationship

from app.database.base import Base
from app.models.types import GeometryColumn


class Geofence(Base):
    __tablename__ = "geofences"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    company_id = Column(String(36), ForeignKey("companies.id"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    kind = Column(String(20), nullable=False)  # circle | polygon | polyline
    geometry = Column(JSON, nullable=False)  # circle: {center: [lat, lng], radius: m}, polygon: {coordinates: [...]}
    geom = Column(GeometryColumn("GEOMETRY", 4326), nullable=True)  # PostGIS spatial column on PostgreSQL
    attributes = Column(JSON, nullable=True, default=dict)  # e.g. {"speedLimit": 60}

    created_at = Column(DateTime, server_default=func.now(), nullable=False)

    # Relationships
    company = relationship("Company")
    device_links = relationship("DeviceGeofence", back_populates="geofence", cascade="all, delete-orphan")


class DeviceGeofence(Base):
    __tablename__ = "device_geofences"

    id = Column(Integer().with_variant(BigInteger, "postgresql"), primary_key=True, autoincrement=True)
    device_id = Column(String(36), ForeignKey("devices.id", ondelete="CASCADE"), nullable=True, index=True)
    geofence_id = Column(String(36), ForeignKey("geofences.id", ondelete="CASCADE"), nullable=False, index=True)
    all_devices = Column(Boolean, default=False, nullable=False)

    # Relationships
    geofence = relationship("Geofence", back_populates="device_links")
    device = relationship("Device")
