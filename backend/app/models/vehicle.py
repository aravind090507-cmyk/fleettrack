"""Vehicle ORM model — represents fleet assets (vans, trucks, cars)."""
from __future__ import annotations

import uuid

from sqlalchemy import Column, DateTime, Float, ForeignKey, String, func
from sqlalchemy.orm import relationship

from app.database.base import Base


class Vehicle(Base):
    __tablename__ = "vehicles"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    company_id = Column(String(36), ForeignKey("companies.id"), nullable=True, index=True)
    registration_number = Column(String(64), unique=True, nullable=False, index=True)
    model = Column(String(128), nullable=False)
    vehicle_type = Column(String(64), nullable=False, default="VAN")  # VAN | TRUCK | CAR | MOTORCYCLE
    assigned_driver_id = Column(String(36), ForeignKey("users.id"), nullable=True)
    status = Column(String(50), nullable=False, default="AVAILABLE")  # AVAILABLE | IN_TRANSIT | MAINTENANCE | OFFLINE
    battery_or_fuel_level = Column(Float, default=100.0)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)

    # Relationships
    company = relationship("Company", back_populates="vehicles")
    assigned_driver = relationship("User", back_populates="vehicles", foreign_keys=[assigned_driver_id])
    journeys = relationship("Journey", back_populates="vehicle")
