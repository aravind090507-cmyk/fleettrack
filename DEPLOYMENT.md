# FleetTrack AI — Production Deployment Guide

This guide provides end-to-end instructions for deploying **FleetTrack AI** across **Railway** (FastAPI Backend, PostgreSQL, Redis) and **Vercel** (React + Vite SPA Frontend).

```
                      +---------------------------------------+
                      |          User Browser / Mobile         |
                      +-------------------+-------------------+
                                          |
                        HTTPS (SPA)       |     REST & WSS (API / Live GPS)
                                          |
                      +-------------------+-------------------+
                      |                                       |
                      v                                       v
          +-----------------------+               +-----------------------+
          |     VERCEL HOSTING    |               |    RAILWAY HOSTING    |
          |  (React + Vite SPA)   |               |   (FastAPI Backend)   |
          |                       |               |                       |
          |  - Client SPA routes  |               |  - REST endpoints     |
          |  - Static CDN cache   |               |  - Persistent WSS     |
          |  - SSL / HTTPS        |               |  - GPS Ingestion      |
          +-----------------------+               +-----------+-----------+
                                                              |
                                               +--------------+--------------+
                                               |                             |
                                               v                             v
                                   +-----------------------+     +-----------------------+
                                   |  RAILWAY POSTGRESQL   |     |     RAILWAY REDIS     |
                                   |                       |     |                       |
                                   |  - Relational Models  |     |  - Hot Location Cache |
                                   |  - Spatial Telemetry  |     |  - Pub/Sub Channels   |
                                   |  - Connection Pooling |     |  - Resilient Fallback |
                                   +-----------------------+     +-----------------------+
```

---

## 1. Prerequisites

- A [GitHub](https://github.com/) account with access to the `fleettrack` repository.
- A [Railway](https://railway.app/) account for backend and persistent database hosting.
- A [Vercel](https://vercel.com/) account for frontend SPA hosting.
- Python 3.12+ and Node.js 18+ for local verification.

---

## 2. Step 1: Upload the Project to GitHub

Ensure all recent commits are pushed to your GitHub repository:

```bash
git add .
git commit -m "chore: prepare for Railway backend and Vercel frontend deployment"
git push origin main
```

---

## 3. Step 2: Deploy Backend & Database on Railway

### 3.1 Create a New Project on Railway
1. Log in to your [Railway Dashboard](https://railway.app/dashboard).
2. Click **New Project** → **Deploy from GitHub repo**.
3. Select your `fleettrack` repository.

### 3.2 Provision Railway PostgreSQL
1. In your Railway project canvas, click **+ New** → **Database** → **Add PostgreSQL**.
2. Railway provisions an enterprise PostgreSQL instance with persistent storage.
3. Click the PostgreSQL card → **Variables** tab to inspect the auto-generated connection string:
   - `DATABASE_URL` (e.g. `postgresql://postgres:password@postgres.railway.internal:5432/railway`)

### 3.3 Provision Railway Redis (Recommended)
1. In the same project canvas, click **+ New** → **Database** → **Add Redis**.
2. Railway will create a Redis instance.
3. *Note*: If Redis is omitted, FleetTrack automatically falls back to internal in-memory pub/sub and caching.

### 3.4 Configure the FastAPI Backend Service
1. Click the **fleettrack** backend service card in the Railway canvas.
2. Go to **Settings**:
   - **Build**: Ensure Builder is set to **Dockerfile** (pointing to `backend/Dockerfile` or root `Dockerfile`).
   - Railway will automatically read `railway.json`.
3. Go to **Variables** and configure:
   - `PORT`: `8000` (or leave default; Railway automatically supplies `$PORT`).
   - `APP_ENVIRONMENT`: `production`
   - `DATABASE_URL`: `${{Postgres.DATABASE_URL}}` (Select from Railway auto-complete reference).
   - `REDIS_URL`: `${{Redis.REDIS_URL}}` (Select from Railway auto-complete reference, or leave blank for in-memory).
   - `SECRET_KEY`: Generate a secure 64-character hex key (e.g., run `openssl rand -hex 32`).
   - `ALGORITHM`: `HS256`
   - `ACCESS_TOKEN_EXPIRE_MINUTES`: `1440`
   - `TRACKING_LINK_EXPIRE_HOURS`: `24`
   - `CORS_ORIGINS`: `["https://*.vercel.app","http://localhost:5173"]` (Add your Vercel URL once generated; wildcards `*` are rejected in production).
   - `TELEMATICS_PROFILE`: `vehicle` (default for commercial vehicles) or `walk_test` (for walking/indoor testing).
   - `SEED_DEMO_DATA`: `false` (default in production; set `true` only for staging demo environments).
4. Go to **Networking**:
   - Click **Generate Domain** (e.g., `fleettrack-backend.up.railway.app`).
   - Ensure the port maps to `8000` (or `$PORT`).

### 3.5 Verify Backend Deployment
Open your browser or terminal and test the health check endpoint:

```bash
curl -s https://<your-railway-domain>/health
```

Expected response:
```json
{
  "status": "healthy",
  "database": "connected",
  "redis": "connected"
}
```

---

## 4. Step 3: Deploy Frontend on Vercel

### 4.1 Import the Repository into Vercel
1. Log in to your [Vercel Dashboard](https://vercel.com/dashboard).
2. Click **Add New...** → **Project**.
3. Select your GitHub `fleettrack` repository.

### 4.2 Configure Build & Output Settings
- **Framework Preset**: `Vite`
- **Root Directory**: `./` (or `frontend` if deploying frontend exclusively)
- **Build Command**: `cd frontend && npm install && npm run build`
- **Output Directory**: `frontend/dist` (or `dist` if Root Directory is set to `frontend`)

### 4.3 Configure Environment Variables in Vercel
Add the following variables under **Project Settings** → **Environment Variables**:

| Variable | Value | Description |
|---|---|---|
| `VITE_API_URL` | `https://<your-railway-domain>` | Railway FastAPI backend URL (e.g. `https://fleettrack-backend.up.railway.app`) |
| `VITE_WS_URL` | `wss://<your-railway-domain>` | Railway WebSocket URL (e.g. `wss://fleettrack-backend.up.railway.app`) |

> ⚠️ **CRITICAL: Vercel WebSockets Notice**
> Vercel Edge and Serverless functions do **NOT** support persistent WebSocket proxying. Do not attempt to route `/ws` through Vercel rewrites. The frontend must connect directly to Railway (`wss://<your-railway-domain>/ws/...`) via `VITE_WS_URL`.

### 4.4 Deploy
1. Click **Deploy**.
2. Vercel will install dependencies, compile TypeScript, build the Vite bundle, and deploy to a global edge CDN with automatic HTTPS.
3. Once deployed, copy your Vercel URL (e.g. `https://fleettrack.vercel.app`) and add it to `CORS_ORIGINS` in your Railway backend variables.

---

## 5. Step 4: Verification & Live Testing

### 5.1 Test Driver Authentication & Journey Setup
1. Open your Vercel web application in your browser.
2. Log in using pre-seeded driver credentials:
   - **Email**: `driver1@fleetcorp.com`
   - **Password**: `Password123!`
3. Select vehicle `TN-01-AB-1234` and set origin and destination locations.
4. Click **Start Trip**. A unique tracking link and QR code will be generated.

### 5.2 Test Public Live Tracking
1. Copy the public tracking link (format: `https://<your-vercel-domain>/track/<jwt-token>`).
2. Open the link in a separate private/incognito browser window or on your mobile phone.
3. Verify:
   - The map loads showing the route, destination, vehicle plate, and driver name.
   - When the driver sends GPS pings, the marker updates on the public tracking map in real time via WebSockets.

### 5.3 Test Fleet Manager Console
1. Log in as Fleet Manager:
   - **Email**: `manager@fleetcorp.com`
   - **Password**: `Password123!`
2. Navigate to **Live Map** (`/company/live-map`):
   - Verify active vehicles appear with status `IN_TRANSIT` or `AVAILABLE`.
   - Click any vehicle to view real-time telemetry (speed, heading, ignition status).
   - Test **Replay** feature on historical journeys in **Trip Archives** (`/company/history`).

### 5.4 Test Journey Conclusion & Revocation
1. In the Driver App, click **Complete Journey**.
2. Switch to the public tracking tab:
   - The tracking page immediately updates to **"Journey Completed"**.
   - Refresh the page: the server rejects access with `HTTP 410 Gone`.

---

## 6. Local Development Instructions

### Running Backend Locally:
```bash
cd backend
python -m venv venv
# On Windows:
venv\Scripts\activate
# On Linux/macOS:
source venv/bin/activate

pip install -r requirements.txt
uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

### Running Frontend Locally:
```bash
cd frontend
npm install
npm run dev
```
Open `http://localhost:5173`. Vite automatically proxies `/api` and `/ws` to `http://127.0.0.1:8000`.

### Running Automated Test Suites:
```bash
# Backend pytest suite (all 35 unit, integration, and load tests):
cd backend
python -m pytest tests -v

# Frontend test suite:
cd frontend
npm test

# Frontend production build verification:
npm run build
```

---

## 7. Hardware GPS Ingestion & Telematics Pipeline

FleetTrack includes an embedded port of Traccar's telematics pipeline, supporting hardware GPS units and the official Traccar Client mobile application without Java dependencies.

### 7.1 Ingestion Endpoints (OsmAnd Protocol)
Hardware trackers and the Traccar Client app (Android/iOS) can post telemetry to either:
- `http://<your-railway-domain>/osmand` (Standard OsmAnd port)
- `http://<your-railway-domain>/api/osmand` (API-namespaced OsmAnd port)

Both `GET` query parameters and `POST` body are supported:
- Parameters: `id`, `lat`, `lon`, `timestamp` (or `time`), `speed`, `bearing` (or `heading`), `altitude`, `accuracy`, `batt`, `charge`.
- Response: `HTTP 200 OK` (plain text `OK`).

### 7.2 Telematics Profiles
Configured via the `TELEMATICS_PROFILE` environment variable:
- `vehicle` (Production Default):
  - Max speed: 180 km/h (filters impossible teleport spikes).
  - Accuracy threshold: 100 meters.
  - Stationary jitter threshold: 10 meters (snaps creeping GPS noise).
  - Motion speed threshold: 2.5 knots (~4.6 km/h).
- `walk_test` (Walk & Indoor Testing):
  - Max speed: 0 (disabled).
  - Accuracy threshold: 150 meters.
  - Stationary jitter threshold: 5 meters (captures short walks).
  - Motion speed threshold: 0.5 knots (~0.9 km/h).

