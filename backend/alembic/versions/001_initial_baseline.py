"""Initial baseline schema

Revision ID: 001_initial_baseline
Revises: 
Create Date: 2026-11-10 10:48:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "001_initial_baseline"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Companies
    op.create_table(
        "companies",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("slug", sa.String(100), unique=True, nullable=False),
        sa.Column("invite_code", sa.String(20), unique=True, nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )

    # 2. Users
    op.create_table(
        "users",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("company_id", sa.String(36), sa.ForeignKey("companies.id"), nullable=True),
        sa.Column("email", sa.String(255), unique=True, nullable=False),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("full_name", sa.String(255), nullable=False),
        sa.Column("role", sa.String(20), nullable=False, default="DRIVER"),
        sa.Column("phone_number", sa.String(20), nullable=True),
        sa.Column("is_active", sa.Boolean(), default=True, nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )

    # 3. Vehicles
    op.create_table(
        "vehicles",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("company_id", sa.String(36), sa.ForeignKey("companies.id"), nullable=True),
        sa.Column("registration_number", sa.String(50), unique=True, nullable=False),
        sa.Column("model", sa.String(100), nullable=False),
        sa.Column("vehicle_type", sa.String(20), nullable=False),
        sa.Column("status", sa.String(20), default="AVAILABLE", nullable=False),
        sa.Column("assigned_driver_id", sa.String(36), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )

    # 4. Journeys
    op.create_table(
        "journeys",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("company_id", sa.String(36), sa.ForeignKey("companies.id"), nullable=True),
        sa.Column("vehicle_id", sa.String(36), sa.ForeignKey("vehicles.id"), nullable=False),
        sa.Column("driver_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("origin_name", sa.String(255), nullable=False),
        sa.Column("origin_lat", sa.Float(), nullable=False),
        sa.Column("origin_lng", sa.Float(), nullable=False),
        sa.Column("destination_name", sa.String(255), nullable=False),
        sa.Column("destination_lat", sa.Float(), nullable=False),
        sa.Column("destination_lng", sa.Float(), nullable=False),
        sa.Column("status", sa.String(50), default="PENDING", nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("total_distance_km", sa.Float(), default=0.0),
        sa.Column("duration_seconds", sa.Integer(), default=0),
        sa.Column("started_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("ended_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )

    # 5. Locations (original schema: journey_id was non-nullable)
    op.create_table(
        "locations",
        sa.Column("id", sa.Integer().with_variant(sa.BigInteger, "postgresql"), primary_key=True, autoincrement=True),
        sa.Column("journey_id", sa.String(36), sa.ForeignKey("journeys.id"), nullable=False),
        sa.Column("latitude", sa.Float(), nullable=False),
        sa.Column("longitude", sa.Float(), nullable=False),
        sa.Column("speed", sa.Float(), default=0.0, nullable=False),
        sa.Column("heading", sa.Float(), default=0.0, nullable=False),
        sa.Column("accuracy", sa.Float(), default=0.0, nullable=False),
        sa.Column("altitude", sa.Float(), nullable=True),
        sa.Column("recorded_at", sa.DateTime(), nullable=False),
        sa.Column("server_received_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )

    # 6. Tracking Links
    op.create_table(
        "tracking_links",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("journey_id", sa.String(36), sa.ForeignKey("journeys.id"), nullable=False),
        sa.Column("token_hash", sa.String(64), unique=True, nullable=False),
        sa.Column("is_active", sa.Boolean(), default=True, nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("access_count", sa.Integer(), default=0, nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )

    # 7. Trip Events
    op.create_table(
        "trip_events",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("journey_id", sa.String(36), sa.ForeignKey("journeys.id"), nullable=False),
        sa.Column("event_type", sa.String(50), nullable=False),
        sa.Column("latitude", sa.Float(), nullable=False),
        sa.Column("longitude", sa.Float(), nullable=False),
        sa.Column("metadata_json", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("trip_events")
    op.drop_table("tracking_links")
    op.drop_table("locations")
    op.drop_table("journeys")
    op.drop_table("vehicles")
    op.drop_table("users")
    op.drop_table("companies")
