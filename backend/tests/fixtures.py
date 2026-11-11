"""Test fixtures for backend test suite. Never loaded at runtime."""

import uuid
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.company import Company
from app.models.user import User
from app.models.vehicle import Vehicle
from app.security.passwords import hash_password


async def seed_demo_users(db: AsyncSession):
    """Seed test multi-tenant companies and users."""
    c1_stmt = select(Company).where(Company.name == "FleetCorp Logistics")
    c1_res = await db.execute(c1_stmt)
    c1 = c1_res.scalar_one_or_none()
    if not c1:
        c1 = Company(
            id=str(uuid.uuid4()),
            name="FleetCorp Logistics",
            invite_code="FLEETCORP-2026",
        )
        db.add(c1)
        await db.flush()

    c2_stmt = select(Company).where(Company.name == "Apex Freight Global")
    c2_res = await db.execute(c2_stmt)
    c2 = c2_res.scalar_one_or_none()
    if not c2:
        c2 = Company(
            id=str(uuid.uuid4()),
            name="Apex Freight Global",
            invite_code="APEX-2026",
        )
        db.add(c2)
        await db.flush()

    demo_accounts = [
        ("driver1@fleetcorp.com", "Password123!", "DRIVER", "Alex Rivera (Driver)", c1.id),
        ("driver2@fleetcorp.com", "Password123!", "DRIVER", "Priya Sharma (Driver)", c1.id),
        ("manager@fleetcorp.com", "Password123!", "FLEET_MANAGER", "Operations Fleet Manager", c1.id),
        ("admin@fleetcorp.com", "Password123!", "ADMIN", "Enterprise System Admin", c1.id),
        ("driver@apex.com", "Password123!", "DRIVER", "Carlos Ortiz (Apex Driver)", c2.id),
        ("manager@apex.com", "Password123!", "FLEET_MANAGER", "Apex Fleet Manager", c2.id),
    ]

    for email, pwd, role, name, comp_id in demo_accounts:
        stmt = select(User).where(User.email == email)
        res = await db.execute(stmt)
        existing = res.scalar_one_or_none()
        if not existing:
            u = User(
                company_id=comp_id,
                email=email,
                name=name,
                password_hash=hash_password(pwd),
                role=role,
                is_active=True,
            )
            db.add(u)
        else:
            existing.company_id = comp_id
            existing.password_hash = hash_password(pwd)
            existing.is_active = True
    await db.commit()


async def seed_demo_vehicles(db: AsyncSession):
    """Seed test company vehicle assets."""
    c1_stmt = select(Company).where(Company.name == "FleetCorp Logistics")
    c1_res = await db.execute(c1_stmt)
    c1 = c1_res.scalar_one_or_none()

    c2_stmt = select(Company).where(Company.name == "Apex Freight Global")
    c2_res = await db.execute(c2_stmt)
    c2 = c2_res.scalar_one_or_none()

    c1_id = c1.id if c1 else None
    c2_id = c2.id if c2 else None

    demo_vehicles = [
        ("KA-01-AB-1234", "Mercedes-Benz Sprinter 3500", "VAN", c1_id),
        ("MH-02-CD-5678", "Tata Ace Gold Logistics", "TRUCK", c1_id),
        ("TN-03-EF-9012", "Toyota Probox Delivery Wagon", "VAN", c1_id),
        ("DL-04-GH-3456", "Mahindra Bolero Maxi Truck", "TRUCK", c1_id),
        ("SAMPLE P1", "Royal Enfield Hunter 350", "MOTORCYCLE", c1_id),
        ("APEX-TRUCK-01", "Volvo FH16 Long Haul", "TRUCK", c2_id),
        ("APEX-VAN-02", "Ford Transit Cargo Custom", "VAN", c2_id),
    ]

    for reg, model, v_type, comp_id in demo_vehicles:
        stmt = select(Vehicle).where(Vehicle.registration_number == reg)
        res = await db.execute(stmt)
        existing = res.scalar_one_or_none()
        if not existing:
            v = Vehicle(
                company_id=comp_id,
                registration_number=reg,
                model=model,
                vehicle_type=v_type,
                status="AVAILABLE",
                battery_or_fuel_level=100.0,
            )
            db.add(v)
        else:
            existing.company_id = comp_id
    await db.commit()
