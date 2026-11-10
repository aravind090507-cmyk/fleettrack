"""Time skew and stale/future point validation handler.
Detects phone clock drift, applies offset adjustments, and bounds ancient/future fixes.
"""

from datetime import datetime, timezone, timedelta
from typing import Dict, Any, Tuple, Optional
from app.pipeline.reasons import ReasonCode
from app.pipeline.config import lookup_config


class TimeHandler:
    """Handles device clock drift, clock skew logging, and past/future validation."""

    def __init__(self, config_dict: Optional[Dict[str, Any]] = None):
        self.config = config_dict or {}

    def process(
        self,
        position: Dict[str, Any],
        device_attributes: Optional[Dict[str, Any]] = None,
        server_time: Optional[datetime] = None,
    ) -> Tuple[bool, Optional[ReasonCode], Dict[str, Any]]:
        """Validates position timestamp against server time.
        Returns: (is_valid, optional_reason, adjusted_fields)
        """
        now = server_time or datetime.now(timezone.utc)
        device_time: datetime = position.get("device_time") or position.get("recorded_at")

        if device_time is None:
            device_time = now

        # Ensure tz-aware UTC
        if device_time.tzinfo is None:
            device_time = device_time.replace(tzinfo=timezone.utc)
        if now.tzinfo is None:
            now = now.replace(tzinfo=timezone.utc)

        skew_threshold_s = lookup_config("time.clockSkewThreshold", device_attributes, self.config, 120.0)
        past_limit_s = lookup_config("filter.past", device_attributes, self.config, 259200) # 72 hours
        future_limit_s = lookup_config("filter.future", device_attributes, self.config, 86400) # 24 hours

        diff_s = (device_time - now).total_seconds()
        skew_ms = diff_s * 1000.0

        adjusted = {}

        # 1. Past check (older than 72 hours)
        if past_limit_s > 0 and diff_s < -past_limit_s:
            return False, ReasonCode.REJECTED_PAST, {}

        # 2. Future check (more than 24 hours ahead)
        if future_limit_s > 0 and diff_s > future_limit_s:
            return False, ReasonCode.REJECTED_FUTURE, {}

        # 3. Moderate clock skew (|diff| > skew_threshold_s, e.g. phone clock 2 min ahead)
        # In Traccar, we track clock skew in attributes. If ahead, clamp or offset device_time
        if abs(diff_s) > skew_threshold_s:
            adjusted["clockSkewMs"] = skew_ms
            # If the device time is in the future relative to server time, clamp to server_time
            if diff_s > 0:
                adjusted["recorded_at"] = now
                adjusted["device_time"] = device_time
                adjusted["skew_adjusted"] = True
                return True, None, adjusted

        return True, None, {"clockSkewMs": skew_ms}
