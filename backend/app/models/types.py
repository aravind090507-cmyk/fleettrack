"""Custom cross-platform database types."""
from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.types import UserDefinedType


_postgis_available = False


def set_postgis_available(available: bool):
    global _postgis_available
    _postgis_available = available


def is_postgis_available() -> bool:
    return _postgis_available


class PostGISGeometry(UserDefinedType):
    """PostGIS spatial Geometry column for PostgreSQL with graceful fallback."""

    def __init__(self, geometry_type: str = "POINT", srid: int = 4326):
        self.geometry_type = geometry_type
        self.srid = srid

    def get_col_spec(self, **kw) -> str:
        if _postgis_available:
            return f"geometry({self.geometry_type}, {self.srid})"
        return "TEXT"

    def bind_processor(self, dialect):
        return None

    def result_processor(self, dialect, coltype):
        return None


def GeometryColumn(geometry_type: str = "Point", srid: int = 4326):
    """Returns a geometry column with variant for SQLite."""
    return PostGISGeometry(geometry_type, srid).with_variant(sa.Text, "sqlite")
