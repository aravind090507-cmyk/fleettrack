import logging
import math
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional
import httpx

from app.core.config import settings

logger = logging.getLogger("fleettrack.eta_service")


class ETAService:
    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or settings.GOOGLE_MAPS_SERVER_KEY

    async def calculate_eta(
        self,
        origin_lat: float,
        origin_lng: float,
        dest_lat: float,
        dest_lng: float,
        dest_name: str,
    ) -> Dict[str, Any]:
        """
        Calculates ETA using Google Maps Directions API if server key is provided,
        or falls back to road-distance mathematical estimation (never inventing fake API responses).
        """
        now = datetime.now(timezone.utc)

        # 1. Try Google Maps Directions API if key configured
        if self.api_key and self.api_key.strip():
            try:
                async with httpx.AsyncClient(timeout=5.0) as client:
                    resp = await client.get(
                        "https://maps.googleapis.com/maps/api/directions/json",
                        params={
                            "origin": f"{origin_lat},{origin_lng}",
                            "destination": f"{dest_lat},{dest_lng}",
                            "mode": "driving",
                            "departure_time": "now",
                            "key": self.api_key,
                        },
                    )
                    data = resp.json()
                    if data.get("status") == "OK" and data.get("routes"):
                        leg = data["routes"][0]["legs"][0]
                        dist_meters = leg["distance"]["value"]
                        dur_seconds = (
                            leg.get("duration_in_traffic", {}).get("value")
                            or leg["duration"]["value"]
                        )
                        eta_time = now + timedelta(seconds=dur_seconds)
                        return {
                            "destination_name": dest_name,
                            "destination_latitude": dest_lat,
                            "destination_longitude": dest_lng,
                            "distance_meters": dist_meters,
                            "distance_km": round(dist_meters / 1000.0, 2),
                            "distance_text": leg["distance"]["text"],
                            "duration_seconds": dur_seconds,
                            "duration_minutes": round(dur_seconds / 60.0, 1),
                            "duration_text": leg["duration"]["text"],
                            "estimated_arrival_time": eta_time.isoformat(),
                            "calculated_at": now.isoformat(),
                            "source": "google_maps_api",
                        }
                    else:
                        logger.warning(
                            f"Google Maps Directions status: {data.get('status')} - {data.get('error_message')}"
                        )
            except Exception as e:
                logger.error(f"Failed to fetch directions from Google Maps API: {e}")

        # 2. Transparent fallback based on Haversine distance & urban commercial vehicle speeds
        # Urban road factor for road-distance is typically 1.3 - 1.4x straight line distance
        R = 6371000  # meters
        phi1 = math.radians(origin_lat)
        phi2 = math.radians(dest_lat)
        dphi = math.radians(dest_lat - origin_lat)
        dlam = math.radians(dest_lng - origin_lng)
        a = math.sin(dphi / 2.0) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2.0) ** 2
        straight_dist_m = R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

        road_dist_m = straight_dist_m * 1.35  # urban circuity factor
        avg_speed_mps = 35 * 1000 / 3600  # 35 km/h urban construction vehicle avg speed
        dur_seconds = max(60, int(road_dist_m / avg_speed_mps))

        eta_time = now + timedelta(seconds=dur_seconds)
        dist_km = round(road_dist_m / 1000.0, 2)
        dur_min = round(dur_seconds / 60.0, 1)

        return {
            "destination_name": dest_name,
            "destination_latitude": dest_lat,
            "destination_longitude": dest_lng,
            "distance_meters": int(road_dist_m),
            "distance_km": dist_km,
            "distance_text": f"{dist_km} km",
            "duration_seconds": dur_seconds,
            "duration_minutes": dur_min,
            "duration_text": f"{int(dur_min)} mins",
            "estimated_arrival_time": eta_time.isoformat(),
            "calculated_at": now.isoformat(),
            "source": "estimated_fallback",
        }
