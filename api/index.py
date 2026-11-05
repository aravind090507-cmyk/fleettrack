"""
Vercel Serverless Entrypoint for FastAPI Backend.
Exposes the ASGI app directly to Vercel's Python runtime.
"""
from __future__ import annotations

import os
import sys

# Ensure backend directory is in Python module search path
current_dir = os.path.dirname(os.path.abspath(__file__))
root_dir = os.path.dirname(current_dir)
backend_dir = os.path.join(root_dir, "backend")

for path in [backend_dir, root_dir]:
    if path not in sys.path:
        sys.path.insert(0, path)

# On Vercel serverless, /tmp is the only writable directory for SQLite
if os.environ.get("VERCEL") and not os.environ.get("DATABASE_URL"):
    os.environ["DATABASE_URL"] = "sqlite+aiosqlite:////tmp/fleettrack.db"

# Import models to register ORM mappers
import app.models  # noqa: F401

# Import the core FastAPI application
from app.main import app  # noqa: E402
