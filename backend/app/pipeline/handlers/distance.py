"""Distance calculation and accuracy-aware jitter snap gate.
Ported directly from Traccar's DistanceHandler.java.
Eliminates stationary distance drift while accurately accumulating total distance.
"""

from typing import Dict, Any, Tuple, Optional
from app.pipeline import geo
from app.pipeline.reasons import ReasonCode
from app.pipeline.config import lookup_config


class DistanceHandler:
    """Calculates distance between fixes and applies jitter suppression gate."""

    def __init__(self, config_dict: Optional[Dict[str, Any]] = None):
        self.config = config_dict or {}

    def process(
        self,
        position: Dict[str, Any],
        last_position: Optional[Dict[str, Any]],
        device_attributes: Optional[Dict[str, Any]] = None,
    ) -> Tuple[float, float, Dict[str, Any]]:
        """Processes position distance and applies coordinates jitter snap gate.
        Returns: (distance_m, total_distance_m, adjusted_fields)
        """
        lat = position.get("latitude", 0.0)
        lon = position.get("longitude", 0.0)
        speed_kmh = position.get("speed", 0.0) or 0.0

        distance_m = 0.0
        total_distance_m = 0.0
        adjusted: Dict[str, Any] = {}

        if last_position is not None:
            last_lat = last_position.get("latitude", 0.0)
            last_lon = last_position.get("longitude", 0.0)
            total_distance_m = last_position.get("total_distance_m", 0.0) or 0.0

            # Calculate geodesic distance
            distance_m = geo.distance(last_lat, last_lon, lat, lon)

            # Jitter gate
            filter_coords = lookup_config("coordinates.filter", device_attributes, self.config, True)
            min_error = lookup_config("coordinates.minError", device_attributes, self.config, 10.0) # meters
            max_error = lookup_config("coordinates.maxError", device_attributes, self.config, 0.0)
            motion_thresh = lookup_config("speed.motionThreshold", device_attributes, self.config, 2.0) # km/h

            # If vehicle is stationary according to Doppler speed, or displacement is within jitter radius
            is_stationary_speed = speed_kmh <= motion_thresh
            is_within_jitter_noise = min_error > 0 and distance_m <= min_error

            if filter_coords and last_lat != 0.0 and last_lon != 0.0:
                if is_stationary_speed or is_within_jitter_noise:
                    # Snap to previous coordinate and zero distance
                    adjusted["latitude"] = last_lat
                    adjusted["longitude"] = last_lon
                    adjusted["snapped_to_previous"] = True
                    adjusted["jitter_filtered"] = True
                    distance_m = 0.0
                elif max_error > 0 and distance_m > max_error:
                    # Extreme single-ping jump
                    adjusted["latitude"] = last_lat
                    adjusted["longitude"] = last_lon
                    distance_m = 0.0

            # Derive bearing if missing or stationary
            if distance_m > 0 and position.get("heading") is None or position.get("heading") == 0:
                derived_heading = geo.bearing(last_lat, last_lon, lat, lon)
                adjusted["heading"] = round(derived_heading, 1)

        total_distance_m += distance_m
        return distance_m, total_distance_m, adjusted
