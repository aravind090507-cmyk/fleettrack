"""Reason codes for location filtering, adjustment, and pipeline execution.
Used for granular transparency on why a position was accepted, rejected, or modified.
"""

from enum import Enum


class PipelineStatus(str, Enum):
    RECORDED = "recorded"
    ACCEPTED = "accepted"
    FILTERED = "filtered"
    REJECTED = "rejected"
    ERROR = "error"


class ReasonCode(str, Enum):
    # Rejection reasons (hard drop / error)
    REJECTED_DEVICE_NOT_FOUND = "rejected_device_not_found"
    REJECTED_DEVICE_DISABLED = "rejected_device_disabled"
    REJECTED_JOURNEY_ENDED = "rejected_journey_ended"
    REJECTED_INVALID = "rejected_invalid"
    REJECTED_ZERO = "rejected_zero"
    REJECTED_PAST = "rejected_past"
    REJECTED_FUTURE = "rejected_future"
    REJECTED_ACCURACY = "rejected_accuracy"
    REJECTED_MAX_SPEED = "rejected_max_speed"
    REJECTED_DAILY_LIMIT = "rejected_daily_limit"

    # Filtered reasons (soft skip / deduplicated / out of bounds)
    FILTERED_DUPLICATE = "filtered_duplicate"
    FILTERED_OUTDATED = "filtered_outdated"
    FILTERED_MIN_PERIOD = "filtered_min_period"
    FILTERED_DISTANCE = "filtered_distance"
    FILTERED_STATIC = "filtered_static"

    # Adjustment reasons (modified and accepted)
    ADJUSTED_CLOCK_SKEW = "adjusted_clock_skew"
    ADJUSTED_JITTER_SNAP = "adjusted_jitter_snap"
    ADJUSTED_SPEED_DERIVED = "adjusted_speed_derived"
    ADJUSTED_BEARING_DERIVED = "adjusted_bearing_derived"
