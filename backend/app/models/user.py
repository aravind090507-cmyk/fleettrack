"""User ORM model — stores driver and company manager accounts."""
from __future__ import annotations

import uuid

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, String, func
from sqlalchemy.orm import relationship

from app.database.base import Base


class User(Base):
    __tablename__ = "users"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    company_id = Column(String(36), ForeignKey("companies.id"), nullable=True, index=True)
    name = Column(String(255), nullable=False)
    email = Column(String(255), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    role = Column(String(50), nullable=False, default="DRIVER")  # DRIVER | FLEET_MANAGER | ADMIN
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)

    # Relationships
    company = relationship("Company", back_populates="users")
    vehicles = relationship("Vehicle", back_populates="assigned_driver", foreign_keys="Vehicle.assigned_driver_id")
    journeys = relationship("Journey", back_populates="driver", foreign_keys="Journey.driver_id")
