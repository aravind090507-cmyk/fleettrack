import os
import tempfile
import pytest
from alembic.config import Config
from alembic import command
import sqlalchemy as sa

def test_alembic_upgrade_and_downgrade():
    """Test that alembic upgrade head and downgrade base work cleanly."""
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as tmp:
        db_path = tmp.name

    try:
        url = f"sqlite:///{db_path}"
        alembic_cfg = Config("alembic.ini")
        alembic_cfg.set_main_option("sqlalchemy.url", url)

        # 1. Upgrade to head
        command.upgrade(alembic_cfg, "head")

        # Verify tables exist
        engine = sa.create_engine(url)
        with engine.connect() as conn:
            tables = sa.inspect(engine).get_table_names()
            assert "devices" in tables
            assert "geofences" in tables
            assert "events" in tables
            assert "device_geofences" in tables
            assert "locations" in tables
            assert "journeys" in tables

            # Verify locations has new columns
            cols = [c["name"] for c in sa.inspect(engine).get_columns("locations")]
            assert "device_id" in cols
            assert "valid" in cols
            assert "outdated" in cols
            assert "distance_m" in cols
            assert "total_distance_m" in cols
            assert "motion" in cols

        # 2. Downgrade to base
        command.downgrade(alembic_cfg, "base")
        with engine.connect() as conn:
            tables = sa.inspect(engine).get_table_names()
            assert "devices" not in tables
            assert "geofences" not in tables
            assert "events" not in tables

        # 3. Upgrade to head again
        command.upgrade(alembic_cfg, "head")
        with engine.connect() as conn:
            tables = sa.inspect(engine).get_table_names()
            assert "devices" in tables

    finally:
        if os.path.exists(db_path):
            try:
                os.remove(db_path)
            except Exception:
                pass


def test_migration_device_backfill():
    """Test that existing vehicles get web devices backfilled on upgrade."""
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as tmp:
        db_path = tmp.name

    try:
        url = f"sqlite:///{db_path}"
        alembic_cfg = Config("alembic.ini")
        alembic_cfg.set_main_option("sqlalchemy.url", url)

        # 1. Upgrade to baseline (001)
        command.upgrade(alembic_cfg, "001_initial_baseline")

        # Insert a company and a vehicle
        engine = sa.create_engine(url)
        with engine.begin() as conn:
            conn.execute(
                sa.text(
                    "INSERT INTO companies (id, name, slug, invite_code, created_at) "
                    "VALUES ('cmp-1', 'Acme Logistics', 'acme', 'INV123', CURRENT_TIMESTAMP)"
                )
            )
            conn.execute(
                sa.text(
                    "INSERT INTO vehicles (id, company_id, registration_number, model, vehicle_type, status, created_at) "
                    "VALUES ('veh-1', 'cmp-1', 'KA01AB1234', 'Tata Ace', 'TRUCK', 'AVAILABLE', CURRENT_TIMESTAMP)"
                )
            )

        # 2. Upgrade to 002
        command.upgrade(alembic_cfg, "002_traccar_telematics_postgis")

        # 3. Verify backfilled device
        with engine.connect() as conn:
            row = conn.execute(
                sa.text("SELECT id, company_id, unique_id, vehicle_id, name, status FROM devices WHERE vehicle_id = 'veh-1'")
            ).fetchone()
            assert row is not None
            assert row[0] == "dev-veh-1"
            assert row[1] == "cmp-1"
            assert row[2] == "web-veh-1"
            assert row[3] == "veh-1"
            assert "KA01AB1234" in row[4]
            assert row[5] == "unknown"

    finally:
        if os.path.exists(db_path):
            try:
                os.remove(db_path)
            except Exception:
                pass

