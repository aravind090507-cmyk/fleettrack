"""Geofence containment handler.
Ported from Traccar's GeofenceHandler.java.
Evaluates which assigned geofences contain the current position.
"""

from typing import Dict, Any, List, Optional
from app.pipeline import geo


class GeofenceHandler:
    """Evaluates position containment against active geofences."""

    def process(
        self,
        position: Dict[str, Any],
        geofences: List[Dict[str, Any]],
    ) -> List[str]:
        """Returns list of matched geofence IDs containing this point."""
        lat = position.get("latitude", 0.0)
        lon = position.get("longitude", 0.0)

        matched_ids: List[str] = []

        for gf in geofences:
            gf_id = gf.get("id")
            geom_data = gf.get("geometry")
            if not gf_id or not geom_data:
                continue

            try:
                evaluator = geo.parse_geometry(geom_data)
                if evaluator.contains_point(lat, lon):
                    matched_ids.append(gf_id)
            except Exception:
                # Malformed geometry safely skipped
                continue

        return matched_ids
