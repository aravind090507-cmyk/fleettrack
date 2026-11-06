# 🛰️ FleetTrack Pro — Corporate Fleet Tracking & Geospatial Navigation Platform

An enterprise-grade, real-time fleet telematics, geospatial navigation, and ephemeral tracking platform designed for logistics fleets, dispatch operations, and micro-distance trip tracking (tested down to 5–10m indoor walks).

🔗 **GitHub Repository**: [https://github.com/aravind090507-cmyk/fleettrack](https://github.com/aravind090507-cmyk/fleettrack)

---

## 🚀 Key Features

### 1. 📱 Driver Mobile App
- **Live GPS Telemetry**: High-frequency real-time coordinate streaming (`navigator.geolocation.watchPosition` + 2.5s continuous active polling).
- **Micro-Distance Tested**: Specifically tuned spatial noise filtering to track short-distance trips (e.g. 10-meter office walks).
- **Pin Placement Method Dropdown**:
  - **📍 Mode 1: Interactive Map Tap**: Tap "Tap Start Pin" (green), "Tap Goal Pin" (red), or "🎯 Use My Exact GPS for Start".
  - **🔍 Mode 2: Search Location by Name**: Search places and addresses powered by OpenStreetMap Nominatim with smooth fly-to animations.
  - **🔢 Mode 3: Manual GPS Coordinates**: Enter exact latitude and longitude values directly.
- **Offline Buffering**: Automatic fallback to **IndexedDB** on network loss; auto-syncs chronological breadcrumbs upon reconnection.
- **Trip Controls & Safety**: Start trip, pause/resume, report breakdown, and a 3-second hold-to-activate Emergency SOS alert.

### 2. 🔐 Ephemeral Tracking Link Engine (`/track/:token`)
- **256-Bit Cryptographic Security**: Generates unguessable URL-safe tokens (`secrets.token_urlsafe(32)`).
- **Zero Link Leakage**: Only **SHA-256 hashes** are persisted in the database; active tokens cached in Redis with strict TTL.
- **Instant Revocation (`HTTP 410 Gone`)**: When the driver concludes a journey, the tracking token is permanently revoked, Redis keys evicted, WebSockets closed with code `4410`, and the link becomes permanently expired.

### 3. 🖥️ Company Management Dashboard (`/company`)
- **Interactive Live Fleet Map**: Vector canvas powered by **Leaflet + OpenStreetMap** (zero Google Maps API quotas or fees).
- **Heading-Rotated Vehicle Markers**: Dynamic SVG vehicle markers rotate matching real-time heading with radar pulse halos.
- **Transit Selection & Path History**:
  - Click on any active transit or historical trip to view the complete route on the map.
  - Renders 🟢 **Start Pin**, 🔴 **Goal Pin**, and a glowing **Emerald Polyline** of all recorded GPS breadcrumbs.
  - Floating **Transit HUD** displays real-time speed, distance, odometer, and telemetry ping count.
- **Auto-Syncing KPI Metrics**: 6 cards auto-refreshing every 2.5 seconds (Total Assets, In-Transit, Active Trips, Completed, Offline, SOS Alerts).

---

## 🔑 Demo Multi-Tenant Credentials

The platform auto-seeds demonstration accounts across two completely isolated organizations for multi-tenant verification:

### Organization 1: FleetCorp Logistics (`FLEETCORP-2026`)
| Role | Email | Password | Access Portal |
| :--- | :--- | :--- | :--- |
| **Driver 1** | `driver1@fleetcorp.com` | `Password123!` | Driver Mobile App (`/driver`) |
| **Driver 2** | `driver2@fleetcorp.com` | `Password123!` | Driver Mobile App (`/driver`) |
| **Fleet Manager**| `manager@fleetcorp.com` | `Password123!` | Company Dashboard (`/company`) |
| **System Admin** | `admin@fleetcorp.com` | `Password123!` | Full System Console |

### Organization 2: Apex Freight Global (`APEX-2026`)
| Role | Email | Password | Access Portal |
| :--- | :--- | :--- | :--- |
| **Driver** | `driver@apex.com` | `Password123!` | Driver Mobile App (`/driver`) |
| **Fleet Manager**| `manager@apex.com` | `Password123!` | Company Dashboard (`/company`) |

*(Public registration is locked strictly to `DRIVER` unless a user creates a new company, in which case they become `FLEET_MANAGER` of that organization).*

---

## 🏃 Quick Start Guide (Under 5 Minutes)

### Option A: One-Command Docker Setup (Recommended)
```bash
# Clone and enter repo
git clone https://github.com/aravind090507-cmyk/fleettrack.git
cd fleettrack

# Launch PostgreSQL (PostGIS), Redis, FastAPI backend, Vite frontend, and Nginx reverse proxy
docker compose up -d --build

# Open app
# Frontend: http://localhost:80
# Backend API Docs: http://localhost:8000/docs
```

### Option B: Local Development
```bash
# 1. Backend
cd backend
python -m venv venv
.\venv\Scripts\activate   # Linux/macOS: source venv/bin/activate
pip install -r requirements.txt
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

# 2. Frontend (in a separate terminal)
cd frontend
npm install
npm run dev
# Access at https://localhost:5173
```

### Option C: Run Automated Test Suite
```bash
$env:PYTHONPATH="backend"
.\backend\venv\Scripts\python.exe -m pytest backend/tests/ -v
# Executes Auth, GPS Validation, and E2E Journey Lifecycle tests
```

---

## 📱 Mobile Testing (Testing 10-Meter Walks)

Mobile browsers (iOS Safari and Android Chrome) require **HTTPS** to allow GPS Geolocation. Vite is configured with native SSL support:

1. **Via Same Wi-Fi**:
   - Open your phone browser to: `https://<YOUR_LAPTOP_IP>:5173`
   - Tap **"Advanced"** → **"Proceed"** to accept the self-signed SSL certificate.
2. **Via Personal Hotspot (Recommended if Wi-Fi has Client Isolation)**:
   - Turn ON **Mobile Hotspot** on your Windows laptop.
   - Connect your phone to the hotspot Wi-Fi.
   - Open: `https://192.168.137.1:5173` on your phone.
3. **Conducting a 10-Meter Test**:
   - Log in or register as a Driver.
   - On the dispatch setup, tap **"🎯 Use My Exact GPS for Start"**.
   - Tap **"Tap Goal Pin"** and tap the map ~10 meters away.
   - Click **"Dispatch & Start Journey"**.
   - Walk across your office/room: observe the **Pings Sent** counter update every 2.5 seconds.
   - On the Manager Dashboard (`/company/live-map`), observe your walking path drawn in real time!
   - Conclude trip: public link immediately returns `HTTP 410 Gone`.

---

## 🐳 Docker Deployment (Production)

```bash
# Build and launch all microservices (Postgres, PostGIS, Redis, Backend, Frontend, NGINX)
docker compose up -d --build

# View container logs
docker compose logs -f
```

---

## 📄 License

MIT License. Developed for Corporate Fleet Operations & Geospatial Telematics.
