"""Company ORM model — represents enterprise multi-tenant fleet organization."""
from __future__ import annotations

import uuid

from sqlalchemy import Column, DateTime, String, func
from sqlalchemy.orm import relationship

from app.database.base import Base


class Company(Base):
    __tablename__ = "companies"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String(255), nullable=False)
    invite_code = Column(String(64), unique=True, nullable=False, index=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)

    # Multi-tenant relationships
    users = relationship("User", back_populates="company", cascade="all, delete-orphan")
    vehicles = relationship("Vehicle", back_populates="company", cascade="all, delete-orphan")
    journeys = relationship("Journey", back_populates="company", cascade="all, delete-orphan")
