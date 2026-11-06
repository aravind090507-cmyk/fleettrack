"""Journey ORM model — represents a single vehicle trip from origin to destination."""
from __future__ import annotations

import uuid

from sqlalchemy import Column, DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import relationship

from app.database.base import Base


class Journey(Base):
    __tablename__ = "journeys"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    company_id = Column(String(36), ForeignKey("companies.id"), nullable=True, index=True)
    vehicle_id = Column(String(36), ForeignKey("vehicles.id"), nullable=False)
    driver_id = Column(String(36), ForeignKey("users.id"), nullable=False)

    origin_name = Column(String(255), nullable=False)
    origin_lat = Column(Float, nullable=False)
    origin_lng = Column(Float, nullable=False)
    destination_name = Column(String(255), nullable=False)
    destination_lat = Column(Float, nullable=False)
    destination_lng = Column(Float, nullable=False)

    status = Column(String(50), nullable=False, default="PENDING")
    description = Column(Text, nullable=True)
    total_distance_km = Column(Float, default=0.0)
    duration_seconds = Column(Integer, default=0)

    started_at = Column(DateTime, server_default=func.now(), nullable=False)
    ended_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)

    # Relationships
    company = relationship("Company", back_populates="journeys")
    vehicle = relationship("Vehicle", back_populates="journeys")
    driver = relationship("User", back_populates="journeys", foreign_keys=[driver_id])
    locations = relationship("Location", back_populates="journey", order_by="Location.recorded_at")
    tracking_links = relationship("TrackingLink", back_populates="journey")
    trip_events = relationship("TripEvent", back_populates="journey", order_by="TripEvent.created_at")
