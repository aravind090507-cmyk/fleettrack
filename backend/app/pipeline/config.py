"""Layered configuration and attribute resolution for telematics devices.
Mirroring Traccar's AttributeUtil.lookup (device attributes -> company settings -> system defaults).
"""

from typing import Any, Dict, Optional

import os
from typing import Any, Dict, Optional

# Profiles for vehicle vs walking/indoor test modes
PROFILES: Dict[str, Dict[str, Any]] = {
    "vehicle": {
        "filter.accuracy": 150.0,
        "coordinates.minError": 10.0,
        "speed.motionThreshold": 2.0,
        "speed.overspeedThreshold": 100.0,
        "report.trip.minimalTripDistance": 100.0,
        "report.trip.minimalTripDuration": 30,
        "report.trip.minimalParkingDuration": 120,
    },
    "walk_test": {
        "filter.accuracy": 300.0,
        "coordinates.minError": 3.0,
        "speed.motionThreshold": 0.5,
        "speed.overspeedThreshold": 25.0,
        "report.trip.minimalTripDistance": 10.0,
        "report.trip.minimalTripDuration": 10,
        "report.trip.minimalParkingDuration": 30,
    },
}

# System defaults matching Traccar keys
DEFAULT_CONFIG: Dict[str, Any] = {
    # Filters
    "filter.invalid": True,
    "filter.zero": True,
    "filter.duplicate": True,
    "filter.outdated": False,
    "filter.future": 86400,        # 24 hours in seconds
    "filter.past": 259200,         # 72 hours (3 days) in seconds
    "filter.accuracy": 200.0,      # meters
    "filter.maxSpeed": 0,          # km/h (0 = disabled by default, matching Traccar)
    "filter.minPeriod": 0,         # seconds (0 = disabled)
    "filter.distance": 0.0,        # meters (0 = disabled)
    "filter.static": False,

    # Jitter & coordinates filter
    "coordinates.filter": True,
    "coordinates.minError": 10.0,  # meters (stationary jitter threshold)
    "coordinates.maxError": 0.0,   # meters (0 = unlimited)

    # Time skew
    "time.clockSkewThreshold": 120.0,  # seconds (if |device_time - server_time| > 120s, correct)

    # Motion detection & events
    "speed.motionThreshold": 2.0,       # km/h (below 2 km/h is stationary)
    "speed.overspeedThreshold": 100.0,  # km/h
    "speed.overspeedMinimalDuration": 10, # seconds

    # Status sweep
    "status.timeout": 120,         # seconds before device marked unknown
}

# Apply environment profile if configured
_active_profile_name = os.environ.get("TELEMATICS_PROFILE", "vehicle")
if _active_profile_name in PROFILES:
    DEFAULT_CONFIG.update(PROFILES[_active_profile_name])


def lookup_config(
    key: str,
    device_attributes: Optional[Dict[str, Any]] = None,
    company_settings: Optional[Dict[str, Any]] = None,
    default: Any = None,
) -> Any:
    """Resolves attribute with priority: device -> company -> system default -> caller fallback."""
    if device_attributes and key in device_attributes:
        return device_attributes[key]
    if company_settings and key in company_settings:
        return company_settings[key]
    if key in DEFAULT_CONFIG:
        return DEFAULT_CONFIG[key]
    return default
