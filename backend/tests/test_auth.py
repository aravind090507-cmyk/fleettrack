import uuid
import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.database.session import AsyncSessionLocal, init_db
from app.api.auth import seed_demo_users


@pytest_asyncio.fixture(autouse=True)
async def setup_test_db():
    await init_db()
    async with AsyncSessionLocal() as db:
        await seed_demo_users(db)


@pytest.mark.asyncio
async def test_role_escalation_prevention():
    """Verify client-supplied role is ignored; public registration defaults strictly to DRIVER."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        unique_email = f"attacker-{uuid.uuid4().hex[:8]}@evil.corp"
        payload = {
            "name": "Attacker User",
            "email": unique_email,
            "password": "Password123!",
            "role": "FLEET_MANAGER"  # Even if sent in payload
        }
        res = await client.post("/api/auth/register", json=payload)
        assert res.status_code == 201
        data = res.json()
        assert data["user"]["role"] == "DRIVER"  # Must remain DRIVER


@pytest.mark.asyncio
async def test_company_creation_assigns_fleet_manager():
    """Verify creating a company gives the user FLEET_MANAGER role with company association."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        unique_email = f"boss-{uuid.uuid4().hex[:8]}@logistics.com"
        payload = {
            "name": "Logistics Boss",
            "email": unique_email,
            "password": "Password123!",
            "company_name": f"Logistics Co {uuid.uuid4().hex[:4]}"
        }
        res = await client.post("/api/auth/register", json=payload)
        assert res.status_code == 201
        data = res.json()
        assert data["user"]["role"] == "FLEET_MANAGER"
        assert data["user"]["company_id"] is not None


@pytest.mark.asyncio
async def test_driver_joining_via_invite_code():
    """Verify driver joining with company invite code is assigned to that company."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        unique_email = f"driver-{uuid.uuid4().hex[:8]}@fleetcorp.com"
        payload = {
            "name": "Joined Driver",
            "email": unique_email,
            "password": "Password123!",
            "invite_code": "FLEETCORP-2026"
        }
        res = await client.post("/api/auth/register", json=payload)
        assert res.status_code == 201
        data = res.json()
        assert data["user"]["role"] == "DRIVER"
        assert data["user"]["company_name"] == "FleetCorp Logistics"


@pytest.mark.asyncio
async def test_login_flow():
    """Verify demo manager login returns access token and user profile."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.post("/api/auth/login", json={
            "email": "manager@fleetcorp.com",
            "password": "Password123!"
        })
        assert res.status_code == 200
        data = res.json()
        assert "access_token" in data
        assert data["user"]["role"] == "FLEET_MANAGER"
        assert data["user"]["company_name"] == "FleetCorp Logistics"
