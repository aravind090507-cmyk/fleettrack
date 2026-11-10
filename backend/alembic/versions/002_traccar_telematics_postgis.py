"""Traccar telematics pipeline schema with PostGIS spatial indexing

Revision ID: 002_traccar_telematics_postgis
Revises: 001_initial_baseline
Create Date: 2026-11-10 10:50:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from app.models.types import GeometryColumn

revision: str = "002_traccar_telematics_postgis"
down_revision: Union[str, None] = "001_initial_baseline"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    is_postgres = bind.dialect.name == "postgresql"

    # Enable PostGIS extension on PostgreSQL
    if is_postgres:
        op.execute("CREATE EXTENSION IF NOT EXISTS postgis;")

    # 1. Devices table
    op.create_table(
        "devices",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("company_id", sa.String(36), sa.ForeignKey("companies.id"), nullable=False, index=True),
        sa.Column("unique_id", sa.String(100), unique=True, index=True, nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("vehicle_id", sa.String(36), sa.ForeignKey("vehicles.id"), unique=True, nullable=True),
        sa.Column("status", sa.String(20), default="unknown", nullable=False),
        sa.Column("last_update", sa.DateTime(), nullable=True),
        sa.Column("position_id", sa.BigInteger(), nullable=True),
        sa.Column("disabled", sa.Boolean(), default=False, nullable=False),
        sa.Column("attributes", sa.JSON(), nullable=True),
        # Traccar state fields
        sa.Column("motion_streak", sa.Boolean(), default=False, nullable=False),
        sa.Column("motion_state", sa.Boolean(), default=False, nullable=False),
        sa.Column("motion_position_id", sa.BigInteger(), nullable=True),
        sa.Column("motion_time", sa.DateTime(), nullable=True),
        sa.Column("motion_distance_m", sa.Float(), default=0.0, nullable=False),
        sa.Column("motion_lat", sa.Float(), nullable=True),
        sa.Column("motion_lng", sa.Float(), nullable=True),
        sa.Column("overspeed_state", sa.Boolean(), default=False, nullable=False),
        sa.Column("overspeed_time", sa.DateTime(), nullable=True),
        sa.Column("overspeed_geofence_id", sa.String(36), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )

    # 2. Geofences table
    op.create_table(
        "geofences",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("company_id", sa.String(36), sa.ForeignKey("companies.id"), nullable=False, index=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("geometry", sa.JSON(), nullable=False),
        sa.Column("geom", GeometryColumn("GEOMETRY", 4326), nullable=True),
        sa.Column("attributes", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )

    # 3. DeviceGeofences table
    op.create_table(
        "device_geofences",
        sa.Column("id", sa.Integer().with_variant(sa.BigInteger, "postgresql"), primary_key=True, autoincrement=True),
        sa.Column("device_id", sa.String(36), sa.ForeignKey("devices.id", ondelete="CASCADE"), nullable=True, index=True),
        sa.Column("geofence_id", sa.String(36), sa.ForeignKey("geofences.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("all_devices", sa.Boolean(), default=False, nullable=False),
    )

    # 4. Events table
    op.create_table(
        "events",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("company_id", sa.String(36), sa.ForeignKey("companies.id"), nullable=False, index=True),
        sa.Column("device_id", sa.String(36), sa.ForeignKey("devices.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("journey_id", sa.String(36), sa.ForeignKey("journeys.id", ondelete="SET NULL"), nullable=True, index=True),
        sa.Column("position_id", sa.BigInteger(), nullable=True),
        sa.Column("geofence_id", sa.String(36), sa.ForeignKey("geofences.id", ondelete="SET NULL"), nullable=True),
        sa.Column("type", sa.String(50), nullable=False, index=True),
        sa.Column("event_time", sa.DateTime(), nullable=False, index=True),
        sa.Column("attributes", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )

    # 5. Add columns and indexes to Journeys
    with op.batch_alter_table("journeys") as batch_op:
        batch_op.add_column(sa.Column("device_id", sa.String(36), sa.ForeignKey("devices.id", name="fk_journeys_device_id"), nullable=True))
        batch_op.add_column(sa.Column("destination_geofence_id", sa.String(36), sa.ForeignKey("geofences.id", name="fk_journeys_destination_geofence_id"), nullable=True))

    # 6. Add columns and indexes to Locations (and make journey_id nullable)
    with op.batch_alter_table("locations") as batch_op:
        batch_op.alter_column("journey_id", existing_type=sa.String(36), nullable=True)
        batch_op.add_column(sa.Column("device_id", sa.String(36), sa.ForeignKey("devices.id", name="fk_locations_device_id"), nullable=True))
        batch_op.add_column(sa.Column("valid", sa.Boolean(), default=True, server_default=sa.text("1"), nullable=False))
        batch_op.add_column(sa.Column("outdated", sa.Boolean(), default=False, server_default=sa.text("0"), nullable=False))
        batch_op.add_column(sa.Column("protocol", sa.String(20), default="web", server_default="web", nullable=False))
        batch_op.add_column(sa.Column("device_time", sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column("distance_m", sa.Float(), default=0.0, server_default=sa.text("0.0"), nullable=False))
        batch_op.add_column(sa.Column("total_distance_m", sa.Float(), default=0.0, server_default=sa.text("0.0"), nullable=False))
        batch_op.add_column(sa.Column("motion", sa.Boolean(), default=False, server_default=sa.text("0"), nullable=False))
        batch_op.add_column(sa.Column("geofence_ids", sa.JSON(), nullable=True))
        batch_op.add_column(sa.Column("attributes", sa.JSON(), nullable=True))
        batch_op.add_column(sa.Column("geom", GeometryColumn("POINT", 4326), nullable=True))

        batch_op.create_index("ix_locations_device_recorded", ["device_id", "recorded_at"])
        batch_op.create_index("ix_locations_journey_recorded", ["journey_id", "recorded_at"])
        batch_op.create_unique_constraint("uq_device_recorded_at", ["device_id", "recorded_at"])

    # 7. PostGIS GIST Spatial Indexes on PostgreSQL
    if is_postgres:
        op.execute("CREATE INDEX IF NOT EXISTS idx_locations_geom ON locations USING GIST (geom);")
        op.execute("CREATE INDEX IF NOT EXISTS idx_geofences_geom ON geofences USING GIST (geom);")

    # 8. Backfill existing vehicles with Devices
    op.execute(
        """
        INSERT INTO devices (id, company_id, unique_id, name, vehicle_id, status, disabled, attributes, motion_streak, motion_state, motion_distance_m, overspeed_state, created_at)
        SELECT 
            'dev-' || id,
            company_id,
            'web-' || id,
            'Web Tracker - ' || registration_number,
            id,
            'unknown',
            false,
            '{"protocol": "web", "auto_created": true}',
            false,
            false,
            0.0,
            false,
            CURRENT_TIMESTAMP
        FROM vehicles
        WHERE company_id IS NOT NULL;
        """
    )


def downgrade() -> None:
    bind = op.get_bind()
    is_postgres = bind.dialect.name == "postgresql"

    if is_postgres:
        op.execute("DROP INDEX IF EXISTS idx_locations_geom;")
        op.execute("DROP INDEX IF EXISTS idx_geofences_geom;")

    with op.batch_alter_table("locations") as batch_op:
        batch_op.drop_constraint("uq_device_recorded_at", type_="unique")
        batch_op.drop_index("ix_locations_journey_recorded")
        batch_op.drop_index("ix_locations_device_recorded")
        batch_op.drop_column("geom")
        batch_op.drop_column("attributes")
        batch_op.drop_column("geofence_ids")
        batch_op.drop_column("motion")
        batch_op.drop_column("total_distance_m")
        batch_op.drop_column("distance_m")
        batch_op.drop_column("device_time")
        batch_op.drop_column("protocol")
        batch_op.drop_column("outdated")
        batch_op.drop_column("valid")
        batch_op.drop_column("device_id")
        batch_op.alter_column("journey_id", existing_type=sa.String(36), nullable=False)

    with op.batch_alter_table("journeys") as batch_op:
        batch_op.drop_column("destination_geofence_id")
        batch_op.drop_column("device_id")

    op.drop_table("events")
    op.drop_table("device_geofences")
    op.drop_table("geofences")
    op.drop_table("devices")
