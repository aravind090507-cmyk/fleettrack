import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.core.config import settings
from app.api.v1.router import api_router
from app.websocket.handlers import ws_router

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan: startup and shutdown."""
    logger.info("FleetTrack AI backend starting up...")

    # Ensure tables exist (works out-of-the-box on SQLite or PostgreSQL)
    from app.database.session import Base, engine
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
    except Exception as db_err:
        logger.warning(f"Database schema auto-sync note: {db_err}")

    # Start GPS simulator as background task
    from app.simulator.simulator import fleet_simulator
    simulator_task = asyncio.create_task(fleet_simulator.run())
    logger.info("GPS simulator started as background task")

    yield

    # Shutdown
    logger.info("Shutting down FleetTrack AI...")
    fleet_simulator.stop()
    simulator_task.cancel()
    try:
        await simulator_task
    except asyncio.CancelledError:
        pass
    logger.info("GPS simulator stopped")


app = FastAPI(
    title="FleetTrack AI API",
    description="Real-time fleet management platform for construction companies",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

# CORS - Allow configured origins and any local dev port (e.g. 5173, 5174, etc.)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API routes
app.include_router(api_router, prefix="/api/v1")

# WebSocket routes
app.include_router(ws_router)


@app.get("/health")
async def health_check():
    return {"status": "healthy", "service": "FleetTrack AI", "version": "1.0.0"}


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Unhandled error: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"detail": "An internal server error occurred"},
    )
