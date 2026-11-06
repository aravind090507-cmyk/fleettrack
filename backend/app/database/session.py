"""
Async SQLAlchemy engine and session management.
Supports both SQLite (local dev) and PostgreSQL (Neon production).
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
            from app.api.auth import seed_demo_users
            from app.api.vehicles import seed_demo_vehicles
            async with AsyncSessionLocal() as init_session:
                await seed_demo_users(init_session)
                await seed_demo_vehicles(init_session)
            _db_initialized = True
        except Exception as e:
            logger.warning("DB init or seed notice: %s", e)
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

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        if settings.DATABASE_URL.startswith("sqlite"):
            from sqlalchemy import text
            for table in ["users", "vehicles", "journeys"]:
                try:
                    await conn.execute(text(f"ALTER TABLE {table} ADD COLUMN company_id VARCHAR(36)"))
                except Exception:
                    pass
