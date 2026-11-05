# FleetTrack AI

> **Real-time fleet management and vehicle tracking platform for construction companies.**

FleetTrack AI is a full-stack web application that helps construction companies monitor, manage, and track vehicles across multiple project sites. It provides live GPS tracking, historical route replay, ETA calculations, geofencing, fleet analytics, and an AI-powered fleet assistant.

---

## Features

| Feature | Description |
|---|---|
| 🚛 **Live Tracking** | Real-time vehicle location updates every 5 seconds via WebSockets |
| 🗺️ **Google Maps** | Interactive map with vehicle markers, route polylines, and info windows |
| 📍 **GPS Simulation** | 5 demo vehicles moving on realistic Chennai-area road routes |
| 🕐 **Route History** | View and replay historical vehicle routes with playback controls |
| ⏱️ **ETA Calculation** | Google Directions API-based ETA from current location to destination |
| 🏗️ **Project Management** | Assign vehicles to construction projects and track utilization |
| 🔔 **Geofencing** | Circle and polygon geofences with entry/exit event detection |
| 📊 **Analytics** | Fleet KPIs, distance trends, utilization, and speed charts |
| 🤖 **AI Assistant** | Chat-based fleet insights with rule-based fallback |
| 🔐 **Role-Based Access** | Admin and Fleet Manager roles with server-side enforcement |
| 🔔 **Notifications** | Real-time alerts for offline vehicles, geofence events, idle time |

---

## Demo Credentials

| Role | Email | Password |
|---|---|---|
| **Admin** | `admin@fleettrack.ai` | `FleetAdmin2026!` |
| **Fleet Manager** | `manager@fleettrack.ai` | `FleetMgr2026!` |

> ⚠️ Change these credentials before deploying to production.

---

## Technology Stack

**Frontend:** React 18 · TypeScript · Vite · Tailwind CSS · TanStack Query · Zustand · Google Maps JS API · Recharts · Lucide React

**Backend:** Python 3.11 · FastAPI · SQLAlchemy 2.x · Alembic · Pydantic v2 · python-jose · argon2-cffi

**Database:** PostgreSQL 15 · PostGIS · GeoAlchemy2

**Infrastructure:** Docker · Docker Compose · Redis (optional)

---

## Quick Start (Docker Compose — Recommended)

### Prerequisites
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed and running
- Git

### 1. Clone and configure

```bash
git clone <repository-url>
cd fleettrack-ai

# Copy and edit environment variables
cp .env.example .env
```

Edit `.env` and set at minimum:
- `JWT_SECRET_KEY` — generate with `openssl rand -hex 32`
- `GPS_DEVICE_AUTH_SECRET` — generate with `openssl rand -hex 32`
- `VITE_GOOGLE_MAPS_BROWSER_KEY` — your Google Maps browser API key (optional, see below)
- `GOOGLE_MAPS_SERVER_KEY` — your Google Maps server API key (optional)
- `AI_PROVIDER` + `AI_API_KEY` — optional, see AI Configuration below

### 2. Start the application

```bash
docker-compose up --build
```

This will:
1. Start PostgreSQL + PostGIS
2. Run database migrations automatically
3. Seed demo data (admin user, fleet manager, 5 vehicles, 3 projects)
4. Start the FastAPI backend on port 8000
5. Start the React frontend on port 5173
6. Launch the GPS simulator (vehicles start moving after ~30 seconds)

### 3. Open the application

- **Frontend:** http://localhost:5173
- **Backend API:** http://localhost:8000
- **API Docs:** http://localhost:8000/docs

---

## Local Development (Without Docker)

### Prerequisites
- Python 3.11+
- Node.js 20+
- PostgreSQL 15 with PostGIS extension
- (Optional) Redis

### Backend Setup

```bash
cd backend

# Create virtual environment
python -m venv venv
source venv/bin/activate    # Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Configure environment
cp ../.env.example ../.env
# Edit .env with your DATABASE_URL and other settings

# Run database migrations
alembic upgrade head

# Seed demo data
python seed.py

# Start the backend
uvicorn app.main:app --reload --port 8000
```

### Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Configure environment
cp ../.env.example .env.local
# Set VITE_GOOGLE_MAPS_BROWSER_KEY and VITE_API_BASE_URL=http://localhost:8000

# Start the dev server
npm run dev
```

---

## Environment Variables

See `.env.example` for a complete template. Key variables:

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `JWT_SECRET_KEY` | ✅ | Secret for JWT signing (use openssl rand -hex 32) |
| `GPS_DEVICE_AUTH_SECRET` | ✅ | Shared secret for GPS device authentication |
| `VITE_GOOGLE_MAPS_BROWSER_KEY` | ⚠️ Optional | Browser-restricted Google Maps API key |
| `GOOGLE_MAPS_SERVER_KEY` | ⚠️ Optional | Server-side Maps key for Directions/ETA |
| `AI_PROVIDER` | ⚠️ Optional | AI provider: `openai`, `gemini`, `none` |
| `AI_API_KEY` | ⚠️ Optional | API key for the selected AI provider |
| `REDIS_URL` | ⚠️ Optional | Redis URL for WebSocket pub/sub scaling |

---

## Google Maps Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a project or select an existing one
3. Enable the following APIs:
   - **Maps JavaScript API** (browser key)
   - **Places API** (browser key)
   - **Directions API** (server key)
   - **Geocoding API** (server key)
4. Create two API keys:
   - **Browser key**: Add HTTP referrer restrictions (e.g., `http://localhost:5173/*`)
   - **Server key**: Add IP restrictions for your server
5. Set in `.env`:
   ```
   VITE_GOOGLE_MAPS_BROWSER_KEY=your_browser_key
   GOOGLE_MAPS_SERVER_KEY=your_server_key
   ```

> **Without Google Maps API keys:** The application runs normally, but the map areas show a placeholder message. All other features (vehicle management, analytics, AI, notifications) work without a Maps key.

---

## AI Configuration

The AI assistant supports any OpenAI-compatible API:

### OpenAI
```env
AI_PROVIDER=openai
AI_API_KEY=sk-...
AI_MODEL=gpt-4o-mini
AI_BASE_URL=https://api.openai.com/v1
```

### Google Gemini (via OpenAI-compatible endpoint)
```env
AI_PROVIDER=openai
AI_API_KEY=your-gemini-key
AI_MODEL=gemini-1.5-flash
AI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
```

### No AI (Rule-Based Fallback)
```env
AI_PROVIDER=none
```
The application automatically uses rule-based analysis to answer fleet queries. This is the default and works without any API key.

---

## GPS Simulator

The application includes a built-in GPS simulator that creates 5 demo vehicles moving on realistic road routes in Chennai, India.

**Demo Vehicles:**

| Registration | Type | Route |
|---|---|---|
| TN-01-AB-1234 | Dump Truck | Guindy → Anna Salai → Marina Beach |
| TN-01-CD-5678 | Excavator | Tambaram → GST Road → Chrompet |
| TN-01-EF-9012 | Concrete Mixer | Porur → OMR → Velachery |
| TN-01-GH-3456 | Loader | Ambattur → Padi → Anna Nagar |
| TN-01-IJ-7890 | Crane Truck | Sholinganallur → OMR → Perungudi |

**Simulator controls** are available in **Settings → GPS Simulator** (admin only):
- Start / Pause / Resume / Stop
- Simulation speed multiplier

All simulated data is clearly labeled with `[SIM]` indicators throughout the UI.

---

## API Documentation

Interactive API documentation is available at:
- **Swagger UI:** http://localhost:8000/docs
- **ReDoc:** http://localhost:8000/redoc

### Key Endpoints

```
POST   /api/v1/auth/login
GET    /api/v1/auth/me

GET    /api/v1/vehicles
POST   /api/v1/vehicles
GET    /api/v1/vehicles/{id}
GET    /api/v1/vehicles/{id}/location
GET    /api/v1/vehicles/{id}/history
GET    /api/v1/vehicles/{id}/eta

POST   /api/v1/locations          # GPS device ingestion endpoint

GET    /api/v1/projects
GET    /api/v1/geofences

GET    /api/v1/analytics/fleet-summary
GET    /api/v1/analytics/vehicle-activity
GET    /api/v1/analytics/daily-distance

POST   /api/v1/ai/chat
GET    /api/v1/ai/insights

GET    /api/v1/notifications

WS     /ws/tracking?token=<jwt>
WS     /ws/notifications?token=<jwt>
```

---

## Testing

### Backend Tests

```bash
cd backend
pytest tests/ -v

# With coverage
pytest tests/ -v --cov=app --cov-report=html
```

### Frontend Tests

```bash
cd frontend
npm run test

# With UI
npm run test:ui
```

### Manual Testing

1. Log in as **admin** and verify the dashboard shows fleet KPIs
2. Navigate to **Live Tracking** — wait 30s for simulator to start, verify vehicle markers appear and move
3. Select a vehicle, verify the right panel shows live speed updates
4. Navigate to **Route History**, select a vehicle and today's date, verify route polyline appears
5. Click Play on the route playback, verify the marker moves along the route
6. Navigate to **AI Insights**, send a message like "Which vehicles are currently idle?"
7. Log out and log in as **manager@fleettrack.ai** — verify only assigned vehicles are visible

---

## Project Structure

```
fleettrack-ai/
├── frontend/                  # React + TypeScript frontend
│   ├── src/
│   │   ├── components/        # Reusable UI components
│   │   ├── pages/             # Page-level components
│   │   ├── layouts/           # App shell, sidebar, topbar
│   │   ├── hooks/             # Custom React hooks
│   │   ├── services/          # API client functions
│   │   ├── store/             # Zustand state stores
│   │   ├── types/             # TypeScript interfaces
│   │   └── utils/             # Utility functions
│   └── ...
├── backend/                   # FastAPI + Python backend
│   ├── app/
│   │   ├── api/v1/            # Route handlers
│   │   ├── core/              # Config, security, dependencies
│   │   ├── models/            # SQLAlchemy ORM models
│   │   ├── schemas/           # Pydantic schemas
│   │   ├── services/          # Business logic
│   │   ├── repositories/      # Data access layer
│   │   ├── websocket/         # WebSocket manager
│   │   ├── simulator/         # GPS simulator
│   │   ├── ai/                # AI assistant
│   │   └── database/          # DB session management
│   ├── migrations/            # Alembic migrations
│   ├── tests/                 # pytest tests
│   └── seed.py                # Demo data seeder
├── docker-compose.yml
├── .env.example
└── README.md
```

---

## Security Notes

- Never commit `.env` files to version control
- Rotate `JWT_SECRET_KEY` and `GPS_DEVICE_AUTH_SECRET` in production
- Apply HTTP referrer restrictions to the Google Maps browser key
- Apply IP restrictions to the Google Maps server key
- Use HTTPS in production (add a reverse proxy like nginx or Traefik)
- The AI API key is never exposed to the frontend

---

## License

MIT License — see LICENSE file for details.
