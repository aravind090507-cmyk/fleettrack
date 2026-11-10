"""Main filter handler ported directly from Traccar's FilterHandler.java.
Filters out invalid coordinates, null island (0, 0), duplicate timestamps,
excessive horizontal accuracy errors, teleportation jumps (max speed), and rapid bursts (min period).
"""

from datetime import datetime
from typing import Dict, Any, Tuple, Optional
from app.pipeline.reasons import ReasonCode
from app.pipeline.config import lookup_config
from app.pipeline import geo, units


class FilterHandler:
    """Evaluates position against configured filters."""

    def __init__(self, config_dict: Optional[Dict[str, Any]] = None):
        self.config = config_dict or {}

    def process(
        self,
        position: Dict[str, Any],
        last_position: Optional[Dict[str, Any]],
        device_attributes: Optional[Dict[str, Any]] = None,
    ) -> Tuple[bool, Optional[ReasonCode]]:
        """Processes position against filter chain.
        Returns: (passes_filter: bool, rejection_reason: Optional[ReasonCode])
        """
        lat = position.get("latitude", 0.0)
        lon = position.get("longitude", 0.0)
        acc = position.get("accuracy", 0.0)

        # 1. Invalid coordinates
        filter_invalid = lookup_config("filter.invalid", device_attributes, self.config, True)
        if filter_invalid:
            if not position.get("valid", True):
                return False, ReasonCode.REJECTED_INVALID
            if lat > 90.0 or lat < -90.0 or lon > 180.0 or lon < -180.0:
                return False, ReasonCode.REJECTED_INVALID

        # 2. Zero island (0, 0)
        filter_zero = lookup_config("filter.zero", device_attributes, self.config, True)
        if filter_zero and lat == 0.0 and lon == 0.0:
            return False, ReasonCode.REJECTED_ZERO

        # 3. Accuracy filter
        filter_accuracy = lookup_config("filter.accuracy", device_attributes, self.config, 200.0)
        if filter_accuracy > 0 and acc > filter_accuracy:
            return False, ReasonCode.REJECTED_ACCURACY

        if last_position:
            last_lat = last_position.get("latitude", 0.0)
            last_lon = last_position.get("longitude", 0.0)
            curr_time = position.get("recorded_at") or position.get("device_time")
            last_time = last_position.get("recorded_at") or last_position.get("device_time")

            # 4. Duplicate filter (same timestamp and position)
            filter_dup = lookup_config("filter.duplicate", device_attributes, self.config, True)
            if filter_dup and curr_time and last_time and curr_time == last_time:
                if abs(lat - last_lat) < 1e-6 and abs(lon - last_lon) < 1e-6:
                    return False, ReasonCode.FILTERED_DUPLICATE

            if curr_time and last_time:
                time_delta_s = (curr_time - last_time).total_seconds()

                # 5. Min period filter (rate limiting bursts)
                filter_min_period = lookup_config("filter.minPeriod", device_attributes, self.config, 0)
                if filter_min_period > 0 and 0 < time_delta_s < filter_min_period:
                    return False, ReasonCode.FILTERED_MIN_PERIOD

                # 6. Max speed filter (teleportation guard)
                filter_max_speed = lookup_config("filter.maxSpeed", device_attributes, self.config, 250.0)
                if filter_max_speed > 0 and time_delta_s > 0:
                    dist_m = geo.distance(last_lat, last_lon, lat, lon)
                    calculated_kmh = (dist_m / time_delta_s) * 3.6
                    if calculated_kmh > filter_max_speed:
                        return False, ReasonCode.REJECTED_MAX_SPEED

        return True, None
