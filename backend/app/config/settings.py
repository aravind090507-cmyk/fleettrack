"""
Application configuration using Pydantic Settings.
Loads values from environment variables and .env file.
"""
from __future__ import annotations

import json
from functools import lru_cache
from typing import List

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # Database — defaults to SQLite for zero-install local development
    DATABASE_URL: str = "sqlite+aiosqlite:///./fleettrack.db"

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
        env_file=".env", env_file_encoding="utf-8", case_sensitive=True, extra="ignore"
    )

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
