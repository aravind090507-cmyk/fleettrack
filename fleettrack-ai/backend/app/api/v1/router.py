from fastapi import APIRouter

from app.api.v1 import auth, users, vehicles, locations, projects, geofences, analytics, notifications, ai_routes, simulator_routes

api_router = APIRouter()

api_router.include_router(auth.router, prefix="/auth", tags=["Authentication"])
api_router.include_router(users.router, prefix="/users", tags=["Users"])
api_router.include_router(vehicles.router, prefix="/vehicles", tags=["Vehicles"])
api_router.include_router(locations.router, prefix="/locations", tags=["Locations"])
api_router.include_router(projects.router, prefix="/projects", tags=["Projects"])
api_router.include_router(geofences.router, prefix="/geofences", tags=["Geofences"])
api_router.include_router(analytics.router, prefix="/analytics", tags=["Analytics"])
api_router.include_router(notifications.router, prefix="/notifications", tags=["Notifications"])
api_router.include_router(ai_routes.router, prefix="/ai", tags=["AI"])
api_router.include_router(simulator_routes.router, prefix="/simulator", tags=["Simulator"])
