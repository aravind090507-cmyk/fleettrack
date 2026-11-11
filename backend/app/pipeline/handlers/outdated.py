"""Outdated position handler.
Flags positions that arrived out-of-order relative to the last recorded fix time.
"""

from datetime import datetime
from typing import Dict, Any, Tuple, Optional


class OutdatedHandler:
    """Flags points that arrived out of chronological sequence."""

    def process(
        self,
        position: Dict[str, Any],
        last_position: Optional[Dict[str, Any]],
    ) -> Tuple[bool, bool]:
        """Returns: (is_outdated, should_filter)"""
        if not last_position:
            return False, False

        curr_time = position.get("recorded_at") or position.get("device_time")
        last_time = last_position.get("recorded_at") or last_position.get("device_time")

        if curr_time and hasattr(curr_time, "tzinfo") and curr_time.tzinfo is not None:
            curr_time = curr_time.replace(tzinfo=None)
        if last_time and hasattr(last_time, "tzinfo") and last_time.tzinfo is not None:
            last_time = last_time.replace(tzinfo=None)

        if curr_time and last_time and curr_time < last_time:
            # Arrived out of sequence
            return True, False

        return False, False
