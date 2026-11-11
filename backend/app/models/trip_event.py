"""TripEvent ORM model — audit log of key trip events (SOS, breakdowns, breaks)."""
from __future__ import annotations

import uuid

from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, String, func
from sqlalchemy.types import JSON

from sqlalchemy.orm import relationship

from app.database.base import Base


class TripEvent(Base):
    __tablename__ = "trip_events"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    journey_id = Column(String(36), ForeignKey("journeys.id"), nullable=False, index=True)
    event_type = Column(String(64), nullable=False)  # DEPARTURE | STOP | BREAK_START | BREAK_END | SOS | BREAKDOWN | ARRIVAL
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    metadata_json = Column(JSON, default=dict)
    is_dismissed = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)

    # Relationship
    journey = relationship("Journey", back_populates="trip_events")
