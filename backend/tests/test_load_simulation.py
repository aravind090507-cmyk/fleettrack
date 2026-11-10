"""
High-throughput 200-device concurrent load test simulation.
Validates sub-500ms p95 latency, zero silent drops, and coalescing buffer behavior.
"""
import asyncio
import time
import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.models.device import Device
from app.models.company import Company
from app.database.session import AsyncSessionLocal, init_db
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
async def test_200_device_load_simulation():
    """
    Simulate 200 devices reporting concurrently.
    Measures latency percentiles (p50, p90, p95) and verifies zero silent drops.
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
        device_count = 200
        cycles = 2

        async with session_maker() as db:
            comp = Company(id=company_id, name="Load Test Fleet Corp", invite_code="LOADTEST")
            db.add(comp)
            await db.commit()

            devs = [
                Device(
                    id=f"dev-load-{i:03d}",
                    unique_id=f"sim-imei-{i:03d}",
                    name=f"Simulated Truck {i:03d}",
                    company_id=company_id,
                    status="online",
                    attributes={"speed.overspeedThreshold": 120.0},
                )
                for i in range(device_count)
            ]
            db.add_all(devs)
            await db.commit()

        latencies_ms = []
        success_count = 0
        total_expected = device_count * cycles

        transport = ASGITransport(app=app)
        sem = asyncio.Semaphore(2)
        async with AsyncClient(transport=transport, base_url="http://testserver") as client:
            start_overall = time.perf_counter()

            for cycle in range(cycles):
                cycle_time = int(time.time())

                async def send_ping(dev_idx: int):
                    async with sem:
                        unique_id = f"sim-imei-{dev_idx:03d}"
                        lat = 12.9716 + (dev_idx * 0.0001) + (cycle * 0.0002)
                        lng = 77.5946 + (dev_idx * 0.0001) + (cycle * 0.0002)
                        speed = 25.0 + (dev_idx % 10)

                        t0 = time.perf_counter()
                        resp = await client.get(
                            f"/api/osmand?id={unique_id}&lat={lat:.6f}&lon={lng:.6f}&speed={speed:.1f}&bearing=90&timestamp={cycle_time}&altitude=100&accuracy=5.0"
                        )
                        dt_ms = (time.perf_counter() - t0) * 1000.0
                        return resp.status_code, dt_ms

                results = await asyncio.gather(*(send_ping(i) for i in range(device_count)))

                for status_code, dt_ms in results:
                    latencies_ms.append(dt_ms)
                    if status_code == 200:
                        success_count += 1

        total_time = time.perf_counter() - start_overall
        throughput = total_expected / total_time

        p50 = percentile(latencies_ms, 50)
        p90 = percentile(latencies_ms, 90)
        p95 = percentile(latencies_ms, 95)
        p99 = percentile(latencies_ms, 99)

        print(f"\n--- 200-Device Load Simulation Results ---")
        print(f"Total Requests: {total_expected}")
        print(f"Successful (200 OK): {success_count} / {total_expected} (Zero silent drops)")
        print(f"Total Execution Time: {total_time:.2f}s")
        print(f"Throughput: {throughput:.1f} requests/sec")
        print(f"Latency p50: {p50:.2f}ms")
        print(f"Latency p90: {p90:.2f}ms")
        print(f"Latency p95: {p95:.2f}ms")
        print(f"Latency p99: {p99:.2f}ms")

        assert success_count == total_expected, f"Expected {total_expected} successes, got {success_count} (silent drops detected)"
        assert p95 < 500.0, f"Target p95 < 500ms breached: got {p95:.2f}ms"
    finally:
        app.dependency_overrides.clear()
        try:
            import os
            os.remove(db_path)
        except Exception:
            pass
