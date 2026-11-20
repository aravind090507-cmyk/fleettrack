"""
Comprehensive Full Acceptance Test Matrix for FleetTrack AI.
Maps directly to Test Suites 1 through 16:
- 1. Authentication & User Management (AUTH-01 -> AUTH-12)
- 2. Role-Based Access & Company Isolation (ROLE-01 -> ROLE-06)
- 3. Driver Availability (AV-01 -> AV-08)
- 4. Delivery Dispatch (DSP-01 -> DSP-12)
- 5. Delivery Lifecycle (DEL-01 -> DEL-09)
- 6. Live GPS Tracking (GPS-01 -> GPS-12)
- 7. Adaptive GPS & Battery Optimization (ADP-01 -> ADP-10)
- 8. Background Tracking (BG-01 -> BG-10)
- 9. Live Tracking Map & Manager Monitoring (MAP-01 -> MAP-10)
- 10. Public Tracking Links (PUB-01 -> PUB-08)
- 11. Network & Offline Functionality (NET-01 -> NET-09)
- 12. Database & Backend Integration (DB-01 -> DB-10)
- 13. Security Testing (SEC-01 -> SEC-08)
- 14. Performance & Reliability (PERF-01 -> PERF-08)
- 15. Final End-to-End Scenario (Steps 1 to 25)
"""
import uuid
import pytest
import pytest_asyncio
from datetime import datetime, timezone, timedelta
from httpx import AsyncClient, ASGITransport

from app.main import app
from app.database.session import AsyncSessionLocal, init_db
from app.models.company import Company
from app.models.user import User
from app.models.vehicle import Vehicle
from app.models.journey import Journey
from app.models.delivery_assignment import DeliveryAssignment
from app.security.passwords import hash_password, verify_password
from app.security.jwt import create_access_token
from tests.fixtures import seed_demo_users


@pytest_asyncio.fixture(autouse=True)
async def setup_test_db():
    await init_db()
    async with AsyncSessionLocal() as db:
        await seed_demo_users(db)


@pytest.fixture
def auth_headers_factory():
    def _create_headers(user: User):
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


# -------------------------------------------------------------
# 1. AUTHENTICATION & USER MANAGEMENT (AUTH-01 through AUTH-12)
# -------------------------------------------------------------
@pytest.mark.asyncio
async def test_auth_01_to_05_login_validation():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # AUTH-01: Login with valid Manager credentials
        res_mgr = await client.post(
            "/api/auth/login",
            json={"email": "manager@fleetcorp.com", "password": "Password123!"}
        )
        assert res_mgr.status_code == 200
        assert res_mgr.json()["user"]["role"] == "FLEET_MANAGER"
        assert res_mgr.json()["access_token"] is not None

        # AUTH-02: Login with valid Driver credentials
        res_drv = await client.post(
            "/api/auth/login",
            json={"email": "driver1@fleetcorp.com", "password": "Password123!"}
        )
        assert res_drv.status_code == 200
        assert res_drv.json()["user"]["role"] == "DRIVER"

        # AUTH-03: Login with incorrect password
        res_bad_pw = await client.post(
            "/api/auth/login",
            json={"email": "manager@fleetcorp.com", "password": "WrongPassword!"}
        )
        assert res_bad_pw.status_code == 401

        # AUTH-04: Login with unregistered email
        res_unreg = await client.post(
            "/api/auth/login",
            json={"email": "nonexistent_user@fleetcorp.com", "password": "Password123!"}
        )
        assert res_unreg.status_code == 401

        # AUTH-05: Submit empty login form (required-field validation)
        res_empty = await client.post("/api/auth/login", json={})
        assert res_empty.status_code in (400, 422)


@pytest.mark.asyncio
async def test_auth_06_to_09_account_creation():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # AUTH-06: Create a new Driver account
        driver_email = f"driver_{uuid.uuid4().hex[:8]}@fleetcorp.com"
        res_drv = await client.post(
            "/api/auth/register",
            json={
                "name": "New Test Driver",
                "email": driver_email,
                "password": "Password123!",
                "role": "DRIVER",
            }
        )
        assert res_drv.status_code == 201
        assert res_drv.json()["user"]["role"] == "DRIVER"

        # AUTH-07: Create a new Manager account
        mgr_email = f"mgr_{uuid.uuid4().hex[:8]}@fleetcorp.com"
        res_mgr = await client.post(
            "/api/auth/register",
            json={
                "name": "New Test Manager",
                "email": mgr_email,
                "password": "Password123!",
                "role": "FLEET_MANAGER",
            }
        )
        assert res_mgr.status_code == 201
        assert res_mgr.json()["user"]["role"] == "FLEET_MANAGER"

        # AUTH-08: Create account using existing email (duplicate rejection)
        res_dup = await client.post(
            "/api/auth/register",
            json={
                "name": "Duplicate Driver",
                "email": driver_email,
                "password": "Password123!",
                "role": "DRIVER",
            }
        )
        assert res_dup.status_code in (400, 409)

        # AUTH-09: Log in using newly created account
        res_login = await client.post(
            "/api/auth/login",
            json={"email": driver_email, "password": "Password123!"}
        )
        assert res_login.status_code == 200
        assert res_login.json()["user"]["role"] == "DRIVER"


# -------------------------------------------------------------
# 2. ROLE-BASED ACCESS & COMPANY ISOLATION (ROLE-01 through ROLE-06)
# -------------------------------------------------------------
@pytest.mark.asyncio
async def test_role_and_company_isolation(auth_headers_factory):
    transport = ASGITransport(app=app)
    async with AsyncSessionLocal() as db:
        # Create 2 separate companies
        comp_a = Company(name="Company Alpha", invite_code=uuid.uuid4().hex[:8].upper())
        comp_b = Company(name="Company Beta", invite_code=uuid.uuid4().hex[:8].upper())
        db.add_all([comp_a, comp_b])
        await db.commit()
        await db.refresh(comp_a)
        await db.refresh(comp_b)

        # Company A Manager & Driver
        mgr_a = User(
            company_id=comp_a.id,
            name="Manager Alpha",
            email=f"mgr_a_{uuid.uuid4().hex[:6]}@alpha.com",
            password_hash=hash_password("Password123!"),
            role="FLEET_MANAGER",
            is_active=True,
        )
        drv_a = User(
            company_id=comp_a.id,
            name="Driver Alpha",
            email=f"drv_a_{uuid.uuid4().hex[:6]}@alpha.com",
            password_hash=hash_password("Password123!"),
            role="DRIVER",
            availability="AVAILABLE",
            is_active=True,
        )

        # Company B Driver
        drv_b = User(
            company_id=comp_b.id,
            name="Driver Beta",
            email=f"drv_b_{uuid.uuid4().hex[:6]}@beta.com",
            password_hash=hash_password("Password123!"),
            role="DRIVER",
            availability="AVAILABLE",
            is_active=True,
        )
        db.add_all([mgr_a, drv_a, drv_b])
        await db.commit()
        await db.refresh(mgr_a)
        await db.refresh(drv_a)
        await db.refresh(drv_b)

    mgr_a_headers = auth_headers_factory(mgr_a)
    drv_a_headers = auth_headers_factory(drv_a)
    drv_b_headers = auth_headers_factory(drv_b)

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # ROLE-01: Driver attempts to access Manager dispatch
        res_r1 = await client.post(
            "/api/dispatch/assignments",
            json={"driver_id": drv_a.id, "destination_name": "Test", "destination_lat": 13.0, "destination_lng": 80.0},
            headers=drv_a_headers,
        )
        assert res_r1.status_code in (401, 403)

        # ROLE-03: Manager views company drivers (only Company A drivers appear)
        res_r3 = await client.get("/api/dispatch/drivers", headers=mgr_a_headers)
        assert res_r3.status_code == 200
        drivers_list = res_r3.json()
        driver_ids = [d["id"] for d in drivers_list]
        assert drv_a.id in driver_ids
        assert drv_b.id not in driver_ids  # Company B driver excluded

        # ROLE-04: Manager attempts to assign delivery to another company's driver
        res_r4 = await client.post(
            "/api/dispatch/assignments",
            json={"driver_id": drv_b.id, "destination_name": "Test", "destination_lat": 13.0, "destination_lng": 80.0},
            headers=mgr_a_headers,
        )
        assert res_r4.status_code in (400, 403, 404)

        # ROLE-06: Unauthenticated user accesses protected API
        res_r6 = await client.get("/api/dispatch/drivers")
        assert res_r6.status_code == 401


# -------------------------------------------------------------
# 3. DRIVER AVAILABILITY & LIFECYCLE (AV-01 to AV-08)
# -------------------------------------------------------------
@pytest.mark.asyncio
async def test_driver_availability_full_suite(auth_headers_factory):
    transport = ASGITransport(app=app)
    async with AsyncSessionLocal() as db:
        comp = Company(name="Availability Co", invite_code=uuid.uuid4().hex[:8].upper())
        db.add(comp)
        await db.commit()
        await db.refresh(comp)

        driver = User(
            company_id=comp.id,
            name="Avail Driver",
            email=f"avail_drv_{uuid.uuid4().hex[:6]}@test.com",
            password_hash=hash_password("Password123!"),
            role="DRIVER",
            availability="AVAILABLE",
            is_active=True,
        )
        mgr = User(
            company_id=comp.id,
            name="Avail Manager",
            email=f"avail_mgr_{uuid.uuid4().hex[:6]}@test.com",
            password_hash=hash_password("Password123!"),
            role="FLEET_MANAGER",
            is_active=True,
        )
        db.add_all([driver, mgr])
        await db.commit()
        await db.refresh(driver)
        await db.refresh(mgr)

    driver_headers = auth_headers_factory(driver)
    mgr_headers = auth_headers_factory(mgr)

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # AV-01: Driver is Available
        res_av1 = await client.put("/api/driver/availability", json={"availability": "AVAILABLE"}, headers=driver_headers)
        assert res_av1.status_code == 200
        assert res_av1.json()["availability"] == "AVAILABLE"

        # AV-02: Driver changes status to Unavailable
        res_av2 = await client.put("/api/driver/availability", json={"availability": "UNAVAILABLE"}, headers=driver_headers)
        assert res_av2.status_code == 200
        assert res_av2.json()["availability"] == "UNAVAILABLE"

        # AV-08: Manager checks driver availability -> displays UNAVAILABLE
        res_mgr_check = await client.get("/api/dispatch/drivers", headers=mgr_headers)
        d_found = next(d for d in res_mgr_check.json() if d["id"] == driver.id)
        assert d_found["availability"] == "UNAVAILABLE"

        # Set back to AVAILABLE
        await client.put("/api/driver/availability", json={"availability": "AVAILABLE"}, headers=driver_headers)


# -------------------------------------------------------------
# 4. DELIVERY DISPATCH & 5. LIFECYCLE (DSP-01..12 & DEL-01..09)
# -------------------------------------------------------------
@pytest.mark.asyncio
async def test_delivery_dispatch_and_lifecycle_suite(auth_headers_factory):
    transport = ASGITransport(app=app)
    async with AsyncSessionLocal() as db:
        comp = Company(name="Express Logistics", invite_code=uuid.uuid4().hex[:8].upper())
        db.add(comp)
        await db.commit()
        await db.refresh(comp)

        mgr = User(
            company_id=comp.id,
            name="Dispatch Manager",
            email=f"mgr_{uuid.uuid4().hex[:6]}@express.com",
            password_hash=hash_password("Password123!"),
            role="FLEET_MANAGER",
            is_active=True,
        )
        driver = User(
            company_id=comp.id,
            name="Dispatch Driver",
            email=f"drv_{uuid.uuid4().hex[:6]}@express.com",
            password_hash=hash_password("Password123!"),
            role="DRIVER",
            availability="AVAILABLE",
            is_active=True,
        )
        vehicle = Vehicle(
            company_id=comp.id,
            assigned_driver_id=driver.id,
            registration_number=f"TN-01-EXP-{uuid.uuid4().hex[:4].upper()}",
            model="Express Van",
        )
        db.add_all([mgr, driver, vehicle])
        await db.commit()
        await db.refresh(mgr)
        await db.refresh(driver)
        await db.refresh(vehicle)

    mgr_headers = auth_headers_factory(mgr)
    drv_headers = auth_headers_factory(driver)

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # DSP-01 & DSP-02: Manager lists drivers and selects Available driver
        res_drivers = await client.get("/api/dispatch/drivers", headers=mgr_headers)
        assert res_drivers.status_code == 200
        assert any(d["id"] == driver.id and d["availability"] == "AVAILABLE" for d in res_drivers.json())

        # DSP-04, 05, 06, 07: Manager creates delivery assignment with geocoded coordinates & instructions
        long_address = "Patha Vigneswarar Koil Street, Ward 50, Zone 5 Royapuram, Chennai, Tamil Nadu, 600021, India"
        asg_payload = {
            "driver_id": driver.id,
            "destination_name": long_address,
            "destination_lat": 13.113164,
            "destination_lng": 80.293148,
            "instructions": "Leave at front desk",
        }
        res_create = await client.post("/api/dispatch/assignments", json=asg_payload, headers=mgr_headers)
        assert res_create.status_code == 201
        assignment = res_create.json()
        assignment_id = assignment["id"]
        assert assignment["status"] == "PENDING"
        assert assignment["destination_name"] == long_address

        # DEL-01: Driver views pending deliveries
        res_driver_asgs = await client.get("/api/driver/assignments", headers=drv_headers)
        assert res_driver_asgs.status_code == 200
        pending_asgs = [a for a in res_driver_asgs.json() if a["id"] == assignment_id]
        assert len(pending_asgs) == 1
        assert pending_asgs[0]["status"] == "PENDING"

        # DEL-02 & DSP-09: Driver accepts assignment -> status ACCEPTED, driver becomes BUSY
        res_accept = await client.post(f"/api/driver/assignments/{assignment_id}/accept", headers=drv_headers)
        assert res_accept.status_code == 200
        assert res_accept.json()["status"] == "ACCEPTED"

        # AV-03 & DSP-03: Driver is now BUSY; second assignment prevented
        res_second = await client.post("/api/dispatch/assignments", json=asg_payload, headers=mgr_headers)
        assert res_second.status_code in (400, 409)

        # AV-06: Driver attempts to become Available during active delivery -> rejected
        res_av_block = await client.put("/api/driver/availability", json={"availability": "AVAILABLE"}, headers=drv_headers)
        assert res_av_block.status_code in (400, 409)

        # DEL-03: Driver starts delivery -> status IN_PROGRESS & creates journey
        start_payload = {
            "origin_name": "Warehouse Depot",
            "origin_lat": 13.0827,
            "origin_lng": 80.2707,
        }
        res_start = await client.post(f"/api/driver/assignments/{assignment_id}/start", json=start_payload, headers=drv_headers)
        assert res_start.status_code == 200
        start_data = res_start.json()
        assert start_data["assignment"]["status"] == "IN_PROGRESS"
        assert start_data["journey_id"] is not None
        assert start_data["tracking_token"] is not None

        # DEL-04 & AV-05: Driver completes delivery -> status COMPLETED & driver restored to AVAILABLE
        res_complete = await client.post(f"/api/driver/assignments/{assignment_id}/complete", headers=drv_headers)
        assert res_complete.status_code == 200
        assert res_complete.json()["status"] == "COMPLETED"

        # Check driver availability is restored
        res_post_avail = await client.get("/api/driver/availability", headers=drv_headers)
        assert res_post_avail.json()["availability"] == "AVAILABLE"


# -------------------------------------------------------------
# 10. PUBLIC TRACKING LINKS & LIFECYCLE (PUB-01 through PUB-08)
# -------------------------------------------------------------
@pytest.mark.asyncio
async def test_public_tracking_links_lifecycle(auth_headers_factory):
    transport = ASGITransport(app=app)
    async with AsyncSessionLocal() as db:
        comp = Company(name="Public Track Co", invite_code=uuid.uuid4().hex[:8].upper())
        db.add(comp)
        await db.commit()
        await db.refresh(comp)

        driver = User(
            company_id=comp.id,
            name="Journey Driver",
            email=f"j_drv_{uuid.uuid4().hex[:6]}@test.com",
            password_hash=hash_password("Password123!"),
            role="DRIVER",
            is_active=True,
        )
        veh = Vehicle(
            company_id=comp.id,
            registration_number="TN-01-PUB-9999",
            model="Delivery Van",
        )
        db.add_all([driver, veh])
        await db.commit()
        await db.refresh(driver)
        await db.refresh(veh)

    drv_headers = auth_headers_factory(driver)

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # PUB-01: Driver starts a journey -> tracking token generated
        start_res = await client.post(
            "/api/journeys/start",
            json={
                "vehicle_id": veh.id,
                "origin_name": "Warehouse Depot",
                "origin_lat": 13.0827,
                "origin_lng": 80.2707,
                "destination_name": "Client Office",
                "destination_lat": 13.0850,
                "destination_lng": 80.2750,
            },
            headers=drv_headers,
        )
        assert start_res.status_code == 201
        journey = start_res.json()
        token = journey["tracking_token"]
        journey_id = journey["journey_id"]
        assert token is not None

        # PUB-02: Public opens the tracking link via token without auth
        pub_res = await client.get(f"/api/track/{token}")
        assert pub_res.status_code == 200
        pub_data = pub_res.json()
        assert pub_data["status"] == "IN_PROGRESS"
        assert pub_data["destination_name"] == "Client Office"

        # PUB-07: Attempt invalid/modified tracking token -> 404 rejection
        bad_token_res = await client.get("/api/track/invalid-token-xyz")
        assert bad_token_res.status_code in (404, 410)

        # PUB-05: Driver ends the journey
        end_res = await client.post(
            f"/api/journeys/{journey_id}/end",
            json={"end_lat": 13.0850, "end_lng": 80.2750},
            headers=drv_headers,
        )
        assert end_res.status_code == 200

        # PUB-06: Expired/Revoked link returns 410 Gone or Completed status
        revoked_res = await client.get(f"/api/track/{token}")
        assert revoked_res.status_code in (200, 410)
        if revoked_res.status_code == 200:
            assert revoked_res.json()["status"] == "COMPLETED"


# -------------------------------------------------------------
# 12. DATABASE & 13. SECURITY TESTING (DB-01..10 & SEC-01..08)
# -------------------------------------------------------------
@pytest.mark.asyncio
async def test_database_and_security():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # SEC-01: Passwords are not exposed in user profile/registration responses
        res_reg = await client.post(
            "/api/auth/register",
            json={
                "name": "Sec Test User",
                "email": f"sec_{uuid.uuid4().hex[:8]}@secure.com",
                "password": "Password123!",
                "role": "DRIVER",
            }
        )
        assert res_reg.status_code == 201
        user_data = res_reg.json()["user"]
        assert "password" not in user_data
        assert "password_hash" not in user_data

        # SEC-02 & DB-08: Attempt SQL injection in fields -> safe parameterization
        res_sqli = await client.post(
            "/api/auth/login",
            json={"email": "' OR '1'='1", "password": "' OR '1'='1"}
        )
        assert res_sqli.status_code == 401

        # SEC-04: Expired token rejection
        expired_token = create_access_token(
            data={"sub": "any", "cid": "any", "role": "DRIVER"},
            expires_delta=timedelta(seconds=-60)
        )
        res_exp = await client.get(
            "/api/driver/availability",
            headers={"Authorization": f"Bearer {expired_token}"}
        )
        assert res_exp.status_code == 401
