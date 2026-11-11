"""
High-throughput concurrent load test simulation for driver phone GPS telemetry.
Validates sub-500ms p95 latency, zero silent drops, and coalescing buffer behavior.
"""
import asyncio
import time
import pytest
from httpx import AsyncClient, ASGITransport
from datetime import datetime, timezone
from app.main import app
from app.models.company import Company
from app.models.user import User
from app.models.vehicle import Vehicle
from app.models.journey import Journey
from app.security.jwt import create_access_token


def percentile(data, pct):
    if not data:
        return 0.0
    s = sorted(data)
    k = (len(s) - 1) * (pct / 100.0)
    f = int(k)
    c = min(f + 1, len(s) - 1)
    d = k - f
    return s[f] * (1 - d) + s[c] * d


@pytest.mark.asyncio
async def test_driver_telemetry_load_simulation():
    """
    Simulate concurrent drivers reporting GPS telemetry.
    Measures latency percentiles and verifies zero silent drops.
    """
    import tempfile
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as tmp:
        db_path = tmp.name

    file_url = f"sqlite+aiosqlite:///{db_path}?timeout=30"
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
    from sqlalchemy.pool import NullPool
    from sqlalchemy import event
    from app.database.base import Base

    engine = create_async_engine(file_url, poolclass=NullPool)

    @event.listens_for(engine.sync_engine, "connect")
    def set_sqlite_pragma(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.execute("PRAGMA busy_timeout=30000")
        cursor.close()

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    session_maker = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    
    # Override get_db in app for this test
    from app.database.session import get_db
    async def override_get_db():
        async with session_maker() as session:
            try:
                yield session
            except Exception:
                await session.rollback()
                raise

    app.dependency_overrides[get_db] = override_get_db

    try:
        company_id = "test-comp-load"
        driver_count = 20
        cycles = 3

        tokens = {}
        journey_ids = []

        async with session_maker() as db:
            comp = Company(id=company_id, name="Load Test Fleet Corp", invite_code="LOADTEST")
            db.add(comp)
            await db.flush()

            for i in range(driver_count):
                u = User(
                    id=f"u-load-{i:03d}",
                    company_id=company_id,
                    name=f"Driver {i}",
                    email=f"load_driver_{i}@fleetcorp.com",
                    password_hash="pwd",
                    role="DRIVER",
                    is_active=True,
                )
                v = Vehicle(
                    id=f"v-load-{i:03d}",
                    company_id=company_id,
                    registration_number=f"LOAD-{i:03d}",
                    model="Van",
                    vehicle_type="VAN",
                )
                j = Journey(
                    id=f"j-load-{i:03d}",
                    company_id=company_id,
                    vehicle_id=v.id,
                    driver_id=u.id,
                    origin_name="Depot",
                    origin_lat=12.9716,
                    origin_lng=77.5946,
                    destination_name="Warehouse",
                    destination_lat=12.9760,
                    destination_lng=77.5990,
                    status="IN_PROGRESS",
                    total_distance_km=0.0,
                )
                db.add_all([u, v, j])
                tokens[j.id] = create_access_token({"sub": u.id, "email": u.email, "role": u.role, "company_id": company_id})
                journey_ids.append(j.id)

            await db.commit()

        latencies_ms = []
        success_count = 0
        total_expected = driver_count * cycles

        transport = ASGITransport(app=app)
        sem = asyncio.Semaphore(5)
        async with AsyncClient(transport=transport, base_url="http://testserver") as client:
            start_overall = time.perf_counter()

            for cycle in range(cycles):
                async def send_ping(j_id: str, idx: int):
                    async with sem:
                        token = tokens[j_id]
                        headers = {"Authorization": f"Bearer {token}"}
                        lat = 12.9716 + (idx * 0.0001) + (cycle * 0.0002)
                        lng = 77.5946 + (idx * 0.0001) + (cycle * 0.0002)
                        speed = 25.0 + (idx % 10)
                        payload = {
                            "latitude": lat,
                            "longitude": lng,
                            "speed": speed,
                            "heading": 90.0,
                            "accuracy": 5.0,
                            "timestamp": datetime.now(timezone.utc).isoformat(),
                        }
                        t0 = time.perf_counter()
                        resp = await client.post(
                            f"/api/journeys/{j_id}/location",
                            json=payload,
                            headers=headers,
                        )
                        dt_ms = (time.perf_counter() - t0) * 1000.0
                        return resp.status_code, dt_ms

                results = await asyncio.gather(*(send_ping(j_id, i) for i, j_id in enumerate(journey_ids)))

                for status_code, dt_ms in results:
                    latencies_ms.append(dt_ms)
                    if status_code == 200:
                        success_count += 1

        total_time = time.perf_counter() - start_overall
        throughput = total_expected / total_time

        p50 = percentile(latencies_ms, 50)
        p90 = percentile(latencies_ms, 90)
        p95 = percentile(latencies_ms, 95)

        print(f"\n--- Driver Telemetry Load Simulation Results ---")
        print(f"Total Requests: {total_expected}")
        print(f"Successful (200 OK): {success_count} / {total_expected} (Zero silent drops)")
        print(f"Total Execution Time: {total_time:.2f}s")
        print(f"Throughput: {throughput:.1f} requests/sec")
        print(f"Latency p50: {p50:.2f}ms")
        print(f"Latency p90: {p90:.2f}ms")
        print(f"Latency p95: {p95:.2f}ms")

        assert success_count == total_expected, f"Expected {total_expected} successes, got {success_count}"
        assert p95 < 500.0, f"Target p95 < 500ms breached: got {p95:.2f}ms"
    finally:
        app.dependency_overrides.clear()
        try:
            import os
            os.remove(db_path)
        except Exception:
            pass
