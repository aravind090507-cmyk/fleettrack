from typing import AsyncGenerator
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.ext.compiler import compiles
from geoalchemy2.types import Geography, Geometry

from app.core.config import settings


# SQLite compatibility for testing/local environments without SpatiaLite
@compiles(Geography, "sqlite")
def compile_geography_sqlite(type_, compiler, **kw):
    return "TEXT"


@compiles(Geometry, "sqlite")
def compile_geometry_sqlite(type_, compiler, **kw):
    return "TEXT"


try:
    import geoalchemy2.admin.dialects.sqlite
    geoalchemy2.admin.dialects.sqlite.after_create = lambda *args, **kwargs: None
    geoalchemy2.admin.dialects.sqlite.before_create = lambda *args, **kwargs: None
except Exception:
    pass


class Base(DeclarativeBase):
    """Base class for all SQLAlchemy Declarative models."""
    pass


# Build database engine
# If postgresql:// without asyncpg is passed in environment, ensure driver is asyncpg
db_url = settings.DATABASE_URL
if db_url.startswith("postgresql://"):
    db_url = db_url.replace("postgresql://", "postgresql+asyncpg://", 1)

engine_kwargs = {"echo": False, "future": True}
if not db_url.startswith("sqlite"):
    engine_kwargs["pool_pre_ping"] = True

engine = create_async_engine(db_url, **engine_kwargs)

def setup_sqlite_spatial_stubs(eng):
    from sqlalchemy import event

    @event.listens_for(eng.sync_engine, "connect")
    def add_sqlite_spatial_functions(dbapi_connection, connection_record):
        try:
            for fn in [
                "ST_GeogFromText", "ST_GeomFromText", "ST_AsBinary", "ST_AsGeoJSON", "ST_AsText", "ST_Point",
                "GeogFromText", "GeomFromText", "AsBinary", "AsGeoJSON", "AsText", "Point",
                "CreateSpatialIndex", "InitSpatialMetaData",
            ]:
                dbapi_connection.create_function(fn, -1, lambda *args: args[0] if args else None)
        except Exception:
            pass


if "sqlite" in db_url:
    setup_sqlite_spatial_stubs(engine)

async_session_maker = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Dependency for providing database session to FastAPI route handlers."""
    async with async_session_maker() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
