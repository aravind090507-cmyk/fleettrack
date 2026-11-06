import os, sys, httpx
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from app.security.passwords import hash_password

url = 'https://ep-bitter-lab-b3e0gxdc.c-4.ap-southeast-1.aws.neon.tech/sql'
headers = {
    'Neon-Connection-String': 'postgresql://neondb_owner:npg_4nKFo9kLDHrX@ep-bitter-lab-b3e0gxdc.c-4.ap-southeast-1.aws.neon.tech/neondb?sslmode=require'
}

pw_hash = hash_password('Password123!')

queries = [
    "INSERT INTO companies (id, name, invite_code) VALUES ('comp-1', 'FleetCorp Logistics', 'FLEETCORP-2026') ON CONFLICT (id) DO NOTHING;",
    "INSERT INTO companies (id, name, invite_code) VALUES ('comp-2', 'Apex Global Transit', 'APEX-2026') ON CONFLICT (id) DO NOTHING;",
    f"INSERT INTO users (id, company_id, email, password_hash, name, role, is_active, created_at, updated_at) VALUES ('u-mgr-1', 'comp-1', 'manager@fleetcorp.com', '{pw_hash}', 'Fleet Director', 'FLEET_MANAGER', true, NOW(), NOW()) ON CONFLICT (id) DO NOTHING;",
    f"INSERT INTO users (id, company_id, email, password_hash, name, role, is_active, created_at, updated_at) VALUES ('u-drv-1', 'comp-1', 'driver1@fleetcorp.com', '{pw_hash}', 'Dave Driver', 'DRIVER', true, NOW(), NOW()) ON CONFLICT (id) DO NOTHING;",
    f"INSERT INTO users (id, company_id, email, password_hash, name, role, is_active, created_at, updated_at) VALUES ('u-drv-2', 'comp-2', 'driver@apex.com', '{pw_hash}', 'Apex Driver', 'DRIVER', true, NOW(), NOW()) ON CONFLICT (id) DO NOTHING;",
    "INSERT INTO vehicles (id, company_id, registration_number, model, vehicle_type, status) VALUES ('veh-1', 'comp-1', 'TN-01-AB-1234', 'Ford Transit', 'VAN', 'AVAILABLE') ON CONFLICT (id) DO NOTHING;",
    "INSERT INTO vehicles (id, company_id, registration_number, model, vehicle_type, status) VALUES ('veh-2', 'comp-1', 'KA-05-CD-5678', 'Freightliner Cascadia', 'TRUCK', 'AVAILABLE') ON CONFLICT (id) DO NOTHING;",
]

for q in queries:
    r = httpx.post(url, headers=headers, json={'query': q})
    print(f"Executed: {r.status_code} - {r.text[:60]}")

print("Neon seeding completed successfully!")
