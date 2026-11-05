# API Specification & Communication Protocols
## Corporate Fleet Tracking and Geospatial Navigation System

---

## 1. Protocol Fundamentals & Comparison

Understanding the roles and limitations of communication protocols is essential for high-frequency GPS telemetry:

| Protocol | State / Connection | Transport Layer | Directionality | Overhead / Latency | Primary Use Case in System |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **HTTP (HyperText Transfer Protocol)** | Stateless, Request-Response | TCP (Cleartext, Port 80) | Unidirectional (Client pulls) | High header overhead per request. Unencrypted, vulnerable to MITM. | Legacy fallback, local dev testing. |
| **HTTPS (HTTP over TLS)** | Stateless request/response over encrypted TLS 1.3 | TCP + TLS (Port 443) | Unidirectional (Client pulls) | Standard HTTP headers + initial TLS handshake. Secure end-to-end. | Authentication, control commands (Start/End Journey), batch uploads. |
| **REST API (Architectural Style)** | Stateless, Resource-Oriented | Typically HTTPS | Unidirectional | Leverages standard verbs (`GET`, `POST`, `PUT`, `DELETE`) and HTTP status codes. | Managing Users, Vehicles, Journeys, and Auth tokens. |
| **WebSockets (RFC 6455)** | Stateful, persistent full-duplex TCP socket | TCP (Port 80/443 after HTTP `Upgrade`) | Bidirectional (Server pushes immediately) | Low overhead (2-byte framing per message, zero repeated HTTP headers). | Real-time GPS broadcasting from backend to Company Dashboard and Public Links. |

---

## 2. Authentication & Authorization

All authenticated endpoints expect an `Authorization` header formatted as:
`Authorization: Bearer <JWT_TOKEN>`

### JWT Payload Structure:
```json
{
  "sub": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "email": "driver1@fleetcorp.com",
  "role": "DRIVER",
  "name": "Jane Doe",
  "exp": 1730728800
}
```

---

## 3. REST API Endpoint Specifications

### 3.1 Authentication
* **`POST /api/auth/login`**
  * **Request**:
    ```json
    {
      "email": "manager@fleetcorp.com",
      "password": "SecurePassword123!"
    }
    ```
  * **Response (200 OK)**:
    ```json
    {
      "access_token": "eyJhbGciOi...",
      "token_type": "bearer",
      "user": {
        "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
        "name": "Fleet Manager",
        "email": "manager@fleetcorp.com",
        "role": "FLEET_MANAGER"
      }
    }
    ```
* **`GET /api/auth/me`**
  * Returns authenticated user profile.
* **`POST /api/auth/logout`**
  * Invalidates client session.

---

### 3.2 Vehicle Management
* **`GET /api/vehicles`**
  * Query params: `status`, `assigned_driver_id`
  * Returns list of fleet vehicles with current operational status.
* **`POST /api/vehicles`** (Role: `FLEET_MANAGER`, `ADMIN`)
  * Creates a new vehicle asset.
* **`GET /api/vehicles/{vehicle_id}`**
  * Returns detailed vehicle telemetry and driver assignment.
* **`PUT /api/vehicles/{vehicle_id}`**
  * Updates vehicle details or status.
* **`DELETE /api/vehicles/{vehicle_id}`**
  * Decommissions a vehicle.

---

### 3.3 Journey Lifecycle Management
* **`POST /api/journeys/start`** (Role: `DRIVER`)
  * **Request**:
    ```json
    {
      "vehicle_id": "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d",
      "origin_name": "Regional Logistics Hub A, North Bangalore",
      "origin_lat": 13.0827,
      "origin_lng": 80.2707,
      "destination_name": "Central Retail Distribution Hub",
      "destination_lat": 12.9716,
      "destination_lng": 77.5946,
      "description": "High-priority pharmaceutical cargo"
    }
    ```
  * **Response (201 Created)**:
    ```json
    {
      "journey_id": "98765432-1234-5678-90ab-cdef12345678",
      "tracking_token": "aF93kz_8bYQ74eL3u-qRt0P2mL9sW...",
      "tracking_url": "https://fleettrack.company.com/track/aF93kz_8bYQ74eL3u-qRt0P2mL9sW...",
      "status": "IN_PROGRESS",
      "started_at": "2026-11-04T09:30:00Z"
    }
    ```
* **`POST /api/journeys/{journey_id}/end`** (Role: `DRIVER`)
  * Ends the active journey, revokes the temporary token, and returns trip summary.
* **`GET /api/journeys/active`** (Role: `FLEET_MANAGER`)
  * Retrieves all journeys currently `IN_PROGRESS`.
* **`GET /api/journeys/{journey_id}`**
  * Returns detailed journey record.
* **`GET /api/journeys/history`**
  * Retrieves completed historical journeys with distance and duration filters.

---

### 3.4 GPS Location Ingestion
* **`POST /api/journeys/{journey_id}/location`** (Role: `DRIVER`)
  * **Request**:
    ```json
    {
      "latitude": 13.0827,
      "longitude": 80.2707,
      "speed": 42.5,
      "heading": 178.2,
      "accuracy": 4.8,
      "altitude": 32.1,
      "timestamp": "2026-11-04T09:32:15.123Z"
    }
    ```
  * **Response (200 OK)**:
    ```json
    {
      "status": "recorded",
      "received_at": "2026-11-04T09:32:15.195Z"
    }
    ```
* **`POST /api/journeys/{journey_id}/location/batch`** (Role: `DRIVER`)
  * Used for flushing offline IndexedDB buffers after network reconnection.
  * **Request**: Array of location objects ordered chronologically.

---

### 3.5 Temporary Tracking Links (Public / External Viewers)
* **`GET /api/track/{token}`**
  * Public read-only endpoint. Validates token hash against Redis/PostgreSQL.
  * If active: returns sanitized journey details (vehicle license plate, origin, destination, current status, started_at).
  * If revoked or expired: **Returns `HTTP 410 Gone`**.
* **`GET /api/track/{token}/location`**
  * Returns the latest known location coordinates and speed.

---

### 3.6 Fleet Company Dashboard
* **`GET /api/dashboard/overview`**
  * Fleet metrics: total vehicles, active journeys, completed journeys, offline count, moving count, active SOS alerts.
* **`GET /api/dashboard/active-vehicles`**
  * Array of vehicles with their latest real-time coordinates.
* **`GET /api/dashboard/active-journeys`**
  * Comprehensive list of ongoing dispatches.

---

## 4. WebSocket Specifications

### 4.1 Ephemeral Tracking Stream: `/ws/track/{token}`
- **Protocol**: Raw WebSocket over WSS.
- **Client Lifecycle**:
  1. Client initiates handshake with `token`.
  2. Server verifies `SHA-256(token)` in Redis.
  3. If invalid or revoked: Server responds with WebSocket close code `4410 (Journey Ended)`.
  4. If valid: Server registers socket to journey subscriber pool and sends initial snapshot:
     ```json
     {
       "type": "INITIAL_STATE",
       "journey_id": "98765432-1234-...",
       "vehicle_registration": "KA-01-AB-1234",
       "origin": "Bangalore",
       "destination": "Chennai",
       "latest_location": {
         "lat": 13.0827,
         "lng": 80.2707,
         "speed": 42.5,
         "heading": 178.2,
         "recorded_at": "2026-11-04T09:32:15Z"
       }
     }
     ```
  5. Subsequent updates broadcast real-time movement:
     ```json
     {
       "type": "LOCATION_UPDATE",
       "lat": 13.0831,
       "lng": 80.2711,
       "speed": 44.0,
       "heading": 180.0,
       "recorded_at": "2026-11-04T09:32:20Z"
     }
     ```
  6. When journey ends:
     ```json
     {
       "type": "JOURNEY_COMPLETED",
       "message": "This journey has concluded."
     }
     ```
     Server closes the connection immediately.

### 4.2 Fleet Management Stream: `/ws/live-fleet`
- Requires JWT token in handshake query or header.
- Broadcasts updates across the entire corporate fleet:
  ```json
  {
    "type": "VEHICLE_MOVED",
    "vehicle_id": "uuid",
    "journey_id": "uuid",
    "lat": 12.9716,
    "lng": 77.5946,
    "speed": 55.2,
    "heading": 92.0,
    "timestamp": "2026-11-04T09:32:25Z"
  }
  ```
