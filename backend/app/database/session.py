"""
Async SQLAlchemy engine and session management.
Supports both SQLite (local dev) and PostgreSQL (Neon/Railway production with PostGIS).
"""
from __future__ import annotations

import logging
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config.settings import get_settings

logger = logging.getLogger("fleettrack.db")
settings = get_settings()

connect_args = {}
engine_kwargs = {"echo": False}

if settings.DATABASE_URL.startswith("sqlite"):
    connect_args = {"check_same_thread": False}
elif "asyncpg" in settings.DATABASE_URL:
    connect_args = {"statement_cache_size": 0}
    engine_kwargs.update({
        "pool_size": 10,
        "max_overflow": 20,
        "pool_pre_ping": True,
        "pool_recycle": 300,
    })

engine = create_async_engine(
    settings.DATABASE_URL,
    connect_args=connect_args,
    **engine_kwargs,
)

AsyncSessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


_db_initialized = False


async def get_db():
    """FastAPI dependency that yields an async database session."""
    global _db_initialized
    if not _db_initialized:
        try:
            await init_db()
            _db_initialized = True
        except Exception as e:
            logger.warning("DB init notice: %s", e)
            _db_initialized = True

    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()


async def init_db():
    """Create all tables from ORM models. Called once at startup."""
    from app.database.base import Base
    import app.models.company  # noqa: F401
    import app.models.user  # noqa: F401
    import app.models.vehicle  # noqa: F401
    import app.models.journey  # noqa: F401
    import app.models.location  # noqa: F401
    import app.models.tracking_link  # noqa: F401
    import app.models.trip_event  # noqa: F401
    import app.models.event  # noqa: F401
    import app.models.geofence  # noqa: F401
    import app.models.delivery_assignment  # noqa: F401

    if not settings.DATABASE_URL.startswith("sqlite"):
        from sqlalchemy import text
        from app.models.types import set_postgis_available
        try:
            async with engine.connect() as ext_conn:
                await ext_conn.execution_options(isolation_level="AUTOCOMMIT").execute(
                    text("CREATE EXTENSION IF NOT EXISTS postgis;")
                )
                set_postgis_available(True)
                logger.info("Ensured PostGIS extension is active")
        except Exception as e:
            set_postgis_available(False)
            logger.warning("Notice on PostGIS extension creation (falling back to spatial text): %s", e)

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        from sqlalchemy import text
        if not settings.DATABASE_URL.startswith("sqlite"):
            # PostgreSQL schema reconciliation for live production databases
            pg_migration_sqls = [
                "ALTER TABLE users ADD COLUMN IF NOT EXISTS availability VARCHAR(50) DEFAULT 'AVAILABLE'",
                "ALTER TABLE users ADD COLUMN IF NOT EXISTS availability_preference VARCHAR(50) DEFAULT 'AVAILABLE'",
                "ALTER TABLE users ADD COLUMN IF NOT EXISTS availability_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
                "CREATE TABLE IF NOT EXISTS delivery_assignments (id VARCHAR(36) PRIMARY KEY, company_id VARCHAR(36) REFERENCES companies(id), manager_id VARCHAR(36) REFERENCES users(id), driver_id VARCHAR(36) REFERENCES users(id), destination_name VARCHAR(255) NOT NULL, destination_lat FLOAT NOT NULL, destination_lng FLOAT NOT NULL, instructions TEXT, status VARCHAR(50) DEFAULT 'PENDING' NOT NULL, journey_id VARCHAR(36) REFERENCES journeys(id), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL, accepted_at TIMESTAMP, rejected_at TIMESTAMP, started_at TIMESTAMP, completed_at TIMESTAMP, cancelled_at TIMESTAMP)",
                "CREATE INDEX IF NOT EXISTS ix_delivery_assignments_company_id ON delivery_assignments (company_id)",
                "CREATE INDEX IF NOT EXISTS ix_delivery_assignments_driver_id ON delivery_assignments (driver_id)",
                "CREATE INDEX IF NOT EXISTS ix_delivery_assignments_manager_id ON delivery_assignments (manager_id)",
                "CREATE INDEX IF NOT EXISTS ix_delivery_assignments_status ON delivery_assignments (status)",
                "CREATE INDEX IF NOT EXISTS ix_delivery_assignments_journey_id ON delivery_assignments (journey_id)",
                "ALTER TABLE trip_events ADD COLUMN IF NOT EXISTS is_dismissed BOOLEAN DEFAULT FALSE",
                "ALTER TABLE locations ALTER COLUMN protocol DROP NOT NULL",
                "ALTER TABLE locations ALTER COLUMN protocol SET DEFAULT 'web'",
                "ALTER TABLE locations ALTER COLUMN device_id DROP NOT NULL",
                "ALTER TABLE locations DROP COLUMN IF EXISTS protocol",
                "ALTER TABLE locations DROP COLUMN IF EXISTS device_time",
                "ALTER TABLE locations DROP COLUMN IF EXISTS device_id",
                "ALTER TABLE journeys DROP COLUMN IF EXISTS device_id",
                "DROP TABLE IF EXISTS device_geofences CASCADE",
                "DROP TABLE IF EXISTS devices CASCADE",
            ]
            for sql in pg_migration_sqls:
                try:
                    sp = await conn.begin_nested()
                    await conn.execute(text(sql))
                    await sp.commit()
                except Exception as e:
                    await sp.rollback()
                    logger.debug("PostgreSQL schema notice (%s): %s", sql, e)
        else:
            for table in ["users", "vehicles", "journeys"]:
                try:
                    await conn.execute(text(f"ALTER TABLE {table} ADD COLUMN company_id VARCHAR(36)"))
                except Exception:
                    pass
            # Check and alter new Phase 2 columns if running on an existing populated SQLite database
            for col_sql in [
                "ALTER TABLE journeys ADD COLUMN destination_geofence_id VARCHAR(36)",
                "ALTER TABLE locations ADD COLUMN valid BOOLEAN DEFAULT 1",
                "ALTER TABLE locations ADD COLUMN outdated BOOLEAN DEFAULT 0",
                "ALTER TABLE locations ADD COLUMN distance_m FLOAT DEFAULT 0.0",
                "ALTER TABLE locations ADD COLUMN total_distance_m FLOAT DEFAULT 0.0",
                "ALTER TABLE locations ADD COLUMN motion BOOLEAN DEFAULT 0",
                "ALTER TABLE locations ADD COLUMN geofence_ids JSON",
                "ALTER TABLE locations ADD COLUMN attributes JSON",
                "ALTER TABLE locations ADD COLUMN geom TEXT",
                "ALTER TABLE trip_events ADD COLUMN is_dismissed BOOLEAN DEFAULT 0",
                "ALTER TABLE users ADD COLUMN availability VARCHAR(50) DEFAULT 'AVAILABLE'",
                "ALTER TABLE users ADD COLUMN availability_preference VARCHAR(50) DEFAULT 'AVAILABLE'",
                "ALTER TABLE users ADD COLUMN availability_updated_at TIMESTAMP",
            ]:
                try:
                    await conn.execute(text(col_sql))
                except Exception:
                    pass
