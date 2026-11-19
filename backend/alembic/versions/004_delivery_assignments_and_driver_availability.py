"""Add delivery assignments table and driver availability columns

Revision ID: 004_delivery_assignments
Revises: 003_remove_osmand_and_devices
Create Date: 2026-11-18 20:55:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "004_delivery_assignments"
down_revision: Union[str, None] = "003_remove_osmand_and_devices"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Add availability columns to users table
    with op.batch_alter_table("users") as batch_op:
        try:
            batch_op.add_column(
                sa.Column("availability", sa.String(50), nullable=False, server_default="AVAILABLE")
            )
        except Exception:
            pass
        try:
            batch_op.add_column(
                sa.Column("availability_preference", sa.String(50), nullable=False, server_default="AVAILABLE")
            )
        except Exception:
            pass
        try:
            batch_op.add_column(
                sa.Column("availability_updated_at", sa.DateTime(), nullable=True, server_default=sa.func.now())
            )
        except Exception:
            pass

    # 2. Create delivery_assignments table
    try:
        op.create_table(
            "delivery_assignments",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("company_id", sa.String(36), sa.ForeignKey("companies.id"), nullable=False, index=True),
            sa.Column("manager_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False, index=True),
            sa.Column("driver_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False, index=True),
            sa.Column("destination_name", sa.String(255), nullable=False),
            sa.Column("destination_lat", sa.Float(), nullable=False),
            sa.Column("destination_lng", sa.Float(), nullable=False),
            sa.Column("instructions", sa.Text(), nullable=True),
            sa.Column("status", sa.String(50), nullable=False, server_default="PENDING", index=True),
            sa.Column("journey_id", sa.String(36), sa.ForeignKey("journeys.id"), nullable=True, index=True),
            sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
            sa.Column("accepted_at", sa.DateTime(), nullable=True),
            sa.Column("rejected_at", sa.DateTime(), nullable=True),
            sa.Column("started_at", sa.DateTime(), nullable=True),
            sa.Column("completed_at", sa.DateTime(), nullable=True),
            sa.Column("cancelled_at", sa.DateTime(), nullable=True),
        )
    except Exception:
        pass


def downgrade() -> None:
    try:
        op.drop_table("delivery_assignments")
    except Exception:
        pass

    with op.batch_alter_table("users") as batch_op:
        try:
            batch_op.drop_column("availability_updated_at")
        except Exception:
            pass
        try:
            batch_op.drop_column("availability_preference")
        except Exception:
            pass
        try:
            batch_op.drop_column("availability")
        except Exception:
            pass
