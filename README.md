# Corporate Fleet Tracking & Geospatial Navigation Platform

An enterprise real-time fleet telematics, geospatial navigation, and temporary tracking management system designed for logistics companies managing vehicle fleets.

---

## 🚀 Key Features

- **Driver Mobile Portal**:
  - Driver authentication & assigned vehicle picker.
  - High-accuracy GPS collection (`navigator.geolocation.watchPosition` or built-in realistic simulator).
  - Offline GPS storage with **IndexedDB** & automated chronological synchronization on reconnection.
  - Driver trip controls: Start/End Journey, Take Break, Report Breakdown, and 3-second hold-to-activate Emergency SOS.
- **Ephemeral Journey Tracking Link Engine**:
  - Generates unguessable 256-bit cryptographically secure tracking tokens (`secrets.token_urlsafe(32)`).
  - Only **SHA-256 hashes** are stored in the database.
  - Active tokens are cached in Redis with strict 24-hour expiration.
  - Read-only public tracking link allows multiple company viewers or clients to track live deliveries simultaneously.
  - **Zero Link Leakage / No Reuse**: When the driver clicks **END JOURNEY**, the token is permanently revoked, Redis keys are evicted, WebSocket connections are closed with code `4410`, and any subsequent access returns **`HTTP 410 Gone`**.
- **Company Management Console**:
  - Full-featured **Leaflet + OpenStreetMap** vector canvas with zero API quota limits.
  - Dynamic vehicle markers rotated based on instantaneous heading angles.
  - 6 operational KPI cards: Total Vehicles, In-Transit, Active Trips, Completed, Offline Vehicles, SOS Alerts.
  - Real-time full-fleet WebSocket updates (`/ws/live-fleet`).
  - Vehicle asset inventory management and completed journey archives.
- **FastAPI Asynchronous Backend**:
  - Python 3.12+ ASGI engine using Uvicorn.
  - Works with **SQLite (aiosqlite)** out-of-the-box for local testing with zero setup, or **PostgreSQL 16 + PostGIS 3.4** in production.
  - Transparent **in-memory fallback** for Redis Pub/Sub if Redis is not locally installed.

---

## 🔑 Demo User Credentials

The platform seeds the following demonstration accounts automatically on initial backend startup:

| Role | Email | Password | Intended Portal |
| :--- | :--- | :--- | :--- |
| **Driver 1** | `driver1@fleetcorp.com` | `Driver1Pass!` | Driver Mobile App (`/driver`) |
| **Driver 2** | `driver2@fleetcorp.com` | `Driver2Pass!` | Driver Mobile App (`/driver`) |
| **Fleet Manager**| `manager@fleetcorp.com` | `Manager1Pass!` | Company Dashboard (`/company`) |
| **System Admin** | `admin@fleetcorp.com` | `Admin1Pass!` | Full System Access |

*(Note: The login page includes 1-click autofill buttons for both Driver and Fleet Manager).*

---

## 🏃 Local Quick Start (Without Docker)

You can run the entire platform locally in minutes without installing Docker, PostgreSQL, or Redis:

### 1. Start the FastAPI Backend
```bash
cd backend
python -m venv venv
# Windows:
venv\Scripts\activate
# Linux/macOS:
source venv/bin/activate

pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```
* Interactive API documentation is available at: [http://localhost:8000/docs](http://localhost:8000/docs)
* Health check: [http://localhost:8000/health](http://localhost:8000/health)

### 2. Start the React Frontend
```bash
cd frontend
npm install
npm run dev
```
* Open your browser at: [http://localhost:5173](http://localhost:5173)

---

## 🐳 Production Deployment (Docker Compose)

To deploy the full production stack with PostgreSQL, PostGIS, Redis, NGINX TLS termination, and rate limiting:

```bash
# 1. Configure production environment
cp .env.example .env
# Edit .env with your domain name and secure passwords

# 2. Build and launch all containers
docker compose up -d --build

# 3. View status and logs
docker compose ps
docker compose logs -f backend
```

---

## 🧪 Testing the Complete Journey Lifecycle

1. **Login as Driver**:
   - Go to [http://localhost:5173/login](http://localhost:5173/login) and click **"Driver Portal"** demo button.
   - Click **"Authenticate & Sign In"**.
2. **Start Journey**:
   - Select an available vehicle (e.g. `KA-01-AB-1234`).
   - Enter Origin and Destination.
   - Click **"START JOURNEY"**.
   - Note the generated temporary tracking link and click **"Copy"**.
3. **Open Company Dashboard & Public Link**:
   - In another browser tab/window, open the copied tracking link (e.g., `/track/<token>`).
   - Open [http://localhost:5173/company/live-map](http://localhost:5173/company/live-map) logged in as Fleet Manager.
   - Observe both maps smoothly receiving live coordinates without page reload.
4. **End Journey & Verify Invalidation**:
   - In the Driver portal, click **"END JOURNEY"** and confirm.
   - Switch back to the public tracking tab: observe the link immediately transitions to **"THIS JOURNEY HAS ENDED - Tracking access is no longer available"**.
   - Refresh the public URL: observe backend returns **`HTTP 410 Gone`**.
