"""001_initial_schema

Revision ID: 001_initial_schema
Revises: 
Create Date: 2026-10-29 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "001_initial_schema"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Enable PostGIS extension if PostgreSQL
    bind = op.get_bind()
    is_postgres = bind.dialect.name == "postgresql"

    if is_postgres:
        op.execute("CREATE EXTENSION IF NOT EXISTS postgis;")

    # 2. Users table
    op.create_table(
        "users",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("role", sa.String(length=50), nullable=False, server_default="fleet_manager"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("email"),
    )
    op.create_index("ix_users_email", "users", ["email"])

    # 3. Projects table
    op.create_table(
        "projects",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("address", sa.String(length=500), nullable=True),
        sa.Column("latitude", sa.Float(), nullable=True),
        sa.Column("longitude", sa.Float(), nullable=True),
        sa.Column("status", sa.String(length=50), nullable=False, server_default="active"),
        sa.Column("start_date", sa.Date(), nullable=True),
        sa.Column("end_date", sa.Date(), nullable=True),
        sa.Column("assigned_manager_id", sa.UUID(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )

    if is_postgres:
        op.execute("ALTER TABLE projects ADD COLUMN location geography(Point, 4326);")
        op.execute("ALTER TABLE projects ADD COLUMN boundary geography(Polygon, 4326);")
        op.execute("CREATE INDEX ix_projects_location ON projects USING GIST (location);")
    else:
        op.add_column("projects", sa.Column("location", sa.Text(), nullable=True))
        op.add_column("projects", sa.Column("boundary", sa.Text(), nullable=True))

    # 4. GPS Devices table
    op.create_table(
        "gps_devices",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("device_identifier", sa.String(length=100), nullable=False),
        sa.Column("device_token_hash", sa.String(length=255), nullable=False),
        sa.Column("device_type", sa.String(length=100), nullable=False, server_default="Hardwired"),
        sa.Column("vehicle_id", sa.UUID(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("device_identifier"),
    )
    op.create_index("ix_gps_devices_identifier", "gps_devices", ["device_identifier"])

    # 5. Vehicles table
    op.create_table(
        "vehicles",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("registration_number", sa.String(length=50), nullable=False),
        sa.Column("vehicle_type", sa.String(length=50), nullable=False),
        sa.Column("device_id", sa.UUID(), sa.ForeignKey("gps_devices.id", ondelete="SET NULL"), nullable=True),
        sa.Column("assigned_manager_id", sa.UUID(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("assigned_project_id", sa.UUID(), sa.ForeignKey("projects.id", ondelete="SET NULL"), nullable=True),
        sa.Column("status", sa.String(length=50), nullable=False, server_default="idle"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("registration_number"),
    )
    op.create_index("ix_vehicles_registration_number", "vehicles", ["registration_number"])
    op.create_foreign_key("fk_gps_devices_vehicle_id", "gps_devices", "vehicles", ["vehicle_id"], ["id"], ondelete="SET NULL")

    # 6. Vehicle Locations (history)
    op.create_table(
        "vehicle_locations",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("vehicle_id", sa.UUID(), sa.ForeignKey("vehicles.id", ondelete="CASCADE"), nullable=False),
        sa.Column("latitude", sa.Float(), nullable=False),
        sa.Column("longitude", sa.Float(), nullable=False),
        sa.Column("speed", sa.Float(), nullable=False, server_default=sa.text("0.0")),
        sa.Column("heading", sa.Float(), nullable=False, server_default=sa.text("0.0")),
        sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("received_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("is_simulated", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_vehicle_locations_vehicle_recorded", "vehicle_locations", ["vehicle_id", sa.text("recorded_at DESC")])
    op.create_index("ix_vehicle_locations_recorded_at", "vehicle_locations", ["recorded_at"])

    if is_postgres:
        op.execute("ALTER TABLE vehicle_locations ADD COLUMN location geography(Point, 4326);")
        op.execute("CREATE INDEX ix_vehicle_locations_location ON vehicle_locations USING GIST (location);")
    else:
        op.add_column("vehicle_locations", sa.Column("location", sa.Text(), nullable=True))

    # 7. Vehicle Latest Locations
    op.create_table(
        "vehicle_latest_locations",
        sa.Column("vehicle_id", sa.UUID(), sa.ForeignKey("vehicles.id", ondelete="CASCADE"), nullable=False),
        sa.Column("latitude", sa.Float(), nullable=False),
        sa.Column("longitude", sa.Float(), nullable=False),
        sa.Column("speed", sa.Float(), nullable=False, server_default=sa.text("0.0")),
        sa.Column("heading", sa.Float(), nullable=False, server_default=sa.text("0.0")),
        sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("received_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("is_simulated", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.PrimaryKeyConstraint("vehicle_id"),
    )

    if is_postgres:
        op.execute("ALTER TABLE vehicle_latest_locations ADD COLUMN location geography(Point, 4326);")
        op.execute("CREATE INDEX ix_vehicle_latest_locations_location ON vehicle_latest_locations USING GIST (location);")
    else:
        op.add_column("vehicle_latest_locations", sa.Column("location", sa.Text(), nullable=True))

    # 8. Geofences
    op.create_table(
        "geofences",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("project_id", sa.UUID(), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=True),
        sa.Column("center_latitude", sa.Float(), nullable=True),
        sa.Column("center_longitude", sa.Float(), nullable=True),
        sa.Column("radius_meters", sa.Float(), nullable=True),
        sa.Column("polygon_coordinates", sa.JSON(), nullable=True),
        sa.Column("geofence_type", sa.String(length=50), nullable=False, server_default="circle"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )

    if is_postgres:
        op.execute("ALTER TABLE geofences ADD COLUMN geometry geography(Geometry, 4326);")
        op.execute("CREATE INDEX ix_geofences_geometry ON geofences USING GIST (geometry);")
    else:
        op.add_column("geofences", sa.Column("geometry", sa.Text(), nullable=True))

    # 9. Geofence Events
    op.create_table(
        "geofence_events",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("vehicle_id", sa.UUID(), sa.ForeignKey("vehicles.id", ondelete="CASCADE"), nullable=False),
        sa.Column("geofence_id", sa.UUID(), sa.ForeignKey("geofences.id", ondelete="CASCADE"), nullable=False),
        sa.Column("event_type", sa.String(length=50), nullable=False),
        sa.Column("latitude", sa.Float(), nullable=True),
        sa.Column("longitude", sa.Float(), nullable=True),
        sa.Column("occurred_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_geofence_events_vehicle", "geofence_events", ["vehicle_id"])
    op.create_index("ix_geofence_events_geofence", "geofence_events", ["geofence_id"])

    if is_postgres:
        op.execute("ALTER TABLE geofence_events ADD COLUMN location geography(Point, 4326);")
    else:
        op.add_column("geofence_events", sa.Column("location", sa.Text(), nullable=True))

    # 10. Notifications
    op.create_table(
        "notifications",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("vehicle_id", sa.UUID(), sa.ForeignKey("vehicles.id", ondelete="SET NULL"), nullable=True),
        sa.Column("event_type", sa.String(length=100), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("is_read", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_notifications_user_id", "notifications", ["user_id"])
    op.create_index("ix_notifications_is_read", "notifications", ["is_read"])

    # 11. Vehicle Events
    op.create_table(
        "vehicle_events",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("vehicle_id", sa.UUID(), sa.ForeignKey("vehicles.id", ondelete="CASCADE"), nullable=False),
        sa.Column("event_type", sa.String(length=100), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("event_metadata", sa.JSON(), nullable=True),
        sa.Column("occurred_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_vehicle_events_vehicle_id", "vehicle_events", ["vehicle_id"])

    # 12. AI Insights
    op.create_table(
        "ai_insights",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("vehicle_id", sa.UUID(), sa.ForeignKey("vehicles.id", ondelete="SET NULL"), nullable=True),
        sa.Column("insight_type", sa.String(length=100), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("evidence", sa.JSON(), nullable=True),
        sa.Column("insight_source", sa.String(length=50), nullable=False, server_default="rule_based"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_ai_insights_vehicle_id", "ai_insights", ["vehicle_id"])


def downgrade() -> None:
    op.drop_table("ai_insights")
    op.drop_table("vehicle_events")
    op.drop_table("notifications")
    op.drop_table("geofence_events")
    op.drop_table("geofences")
    op.drop_table("vehicle_latest_locations")
    op.drop_table("vehicle_locations")
    op.drop_table("vehicles")
    op.drop_table("gps_devices")
    op.drop_table("projects")
    op.drop_table("users")
