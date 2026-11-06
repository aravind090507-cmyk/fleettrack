"""
Application configuration using Pydantic Settings.
Loads values from environment variables, .env.local, and .env files.
"""
from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path
from typing import List

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def clean_db_url(url: str) -> str:
    """Normalize database URL for asyncpg compatibility with Neon."""
    if url.startswith("postgres://"):
        url = "postgresql+asyncpg://" + url[len("postgres://"):]
    elif url.startswith("postgresql://"):
        url = "postgresql+asyncpg://" + url[len("postgresql://"):]
    # Remove channel_binding parameter as asyncpg doesn't support it directly in query string
    url = url.replace("channel_binding=require&", "").replace("&channel_binding=require", "").replace("channel_binding=require", "")
    url = url.replace("sslmode=require", "ssl=require").replace("sslmode=prefer", "ssl=prefer")
    return url


def get_default_database_url() -> str:
    """Return unified database URL: Neon for Vercel/cloud, local SQLite for desktop dev."""
    # If explicitly running on Vercel or explicitly enabled remote DB
    if os.environ.get("VERCEL") or os.environ.get("ENABLE_NEON"):
        env_url = os.environ.get("DATABASE_URL")
        if env_url:
            return clean_db_url(env_url)
        # Check .env.local
        local_env = Path(__file__).resolve().parent.parent.parent.parent / ".env.local"
        if local_env.exists():
            for line in local_env.read_text().splitlines():
                if line.startswith("DATABASE_URL="):
                    val = line.split("=", 1)[1].strip().strip('"').strip("'")
                    return clean_db_url(val)

    # For local development, default to local SQLite database so ISP port 5432 blocking never stalls the app
    backend_dir = Path(__file__).resolve().parent.parent.parent
    db_file = (backend_dir / "fleettrack.db").resolve().as_posix()
    return f"sqlite+aiosqlite:///{db_file}"


class Settings(BaseSettings):
    # Database — defaults to unified absolute SQLite file for local dev, Neon for production
    DATABASE_URL: str = get_default_database_url()

    # Neon Cloud Services
    NEON_REALTIME_URL: str = ""
    NEON_REALTIME_SECRET: str = ""
    NEON_FUNCTION_HELLO_BASE_URL: str = ""

    # Redis — gracefully degrades to in-memory fallback if unavailable
    REDIS_URL: str = "redis://localhost:6379/0"

    # JWT Authentication
    SECRET_KEY: str = "dev-only-change-in-production-a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440  # 24 hours

    # CORS
    CORS_ORIGINS: List[str] = [
        "http://localhost:5173",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
        "https://*.loca.lt",
        "https://*.trycloudflare.com",
        "https://*.vercel.app",
        "*",
    ]

    # Tracking links
    TRACKING_LINK_EXPIRE_HOURS: int = 24
    BASE_URL: str = "http://localhost:5173"

    # GPS validation thresholds — optimized for both highway driving & indoor office walking (10m trips)
    GPS_MAX_ACCURACY_METERS: float = 120.0
    GPS_MAX_SPEED_KMH: float = 220.0

    # Application
    APP_ENVIRONMENT: str = "development"

    model_config = SettingsConfigDict(
        env_file=(".env", ".env.local"), env_file_encoding="utf-8", case_sensitive=True, extra="ignore"
    )

    @field_validator("DATABASE_URL", mode="before")
    @classmethod
    def validate_database_url(cls, v):
        if isinstance(v, str):
            if not (os.environ.get("VERCEL") or os.environ.get("ENABLE_NEON")):
                backend_dir = Path(__file__).resolve().parent.parent.parent
                db_file = (backend_dir / "fleettrack.db").resolve().as_posix()
                return f"sqlite+aiosqlite:///{db_file}"
            if v.startswith("postgres"):
                return clean_db_url(v)
            return v
        return v

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def parse_cors_origins(cls, v):
        if isinstance(v, str):
            stripped = v.strip()
            if stripped.startswith("["):
                return json.loads(stripped)
            return [origin.strip() for origin in stripped.split(",")]
        return v


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
