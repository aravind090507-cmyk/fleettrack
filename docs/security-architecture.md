# Security Architecture & Cryptographic Token Engine
## Corporate Fleet Tracking and Geospatial Navigation System

---

## 1. Threat Model & Security Posture

Corporate fleet tracking data involves critical business intelligence, operational routes, and driver privacy. The security architecture addresses six specific threat vectors:

1. **Unauthorized Tracking Link Access**: Eavesdroppers intercepting or guessing tracking URLs.
2. **Persistent Stale Links**: Former clients continuing to monitor vehicles after delivery completion.
3. **Driver Impersonation & Coordinate Injection**: Attackers submitting false telemetry to fake delivery routes.
4. **Cross-Tenant Data Exposure**: Corporate managers seeing vehicles belonging to competitors.
5. **Database Breach & Link Extraction**: Attackers obtaining database dumps to access tracking links.
6. **Denial of Service & Replay Flooding**: Scripted bots overloading GPS ingestion endpoints.

---

## 2. Ephemeral Tracking Token Cryptography

### 2.1 Token Generation
When a driver clicks **START JOURNEY**, the backend generates a token using Python's OS-level cryptographically secure pseudo-random number generator (`secrets.token_urlsafe`):
- **Entropy**: 32 bytes (256 bits) of entropy, base64url encoded (producing a 43-character URL-safe string).
- **Collision Probability**: Infinitesimal ($< 1 \text{ in } 10^{77}$).
```python
import secrets
import hashlib

def generate_journey_token() -> tuple[str, str]:
    raw_token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(raw_token.encode('utf-8')).hexdigest()
    return raw_token, token_hash
```

### 2.2 Token Storage Strategy
- **Plaintext Token**: Returned **only once** in the response to the driver who initiated the journey.
- **Database (`tracking_links`)**: Stores exclusively the `token_hash` (hex-encoded SHA-256).
- **Redis Cache**: Stores `token:{token_hash} -> journey_id` with an explicit TTL (24 hours max).
- Even if a bad actor gains full SQL read access to the database, they cannot reverse the SHA-256 hash to fabricate valid tracking URLs.

### 2.3 Instantaneous Revocation Mechanics
When the driver clicks **END JOURNEY**:
1. PostgreSQL transaction executes:
   ```sql
   UPDATE journeys SET status = 'COMPLETED', ended_at = NOW() WHERE id = :journey_id;
   UPDATE tracking_links SET revoked_at = NOW() WHERE journey_id = :journey_id;
   ```
2. Redis key `token:{token_hash}` is evicted via `DEL`.
3. An event `{ "type": "JOURNEY_COMPLETED" }` is published across Redis Pub/Sub.
4. Connected WebSocket sessions are severed with RFC 6455 custom code `4410`.
5. Any subsequent HTTP `GET /api/track/{token}` computes `SHA-256(token)`, detects `revoked_at IS NOT NULL` (or missing key), and immediately returns:
   ```http
   HTTP/1.1 410 Gone
   Content-Type: application/json

   {
     "detail": "This journey has ended. Tracking access is no longer available."
   }
   ```

---

## 3. Role-Based Access Control (RBAC) Matrix

| Endpoint Group | DRIVER Role | FLEET_MANAGER Role | ADMIN Role | Public Viewer (Token) |
| :--- | :---: | :---: | :---: | :---: |
| `/api/auth/*` | Self | Self | All Users | None |
| `/api/vehicles` (Read) | Assigned only | All fleet | All fleet | None |
| `/api/vehicles` (Write) | Forbidden | Allowed | Allowed | None |
| `/api/journeys/start` | Allowed | Forbidden | Allowed | None |
| `/api/journeys/end` | Allowed (Own trip) | Overwrite permitted | Allowed | None |
| `/api/journeys/active` | Own active trip | All fleet active | All fleet active | None |
| `/api/journeys/history` | Own history | Full corporate history | Full history | None |
| `/api/journeys/{id}/location` (Post) | Allowed (Own active trip) | Forbidden | Forbidden | None |
| `/api/track/{token}` (Read) | Read-only | Read-only | Read-only | Allowed (Active only) |
| `/ws/track/{token}` | N/A | N/A | N/A | Allowed (Active only) |
| `/ws/live-fleet` | Forbidden | Allowed | Allowed | Forbidden |

---

## 4. Google Maps API Key Protection

To prevent unauthorized consumption of Google Maps quotas:
1. **Frontend Maps JavaScript API Key**: Restricted in Google Cloud Console via HTTP Referrer restrictions (`https://fleet.yourdomain.com/*`).
2. **Backend Server-Side Services**: Geocoding, Directions, and Roads API calls are executed strictly from FastAPI workers using IP-restricted credentials stored in environment variables, completely shielded from client inspection.
