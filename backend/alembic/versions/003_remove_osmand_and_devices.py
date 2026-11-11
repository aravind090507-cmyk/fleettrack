"""Remove OsmAnd and hardware devices, add alert dismissal

Revision ID: 003_remove_osmand_and_devices
Revises: 002_traccar_telematics_postgis
Create Date: 2026-11-11 10:35:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "003_remove_osmand_and_devices"
down_revision: Union[str, None] = "002_traccar_telematics_postgis"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    is_postgres = bind.dialect.name == "postgresql"

    # 1. Drop device_geofences table
    try:
        op.drop_table("device_geofences")
    except Exception:
        pass

    # 2. Alter locations table: remove device_id, device_time, protocol, uq_device_recorded_at
    with op.batch_alter_table("locations") as batch_op:
        try:
            batch_op.drop_constraint("uq_device_recorded_at", type_="unique")
        except Exception:
            pass
        try:
            batch_op.drop_index("ix_locations_device_recorded")
        except Exception:
            pass
        try:
            batch_op.drop_column("device_time")
        except Exception:
            pass
        try:
            batch_op.drop_column("protocol")
        except Exception:
            pass
        try:
            batch_op.drop_column("device_id")
        except Exception:
            pass

    # 3. Alter journeys table: drop device_id
    with op.batch_alter_table("journeys") as batch_op:
        try:
            batch_op.drop_column("device_id")
        except Exception:
            pass

    # 4. Alter events table: drop device_id FK constraint if exists
    with op.batch_alter_table("events") as batch_op:
        try:
            batch_op.alter_column("device_id", existing_type=sa.String(36), nullable=True)
        except Exception:
            pass

    # 5. Drop devices table
    try:
        op.drop_table("devices")
    except Exception:
        pass

    # 6. Add is_dismissed flag to trip_events table for dismiss button persistence
    with op.batch_alter_table("trip_events") as batch_op:
        batch_op.add_column(sa.Column("is_dismissed", sa.Boolean(), server_default=sa.text("false"), nullable=False))


def downgrade() -> None:
    # Reverse trip_events addition
    with op.batch_alter_table("trip_events") as batch_op:
        batch_op.drop_column("is_dismissed")

    # Re-create devices table for clean rollback to 002
    op.create_table(
        "devices",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("company_id", sa.String(36), sa.ForeignKey("companies.id"), nullable=False),
        sa.Column("unique_id", sa.String(100), unique=True, nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("vehicle_id", sa.String(36), sa.ForeignKey("vehicles.id"), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="unknown"),
        sa.Column("last_update", sa.DateTime(), nullable=True),
        sa.Column("disabled", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("attributes", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )

    with op.batch_alter_table("locations") as batch_op:
        batch_op.add_column(sa.Column("device_id", sa.String(36), sa.ForeignKey("devices.id", name="fk_locations_devices"), nullable=True))
        batch_op.add_column(sa.Column("device_time", sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column("protocol", sa.String(20), server_default="web", nullable=False))
        batch_op.create_unique_constraint("uq_device_recorded_at", ["device_id", "recorded_at"])
        batch_op.create_index("ix_locations_device_recorded", ["device_id", "recorded_at"])

    with op.batch_alter_table("journeys") as batch_op:
        batch_op.add_column(sa.Column("device_id", sa.String(36), sa.ForeignKey("devices.id", name="fk_journeys_devices"), nullable=True))

    op.create_table(
        "device_geofences",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("device_id", sa.String(36), sa.ForeignKey("devices.id", ondelete="CASCADE"), nullable=True),
        sa.Column("geofence_id", sa.String(36), sa.ForeignKey("geofences.id", ondelete="CASCADE"), nullable=False),
        sa.Column("all_devices", sa.Boolean(), server_default=sa.text("false"), nullable=False),
    )
