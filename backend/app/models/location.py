"""Location ORM model — stores individual GPS telemetry pings."""
from __future__ import annotations

from sqlalchemy import (
    BigInteger,
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    JSON,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import relationship

from app.database.base import Base
from app.models.types import GeometryColumn


class Location(Base):
    __tablename__ = "locations"

    id = Column(Integer().with_variant(BigInteger, "postgresql"), primary_key=True, autoincrement=True)
    journey_id = Column(String(36), ForeignKey("journeys.id"), nullable=True, index=True)

    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    speed = Column(Float, nullable=False, default=0.0)
    heading = Column(Float, nullable=False, default=0.0)
    accuracy = Column(Float, nullable=False, default=0.0)
    altitude = Column(Float, nullable=True)

    valid = Column(Boolean, default=True, nullable=False)
    outdated = Column(Boolean, default=False, nullable=False)
    distance_m = Column(Float, default=0.0, nullable=False)
    total_distance_m = Column(Float, default=0.0, nullable=False)
    motion = Column(Boolean, default=False, nullable=False)
    geofence_ids = Column(JSON, nullable=True, default=list)
    attributes = Column(JSON, nullable=True, default=dict)

    # PostGIS geometry column for PostgreSQL
    geom = Column(GeometryColumn("POINT", 4326), nullable=True)

    recorded_at = Column(DateTime, nullable=False, index=True)
    server_received_at = Column(DateTime, server_default=func.now(), nullable=False)

    __table_args__ = (
        Index("ix_locations_journey_recorded", "journey_id", "recorded_at"),
    )

    # Relationships
    journey = relationship("Journey", back_populates="locations")
