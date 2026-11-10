import os
import pytest

# Ensure local test suite uses dedicated SQLite test database
os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///:memory:"
os.environ["REDIS_URL"] = "redis://localhost:6379/0"
os.environ["APP_ENVIRONMENT"] = "test"


@pytest.fixture
def auth_headers_factory():
    from app.security.jwt import create_access_token
    def _create_headers(user):
        token = create_access_token(
            data={
                "sub": user.id,
                "cid": user.company_id,
                "email": user.email,
                "role": user.role,
                "name": user.name,
            }
        )
        return {"Authorization": f"Bearer {token}"}
    return _create_headers
