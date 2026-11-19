"""Expand delivery_assignments and journey text columns to prevent length errors

Revision ID: 005_expand_text_columns
Revises: 004_delivery_assignments
Create Date: 2026-11-19 14:25:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "005_expand_text_columns"
down_revision: Union[str, None] = "004_delivery_assignments"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Expand delivery_assignments.id to VARCHAR(64) and destination_name to TEXT
    with op.batch_alter_table("delivery_assignments") as batch_op:
        try:
            batch_op.alter_column(
                "id",
                existing_type=sa.String(36),
                type_=sa.String(64),
                existing_nullable=False,
            )
        except Exception:
            pass
        try:
            batch_op.alter_column(
                "destination_name",
                existing_type=sa.String(255),
                type_=sa.Text(),
                existing_nullable=False,
            )
        except Exception:
            pass
        try:
            batch_op.alter_column(
                "instructions",
                existing_type=sa.Text(),
                type_=sa.Text(),
                existing_nullable=True,
            )
        except Exception:
            pass

    # 2. Expand journeys.origin_name and destination_name to TEXT to prevent truncation of full addresses
    with op.batch_alter_table("journeys") as batch_op:
        try:
            batch_op.alter_column(
                "origin_name",
                existing_type=sa.String(255),
                type_=sa.Text(),
                existing_nullable=False,
            )
        except Exception:
            pass
        try:
            batch_op.alter_column(
                "destination_name",
                existing_type=sa.String(255),
                type_=sa.Text(),
                existing_nullable=False,
            )
        except Exception:
            pass


def downgrade() -> None:
    with op.batch_alter_table("journeys") as batch_op:
        try:
            batch_op.alter_column(
                "destination_name",
                existing_type=sa.Text(),
                type_=sa.String(255),
                existing_nullable=False,
            )
        except Exception:
            pass
        try:
            batch_op.alter_column(
                "origin_name",
                existing_type=sa.Text(),
                type_=sa.String(255),
                existing_nullable=False,
            )
        except Exception:
            pass

    with op.batch_alter_table("delivery_assignments") as batch_op:
        try:
            batch_op.alter_column(
                "destination_name",
                existing_type=sa.Text(),
                type_=sa.String(255),
                existing_nullable=False,
            )
        except Exception:
            pass
        try:
            batch_op.alter_column(
                "id",
                existing_type=sa.String(64),
                type_=sa.String(36),
                existing_nullable=False,
            )
        except Exception:
            pass
