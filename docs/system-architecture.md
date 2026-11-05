# System Architecture & Technical Design Document
## Corporate Fleet Tracking and Geospatial Navigation System

---

## 1. Executive Summary & Architectural Vision

The **Corporate Fleet Tracking and Geospatial Navigation System** is an enterprise-grade platform designed to track corporate fleets, manage journeys in real time, and broadcast live vehicular movements to company management and temporary external stakeholders with high fidelity, zero link leakage, and sub-second latency.

The system is bifurcated into two primary user domains:
1. **Driver Mobile Portal (PWA / Hybrid Mobile)**: Captures high-accuracy GPS coordinates, buffers coordinates during offline periods via IndexedDB, transmits telemetry over HTTPS/WSS, and provides journey management (Start, End, Break, Emergency SOS).
2. **Company Management Portal (Web Dashboard)**: Provides fleet managers with bird's-eye visibility over all active vehicles, live journey paths, historical playback, emergency alerts, and vehicle telematics.

Crucially, the architecture features an **Ephemeral Journey-Specific Tracking Engine**:
- Every journey generates a cryptographically random, collision-resistant tracking token (256-bit entropy via `secrets.token_urlsafe(32)`).
- The raw token is **never** stored in plaintext in the persistent database; only its **SHA-256 hash** is persisted.
- Active tokens are cached in Redis with strict TTLs and mapped to active journeys.
- Multiple viewers (dispatchers, clients, logistics coordinators) can simultaneously view the live journey via WebSockets and read-only REST endpoints.
- When the driver clicks **END JOURNEY**, the tracking token is permanently revoked, Redis keys are purged, WebSocket connections are terminated with code `4410 (Journey Ended)`, and any subsequent access returns `HTTP 410 Gone`.
- A newly initiated journey generates an entirely new token; tokens are never recycled or reused.

---

## 2. Comprehensive System Architecture Diagram

```mermaid
flowchart TB
    subgraph Clients["Edge Client Layer"]
        subgraph DriverDevice["Driver Device (Mobile PWA / Capacitor)"]
            GPS["Device GPS Hardware / Geolocation API"]
            IDB[("IndexedDB Offline Queue")]
            DClient["Driver React Client (Zustand + TanStack)"]
            GPS -->|"Coordinates (5s Interval)"| DClient
            DClient <-->|"Offline Cache / Replay"| IDB
        end

        subgraph CompanyUser["Company Management Portal"]
            MDash["React Dashboard (Google Maps JS API)"]
            MState["Fleet State Store (Zustand)"]
            MDash <--> MState
        end

        subgraph PublicUser["Temporary Public / Client Tracking"]
            PubTrack["Public Tracking Viewer (Minimalist Map UI)"]
        end
    end

    subgraph EdgeGateway["Reverse Proxy & Edge Gateway"]
        Nginx["NGINX Reverse Proxy / TLS 1.3 Termination / Rate Limiter"]
    end

    subgraph BackendCluster["Application Layer (FastAPI Asynchronous Engine)"]
        FAPIGW["FastAPI Gateway (Uvicorn Workers)"]
        AuthModule["JWT Auth & RBAC Middleware"]
        JourneySvc["Journey & Token Lifecycle Service"]
        GPSSvc["GPS Ingestion & Spatial Sanitizer"]
        WSManager["WebSocket Connection Manager"]
        
        FAPIGW --> AuthModule
        FAPIGW --> JourneySvc
        FAPIGW --> GPSSvc
        FAPIGW --> WSManager
    end

    subgraph MemoryTier["In-Memory Cache & Message Broker (Redis Cluster)"]
        RedisPubSub["Redis Pub/Sub (Channel: journey:{id}:telemetry)"]
        RedisGeo["Redis GEO / Hash Cache (vehicle:latest:{id})"]
        RedisTokens["Redis Ephemeral Tokens (token:{hash} -> journey_id)"]
    end

    subgraph PersistenceTier["Persistent Storage Tier"]
        Postgres[("PostgreSQL 16 + PostGIS 3.4")]
        subgraph PGSchemas["Relational & Spatial Tables"]
            TUsers["users"]
            TVehicles["vehicles"]
            TJourneys["journeys"]
            TLocations["locations (Geography Point, Spatial Index)"]
            TLinks["tracking_links (SHA-256 Hashes)"]
            TEvents["trip_events"]
        end
        Postgres --- PGSchemas
    end

    subgraph CloudServices["External Geospatial APIs"]
        GMaps["Google Maps JS API"]
        GRoutes["Google Routes API / Geocoding"]
        GRoads["Google Roads API (Route Snapping)"]
    end

    %% Edge Connections
    DClient -->|"HTTPS REST /api/journeys/{id}/location"| Nginx
    DClient -->|"HTTPS REST /api/journeys/start & end"| Nginx
    MDash -->|"WSS /ws/live-fleet & HTTPS REST"| Nginx
    PubTrack -->|"WSS /ws/track/{token} & HTTPS REST /api/track/{token}"| Nginx

    Nginx -->|"Proxy Pass (HTTP/1.1 & WS Upgrade)"| FAPIGW

    %% Internal Backend Communication
    AuthModule -->|"Verify Credentials"| Postgres
    JourneySvc -->|"Create/Revoke Journey & Token Hash"| Postgres
    JourneySvc -->|"Set/Delete Token Key (TTL)"| RedisTokens
    GPSSvc -->|"Batch Insert / Geography Point"| Postgres
    GPSSvc -->|"GEOADD / HSET Latest Coordinates"| RedisGeo
    GPSSvc -->|"PUBLISH Telemetry Event"| RedisPubSub
    RedisPubSub -->|"SUBSCRIBE"| WSManager
    WSManager -->|"Broadcast Real-Time Position"| Nginx

    %% External Services
    MDash -->|"Load Tiles / Directions"| GMaps
    PubTrack -->|"Render Dynamic Polyline"| GMaps
    GPSSvc -.->|"Optional Reverse Geocode / Snapping"| GRoutes
    GPSSvc -.->|"Post-Trip Clean Route"| GRoads
```

---

## 3. Technology Architecture & Stack Rationale

| Layer | Selected Technology | Architectural Justification |
| :--- | :--- | :--- |
| **Frontend Framework** | React 18 + TypeScript + Vite | Strict type safety across geospatial coordinates and tracking payloads. Lightning-fast Vite HMR for development, highly optimized tree-shaken bundles for mobile PWA. |
| **Styling & UI** | Tailwind CSS + Lucide Icons | Utility-first CSS ensuring lightweight, zero-runtime overhead, high responsiveness on mobile devices and responsive dark/light data-dense operations consoles. |
| **State & Data Fetching** | Zustand + TanStack Query (React Query) | Zustand delivers minimal-boilerplate, non-re-rendering high-frequency state updates for live GPS streaming; TanStack Query handles caching, background revalidation, and optimistic updates for REST resources. |
| **Mobile Runtime** | PWA + Capacitor 6 | Progressive Web App for frictionless instant browser deployment across Android/iOS devices; Capacitor provides a bridge to native Android foreground location services for production background tracking. |
| **Offline Telemetry** | IndexedDB (idb wrapper) | Unlike `localStorage` (limited to 5MB, synchronous, blocking), IndexedDB handles thousands of serialized GPS coordinate tuples asynchronously during cellular blind spots. |
| **Backend Framework** | Python 3.12+ / FastAPI | Native asynchronous I/O (`asyncio`), high-throughput ASGI server (Uvicorn), automatic OpenAPI generation, and seamless integration with Pydantic v2 for sub-millisecond serialization of high-frequency GPS pings. |
| **Database & Spatial** | PostgreSQL 16 + PostGIS 3.4 | PostGIS provides true spatial indexing (`GIST` on `geography(Point, 4326)`), exact geodetic distance calculations on the WGS 84 ellipsoid (`ST_Distance`, `ST_DWithin`), and spatial clustering. |
| **Caching & Messaging**| Redis 7 | Sub-millisecond Pub/Sub messaging for broadcasting GPS coordinates to WebSocket workers; Redis `GEOADD`/`GEOPOS` for instant spatial queries; key expiration (`EX`) for automated token invalidation. |
| **Real-Time Protocol** | WebSockets (RFC 6455) | Full-duplex, low-overhead communication eliminating HTTP polling overhead (saving 95% bandwidth per GPS ping compared to traditional polling). |
| **Reverse Proxy & TLS** | NGINX | Terminates TLS 1.3, multiplexes HTTP/1.1 and WebSockets (`Upgrade` header handling), buffers slow mobile connections, and enforces rate-limiting at the edge. |
| **Mapping Engine** | Google Maps JavaScript API | Industry standard for geospatial fidelity, high-precision vector maps, road geometry, real-time traffic overlays, and smooth coordinate interpolation. |

---

## 4. Driver-to-Backend Communication Architecture

The driver client communicates with the backend via a hybrid architecture:
1. **Control Operations (Start Journey, End Journey, Status Changes, Breakdown/SOS)**: Dispatched over authenticated HTTPS REST endpoints using standard Bearer JWT tokens.
2. **GPS Stream Ingestion**: Dispatched over HTTPS POST (`/api/journeys/{id}/location`) with support for single-ping updates (every 5 seconds) or batched array syncs (`/api/journeys/{id}/location/batch`) when reconnecting from network dropouts.

```mermaid
sequenceDiagram
    autonumber
    actor Driver as Driver (Mobile PWA)
    participant Nginx as NGINX Edge
    participant FastAPI as FastAPI Ingestion Engine
    participant Redis as Redis Cache & PubSub
    participant Postgres as PostgreSQL + PostGIS

    Note over Driver,Postgres: 1. Journey Initiation
    Driver->>Nginx: POST /api/journeys/start {vehicle_id, origin, destination} [Bearer JWT]
    Nginx->>FastAPI: Forward Request
    FastAPI->>FastAPI: Generate Journey UUID & 256-bit Token
    FastAPI->>FastAPI: Compute SHA-256(Token)
    FastAPI->>Postgres: INSERT into journeys & tracking_links
    FastAPI->>Redis: SET token:{hash} = journey_id (EX 86400)
    FastAPI-->>Driver: 201 Created {journey_id, tracking_token, tracking_url}

    Note over Driver,Postgres: 2. High-Frequency Telemetry Ingestion (Every 5s)
    loop Active Journey Telemetry
        Driver->>Driver: Acquire GPS (lat, lng, speed, heading, accuracy)
        Driver->>Nginx: POST /api/journeys/{id}/location {telemetry_payload}
        Nginx->>FastAPI: Stream Location Ping
        FastAPI->>FastAPI: Validate Accuracy (< 50m) & Sanity Checks
        par Persistent Storage
            FastAPI->>Postgres: INSERT INTO locations (geom, speed, heading, ...)
        and Live Cache & Pub/Sub
            FastAPI->>Redis: GEOADD fleet:geo lng lat vehicle_id
            FastAPI->>Redis: HSET vehicle:{id}:latest telemetry_json
            FastAPI->>Redis: PUBLISH journey:{id}:telemetry telemetry_json
        end
        FastAPI-->>Driver: 200 OK {status: "recorded", timestamp}
    end

    Note over Driver,Postgres: 3. Journey Termination
    Driver->>Nginx: POST /api/journeys/{id}/end [Bearer JWT]
    Nginx->>FastAPI: Forward Termination Request
    FastAPI->>Postgres: UPDATE journeys SET status='COMPLETED', ended_at=NOW()
    FastAPI->>Postgres: UPDATE tracking_links SET revoked_at=NOW()
    FastAPI->>Redis: DEL token:{hash}
    FastAPI->>Redis: PUBLISH journey:{id}:telemetry {event: "JOURNEY_COMPLETED"}
    FastAPI-->>Driver: 200 OK {status: "completed", duration, total_distance}
```

---

## 5. GPS Data Transmission & Ingestion Architecture

A critical failure point in naive tracking systems is treating every raw GPS coordinate as genuine and assuming persistent network connectivity. The ingestion engine enforces strict filtering, validation, and deduplication:

```mermaid
flowchart TD
    RawGPS["Raw GPS Sensor Ping (Latitude, Longitude, Accuracy, Speed, Heading, Device Timestamp)"]
    
    subgraph ClientValidation["Client-Side Pre-Filtering"]
        AccCheck{"Accuracy <= 50m?"}
        TimeCheck{"Timestamp > Last Transmitted?"}
        BufferDecision{"Network Online?"}
    end

    RawGPS --> AccCheck
    AccCheck -- "No (Multipath Noise)" --> DiscardNoise["Discard Reading / Log Warning"]
    AccCheck -- "Yes" --> TimeCheck
    TimeCheck -- "No (Out-of-Order Ping)" --> DiscardNoise
    TimeCheck -- "Yes" --> BufferDecision

    BufferDecision -- "Offline" --> EnqueueIDB["Write to IndexedDB Queue with Auto-Increment Index"]
    BufferDecision -- "Online" --> TransmitHTTPS["POST /api/journeys/{id}/location"]

    subgraph BackendSanitization["Backend Validation & Sanitization Engine"]
        JWTVerify{"Valid Active Driver Session?"}
        JourneyState{"Journey Status == IN_PROGRESS?"}
        SpatialSanity{"Speed <= 180 km/h & Haversine Delta Plausible?"}
        DedupCheck{"Duplicate Timestamp or Spatial Delta < 1m?"}
    end

    TransmitHTTPS --> JWTVerify
    JWTVerify -- "Unauthorized" --> HTTP401["Return 401 Unauthorized"]
    JWTVerify -- "Authorized" --> JourneyState
    JourneyState -- "Completed / Revoked" --> HTTP410["Return 410 Gone / 400 Bad Request"]
    JourneyState -- "Active" --> SpatialSanity
    SpatialSanity -- "Impossible Jump (Spoof / Glitch)" --> FlagAnomaly["Log Spatial Anomaly & Reject"]
    SpatialSanity -- "Plausible" --> DedupCheck
    DedupCheck -- "Duplicate Ping" --> AckDup["Return 200 OK (Idempotent Skip Persistence)"]
    DedupCheck -- "Fresh Telemetry" --> DualWrite

    subgraph DualWrite["Dual-Path Storage Architecture"]
        direction TB
        subgraph HotPath["Hot Path (Latency < 5ms)"]
            RGEO["Redis GEOADD & HSET (Latest Snapshot)"]
            RPUB["Redis PUBLISH to Journey Channel"]
        end
        subgraph ColdPath["Cold Path (Asynchronous Persistence)"]
            PGBatch["PostGIS ST_SetSRID(ST_MakePoint(lng, lat), 4326)"]
            PGLog["Audit Table / Trip Events"]
        end
    end

    DualWrite --> HotPath
    DualWrite --> ColdPath
```

---

## 6. Journey Creation & Ephemeral Tracking Link Lifecycle

The tracking link security model is designed to withstand leakage and guarantee zero persistence after journey conclusion:

```mermaid
stateDiagram-v2
    [*] --> Idle: Driver logged in, vehicle selected

    state Idle {
        [*] --> SelectRoute
        SelectRoute --> ReadyToDepart: Origin & Destination confirmed
    }

    ReadyToDepart --> JourneyActive: Driver presses "START JOURNEY"
    
    state JourneyActive {
        [*] --> TokenGeneration
        TokenGeneration: Generate 32-byte cryptographically secure token
        TokenGeneration: Compute SHA-256 hash
        TokenGeneration: Save hash to Postgres & Redis (TTL = 24h)
        TokenGeneration --> LiveStreaming: Return plain token in shareable URL
        
        LiveStreaming --> BreakPaused: Driver clicks "Take Break"
        BreakPaused --> LiveStreaming: Driver clicks "Resume Journey"
        LiveStreaming --> IncidentReported: Driver reports Breakdown / SOS
        IncidentReported --> LiveStreaming: Alert broadcast to Dashboard
    }

    JourneyActive --> JourneyTerminated: Driver presses "END JOURNEY" or Max TTL expires

    state JourneyTerminated {
        [*] --> RevokeToken
        RevokeToken: Mark tracking_links.revoked_at = NOW()
        RevokeToken: Delete Redis token key
        RevokeToken: Broadcast JOURNEY_ENDED to all WebSocket clients
        RevokeToken --> ClosedState: Terminate WebSocket channels
    }

    ClosedState --> [*]

    note right of ClosedState
        Any subsequent HTTP request to /api/track/{token}
        or /ws/track/{token} immediately returns:
        HTTP 410 Gone
        {"error": "This journey has ended. Tracking link expired."}
    end note
```

---

## 7. WebSocket Real-Time Communication Architecture

```mermaid
sequenceDiagram
    autonumber
    actor Driver as Driver App
    actor Manager as Fleet Manager (Dashboard)
    actor PublicUser as External Client (Public Tracking Link)
    participant Nginx as NGINX Gateway
    participant WSManager as FastAPI WebSocket Gateway
    participant Redis as Redis Pub/Sub
    participant IngestSvc as FastAPI Location Ingestion

    Note over Manager,PublicUser: Connection Establishment
    Manager->>Nginx: WSS /ws/live-fleet [Auth JWT]
    Nginx->>WSManager: Upgrade Connection
    WSManager->>WSManager: Authenticate Manager & Register to Fleet Stream

    PublicUser->>Nginx: WSS /ws/track/{token}
    Nginx->>WSManager: Upgrade Connection
    WSManager->>Redis: Check token:{sha256(token)} exists?
    alt Token Valid & Active
        Redis-->>WSManager: Returns journey_id
        WSManager->>WSManager: Register Client to Journey Channel
        WSManager-->>PublicUser: 101 Switching Protocols + Initial Coordinates Payload
    else Token Expired or Revoked
        Redis-->>WSManager: Key Not Found
        WSManager-->>PublicUser: Close Code 4410 (Journey Ended / Expired)
    end

    Note over Driver,WSManager: Telemetry Ingestion & Real-Time Broadcast
    Driver->>IngestSvc: POST /api/journeys/{id}/location {lat, lng, speed, heading}
    IngestSvc->>Redis: PUBLISH journey:{id}:telemetry {data}
    Redis-->>WSManager: Deliver message to subscribed channel workers
    par Broadcast to Company Console
        WSManager-->>Manager: {type: "VEHICLE_MOVED", vehicle_id, lat, lng, speed}
    and Broadcast to Public Viewers
        WSManager-->>PublicUser: {type: "LOCATION_UPDATE", lat, lng, speed, heading, time}
    end

    Note over Driver,PublicUser: Termination Event
    Driver->>IngestSvc: POST /api/journeys/{id}/end
    IngestSvc->>Redis: PUBLISH journey:{id}:telemetry {type: "JOURNEY_ENDED"}
    Redis-->>WSManager: Broadcast Termination
    WSManager-->>Manager: {type: "JOURNEY_COMPLETED", journey_id}
    WSManager-->>PublicUser: {type: "JOURNEY_COMPLETED", message: "Journey completed"}
    WSManager->>PublicUser: Close Code 4410
```

---

## 8. Database Entity Relationship (ER) Diagram

```mermaid
erDiagram
    USERS ||--o{ VEHICLES : "assigned_driver"
    USERS ||--o{ JOURNEYS : "operates (driver)"
    VEHICLES ||--o{ JOURNEYS : "utilized_in"
    JOURNEYS ||--o{ LOCATIONS : "records"
    JOURNEYS ||--o{ TRACKING_LINKS : "generates"
    JOURNEYS ||--o{ TRIP_EVENTS : "triggers"

    USERS {
        uuid id PK "Primary Key (UUIDv4)"
        string name "Full Name"
        string email UK "Unique Corporate Email"
        string password_hash "Argon2id or Bcrypt Hash"
        string role "DRIVER | FLEET_MANAGER | ADMIN"
        boolean is_active "Active Status"
        timestamp created_at "Creation Timestamp"
        timestamp updated_at "Update Timestamp"
    }

    VEHICLES {
        uuid id PK "Primary Key (UUIDv4)"
        string registration_number UK "License Plate (e.g., KA-01-AB-1234)"
        string model "Vehicle Model (e.g., Mercedes Sprinter)"
        string vehicle_type "VAN | TRUCK | CAR | BIKE"
        uuid assigned_driver_id FK "References USERS(id) [Nullable]"
        string status "AVAILABLE | IN_TRANSIT | MAINTENANCE | OFFLINE"
        float battery_or_fuel_level "Fuel / State of Charge %"
        timestamp created_at "Registration Timestamp"
        timestamp updated_at "Update Timestamp"
    }

    JOURNEYS {
        uuid id PK "Primary Key (UUIDv4)"
        uuid vehicle_id FK "References VEHICLES(id)"
        uuid driver_id FK "References USERS(id)"
        string origin_name "Starting Address / Landmark"
        float origin_lat "Origin Latitude"
        float origin_lng "Origin Longitude"
        string destination_name "Destination Address / Landmark"
        float destination_lat "Destination Latitude"
        float destination_lng "Destination Longitude"
        string status "PENDING | IN_PROGRESS | PAUSED | COMPLETED | CANCELLED"
        string description "Optional Trip Notes / Cargo Details"
        float total_distance_km "Accumulated Distance"
        integer duration_seconds "Total Trip Duration"
        timestamp started_at "Trip Start Time"
        timestamp ended_at "Trip End Time [Nullable]"
        timestamp created_at "Created Timestamp"
    }

    LOCATIONS {
        bigserial id PK "BigInt Sequence Primary Key"
        uuid journey_id FK "References JOURNEYS(id) [Indexed]"
        geography coordinates "PostGIS GEOGRAPHY(Point, 4326) [GIST Indexed]"
        float latitude "WGS 84 Latitude (-90 to 90)"
        float longitude "WGS 84 Longitude (-180 to 180)"
        float speed "Instantaneous Speed (km/h)"
        float heading "Heading Angle (0-360 degrees)"
        float accuracy "GPS Accuracy Radius (Meters)"
        float altitude "Elevation (Meters) [Nullable]"
        timestamp recorded_at "Client Timestamp from GPS Device"
        timestamp server_received_at "Server Ingestion Timestamp"
    }

    TRACKING_LINKS {
        uuid id PK "Primary Key (UUIDv4)"
        uuid journey_id FK "References JOURNEYS(id) [Indexed]"
        string token_hash UK "SHA-256 Hash of Public Token (Indexed)"
        timestamp expires_at "Automated Hard Expiration Timestamp"
        timestamp revoked_at "Explicit Revocation Timestamp [Nullable]"
        integer access_count "Telemetry View Counter"
        timestamp created_at "Creation Timestamp"
    }

    TRIP_EVENTS {
        uuid id PK "Primary Key (UUIDv4)"
        uuid journey_id FK "References JOURNEYS(id) [Indexed]"
        string event_type "DEPARTURE | STOP | BREAK_START | BREAK_END | SOS | BREAKDOWN | ARRIVAL"
        float latitude "Incident Latitude"
        float longitude "Incident Longitude"
        jsonb metadata "Arbitrary Telemetry Context (Speed, Battery, Severity)"
        timestamp created_at "Event Timestamp"
    }
```

### Why PostGIS is Essential:
1. **True Geodesic Calculations**: Standard SQL floats calculate distance via Euclidean plane approximations ($\sqrt{\Delta x^2 + \Delta y^2}$), which suffers significant distortion over spherical Earth coordinates. PostGIS `geography(Point, 4326)` implements exact great-circle formulas over the WGS 84 ellipsoid.
2. **Spatial Indexing (`GIST`)**: Enables $O(\log N)$ spatial bounding-box lookups (`&&`, `ST_DWithin`, `ST_Contains`) across millions of historical GPS pings.
3. **Route Simplification**: PostGIS provides `ST_Simplify(ST_MakeLine(geom), 0.0001)` to reduce complex multi-hour polylines into optimized geometry for fast rendering on web maps.

---

## 9. Offline GPS Synchronization Architecture

Mobile phones routinely encounter cellular dead zones (tunnels, basements, remote highways). The driver client implements a resilient store-and-forward architecture:

```mermaid
flowchart TD
    subgraph MobileDevice["Driver Mobile Device"]
        Sensor["Geolocation Watcher (5s Ticker)"]
        NetStatus{"navigator.onLine?"}
        
        Sensor --> NetStatus
        NetStatus -- "No (Dead Zone)" --> StoreLocal
        
        subgraph IndexedDBStore["IndexedDB (Store: offline_gps_queue)"]
            StoreLocal["Insert Record {id: auto, journey_id, lat, lng, speed, heading, accuracy, recorded_at, synced: false}"]
            Badge["Update UI Indicator: 'OFFLINE - Queued (X) pings'"]
            StoreLocal --> Badge
        end

        NetStatus -- "Yes (Connected)" --> CheckQueue{"Unsynced Records in IndexedDB?"}
        
        CheckQueue -- "Yes (Backlog Present)" --> BulkRead["Read Pending Records in Chronological Order (Batch Size = 50)"]
        BulkRead --> TransmitBatch["POST /api/journeys/{id}/location/batch"]
        TransmitBatch --> ServerResponse{"Server 200 OK?"}
        ServerResponse -- "Yes" --> ClearIDB["Delete Synced Records from IndexedDB"]
        ClearIDB --> BadgeOnline["Update UI Indicator: 'ONLINE - Synced'"]
        ServerResponse -- "Network Error" --> RetryLater["Exponential Backoff & Retry"]

        CheckQueue -- "No (Clean Queue)" --> DirectPost["POST /api/journeys/{id}/location (Single Ping)"]
    end

    subgraph BackendIngestion["FastAPI Backend Ingestion"]
        DirectPost --> IngestSingle["Process Single Location Ping"]
        TransmitBatch --> IngestBatch["Process Location Batch (Database Transaction)"]
        IngestBatch --> SortAndDedup["Sort by recorded_at, Deduplicate against DB"]
        SortAndDedup --> BulkInsert["Bulk INSERT into locations"]
        BulkInsert --> UpdateLatest["Update Redis Latest Position (Max recorded_at)"]
    end
```

---

## 10. Deployment Architecture (Docker & Production VPS)

```mermaid
flowchart TB
    InternetUser(("Internet Users & Mobile Drivers"))
    
    subgraph Host["Production Ubuntu VPS (Docker Compose Orchestration)"]
        subgraph Ports["External Network"]
            P80["Port 80 (HTTP)"]
            P443["Port 443 (HTTPS)"]
        end

        subgraph Ingress["Edge Gateway Container"]
            NginxContainer["NGINX Container"]
            Certbot["Certbot TLS Auto-Renewal (Let's Encrypt)"]
            Certbot -.-> NginxContainer
        end

        subgraph FrontendContainers["Static UI Containers / Nginx Mount"]
            DriverUI["Driver PWA (SPA Static Dist)"]
            CompanyUI["Company Dashboard (SPA Static Dist)"]
            PublicUI["Public Tracking Viewer (SPA Static Dist)"]
        end

        subgraph BackendContainers["Backend Services"]
            FastAPIWorker1["FastAPI Worker 1 (Uvicorn ASGI)"]
            FastAPIWorker2["FastAPI Worker 2 (Uvicorn ASGI)"]
        end

        subgraph StateContainers["State & Storage Tier"]
            RedisContainer[("Redis 7.2 (AOF + RDB Persistence)")]
            PostgresContainer[("PostgreSQL 16 + PostGIS 3.4 (Volume Mount)")]
        end
    end

    InternetUser -->|"HTTP Port 80 (Redirect to 443)"| P80
    InternetUser -->|"HTTPS Port 443 (TLS 1.3)"| P443
    P80 --> NginxContainer
    P443 --> NginxContainer

    NginxContainer -->|"Serve /driver"| DriverUI
    NginxContainer -->|"Serve /company"| CompanyUI
    NginxContainer -->|"Serve /track"| PublicUI
    NginxContainer -->|"Reverse Proxy /api & /ws"| FastAPIWorker1
    NginxContainer -->|"Reverse Proxy /api & /ws"| FastAPIWorker2

    FastAPIWorker1 <-->|"Socket / TCP"| RedisContainer
    FastAPIWorker2 <-->|"Socket / TCP"| RedisContainer
    FastAPIWorker1 <-->|"Asyncpg Connection Pool"| PostgresContainer
    FastAPIWorker2 <-->|"Asyncpg Connection Pool"| PostgresContainer
```

---

## 11. Security Architecture & Threat Mitigation Matrix

| Potential Threat / Attack Vector | Architectural Mitigation Mechanism |
| :--- | :--- |
| **Tracking Token Guessing / Brute Force** | 256-bit cryptographic entropy (`secrets.token_urlsafe(32)`) yields $2^{256}$ permutations. Rate limiting at NGINX level ($10\text{ req/min}$ per IP on `/api/track/`). |
| **Database Compromise & Token Leakage** | Database stores strictly `SHA-256(token)`. Even if read access to `tracking_links` table is compromised, original tokens cannot be reversed. |
| **Stale Link Access After Trip Completion** | Multi-tier revocation: (1) Database `revoked_at` timestamp recorded; (2) Redis key instantly deleted; (3) Active WebSocket sessions immediately terminated with custom code `4410`; (4) Subsequent requests yield `HTTP 410 Gone`. |
| **GPS Spoofing / Multipath Jump Attacks** | Spatial anomaly filters in FastAPI verify speed delta ($\le 180\text{ km/h}$) and reasonable acceleration between consecutive timestamps. Coordinates with GPS accuracy $> 50\text{m}$ are rejected. |
| **Cross-Tenant Vehicle / Journey Snooping** | Role-Based Access Control (RBAC): Drivers can only access vehicles assigned to their account; Company managers can only view journeys within their corporate tenant scope. |
| **Google Maps API Key Scraping** | Keys are restricted by HTTP Referrer in Google Cloud Console (`*.yourdomain.com/*`). Sensitive backend calls (Geocoding, Routes, Roads) execute strictly server-side. |
