@echo off
echo ========================================================
echo         Launching FleetTrack AI (Local Mode)
echo ========================================================
echo 1. Seeding database...
cd /d "%~dp0backend"
python seed.py

echo 2. Launching FastAPI Backend on http://localhost:8000 ...
start "FleetTrack Backend" cmd /k "cd /d %~dp0backend && python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload"

echo 3. Launching Vite Frontend on http://localhost:5173 ...
start "FleetTrack Frontend" cmd /k "cd /d %~dp0frontend && npm run dev"

echo.
echo ========================================================
echo  FleetTrack AI is running!
echo  Frontend: http://localhost:5173
echo  API Docs: http://localhost:8000/docs
echo.
echo  Demo Accounts:
echo  - Admin:   admin@fleettrack.ai   / FleetAdmin2026!
echo  - Manager: manager@fleettrack.ai / FleetMgr2026!
echo ========================================================
pause
