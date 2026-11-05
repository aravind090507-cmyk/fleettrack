@echo off
echo Seeding FleetTrack AI Demo Fleet Data...
cd /d "%~dp0backend"
python seed.py
pause
