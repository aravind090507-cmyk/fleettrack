# FleetTrack × Traccar Architecture Integration — Implementation Plan

**Date**: November 6, 2026  
**Status**: Phase 0 Baseline Completed — Awaiting Approval for Phase 1

---

## 1. Executive Summary & Baseline Evidence

All 13 identified flaws (F1–F13) have been reviewed against the live codebase, and their root causes have been measured and confirmed with empirical test execution.

### Empirical Measurements Recorded in `docs/traccar-port/baseline.txt`:

1. **Backend Probe (`evidence/probe.py`)**:
   - **Accuracy Filtering**: Fix with 130m accuracy is silently dropped as HTTP 200 `status: "filtered_noise"` without error code or diagnostic explanation.
   - **Clock Skew**: Fix with phone clock +120s ahead is dropped as HTTP 200 `status: "filtered_noise"` instead of applying skew correction.
   - **Burst Rate Limiting**: 6 rapid pings spaced 0.2s apart resulted in **4 out of 6 silently dropped**, because the rate limiter checked server arrival time rather than GPS fix time.
   - **Offline Batch Cap**: 600 points returned HTTP 422 Unprocessable Entity (hardcoded schema cap of 500).
   - **Stale Batch Deadlock**: 20 points older than 24h returned HTTP 200 with `pings_processed: 0`, causing the offline client to retry the same batch indefinitely.
   - **Late Batch After Journey End**: A batch uploaded after the journey ended was unconditionally accepted with HTTP 200.
   - **Stationary Jitter Accumulation**: 200 points with ±4m noise over 10 minutes reported **0.885 km** traveled distance instead of ~0 km.

2. **Frontend Probe (`evidence/probe.test.tsx`)**:
   - **F1 (Driver Geolocation Churn)**: 68–72 uploads in 2 seconds generated from **one** GPS fix source due to object-literal options causing infinite effect restarts and simultaneous `watchPosition` + `getCurrentPosition` polling.
   - **F2 (Public Tracking Socket Churn)**: 7 WebSocket connections opened and 6 closed in 5.2 seconds due to inline arrow callbacks in `PublicTrackingPage.tsx` re-renders, causing repeated `access_count += 1` database writes.

3. **Backend Test Suite**:
   - **11/11 tests passing** (`test_auth`, `test_e2e_verification`, `test_gps_validation`, `test_journey_source_destination`, `test_journeys_lifecycle`).

---

## 2. Phase-by-Phase Roadmap

### Phase 1 — Stop the Bleeding (Frontend Stabilization)
- **Files**:
  - `frontend/src/hooks/useGeolocation.ts`
  - `frontend/src/hooks/useWebSocket.ts`
  - `frontend/src/portals/DriverApp/pages/ActiveJourney.tsx`
  - `frontend/src/pages/PublicTrackingPage.tsx`
  - `frontend/src/components/map/LiveMap.tsx`
- **Actions**:
  1. Refactor `useGeolocation` to hold callbacks and coordinate options in `useRef` so dependencies remain stable across renders. Remove the 2s `getCurrentPosition` interval, keeping `watchPosition` as single source of truth with a 10s watchdog fallback.
  2. Implement fix monotonic timestamp checking (`timestamp > lastTimestamp`) and speed derivation from displacement when `coords.speed` is null.
  3. Refactor `useWebSocket` to hold event callbacks in refs, making the hook effect depend strictly on `url`. Add exponential backoff with jitter (capped at 30s), visibility change / online reconnection listeners, and suppress reconnect on close code 4410.
  4. Fix `ActiveJourney.tsx` to increment the UI "Pings Sent" counter strictly for server-accepted points.
  5. Remove duplicate WS + polling point appends on `LiveMap.tsx` and `PublicTrackingPage.tsx`.
- **Target Metrics**:
  - Driver uploads in 2s <= number of distinct fixes (1-2 instead of 70+).
  - Public page WS connections in 5.2s: exactly 1 socket.

---

### Phase 2 — Data Model & Alembic Migrations
- **Files**:
  - `backend/alembic/` (Alembic environment and migrations)
  - `backend/app/models/device.py`
  - `backend/app/models/event.py`
  - `backend/app/models/geofence.py`
  - `backend/app/models/location.py`
  - `backend/app/models/journey.py`
- **Actions**:
  1. Initialize Alembic with a baseline revision matching the existing schema (`users`, `companies`, `vehicles`, `journeys`, `locations`, `trip_events`, `so_s_alerts`).
  2. Add `devices` table: `id`, `company_id`, `unique_id`, `name`, `vehicle_id`, `status` (`online|offline|unknown`), `last_update`, `position_id`, `disabled`, `attributes` JSON, and Traccar motion/overspeed state columns.
  3. Add `events` table: `id`, `company_id`, `device_id`, `journey_id`, `position_id`, `geofence_id`, `type`, `event_time`, `attributes` JSON.
  4. Add `geofences` and `device_geofences` tables (`kind`, `geometry`, `attributes`).
  5. Alter `locations`: make `journey_id` nullable, add `device_id`, `valid`, `outdated`, `protocol`, `device_time`, `distance_m`, `total_distance_m`, `motion`, `geofence_ids`, `attributes`, and index on `(device_id, recorded_at)` and `(journey_id, recorded_at)`.
  6. Backfill existing vehicles with a corresponding `devices` entry (`unique_id = "web-" + vehicle_id`).
  7. Verify bidirectional upgrade/downgrade on both fresh SQLite/Postgres and populated SQLite databases.

---

### Phase 3 — The Traccar Processing Pipeline (`backend/app/pipeline/`)
- **Modules**:
  - `backend/app/pipeline/units.py`: Central speed/distance unit conversions (knots, m/s, km/h, km).
  - `backend/app/pipeline/geo.py`: Haversine (R = 6,378,137m), distance-to-line, ray casting for polygons, circle containment.
  - `backend/app/pipeline/config.py`: Layered attribute resolution (device -> company -> global defaults).
  - `backend/app/pipeline/reasons.py`: Structured filter and adjustment reason codes.
  - `backend/app/pipeline/state.py`: Per-device state cache and per-device `asyncio.Lock` for strictly ordered serialization.
  - `backend/app/pipeline/handlers/`:
    - `outdated.py`: Flag outdated/reordered fixes.
    - `time.py`: Clock skew correction (`|device_time - server_time| > 120s` adjusts timestamp and sets `clockSkewMs` instead of dropping). Reject fixes older than 72h.
    - `distance.py`: Incremental distance accumulation + accuracy-aware jitter snap gate (`coordinates.filter` semantics).
    - `filter.py`: Filter invalid, zero coordinates, duplicates, excessive speed (teleport guard), and fix-time rate limiter (`minPeriod`).
    - `geofence.py`: Spatial containment tagging.
    - `motion.py`: Reported Doppler speed thresholding + `NewMotionProcessor` port with windowed stop/move transition logic.
  - `backend/app/pipeline/events/`: Overspeed, Motion, Geofence enter/exit, Alarm/SOS.
  - `backend/app/pipeline/runner.py`: Sequential pipeline execution, database persistence, and `PostProcessHandler` (latest position update rule `fix_time >= last.fix_time`).
- **Tests**:
  - Port Traccar golden test vectors (`DistanceCalculatorTest`, `FilterHandlerTest`, `DistanceHandlerTest`, `MotionHandlerTest`, `NewMotionProcessorTest`, `GeofenceTest`).

---

### Phase 4 — Ingestion Adapters & Native OsmAnd Protocol
- **Files**:
  - `backend/app/api/location.py`
  - `backend/app/api/osmand.py`
  - `backend/app/api/devices.py`
- **Actions**:
  1. Refactor `/api/journeys/{id}/location` and `/api/journeys/{id}/location/batch` to route into the pipeline. Add detailed per-point results (`index`, `status`, `reasons`, `adjusted`).
  2. Increase batch limit to 1000 with clean HTTP 413 on payload limit exceed.
  3. Enforce journey lifecycle rules: reject live pings if not `IN_PROGRESS`; allow late offline sync with `recorded_at <= ended_at` within a 6h grace window.
  4. Implement `/osmand` protocol decoder endpoint (handling GET/POST query strings and JSON payloads from Traccar Client mobile apps for native background tracking).
  5. Add device management CRUD and diagnostics endpoint (`GET /api/devices/{id}/diagnostics`).

---

### Phase 5 — Real-time Layer & Scaling
- **Files**:
  - `backend/app/services/redis_service.py`
  - `backend/app/websocket/manager.py`
  - `backend/app/api/dashboard.py`
- **Actions**:
  1. Implement dedicated Redis pub/sub listener task that distributes incoming positions across multi-worker instances to local WebSockets.
  2. Implement unified socket envelope: `{"devices": [...], "positions": [...], "events": [...]}` with <= 250ms coalescing and slow-client backpressure.
  3. Throttle public tracking token access tracking (write at most once per minute to avoid database contention).
  4. Replace N+1 queries in dashboard endpoints with single set-based queries and hot cache lookups.

---

### Phase 6 — Read APIs & Telematics Reports
- **Files**:
  - `backend/app/api/reports.py`
  - `backend/app/api/positions.py`
  - `backend/app/api/geofences.py`
- **Actions**:
  1. Implement `GET /api/reports/{route,trips,stops,summary,events}` with CSV and GPX export.
  2. Implement trip/stop segmentation from `deviceMoving`/`deviceStopped` event transitions.
  3. Compute smoothed ETA using exponential moving average of recent moving speed.

---

### Phase 7 — Frontend Store, UI Rebuild & Replay
- **Files**:
  - `frontend/src/store/telematicsStore.ts`
  - `frontend/src/components/SocketController.tsx`
  - `frontend/src/services/PositionUploader.ts`
  - `frontend/src/portals/DriverApp/pages/ActiveJourney.tsx`
  - `frontend/src/pages/ReplayPage.tsx`
  - `frontend/src/pages/ReportsPage.tsx`
  - `frontend/src/pages/GeofencesPage.tsx`
  - `frontend/src/pages/DevicesPage.tsx`
- **Actions**:
  1. Build unified zustand store for devices, positions, events, and live routes.
  2. Mount `SocketController` with ref-based callbacks and automatic REST resynchronization upon reconnect.
  3. Replace driver upload callback with standalone `PositionUploader` featuring write-ahead IndexedDB buffering and batch acknowledgement.
  4. Update Leaflet maps with status-colored vehicle markers, course rotation, and speed-gradient route trails.
  5. Add Replay, Reports, Geofence management, and Device setup screens.

---

### Phase 8 — Hardening, Deployment & Clean-up
- **Actions**:
  1. Restrict CORS origins in production and remove open regex / wildcards.
  2. Restrict demo data seeding to `SEED_DEMO_DATA=true`.
  3. Enforce production `SECRET_KEY` validation on startup.
  4. Configure GitHub Pages build (`404.html` SPA routing, explicit `VITE_API_URL` and `VITE_WS_URL`).
  5. Execute end-to-end load test simulating 200 devices at 1 Hz for 5 minutes.
  6. Add `NOTICE` file documenting Apache-2.0 attribution for Traccar algorithms.
