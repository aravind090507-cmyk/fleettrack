"""Port of Traccar DistanceCalculatorTest and Geofence tests."""

import pytest
from app.pipeline.geo import (
    distance,
    distance_to_line,
    segments_intersect,
    GeofenceCircle,
    GeofencePolygon,
    GeofencePolyline,
)


def test_distance():
    # Matches DistanceCalculatorTest.java:
    # assertEquals(7863.0, DistanceCalculator.distance(0.0, 0.0, 0.05, 0.05), 10.0);
    d = distance(0.0, 0.0, 0.05, 0.05)
    assert abs(d - 7863.0) < 10.0


def test_distance_to_line():
    # Matches DistanceCalculatorTest.java:
    # assertEquals(33.0, DistanceCalculator.distanceToLine(56.83801, 60.59748, 56.83777, 60.59833, 56.83766, 60.5968), 5.0);
    d1 = distance_to_line(56.83801, 60.59748, 56.83777, 60.59833, 56.83766, 60.5968)
    assert abs(d1 - 33.0) < 5.0

    # assertEquals(105.0, DistanceCalculator.distanceToLine(56.83753, 60.59508, 56.83777, 60.59833, 56.83766, 60.5968), 5.0);
    d2 = distance_to_line(56.83753, 60.59508, 56.83777, 60.59833, 56.83766, 60.5968)
    assert abs(d2 - 105.0) < 5.0


def test_segments_intersect():
    # Matches DistanceCalculatorTest.java
    assert segments_intersect(0, 0, 2, 2, 0, 2, 2, 0) is True
    assert segments_intersect(0, 0, 1, 1, 2, 2, 3, 3) is False
    assert segments_intersect(0, 0, 2, 2, 2, 2, 4, 0) is True
    assert segments_intersect(0, 0, 2, 0, 1, 0, 3, 0) is True


def test_geofence_circle():
    # Matches GeofenceCircleTest.java:
    # GeofenceGeometry geofenceGeometry = new GeofenceCircle("CIRCLE (55.75414 37.6204, 100)");
    # assertTrue(geofenceGeometry.containsPoint(55.75477, 37.62025));
    # assertFalse(geofenceGeometry.containsPoint(55.75545, 37.61921));
    circle = GeofenceCircle.from_wkt("CIRCLE (55.75414 37.6204, 100)")
    assert circle.contains_point(55.75477, 37.62025) is True
    assert circle.contains_point(55.75545, 37.61921) is False
    assert circle.intersects_segment(55.75214, 37.6204, 55.75614, 37.6204) is True
    assert circle.intersects_segment(55.76414, 37.6204, 55.77414, 37.6204) is False


def test_geofence_polygon():
    # Matches GeofencePolygonTest.java:
    # "POLYGON ((55.75474 37.61823, 55.75513 37.61888, 55.7535 37.6222, 55.75315 37.62165))"
    # assertTrue(geofenceGeometry.containsPoint(55.75476, 37.61915));
    # assertFalse(geofenceGeometry.containsPoint(55.75545, 37.61921));
    poly = GeofencePolygon.from_wkt(
        "POLYGON ((55.75474 37.61823, 55.75513 37.61888, 55.7535 37.6222, 55.75315 37.62165))"
    )
    assert poly.contains_point(55.75476, 37.61915) is True
    assert poly.contains_point(55.75545, 37.61921) is False
    assert poly.intersects_segment(55.7520, 37.61915, 55.7560, 37.61915) is True
    assert poly.intersects_segment(55.76, 37.61915, 55.77, 37.61915) is False


def test_geofence_polygon_antimeridian_180():
    # Matches testContainsPolygon180 from GeofencePolygonTest.java:
    # "POLYGON ((66.9494 179.838, 66.9508 -179.8496, 66.8406 -180.0014))"
    poly = GeofencePolygon.from_wkt(
        "POLYGON ((66.9494 179.838, 66.9508 -179.8496, 66.8406 -180.0014))"
    )
    assert poly.contains_point(66.9015, -180.0096) is True
    assert poly.contains_point(66.9015, 179.991) is True
    assert poly.contains_point(66.8368, -179.8792) is False


def test_geofence_polyline():
    # Matches GeofencePolylineTest.java:
    # "LINESTRING (56.83777 60.59833, 56.83766 60.5968)", 35.0
    line = GeofencePolyline.from_wkt(
        "LINESTRING (56.83777 60.59833, 56.83766 60.5968)", 35.0
    )
    assert line.contains_point(56.83801, 60.59748) is True

    line15 = GeofencePolyline.from_wkt(
        "LINESTRING (56.83777 60.59833, 56.83766 60.5968)", 15.0
    )
    assert line15.contains_point(56.83801, 60.59748) is False
