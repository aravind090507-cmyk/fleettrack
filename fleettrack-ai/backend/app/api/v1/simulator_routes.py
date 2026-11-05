from fastapi import APIRouter, Depends
from app.core.dependencies import require_admin
from app.models.user import User
from app.simulator.simulator import fleet_simulator

router = APIRouter()


@router.post("/start")
async def start_simulator(current_user: User = Depends(require_admin)):
    fleet_simulator.paused = False
    fleet_simulator.running = True
    return {"status": "started", "message": "GPS simulator is running"}


@router.post("/pause")
async def pause_simulator(current_user: User = Depends(require_admin)):
    fleet_simulator.paused = True
    return {"status": "paused", "message": "GPS simulator paused"}


@router.post("/resume")
async def resume_simulator(current_user: User = Depends(require_admin)):
    fleet_simulator.paused = False
    return {"status": "running", "message": "GPS simulator resumed"}


@router.post("/stop")
async def stop_simulator(current_user: User = Depends(require_admin)):
    fleet_simulator.stop()
    return {"status": "stopped", "message": "GPS simulator stopped"}


@router.get("/status")
async def simulator_status(current_user: User = Depends(require_admin)):
    return {
        "running": fleet_simulator.running,
        "paused": fleet_simulator.paused,
        "vehicle_count": len(fleet_simulator.vehicles),
        "update_interval_seconds": fleet_simulator.interval,
    }
