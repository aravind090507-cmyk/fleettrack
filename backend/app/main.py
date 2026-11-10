"""
FastAPI Application Entry Point.
Asynchronous ASGI server for corporate fleet tracking and geospatial navigation.
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.auth import router as auth_router, seed_demo_users
from app.api.dashboard import router as dashboard_router
from app.api.journeys import router as journeys_router
from app.api.location import router as location_router, search_router
from app.api.tracking import router as tracking_router
from app.api.vehicles import router as vehicles_router, seed_demo_vehicles
from app.api.websocket_routes import router as ws_router
from app.api.osmand import router as osmand_router
from app.api.devices import router as devices_router
from app.api.positions import router as positions_router
from app.api.events import router as events_router
from app.api.geofences import router as geofences_router
from app.api.reports import router as reports_router
from app.pipeline.status_sweeper import DeviceStatusSweeper
from app.config.settings import get_settings
from app.database.session import AsyncSessionLocal, init_db
from app.services.redis_service import get_redis_service

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("fleettrack.main")
settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifecycle manager for database initialization, demo seeding, and Redis connections."""
    logger.info("Initializing Corporate Fleet Tracking Engine...")

    # 1. Initialize relational & spatial database tables
    try:
        await init_db()
        logger.info("Database schemas verified and initialized.")
    except Exception as e:
        logger.error("Database schema init error: %s", e)
        if settings.APP_ENVIRONMENT == "production":
            raise RuntimeError(f"Database connectivity failed during production startup: {e}")

    # 2. Seed initial demo credentials and vehicles
    try:
        async with AsyncSessionLocal() as db:
            await seed_demo_users(db)
            await seed_demo_vehicles(db)
    except Exception as e:
        logger.error("Demo seeding error: %s", e)

    # 3. Connect to Redis (or fallback to in-memory)
    redis_svc = get_redis_service()
    await redis_svc.initialize()

    # 4. Start background device status sweeper and WebSocket pub/sub subscriber
    sweeper = DeviceStatusSweeper(timeout_seconds=120, check_interval_seconds=30)
    sweeper.start()
    from app.websocket.manager import get_ws_manager
    ws_mgr = get_ws_manager()
    await ws_mgr.start_subscriber(redis_svc)

    logger.info("Fleet Tracking Engine startup complete.")
    yield

    # Clean shutdown
    logger.info("Shutting down Fleet Tracking Engine...")
    ws_mgr.stop_subscriber()
    sweeper.stop()
    await redis_svc.close()
    from app.database.session import engine
    await engine.dispose()
    logger.info("Shutdown finalized.")


app = FastAPI(
    title="Corporate Fleet Tracking & Geospatial Navigation Platform",
    description="Enterprise real-time GPS telemetry, ephemeral tracking link engine, and geospatial fleet operations.",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
)

# Configure Cross-Origin Resource Sharing (CORS)
cors_origins = settings.CORS_ORIGINS
if "*" in cors_origins or settings.APP_ENVIRONMENT != "production":
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=r"^https?://.*",
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
else:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins,
        allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1|.*\.vercel\.app|.*\.railway\.app)(:\d+)?$",
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

# Mount REST API Routers
app.include_router(auth_router)
app.include_router(vehicles_router)
app.include_router(journeys_router)
app.include_router(location_router)
app.include_router(search_router)
app.include_router(tracking_router)
app.include_router(dashboard_router)
app.include_router(ws_router)
app.include_router(osmand_router)
app.include_router(devices_router)
app.include_router(positions_router)
app.include_router(events_router)
app.include_router(geofences_router)
app.include_router(reports_router)


@app.get("/health", tags=["Health"])
async def health_check():
    """System heartbeat and database readiness probe."""
    db_status = "connected"
    try:
        from sqlalchemy import text
        from app.database.session import AsyncSessionLocal
        async with AsyncSessionLocal() as session:
            await session.execute(text("SELECT 1"))
    except Exception as e:
        logger.warning("Database health probe check warning: %s", e)
        db_status = "disconnected"

    redis_svc = get_redis_service()
    redis_status = "connected" if redis_svc.is_connected else "in-memory"

    is_healthy = db_status == "connected"
    return JSONResponse(
        status_code=status.HTTP_200_OK if is_healthy else status.HTTP_503_SERVICE_UNAVAILABLE,
        content={
            "status": "healthy" if is_healthy else "degraded",
            "database": db_status,
            "redis": redis_status,
        },
    )


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error("Unhandled exception on %s %s: %s", request.method, request.url.path, exc, exc_info=True)
    req_origin = request.headers.get("origin") or "*"
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": f"Operational error: {str(exc)}"},
        headers={
            "Access-Control-Allow-Origin": req_origin,
            "Access-Control-Allow-Credentials": "true",
            "Access-Control-Allow-Methods": "*",
            "Access-Control-Allow-Headers": "*",
        },
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
