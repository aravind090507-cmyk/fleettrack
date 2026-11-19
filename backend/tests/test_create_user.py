"""Comprehensive test suite for Create New User feature in FleetTrack AI."""
import uuid
import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.database.session import AsyncSessionLocal, init_db
from tests.fixtures import seed_demo_users


@pytest_asyncio.fixture(autouse=True)
async def setup_test_db():
    await init_db()
    async with AsyncSessionLocal() as db:
        await seed_demo_users(db)


@pytest.mark.asyncio
async def test_1_create_new_fleet_manager():
    """Scenario 1: Create a new Fleet Manager and verify role and company assignment."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        unique_email = f"manager_{uuid.uuid4().hex[:8]}@fleetcorp.com"
        payload = {
            "name": "Jane Operations Manager",
            "email": unique_email,
            "password": "Password123!",
            "role": "FLEET_MANAGER"
        }
        res = await client.post("/api/auth/register", json=payload)
        assert res.status_code == 201
        data = res.json()
        assert data["user"]["role"] == "FLEET_MANAGER"
        assert data["user"]["name"] == "Jane Operations Manager"
        assert data["user"]["email"] == unique_email
        assert data["user"]["company_id"] is not None
        assert data["access_token"] is not None


@pytest.mark.asyncio
async def test_2_create_new_driver():
    """Scenario 2: Create a new Driver and verify role and company assignment."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        unique_email = f"driver_{uuid.uuid4().hex[:8]}@fleetcorp.com"
        payload = {
            "name": "Alex Express Driver",
            "email": unique_email,
            "password": "Password123!",
            "role": "DRIVER"
        }
        res = await client.post("/api/auth/register", json=payload)
        assert res.status_code == 201
        data = res.json()
        assert data["user"]["role"] == "DRIVER"
        assert data["user"]["name"] == "Alex Express Driver"
        assert data["user"]["email"] == unique_email
        assert data["user"]["company_id"] is not None


@pytest.mark.asyncio
async def test_3_create_user_missing_mandatory_fields():
    """Scenario 3: Create a user with missing mandatory fields fails with HTTP 422."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Missing password and name
        res = await client.post("/api/auth/register", json={"email": "incomplete@fleetcorp.com"})
        assert res.status_code == 422

        # Empty name
        res2 = await client.post("/api/auth/register", json={
            "name": "   ",
            "email": "test_empty_name@fleetcorp.com",
            "password": "Password123!"
        })
        assert res2.status_code == 422

        # Password too short (< 6 chars)
        res3 = await client.post("/api/auth/register", json={
            "name": "Short Password",
            "email": "short_pw@fleetcorp.com",
            "password": "123"
        })
        assert res3.status_code == 422


@pytest.mark.asyncio
async def test_4_create_user_invalid_email_format():
    """Scenario 4: Create a user with an invalid email address format fails validation."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        invalid_emails = [
            "not-an-email",
            "missing-at.com",
            "@no-username.com",
            "spaces in email@domain.com"
        ]
        for bad_email in invalid_emails:
            res = await client.post("/api/auth/register", json={
                "name": "Bad Email User",
                "email": bad_email,
                "password": "Password123!",
                "role": "DRIVER"
            })
            assert res.status_code == 422


@pytest.mark.asyncio
async def test_5_attempt_duplicate_email_registration():
    """Scenario 5: Attempting duplicate email registration returns HTTP 409 Conflict."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        unique_email = f"dup_{uuid.uuid4().hex[:8]}@fleetcorp.com"
        payload = {
            "name": "Original User",
            "email": unique_email,
            "password": "Password123!",
            "role": "DRIVER"
        }
        res1 = await client.post("/api/auth/register", json=payload)
        assert res1.status_code == 201

        # Attempt to register again with same email
        res2 = await client.post("/api/auth/register", json=payload)
        assert res2.status_code == 409
        assert "already exists" in res2.json()["detail"].lower()


@pytest.mark.asyncio
async def test_6_attempt_creation_with_invalid_role():
    """Scenario 6: Attempting user creation with an invalid role fails validation."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.post("/api/auth/register", json={
            "name": "Invalid Role User",
            "email": f"bad_role_{uuid.uuid4().hex[:8]}@fleetcorp.com",
            "password": "Password123!",
            "role": "UNAUTHORIZED_BOGUS_ROLE"
        })
        # Validation error (400 or 422)
        assert res.status_code in (400, 422)


@pytest.mark.asyncio
async def test_7_verify_company_association():
    """Scenario 7: Verify user is associated with company (default, custom, or via invite code)."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Default company association
        email1 = f"default_co_{uuid.uuid4().hex[:8]}@fleetcorp.com"
        res1 = await client.post("/api/auth/register", json={
            "name": "Default Co Driver",
            "email": email1,
            "password": "Password123!",
            "role": "DRIVER"
        })
        assert res1.status_code == 201
        assert res1.json()["user"]["company_name"] == "FleetCorp Logistics"
        assert res1.json()["user"]["company_id"] is not None

        # Custom company creation
        email2 = f"owner_{uuid.uuid4().hex[:8]}@acme.com"
        res2 = await client.post("/api/auth/register", json={
            "name": "Acme Owner",
            "email": email2,
            "password": "Password123!",
            "company_name": f"Acme Logistics {uuid.uuid4().hex[:4]}"
        })
        assert res2.status_code == 201
        assert "Acme" in res2.json()["user"]["company_name"]
        assert res2.json()["user"]["role"] == "FLEET_MANAGER"


@pytest.mark.asyncio
async def test_8_and_9_login_new_account_and_portal_redirection():
    """Scenario 8 & 9: Log in using newly created account and verify role for portal routing."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Create new Driver
        driver_email = f"driver_login_{uuid.uuid4().hex[:8]}@fleetcorp.com"
        await client.post("/api/auth/register", json={
            "name": "Driver Logintester",
            "email": driver_email,
            "password": "Password123!",
            "role": "DRIVER"
        })

        # 2. Login as Driver -> verify driver role for /driver portal routing
        login_driver_res = await client.post("/api/auth/login", json={
            "email": driver_email,
            "password": "Password123!"
        })
        assert login_driver_res.status_code == 200
        driver_data = login_driver_res.json()
        assert driver_data["user"]["role"] == "DRIVER"
        assert driver_data["access_token"] is not None

        # 3. Create new Fleet Manager
        manager_email = f"manager_login_{uuid.uuid4().hex[:8]}@fleetcorp.com"
        await client.post("/api/auth/register", json={
            "name": "Manager Logintester",
            "email": manager_email,
            "password": "Password123!",
            "role": "FLEET_MANAGER"
        })

        # 4. Login as Fleet Manager -> verify manager role for /company portal routing
        login_mgr_res = await client.post("/api/auth/login", json={
            "email": manager_email,
            "password": "Password123!"
        })
        assert login_mgr_res.status_code == 200
        mgr_data = login_mgr_res.json()
        assert mgr_data["user"]["role"] == "FLEET_MANAGER"
        assert mgr_data["access_token"] is not None


@pytest.mark.asyncio
async def test_10_existing_accounts_can_still_login():
    """Scenario 10: Verify existing seeded accounts continue to authenticate smoothly."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Existing demo manager
        mgr_res = await client.post("/api/auth/login", json={
            "email": "manager@fleetcorp.com",
            "password": "Password123!"
        })
        assert mgr_res.status_code == 200
        assert mgr_res.json()["user"]["role"] == "FLEET_MANAGER"

        # Existing demo driver
        drv_res = await client.post("/api/auth/login", json={
            "email": "driver1@fleetcorp.com",
            "password": "Password123!"
        })
        assert drv_res.status_code == 200
        assert drv_res.json()["user"]["role"] == "DRIVER"


@pytest.mark.asyncio
async def test_create_user_alias_endpoint():
    """Verify POST /api/auth/create-user alias works identically to /api/auth/register."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        email = f"alias_{uuid.uuid4().hex[:8]}@fleetcorp.com"
        res = await client.post("/api/auth/create-user", json={
            "name": "Alias Test User",
            "email": email,
            "password": "Password123!",
            "role": "DRIVER"
        })
        assert res.status_code == 201
        assert res.json()["user"]["email"] == email
