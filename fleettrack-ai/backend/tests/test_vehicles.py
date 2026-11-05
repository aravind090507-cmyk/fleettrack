import pytest
import uuid
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.vehicle import Vehicle


@pytest.mark.asyncio
async def test_admin_create_vehicle(client: AsyncClient, admin_token: str):
    payload = {
        "registration_number": "TN-01-XY-9999",
        "vehicle_type": "dump_truck",
        "status": "idle",
        "is_active": True,
    }
    resp = await client.post(
        "/api/v1/vehicles",
        json=payload,
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["registration_number"] == "TN-01-XY-9999"
    assert data["vehicle_type"] == "dump_truck"


@pytest.mark.asyncio
async def test_manager_cannot_create_vehicle(client: AsyncClient, manager_token: str):
    payload = {
        "registration_number": "TN-01-XY-8888",
        "vehicle_type": "excavator",
        "status": "idle",
    }
    resp = await client.post(
        "/api/v1/vehicles",
        json=payload,
        headers={"Authorization": f"Bearer {manager_token}"},
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_duplicate_registration_rejected(client: AsyncClient, admin_token: str):
    payload = {
        "registration_number": "TN-01-DUP-01",
        "vehicle_type": "loader",
    }
    resp1 = await client.post(
        "/api/v1/vehicles",
        json=payload,
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp1.status_code == 201

    resp2 = await client.post(
        "/api/v1/vehicles",
        json=payload,
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp2.status_code == 400


@pytest.mark.asyncio
async def test_role_based_vehicle_scoping(
    client: AsyncClient,
    db_session: AsyncSession,
    admin_token: str,
    manager_token: str,
    admin_user,
    manager_user,
):
    # Create two vehicles: one assigned to manager, one assigned to admin
    v1 = Vehicle(
        id=uuid.uuid4(),
        registration_number="TN-ADMIN-ONLY",
        vehicle_type="crane_truck",
        assigned_manager_id=admin_user.id,
        status="idle",
        is_active=True,
    )
    v2 = Vehicle(
        id=uuid.uuid4(),
        registration_number="TN-MANAGER-ASSIGNED",
        vehicle_type="concrete_mixer",
        assigned_manager_id=manager_user.id,
        status="moving",
        is_active=True,
    )
    db_session.add_all([v1, v2])
    await db_session.commit()

    # Admin should see both
    admin_res = await client.get(
        "/api/v1/vehicles",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert admin_res.status_code == 200
    admin_regs = [v["registration_number"] for v in admin_res.json()]
    assert "TN-ADMIN-ONLY" in admin_regs
    assert "TN-MANAGER-ASSIGNED" in admin_regs

    # Manager should ONLY see their assigned vehicle
    mgr_res = await client.get(
        "/api/v1/vehicles",
        headers={"Authorization": f"Bearer {manager_token}"},
    )
    assert mgr_res.status_code == 200
    mgr_regs = [v["registration_number"] for v in mgr_res.json()]
    assert "TN-MANAGER-ASSIGNED" in mgr_regs
    assert "TN-ADMIN-ONLY" not in mgr_regs
