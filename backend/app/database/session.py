"""
Async SQLAlchemy engine and session management.
Supports both SQLite (local dev) and PostgreSQL (production).
"""
from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config.settings import get_settings

settings = get_settings()

# Connection args differ by backend
connect_args = {}
if settings.DATABASE_URL.startswith("sqlite"):
    connect_args = {"check_same_thread": False}

engine = create_async_engine(
    settings.DATABASE_URL,
    echo=False,
    connect_args=connect_args,
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
            import logging
            logging.getLogger("fleettrack.db").warning("DB init or seed warning: %s", e)
            _db_initialized = True

    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()


async def init_db():
    """Create all tables from ORM models. Called once at startup."""
    from app.database.base import Base
    # Import all models so they register with Base.metadata
    import app.models.company  # noqa: F401
    import app.models.user  # noqa: F401
    import app.models.vehicle  # noqa: F401
    import app.models.journey  # noqa: F401
    import app.models.location  # noqa: F401
    import app.models.tracking_link  # noqa: F401
    import app.models.trip_event  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # Auto-migrate missing columns for existing SQLite databases
        from sqlalchemy import text
        for table in ["users", "vehicles", "journeys"]:
            try:
                await conn.execute(text(f"ALTER TABLE {table} ADD COLUMN company_id VARCHAR(36)"))
            except Exception:
                # Column already exists
                pass
