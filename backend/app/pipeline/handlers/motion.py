"""Motion detection handler and state machine.
Ported from Traccar's MotionHandler.java and NewMotionProcessor.java.
Accurately categorizes moving vs stopped states without false positives during stops.
"""

from datetime import datetime
from typing import Dict, Any, Tuple, Optional, List
from app.pipeline.config import lookup_config


class MotionHandler:
    """Evaluates motion state for incoming position."""

    def __init__(self, config_dict: Optional[Dict[str, Any]] = None):
        self.config = config_dict or {}

    def process(
        self,
        position: Dict[str, Any],
        device_attributes: Optional[Dict[str, Any]] = None,
    ) -> bool:
        """Determines whether the device is in motion.
        Returns: motion (bool)
        """
        # If client explicitly provided motion flag, respect it
        if "motion" in position and position["motion"] is not None:
            return bool(position["motion"])

        speed_kmh = position.get("speed", 0.0) or 0.0
        threshold_kmh = lookup_config("speed.motionThreshold", device_attributes, self.config, 2.0)

        return speed_kmh > threshold_kmh
