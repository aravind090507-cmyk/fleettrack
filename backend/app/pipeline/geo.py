"""Geodesic distance calculations, geometric algorithms, and geofence evaluators.
Ported directly from Traccar's DistanceCalculator, GeofenceCircle, GeofencePolygon,
and GeofencePolyline.
"""

import math
import re
from typing import List, Tuple, Optional, Dict, Any

EQUATORIAL_EARTH_RADIUS = 6378137.0
DEG_TO_RAD = math.pi / 180.0
RAD_TO_DEG = 180.0 / math.pi


def distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Haversine distance between two coordinates in meters."""
    dlong = (lon2 - lon1) * DEG_TO_RAD
    dlat = (lat2 - lat1) * DEG_TO_RAD
    sin_dlat = math.sin(dlat / 2.0)
    sin_dlong = math.sin(dlong / 2.0)
    a = (sin_dlat * sin_dlat
         + math.cos(lat1 * DEG_TO_RAD) * math.cos(lat2 * DEG_TO_RAD) * sin_dlong * sin_dlong)
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(max(0.0, 1.0 - a)))
    return EQUATORIAL_EARTH_RADIUS * c


def bearing(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Spherical forward azimuth (bearing) from point 1 to point 2 in degrees [0, 360)."""
    phi1 = lat1 * DEG_TO_RAD
    phi2 = lat2 * DEG_TO_RAD
    delta_lambda = (lon2 - lon1) * DEG_TO_RAD
    y = math.sin(delta_lambda) * math.cos(phi2)
    x = math.cos(phi1) * math.sin(phi2) - math.sin(phi1) * math.cos(phi2) * math.cos(delta_lambda)
    theta = math.atan2(y, x)
    return (theta * RAD_TO_DEG + 360.0) % 360.0


def distance_to_line(
    point_lat: float, point_lon: float,
    lat1: float, lon1: float,
    lat2: float, lon2: float,
) -> float:
    """Perpendicular distance from a point to a line segment in meters."""
    d0 = distance(point_lat, point_lon, lat1, lon1)
    d1 = distance(lat1, lon1, lat2, lon2)
    d2 = distance(lat2, lon2, point_lat, point_lon)
    if d1 == 0:
        return d0

    d0_squared = d0 * d0
    d1_squared = d1 * d1
    d2_squared = d2 * d2

    if d0_squared > d1_squared + d2_squared:
        return d2
    if d2_squared > d1_squared + d0_squared:
        return d0

    half_p = (d0 + d1 + d2) * 0.5
    area = math.sqrt(max(0.0, half_p * (half_p - d0) * (half_p - d1) * (half_p - d2)))
    return 2.0 * area / d1


def _direction(ax: float, ay: float, bx: float, by: float, cx: float, cy: float) -> float:
    return (cx - ax) * (by - ay) - (cy - ay) * (bx - ax)


def _on_segment(ax: float, ay: float, bx: float, by: float, px: float, py: float) -> bool:
    return (min(ax, bx) <= px <= max(ax, bx) and min(ay, by) <= py <= max(ay, by))


def segments_intersect(
    ax1: float, ay1: float, ax2: float, ay2: float,
    bx1: float, by1: float, bx2: float, by2: float,
) -> bool:
    """Checks whether segment a and segment b intersect."""
    d1 = _direction(bx1, by1, bx2, by2, ax1, ay1)
    d2 = _direction(bx1, by1, bx2, by2, ax2, ay2)
    d3 = _direction(ax1, ay1, ax2, ay2, bx1, by1)
    d4 = _direction(ax1, ay1, ax2, ay2, bx2, by2)

    if (((d1 > 0 and d2 < 0) or (d1 < 0 and d2 > 0)) and
            ((d3 > 0 and d4 < 0) or (d3 < 0 and d4 > 0))):
        return True
    if d1 == 0 and _on_segment(bx1, by1, bx2, by2, ax1, ay1):
        return True
    if d2 == 0 and _on_segment(bx1, by1, bx2, by2, ax2, ay2):
        return True
    if d3 == 0 and _on_segment(ax1, ay1, ax2, ay2, bx1, by1):
        return True
    return d4 == 0 and _on_segment(ax1, ay1, ax2, ay2, bx2, by2)


def get_latitude_delta(meters: float) -> float:
    return meters / 111320.0


def get_longitude_delta(meters: float, latitude: float) -> float:
    return meters / (111320.0 * math.cos(math.radians(latitude)))


class GeofenceCircle:
    """Circular geofence with center lat/lon and radius in meters."""

    def __init__(self, center_lat: float, center_lon: float, radius_m: float):
        self.center_lat = center_lat
        self.center_lon = center_lon
        self.radius_m = radius_m

    @classmethod
    def from_wkt(cls, wkt: str) -> "GeofenceCircle":
        # Format: CIRCLE (lat lon, radius)
        m = re.match(r"CIRCLE\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*,\s*([-\d.]+)\s*\)", wkt.strip(), re.IGNORECASE)
        if not m:
            raise ValueError(f"Invalid circle WKT: {wkt}")
        return cls(float(m.group(1)), float(m.group(2)), float(m.group(3)))

    def to_wkt(self) -> str:
        return f"CIRCLE ({self.center_lat} {self.center_lon}, {int(self.radius_m) if self.radius_m.is_integer() else self.radius_m})"

    def contains_point(self, lat: float, lon: float) -> bool:
        return distance(self.center_lat, self.center_lon, lat, lon) <= self.radius_m

    def intersects_segment(self, lat1: float, lon1: float, lat2: float, lon2: float) -> bool:
        return distance_to_line(self.center_lat, self.center_lon, lat1, lon1, lat2, lon2) <= self.radius_m


class GeofencePolygon:
    """Polygon geofence using Traccar precomputed ray-casting with antimeridian normalization."""

    def __init__(self, coordinates: List[Tuple[float, float]]):
        if len(coordinates) < 3:
            raise ValueError("Polygon must have at least 3 vertices")
        self.coordinates = coordinates
        poly_corners = len(coordinates)
        self.constant = [0.0] * poly_corners
        self.multiple = [0.0] * poly_corners

        has_positive = any(lon > 90 for _, lon in coordinates)
        has_negative = any(lon < -90 for _, lon in coordinates)
        self.need_normalize = has_positive and has_negative

        j = poly_corners - 1
        for i in range(poly_corners):
            i_lat, i_lon = coordinates[i]
            j_lat, j_lon = coordinates[j]
            norm_i_lon = self._normalize_lon(i_lon)
            norm_j_lon = self._normalize_lon(j_lon)

            if norm_j_lon == norm_i_lon:
                self.constant[i] = i_lon
                self.multiple[i] = 0.0
            else:
                denom = norm_j_lon - norm_i_lon
                self.constant[i] = i_lat - (norm_i_lon * j_lat) / denom + (norm_i_lon * i_lat) / denom
                self.multiple[i] = (j_lat - i_lat) / denom
            j = i

    @classmethod
    def from_wkt(cls, wkt: str) -> "GeofencePolygon":
        # Format: POLYGON ((lat1 lon1, lat2 lon2, ...))
        cleaned = re.sub(r"^POLYGON\s*\(\s*\(\s*", "", wkt.strip(), flags=re.IGNORECASE)
        cleaned = re.sub(r"\s*\)\s*\)$", "", cleaned)
        cleaned = cleaned.replace("(", "").replace(")", "")
        pts: List[Tuple[float, float]] = []
        for pair in cleaned.split(","):
            parts = pair.strip().split()
            if len(parts) >= 2:
                pts.append((float(parts[0]), float(parts[1])))
        return cls(pts)

    def to_wkt(self) -> str:
        pts_str = ", ".join(f"{lat} {lon}" for lat, lon in self.coordinates)
        return f"POLYGON (({pts_str}))"

    def _normalize_lon(self, lon: float) -> float:
        if self.need_normalize and lon < -90:
            return lon + 360.0
        return lon

    def contains_point(self, lat: float, lon: float) -> bool:
        poly_corners = len(self.coordinates)
        lon_norm = self._normalize_lon(lon)
        odd_nodes = False
        j = poly_corners - 1
        for i in range(poly_corners):
            i_lon = self._normalize_lon(self.coordinates[i][1])
            j_lon = self._normalize_lon(self.coordinates[j][1])
            if (i_lon < lon_norm and j_lon >= lon_norm) or (j_lon < lon_norm and i_lon >= lon_norm):
                if lon_norm * self.multiple[i] + self.constant[i] < lat:
                    odd_nodes = not odd_nodes
            j = i
        return odd_nodes

    def intersects_segment(self, lat1: float, lon1: float, lat2: float, lon2: float) -> bool:
        if self.contains_point(lat1, lon1) or self.contains_point(lat2, lon2):
            return True
        j = len(self.coordinates) - 1
        for i in range(len(self.coordinates)):
            if segments_intersect(
                lat1, lon1, lat2, lon2,
                self.coordinates[j][0], self.coordinates[j][1],
                self.coordinates[i][0], self.coordinates[i][1],
            ):
                return True
            j = i
        return False

    def calculate_area(self) -> float:
        """Approximate area in square kilometers."""
        area = 0.0
        poly_corners = len(self.coordinates)
        j = poly_corners - 1
        for i in range(poly_corners):
            lat_i, lon_i = self.coordinates[i]
            lat_j, lon_j = self.coordinates[j]
            area += (lon_j + lon_i) * (lat_j - lat_i)
            j = i
        # Convert degrees to km^2 roughly around latitude
        lat_ref = self.coordinates[0][0]
        factor_x = 111.32 * math.cos(math.radians(lat_ref))
        factor_y = 110.57
        return abs(area * 0.5 * factor_x * factor_y)


class GeofencePolyline:
    """Polyline corridor geofence with distance buffer in meters."""

    def __init__(self, coordinates: List[Tuple[float, float]], distance_m: float = 0.0):
        if len(coordinates) < 2:
            raise ValueError("Polyline must have at least 2 points")
        self.coordinates = coordinates
        self.distance_m = distance_m

    @classmethod
    def from_wkt(cls, wkt: str, distance_m: float = 0.0) -> "GeofencePolyline":
        cleaned = re.sub(r"^LINESTRING\s*\(\s*", "", wkt.strip(), flags=re.IGNORECASE)
        cleaned = re.sub(r"\s*\)$", "", cleaned)
        pts: List[Tuple[float, float]] = []
        for pair in cleaned.split(","):
            parts = pair.strip().split()
            if len(parts) >= 2:
                pts.append((float(parts[0]), float(parts[1])))
        return cls(pts, distance_m)

    def to_wkt(self) -> str:
        pts_str = ", ".join(f"{lat} {lon}" for lat, lon in self.coordinates)
        return f"LINESTRING ({pts_str})"

    def contains_point(self, lat: float, lon: float) -> bool:
        for i in range(1, len(self.coordinates)):
            lat1, lon1 = self.coordinates[i - 1]
            lat2, lon2 = self.coordinates[i]
            if distance_to_line(lat, lon, lat1, lon1, lat2, lon2) <= self.distance_m:
                return True
        return False

    def intersects_segment(self, lat1: float, lon1: float, lat2: float, lon2: float) -> bool:
        for i in range(1, len(self.coordinates)):
            seg_lat1, seg_lon1 = self.coordinates[i - 1]
            seg_lat2, seg_lon2 = self.coordinates[i]
            if segments_intersect(lat1, lon1, lat2, lon2, seg_lat1, seg_lon1, seg_lat2, seg_lon2):
                return True
        return False


def parse_geometry(geometry_dict_or_wkt: Any, buffer_m: float = 0.0):
    """Parses geometry from GeoJSON dict or WKT string into evaluator."""
    if isinstance(geometry_dict_or_wkt, str):
        text = geometry_dict_or_wkt.strip().upper()
        if text.startswith("CIRCLE"):
            return GeofenceCircle.from_wkt(geometry_dict_or_wkt)
        elif text.startswith("POLYGON"):
            return GeofencePolygon.from_wkt(geometry_dict_or_wkt)
        elif text.startswith("LINESTRING"):
            return GeofencePolyline.from_wkt(geometry_dict_or_wkt, buffer_m)
    elif isinstance(geometry_dict_or_wkt, dict):
        kind = geometry_dict_or_wkt.get("type", "").lower()
        if kind == "circle":
            center = geometry_dict_or_wkt.get("center", [0, 0])
            radius = geometry_dict_or_wkt.get("radius", 100.0)
            return GeofenceCircle(center[0], center[1], float(radius))
        elif kind == "polygon":
            coords = geometry_dict_or_wkt.get("coordinates", [[]])[0]
            # GeoJSON coordinates are [lon, lat]
            pts = [(float(c[1]), float(c[0])) for c in coords]
            return GeofencePolygon(pts)
        elif kind == "linestring":
            coords = geometry_dict_or_wkt.get("coordinates", [])
            pts = [(float(c[1]), float(c[0])) for c in coords]
            radius = geometry_dict_or_wkt.get("radius", buffer_m)
            return GeofencePolyline(pts, float(radius))
    raise ValueError(f"Unsupported geometry: {geometry_dict_or_wkt}")
