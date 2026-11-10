"""
Application configuration using Pydantic Settings.
Loads values from environment variables, .env.local, and .env files.
"""
from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path
from typing import List, Union, Any

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def clean_db_url(url: str) -> str:
    """Normalize database URL for asyncpg compatibility with Railway & Neon PostgreSQL."""
    if url.startswith("postgres://"):
        url = "postgresql+asyncpg://" + url[len("postgres://"):]
    elif url.startswith("postgresql://") and not url.startswith("postgresql+asyncpg://"):
        url = "postgresql+asyncpg://" + url[len("postgresql://"):]
    # Remove channel_binding parameter as asyncpg doesn't support it directly in query string
    url = url.replace("channel_binding=require&", "").replace("&channel_binding=require", "").replace("channel_binding=require", "")
    url = url.replace("sslmode=require", "ssl=require").replace("sslmode=prefer", "ssl=prefer")
    # For Railway internal service networks (e.g. postgres.railway.internal), SSL is not required
    if "railway.internal" in url:
        url = url.replace("?ssl=require", "").replace("&ssl=require", "").replace("ssl=require", "")
    return url


def get_default_database_url() -> str:
    """Return unified database URL: PostgreSQL for Railway/Cloud, local SQLite for desktop dev."""
    is_cloud_or_prod = bool(
        os.environ.get("RAILWAY_ENVIRONMENT")
        or os.environ.get("RAILWAY_PROJECT_ID")
        or os.environ.get("VERCEL")
        or os.environ.get("ENABLE_NEON")
        or os.environ.get("APP_ENVIRONMENT") == "production"
    )

    env_url = os.environ.get("DATABASE_URL")
    if is_cloud_or_prod and env_url:
        return clean_db_url(env_url)

    if is_cloud_or_prod:
        # Check .env.local
        local_env = Path(__file__).resolve().parent.parent.parent.parent / ".env.local"
        if local_env.exists():
            for line in local_env.read_text().splitlines():
                if line.startswith("DATABASE_URL="):
                    val = line.split("=", 1)[1].strip().strip('"').strip("'")
                    if val:
                        return clean_db_url(val)
        raise ValueError("DATABASE_URL must be configured in production environment for PostgreSQL.")

    # For local development, default to local SQLite database so ISP port 5432 blocking never stalls the app
    backend_dir = Path(__file__).resolve().parent.parent.parent
    db_file = (backend_dir / "fleettrack.db").resolve().as_posix()
    return f"sqlite+aiosqlite:///{db_file}"


class Settings(BaseSettings):
    # Server configuration (supports Railway dynamic PORT)
    HOST: str = "0.0.0.0"
    PORT: int = int(os.environ.get("PORT", "8000"))

    # Database — defaults to unified absolute SQLite file for local dev, PostgreSQL for production
    DATABASE_URL: str = get_default_database_url()

    # Neon / Cloud Database Services
    NEON_REALTIME_URL: str = ""
    NEON_REALTIME_SECRET: str = ""
    NEON_FUNCTION_HELLO_BASE_URL: str = ""

    # Redis — gracefully degrades to in-memory fallback if unavailable
    REDIS_URL: str = os.environ.get("REDIS_URL", "redis://localhost:6379/0")

    # JWT Authentication
    SECRET_KEY: str = "dev-only-change-in-production-a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440  # 24 hours

    # CORS
    CORS_ORIGINS: Union[List[str], str] = [
        "http://localhost:5173",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
        "https://*.loca.lt",
        "https://*.trycloudflare.com",
        "https://*.vercel.app",
        "https://*.railway.app",
        "*",
    ]

    # Tracking links
    TRACKING_LINK_EXPIRE_HOURS: int = 24
    BASE_URL: str = "http://localhost:5173"

    # GPS validation thresholds — optimized for both highway driving & indoor office walking (10m trips)
    GPS_MAX_ACCURACY_METERS: float = 120.0
    GPS_MAX_SPEED_KMH: float = 220.0

    # Demo data seeding flag
    SEED_DEMO_DATA: bool = os.environ.get("SEED_DEMO_DATA", "true").lower() in ("true", "1", "yes")

    # Application
    APP_ENVIRONMENT: str = os.environ.get("APP_ENVIRONMENT", "development")

    model_config = SettingsConfigDict(
        env_file=(".env", ".env.local"), env_file_encoding="utf-8", case_sensitive=True, extra="ignore"
    )

    @field_validator("SECRET_KEY", mode="after")
    @classmethod
    def validate_secret_key(cls, v):
        is_prod = (
            os.environ.get("APP_ENVIRONMENT") == "production"
            or os.environ.get("RAILWAY_ENVIRONMENT") is not None
        )
        if is_prod and "dev-only-change-in-production" in v:
            raise ValueError(
                "SECRET_KEY must be a secure random string in production! "
                "Do not use default development credentials. Run 'openssl rand -hex 32' to generate one."
            )
        return v

    @field_validator("DATABASE_URL", mode="before")
    @classmethod
    def validate_database_url(cls, v):
        is_cloud_or_prod = bool(
            os.environ.get("RAILWAY_ENVIRONMENT")
            or os.environ.get("RAILWAY_PROJECT_ID")
            or os.environ.get("VERCEL")
            or os.environ.get("ENABLE_NEON")
            or os.environ.get("APP_ENVIRONMENT") == "production"
        )
        if isinstance(v, str) and v.strip():
            stripped = v.strip()
            if stripped.startswith("postgres"):
                if is_cloud_or_prod:
                    return clean_db_url(stripped)
                # On local desktop dev, use SQLite so ISP port 5432 blocking never stalls testing
                backend_dir = Path(__file__).resolve().parent.parent.parent
                db_file = (backend_dir / "fleettrack.db").resolve().as_posix()
                return f"sqlite+aiosqlite:///{db_file}"
            if stripped.startswith("sqlite"):
                if is_cloud_or_prod:
                    raise ValueError("SQLite fallback is forbidden in production! Please provide a PostgreSQL DATABASE_URL.")
                return stripped
        # Fallback to local dev SQLite if not configured
        backend_dir = Path(__file__).resolve().parent.parent.parent
        db_file = (backend_dir / "fleettrack.db").resolve().as_posix()
        return f"sqlite+aiosqlite:///{db_file}"

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def parse_cors_origins(cls, v) -> List[str]:
        if isinstance(v, str):
            stripped = v.strip()
            if not stripped:
                return ["*"]
            if stripped.startswith("["):
                try:
                    return json.loads(stripped)
                except Exception:
                    try:
                        import ast
                        parsed = ast.literal_eval(stripped)
                        if isinstance(parsed, list):
                            return [str(x).strip() for x in parsed]
                    except Exception:
                        pass
            return [origin.strip() for origin in stripped.split(",") if origin.strip()]
        if isinstance(v, list):
            return [str(x).strip() for x in v]
        return ["*"]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
