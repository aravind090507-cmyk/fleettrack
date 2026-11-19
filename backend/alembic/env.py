import asyncio
from logging.config import fileConfig

from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

from alembic import context

from app.config.settings import get_settings
from app.database.base import Base
import app.models  # load all models

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata

db_url = config.get_main_option("sqlalchemy.url")
if not db_url or "%(DATABASE_URL)s" in db_url or "driver://user:pass" in db_url:
    settings = get_settings()
    db_url = settings.DATABASE_URL

if db_url.startswith("sqlite:///") and not db_url.startswith("sqlite+aiosqlite:///"):
    db_url = db_url.replace("sqlite:///", "sqlite+aiosqlite:///")
elif db_url.startswith("postgresql://") and not db_url.startswith("postgresql+asyncpg://"):
    db_url = db_url.replace("postgresql://", "postgresql+asyncpg://")

config.set_main_option("sqlalchemy.url", db_url)


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        render_as_batch=True if "sqlite" in url else False,
    )

    with context.begin_transaction():
        context.run_migrations()


def reconcile_existing_schema(connection: Connection) -> None:
    """
    Evidence-based schema reconciliation.
    Detects whether existing database tables already match a known migration revision
    when alembic_version is uninitialized or missing.
    Prevents 'relation "companies" already exists' on pre-existing databases without blindly stamping.
    """
    import sqlalchemy as sa
    from sqlalchemy import text

    is_postgres = connection.dialect.name == "postgresql"

    # Concurrency guard: Acquire Postgres transaction advisory lock so multiple workers don't race
    if is_postgres:
        try:
            connection.execute(text("SELECT pg_advisory_xact_lock(718293);"))
        except Exception:
            pass

    inspector = sa.inspect(connection)
    existing_tables = set(inspector.get_table_names())

    has_alembic_version = "alembic_version" in existing_tables
    recorded_versions = []
    if has_alembic_version:
        try:
            res = connection.execute(text("SELECT version_num FROM alembic_version")).fetchall()
            recorded_versions = [row[0] for row in res if row[0]]
        except Exception:
            recorded_versions = []

    # If alembic_version already has a revision recorded, leave Alembic's native migration graph to handle it
    if recorded_versions:
        return

    # If database is fresh/empty (no companies table), let normal migrations run from 001
    if "companies" not in existing_tables:
        return

    # Database contains existing tables. Gather evidence to determine actual schema state:
    matched_revision = None

    if "delivery_assignments" in existing_tables:
        cols = {col["name"]: str(col.get("type", "")).upper() for col in inspector.get_columns("delivery_assignments")}
        dest_type = cols.get("destination_name", "")
        if "TEXT" in dest_type or "VARCHAR" not in dest_type:
            matched_revision = "005_expand_text_columns"
        else:
            matched_revision = "004_delivery_assignments"
    elif "users" in existing_tables:
        user_cols = {col["name"] for col in inspector.get_columns("users")}
        if "availability" in user_cols:
            matched_revision = "004_delivery_assignments"
        elif "geofences" in existing_tables:
            if "devices" not in existing_tables:
                matched_revision = "003_remove_osmand_and_devices"
            else:
                matched_revision = "002_traccar_telematics_postgis"
        else:
            matched_revision = "001_initial_baseline"

    if matched_revision:
        if not has_alembic_version:
            connection.execute(text(
                "CREATE TABLE IF NOT EXISTS alembic_version ("
                "version_num VARCHAR(32) NOT NULL, "
                "CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num))"
            ))

        connection.execute(text("DELETE FROM alembic_version"))
        connection.execute(
            text("INSERT INTO alembic_version (version_num) VALUES (:ver)"),
            {"ver": matched_revision}
        )


def do_run_migrations(connection: Connection) -> None:
    is_sqlite = connection.dialect.name == "sqlite"
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        render_as_batch=is_sqlite,
    )

    with context.begin_transaction():
        reconcile_existing_schema(connection)
        context.run_migrations()


async def run_async_migrations() -> None:
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)

    await connectable.dispose()


def run_migrations_online() -> None:
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
