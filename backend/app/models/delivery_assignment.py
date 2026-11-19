"""DeliveryAssignment ORM model — manages dispatch assignment lifecycle."""
from __future__ import annotations

import uuid
from sqlalchemy import Column, DateTime, Float, ForeignKey, String, Text, func
from sqlalchemy.orm import relationship

from app.database.base import Base


class DeliveryAssignment(Base):
    __tablename__ = "delivery_assignments"

    id = Column(String(64), primary_key=True, default=lambda: str(uuid.uuid4()))
    company_id = Column(String(36), ForeignKey("companies.id"), nullable=False, index=True)
    manager_id = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    driver_id = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)

    destination_name = Column(Text, nullable=False)
    destination_lat = Column(Float, nullable=False)
    destination_lng = Column(Float, nullable=False)
    instructions = Column(Text, nullable=True)

    # Status: PENDING | ACCEPTED | REJECTED | IN_PROGRESS | COMPLETED | CANCELLED
    status = Column(String(50), nullable=False, default="PENDING", index=True)
    journey_id = Column(String(36), ForeignKey("journeys.id"), nullable=True, index=True)

    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    accepted_at = Column(DateTime, nullable=True)
    rejected_at = Column(DateTime, nullable=True)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    cancelled_at = Column(DateTime, nullable=True)

    # Relationships
    company = relationship("Company")
    manager = relationship("User", foreign_keys=[manager_id], back_populates="managed_assignments")
    driver = relationship("User", foreign_keys=[driver_id], back_populates="driver_assignments")
    journey = relationship("Journey", back_populates="delivery_assignment")
