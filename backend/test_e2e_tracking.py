import asyncio
import httpx
import time

BASE = "http://127.0.0.1:8000"

async def test_full_pipeline():
    async with httpx.AsyncClient(base_url=BASE, timeout=10.0) as client:
        # 1. Health check
        r = await client.get("/health")
        print(f"1. Health: {r.status_code} - {r.json()}")

        # 2. Login as driver
        r = await client.post("/api/auth/login", json={"email": "driver1@fleetcorp.com", "password": "Password123!"})
        print(f"2. Login: {r.status_code}")
        if r.status_code != 200:
            print("Login failed:", r.text)
            return
        auth_data = r.json()
        token = auth_data["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        # 2b. End any prior active journey for this driver to ensure clean state
        active_res = await client.get("/api/journeys/active", headers=headers)
        if active_res.status_code == 200:
            for active_j in active_res.json():
                if active_j.get("driver_id") == auth_data["user"]["id"] or active_j.get("id"):
                    await client.post(f"/api/journeys/{active_j['id']}/end", headers=headers)
                    print(f"   Cleared previous active journey: {active_j['id']}")

        # 3. Start a journey
        start_payload = {
            "vehicle_registration": "TN-01-E2E-99",
            "vehicle_model": "Electric Van",
            "vehicle_type": "VAN",
            "origin_name": "Test Origin Depot",
            "origin_lat": 13.0207,
            "origin_lng": 80.1783,
            "destination_name": "Test Client Hub",
            "destination_lat": 13.0250,
            "destination_lng": 80.1850,
            "description": "E2E Live Tracking Pipeline Test"
        }
        r = await client.post("/api/journeys/start", json=start_payload, headers=headers)
        print(f"3. Start Journey: {r.status_code}")
        if r.status_code != 201:
            print("Start journey failed:", r.text)
            return
        journey_data = r.json()
        jid = journey_data["journey_id"]
        tracking_token = journey_data["tracking_token"]
        print(f"   Journey ID: {jid}")
        print(f"   Tracking Token: {tracking_token[:30]}...")

        # 4. Read Public Tracking Info
        r = await client.get(f"/api/track/{tracking_token}")
        print(f"4. Public Info: {r.status_code}")
        if r.status_code != 200:
            print("   Public info failed:", r.text)
        else:
            info = r.json()
            print(f"   Vehicle: {info.get('vehicle_registration')}, Driver: {info.get('driver_name')}, Status: {info.get('status')}, ETA: {info.get('eta_minutes')} min, Dist: {info.get('distance_remaining_km')} km")

        # 5. Ingest GPS Pings
        ping_coords = [
            (13.0210, 80.1790, 25.0, 45.0),
            (13.0215, 80.1800, 30.0, 48.0),
            (13.0220, 80.1810, 35.0, 50.0)
        ]
        for idx, (lat, lng, spd, hdg) in enumerate(ping_coords, 1):
            ping_payload = {
                "latitude": lat,
                "longitude": lng,
                "speed": spd,
                "heading": hdg,
                "accuracy": 5.0,
                "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            }
            # Test ingestion
            r = await client.post(f"/api/journeys/{jid}/location", json=ping_payload, headers=headers)
            print(f"5.{idx} Ping {lat},{lng}: {r.status_code}")
            if r.status_code not in (200, 201):
                print(f"   Ping error: {r.status_code} - {r.text}")
            await asyncio.sleep(0.8)  # satisfy rate limiter

        # 6. Read Public Tracking Location (Poll endpoint)
        r = await client.get(f"/api/track/{tracking_token}/location")
        print(f"6. Public Poll Location: {r.status_code}")
        if r.status_code == 200:
            loc_data = r.json()
            latest = loc_data.get("latest_location") or {}
            print(f"   Latest Loc: {latest.get('latitude')}, {latest.get('longitude')}, Speed: {latest.get('speed')} km/h")
        else:
            print(f"   Poll location error: {r.status_code} - {r.text}")

        # 7. Read Public Trail
        r = await client.get(f"/api/track/{tracking_token}/trail")
        print(f"7. Public Trail: {r.status_code}")
        if r.status_code == 200:
            trail = r.json()
            print(f"   Trail points count: {len(trail)}")
        else:
            print(f"   Trail error: {r.status_code} - {r.text}")

        # 8. Record Trip Event (Break)
        r = await client.post(
            f"/api/journeys/{jid}/event",
            json={"event_type": "BREAK", "latitude": 13.0220, "longitude": 80.1810, "metadata": {"note": "15m tea break"}},
            headers=headers
        )
        print(f"8. Post Break Event: {r.status_code}")

        # Verify tracking link shows break
        r = await client.get(f"/api/track/{tracking_token}")
        if r.status_code == 200:
            info = r.json()
            print(f"   Tracking Event Status: {info.get('latest_event_type')} - {info.get('latest_event_note')}")

        # 9. End Journey
        r = await client.post(f"/api/journeys/{jid}/end", headers=headers)
        print(f"9. End Journey: {r.status_code}")

        # 10. Verify Tracking Link returns 410 Gone immediately
        r = await client.get(f"/api/track/{tracking_token}")
        print(f"10. Verify 410 Gone: {r.status_code} (expected 410)")

        # 11. Verify Bug 4 fix: Unknown journey IDs return 404 (never create ghost journeys)
        bad_jid = "non-existent-journey-uuid-999"
        ping_fake = {
            "latitude": 13.022,
            "longitude": 80.181,
            "speed": 20.0,
            "heading": 90.0,
            "accuracy": 5.0,
            "timestamp": "2026-11-06T12:00:00Z"
        }
        r = await client.post(f"/api/journeys/{bad_jid}/location", json=ping_fake, headers=headers)
        print(f"11. Verify Unknown Journey Location Ping: {r.status_code} (expected 404)")
        assert r.status_code == 404, f"Expected 404 but got {r.status_code}"

if __name__ == "__main__":
    asyncio.run(test_full_pipeline())
