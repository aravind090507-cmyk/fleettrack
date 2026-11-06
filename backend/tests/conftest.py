import os
import pytest

# Ensure local test suite uses dedicated SQLite test database
os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///:memory:"
os.environ["REDIS_URL"] = "redis://localhost:6379/0"
os.environ["APP_ENVIRONMENT"] = "test"
