import asyncio
import logging
import uuid
from datetime import datetime, timedelta, timezone
from sqlalchemy import select

from app.core.security import get_password_hash, hash_device_token
from app.database.session import async_session_maker
from app.models.user import User
from app.models.project import Project
from app.models.gps_device import GPSDevice
from app.models.vehicle import Vehicle
from app.models.geofence import Geofence, GeofenceEvent
from app.models.location import VehicleLocation, VehicleLatestLocation
from app.models.vehicle_event import VehicleEvent
from app.models.notification import Notification

from app.database.session import Base, engine, async_session_maker

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("seed")


async def seed_database():
    logger.info("Starting database seeding...")

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with async_session_maker() as db:
        # 1. Check if admin already exists (Idempotent check)
        admin_res = await db.execute(select(User).where(User.email == "admin@fleettrack.ai"))
        if admin_res.scalar_one_or_none():
            logger.info("Database already seeded. Skipping initial seeding.")
            return

        # 2. Create Users
        admin_user = User(
            id=uuid.uuid4(),
            name="Fleet Administrator",
            email="admin@fleettrack.ai",
            password_hash=get_password_hash("FleetAdmin2026!"),
            role="admin",
            is_active=True,
        )
        manager_user = User(
            id=uuid.uuid4(),
            name="Karthik Raman (Manager)",
            email="manager@fleettrack.ai",
            password_hash=get_password_hash("FleetMgr2026!"),
            role="fleet_manager",
            is_active=True,
        )
        db.add_all([admin_user, manager_user])
        await db.flush()
        logger.info("Created Admin and Fleet Manager users.")

        # 3. Create Construction Projects
        projects = [
            Project(
                id=uuid.uuid4(),
                name="Metro Line 4 Corridor",
                description="Elevated metro corridor package covering Kathipara to Guindy section.",
                address="Kathipara Junction, Chennai, TN",
                latitude=13.0067,
                longitude=80.2025,
                status="active",
                start_date=datetime.now(timezone.utc).date() - timedelta(days=90),
                end_date=datetime.now(timezone.utc).date() + timedelta(days=270),
                assigned_manager_id=admin_user.id,
            ),
            Project(
                id=uuid.uuid4(),
                name="OMR IT Park Infrastructure Phase 2",
                description="Commercial high-rise foundation and access road infrastructure.",
                address="Perungudi OMR, Chennai, TN",
                latitude=12.9550,
                longitude=80.2480,
                status="active",
                start_date=datetime.now(timezone.utc).date() - timedelta(days=45),
                end_date=datetime.now(timezone.utc).date() + timedelta(days=180),
                assigned_manager_id=manager_user.id,
            ),
            Project(
                id=uuid.uuid4(),
                name="Outer Ring Road Bridge Widening",
                description="Expressway flyover and bridge expansion connecting Tambaram to Porur.",
                address="Porur Junction, Chennai, TN",
                latitude=13.0382,
                longitude=80.1565,
                status="planning",
                start_date=datetime.now(timezone.utc).date() - timedelta(days=15),
                end_date=datetime.now(timezone.utc).date() + timedelta(days=365),
                assigned_manager_id=manager_user.id,
            ),
        ]
        db.add_all(projects)
        await db.flush()
        logger.info("Created 3 construction projects.")

        # 4. Create GPS Devices & Vehicles
        vehicle_configs = [
            {
                "reg": "TN-01-AB-1234",
                "type": "dump_truck",
                "dev_id": "GPS-TRUCK-001",
                "manager": admin_user.id,
                "project": projects[0].id,
                "status": "moving",
                "lat": 13.0189,
                "lng": 80.2165,
                "speed": 42.5,
                "heading": 85.0,
            },
            {
                "reg": "TN-01-CD-5678",
                "type": "excavator",
                "dev_id": "GPS-EXCV-002",
                "manager": admin_user.id,
                "project": projects[0].id,
                "status": "idle",
                "lat": 12.9410,
                "lng": 80.1440,
                "speed": 0.0,
                "heading": 120.0,
            },
            {
                "reg": "TN-01-EF-9012",
                "type": "concrete_mixer",
                "dev_id": "GPS-MIXR-003",
                "manager": admin_user.id,
                "project": projects[0].id,
                "status": "moving",
                "lat": 13.0100,
                "lng": 80.1990,
                "speed": 31.0,
                "heading": 210.0,
            },
            {
                "reg": "TN-01-GH-3456",
                "type": "loader",
                "dev_id": "GPS-LOAD-004",
                "manager": manager_user.id,
                "project": projects[1].id,
                "status": "moving",
                "lat": 13.0920,
                "lng": 80.1880,
                "speed": 22.0,
                "heading": 140.0,
            },
            {
                "reg": "TN-01-IJ-7890",
                "type": "crane_truck",
                "dev_id": "GPS-CRAN-005",
                "manager": manager_user.id,
                "project": projects[1].id,
                "status": "idle",
                "lat": 12.9350,
                "lng": 80.2420,
                "speed": 0.0,
                "heading": 30.0,
            },
        ]

        now = datetime.now(timezone.utc)
        vehicles_created = []

        for vc in vehicle_configs:
            v_id = uuid.uuid4()
            d_id = uuid.uuid4()

            device = GPSDevice(
                id=d_id,
                device_identifier=vc["dev_id"],
                device_token_hash=hash_device_token(f"dev_token_{vc['dev_id']}"),
                device_type="cellular_obd2",
                vehicle_id=v_id,
                is_active=True,
                last_seen_at=now,
            )
            db.add(device)

            vehicle = Vehicle(
                id=v_id,
                registration_number=vc["reg"],
                vehicle_type=vc["type"],
                device_id=d_id,
                assigned_manager_id=vc["manager"],
                assigned_project_id=vc["project"],
                status=vc["status"],
                is_active=True,
            )
            db.add(vehicle)
            vehicles_created.append(vehicle)

            # Latest Location
            latest_loc = VehicleLatestLocation(
                vehicle_id=v_id,
                latitude=vc["lat"],
                longitude=vc["lng"],
                speed=vc["speed"],
                heading=vc["heading"],
                recorded_at=now,
                received_at=now,
                is_simulated=True,
            )
            db.add(latest_loc)

            # Historical locations (seed past 12 hours)
            for i in range(20, 0, -1):
                offset_lat = vc["lat"] - (i * 0.001)
                offset_lng = vc["lng"] - (i * 0.001)
                hist_loc = VehicleLocation(
                    id=uuid.uuid4(),
                    vehicle_id=v_id,
                    latitude=offset_lat,
                    longitude=offset_lng,
                    speed=max(0.0, vc["speed"] - (i % 5)),
                    heading=vc["heading"],
                    recorded_at=now - timedelta(minutes=i * 15),
                    received_at=now - timedelta(minutes=i * 15),
                    is_simulated=True,
                )
                db.add(hist_loc)

        await db.flush()
        logger.info("Created 5 vehicles, GPS devices, and initial location histories.")

        # 5. Create Geofences
        gf1 = Geofence(
            id=uuid.uuid4(),
            name="Kathipara Metro Site Zone",
            project_id=projects[0].id,
            geofence_type="circle",
            center_latitude=13.0067,
            center_longitude=80.2025,
            radius_meters=850.0,
            is_active=True,
        )
        gf2 = Geofence(
            id=uuid.uuid4(),
            name="Perungudi OMR Worksite Perimeter",
            project_id=projects[1].id,
            geofence_type="polygon",
            polygon_coordinates=[
                {"lat": 12.9510, "lng": 80.2440},
                {"lat": 12.9590, "lng": 80.2450},
                {"lat": 12.9580, "lng": 80.2520},
                {"lat": 12.9500, "lng": 80.2510},
            ],
            is_active=True,
        )
        db.add_all([gf1, gf2])
        await db.flush()

        # 6. Create Initial Geofence Events
        events = [
            GeofenceEvent(
                vehicle_id=vehicles_created[0].id,
                geofence_id=gf1.id,
                event_type="entered",
                latitude=13.0068,
                longitude=80.2024,
                occurred_at=now - timedelta(hours=2),
            ),
            GeofenceEvent(
                vehicle_id=vehicles_created[3].id,
                geofence_id=gf2.id,
                event_type="entered",
                latitude=12.9540,
                longitude=80.2470,
                occurred_at=now - timedelta(hours=1),
            ),
        ]
        db.add_all(events)

        # 7. Create Activity Log & Notifications
        notifications = [
            Notification(
                user_id=admin_user.id,
                vehicle_id=vehicles_created[0].id,
                event_type="geofence_entered",
                message=f"Vehicle {vehicles_created[0].registration_number} entered Kathipara Metro Site Zone",
                is_read=False,
                created_at=now - timedelta(hours=2),
            ),
            Notification(
                user_id=manager_user.id,
                vehicle_id=vehicles_created[3].id,
                event_type="geofence_entered",
                message=f"Vehicle {vehicles_created[3].registration_number} entered Perungudi OMR Worksite Perimeter",
                is_read=False,
                created_at=now - timedelta(hours=1),
            ),
            Notification(
                user_id=admin_user.id,
                vehicle_id=vehicles_created[1].id,
                event_type="idle_warning",
                message=f"Vehicle {vehicles_created[1].registration_number} has been idle for over 45 minutes",
                is_read=True,
                created_at=now - timedelta(minutes=45),
            ),
        ]
        db.add_all(notifications)

        # Vehicle activity events
        v_events = [
            VehicleEvent(
                vehicle_id=vehicles_created[0].id,
                event_type="shift_start",
                description=f"Shift started for {vehicles_created[0].registration_number}",
                event_metadata={"driver": "M. Suresh", "odometer_km": 14220},
                occurred_at=now - timedelta(hours=5),
            ),
            VehicleEvent(
                vehicle_id=vehicles_created[3].id,
                event_type="route_dispatch",
                description=f"Dispatched {vehicles_created[3].registration_number} to OMR Site",
                event_metadata={"cargo": "Aggregate gravel"},
                occurred_at=now - timedelta(hours=3),
            ),
        ]
        db.add_all(v_events)

        await db.commit()
        logger.info("Successfully seeded demo data for FleetTrack AI!")


if __name__ == "__main__":
    asyncio.run(seed_database())
