"""Evidence probe: drives the REAL FleetTrack FastAPI app (in-memory SQLite) and records what
silently happens to GPS pings. Run with PYTHONPATH=backend."""
import os, asyncio, math, random, json
os.environ["DATABASE_URL"]="sqlite+aiosqlite:///:memory:"; os.environ["APP_ENVIRONMENT"]="test"
from datetime import datetime, timezone, timedelta
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.database.session import AsyncSessionLocal, init_db
from app.api.auth import seed_demo_users
from app.api.vehicles import seed_demo_vehicles

def iso(dt): return dt.isoformat()
def ping(lat,lng,ts,acc=8,spd=0): return dict(latitude=lat,longitude=lng,speed=spd,heading=0,accuracy=acc,timestamp=iso(ts))

async def main():
    await init_db()
    async with AsyncSessionLocal() as db:
        await seed_demo_users(db); await seed_demo_vehicles(db)
    out={}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        tok=(await c.post("/api/auth/login",json={"email":"driver1@fleetcorp.com","password":"Password123!"})).json()["access_token"]
        H={"Authorization":f"Bearer {tok}"}
        async def new_journey(reg):
            for a in (await c.get("/api/journeys/active",headers=H)).json():
                await c.post(f"/api/journeys/{a['id']}/end",headers=H)
            r=await c.post("/api/journeys/start",json=dict(vehicle_id="custom",vehicle_registration=reg,vehicle_model="V",vehicle_type="VAN",
              origin_name="A",origin_lat=12.9716,origin_lng=77.5946,destination_name="B",destination_lat=12.98,destination_lng=77.60),headers=H)
            
            if r.status_code!=201: print("START FAILED",r.status_code,r.text[:200])
            return r.json()["journey_id"]
        async def stored(j):
            r=await c.get(f"/api/journeys/{j}/location",headers=H); return len(r.json())
        now=datetime.now(timezone.utc)

        # 1. accuracy filter
        j=await new_journey("P-ACC"); r=await c.post(f"/api/journeys/{j}/location",json=ping(12.9717,77.5947,now,acc=130),headers=H)
        out["accuracy_130m"]=r.json()["status"]
        # 2. device clock 2 min ahead (common on phones w/o auto time)
        j=await new_journey("P-SKEW"); r=await c.post(f"/api/journeys/{j}/location",json=ping(12.9717,77.5947,now+timedelta(seconds=120)),headers=H)
        out["clock_ahead_120s"]=r.json()["status"]
        # 3. rapid pings (the frontend watch+poll+restart loop emits bursts)
        j=await new_journey("P-RATE"); res=[]
        for i in range(6):
            r=await c.post(f"/api/journeys/{j}/location",json=ping(12.9717+i*1e-5,77.5947,now+timedelta(seconds=i*0.2)),headers=H); res.append(r.json()["status"])
            await asyncio.sleep(0.2)
        out["burst_6_pings_0.2s_apart"]={"statuses":res,"rows_stored_incl_origin_seed":await stored(j)}
        # 4. offline batch > 500
        j=await new_journey("P-BIG")
        big=[ping(12.9717+i*1e-6,77.5947,now-timedelta(seconds=600-i)) for i in range(600)]
        r=await c.post(f"/api/journeys/{j}/location/batch",json={"pings":big},headers=H); out["batch_600"]=r.status_code
        # 5. batch with stale (>24h) points: processed==0 -> client never clears queue
        j=await new_journey("P-OLD")
        old=[ping(12.9717+i*1e-5,77.5947,now-timedelta(hours=30,seconds=-i)) for i in range(20)]
        r=await c.post(f"/api/journeys/{j}/location/batch",json={"pings":old},headers=H); out["batch_30h_old_20pts"]=r.json()
        # 6. batch to COMPLETED journey
        j=await new_journey("P-DONE"); await c.post(f"/api/journeys/{j}/end",headers=H)
        r=await c.post(f"/api/journeys/{j}/location/batch",json={"pings":[ping(12.9717,77.5947,now)]},headers=H)
        out["batch_after_end"]={"http":r.status_code,"body":r.json()}
        # 7. stationary jitter -> inflated distance (device sitting still, +-4m noise, 1 ping / 3s for 10 min)
        j=await new_journey("P-JIT"); random.seed(1)
        pts=[]
        for i in range(200):
            dlat=random.uniform(-4,4)/111_000; dlng=random.uniform(-4,4)/(111_000*math.cos(math.radians(12.97)))
            pts.append(ping(12.9716+dlat,77.5946+dlng,now-timedelta(seconds=600-i*3)))
        r=await c.post(f"/api/journeys/{j}/location/batch",json={"pings":pts},headers=H); out["jitter_saved"]=r.json()["pings_processed"]
        e=await c.post(f"/api/journeys/{j}/end",headers=H); jd=e.json()
        out["stationary_10min_reported_distance_km"]=jd.get("total_distance_km")
    print(json.dumps(out,indent=2))
asyncio.run(main())
