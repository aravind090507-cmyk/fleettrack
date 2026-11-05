"""Location ORM model — stores individual GPS telemetry pings."""
from __future__ import annotations

from sqlalchemy import BigInteger, Column, DateTime, Float, ForeignKey, String, func
from sqlalchemy.orm import relationship

from app.database.base import Base


class Location(Base):
    __tablename__ = "locations"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    journey_id = Column(String(36), ForeignKey("journeys.id"), nullable=False, index=True)

    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    speed = Column(Float, nullable=False, default=0.0)
    heading = Column(Float, nullable=False, default=0.0)
    accuracy = Column(Float, nullable=False, default=0.0)
    altitude = Column(Float, nullable=True)

    recorded_at = Column(DateTime, nullable=False)  # Device timestamp
    server_received_at = Column(DateTime, server_default=func.now(), nullable=False)

    # Relationship
    journey = relationship("Journey", back_populates="locations")
