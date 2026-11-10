"""Standard telematics event types ported from Traccar Event model.
"""

from enum import Enum


class EventType(str, Enum):
    DEVICE_MOVING = "deviceMoving"
    DEVICE_STOPPED = "deviceStopped"
    DEVICE_OVERSPEED = "deviceOverspeed"
    GEOFENCE_ENTER = "geofenceEnter"
    GEOFENCE_EXIT = "geofenceExit"
    DEVICE_ONLINE = "deviceOnline"
    DEVICE_UNKNOWN = "deviceUnknown"
    DEVICE_OFFLINE = "deviceOffline"
    ALARM = "alarm"
