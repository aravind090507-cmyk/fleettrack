"""Port of Traccar FilterHandlerTest, DistanceHandlerTest, MotionHandlerTest, and PipelineRunner."""

import pytest
from datetime import datetime, timezone, timedelta
from app.pipeline.handlers.filter import FilterHandler
from app.pipeline.handlers.distance import DistanceHandler
from app.pipeline.handlers.time import TimeHandler
from app.pipeline.handlers.motion import MotionHandler
from app.pipeline.events.detector import EventDetector
from app.pipeline.reasons import ReasonCode
from app.pipeline.events.types import EventType


def test_filter_invalid_coordinates():
    handler = FilterHandler({"filter.invalid": True})
    # Latitude > 90
    pos = {"latitude": 95.0, "longitude": 77.0, "valid": True}
    passes, reason = handler.process(pos, None)
    assert passes is False
    assert reason == ReasonCode.REJECTED_INVALID

    # Valid
    pos_ok = {"latitude": 12.9716, "longitude": 77.5946, "valid": True}
    passes, reason = handler.process(pos_ok, None)
    assert passes is True
    assert reason is None


def test_filter_zero_island():
    handler = FilterHandler({"filter.zero": True})
    pos = {"latitude": 0.0, "longitude": 0.0, "valid": True}
    passes, reason = handler.process(pos, None)
    assert passes is False
    assert reason == ReasonCode.REJECTED_ZERO


def test_filter_accuracy():
    handler = FilterHandler({"filter.accuracy": 100.0})
    pos_bad = {"latitude": 12.0, "longitude": 77.0, "accuracy": 150.0, "valid": True}
    passes, reason = handler.process(pos_bad, None)
    assert passes is False
    assert reason == ReasonCode.REJECTED_ACCURACY

    pos_good = {"latitude": 12.0, "longitude": 77.0, "accuracy": 20.0, "valid": True}
    passes, reason = handler.process(pos_good, None)
    assert passes is True


def test_filter_duplicate():
    handler = FilterHandler({"filter.duplicate": True})
    t0 = datetime(2026, 11, 10, 10, 0, 0, tzinfo=timezone.utc)
    p1 = {"latitude": 12.9716, "longitude": 77.5946, "recorded_at": t0, "valid": True}
    p2 = {"latitude": 12.9716, "longitude": 77.5946, "recorded_at": t0, "valid": True}
    passes, reason = handler.process(p2, p1)
    assert passes is False
    assert reason == ReasonCode.FILTERED_DUPLICATE


def test_filter_max_speed_teleport_guard():
    handler = FilterHandler({"filter.maxSpeed": 250.0}) # 250 km/h limit
    t0 = datetime(2026, 11, 10, 10, 0, 0, tzinfo=timezone.utc)
    t1 = t0 + timedelta(seconds=1) # 1 second later
    # Bangalore to Delhi (~1700 km in 1 second)
    p0 = {"latitude": 12.9716, "longitude": 77.5946, "recorded_at": t0, "valid": True}
    p1 = {"latitude": 28.6139, "longitude": 77.2090, "recorded_at": t1, "valid": True}
    passes, reason = handler.process(p1, p0)
    assert passes is False
    assert reason == ReasonCode.REJECTED_MAX_SPEED


def test_distance_handler_stationary_jitter_snap():
    handler = DistanceHandler({"coordinates.filter": True, "coordinates.minError": 10.0})
    p0 = {"latitude": 12.9716, "longitude": 77.5946, "speed": 0.0, "total_distance_m": 100.0}
    # Jitter displacement of ~3 meters while stationary
    p1 = {"latitude": 12.97162, "longitude": 77.5946, "speed": 0.0}
    dist_m, total_dist_m, adj = handler.process(p1, p0)

    # Must snap coordinates to p0, zero distance, and not inflate total_distance_m!
    assert dist_m == 0.0
    assert total_dist_m == 100.0
    assert adj.get("snapped_to_previous") is True
    assert adj.get("latitude") == 12.9716


def test_distance_handler_true_movement():
    handler = DistanceHandler({"coordinates.filter": True, "coordinates.minError": 10.0})
    p0 = {"latitude": 12.9716, "longitude": 77.5946, "speed": 40.0, "total_distance_m": 0.0}
    # Vehicle drives ~50 meters
    p1 = {"latitude": 12.97205, "longitude": 77.5946, "speed": 45.0}
    dist_m, total_dist_m, adj = handler.process(p1, p0)

    assert dist_m > 40.0
    assert total_dist_m == dist_m
    assert "snapped_to_previous" not in adj


def test_motion_handler_threshold():
    handler = MotionHandler({"speed.motionThreshold": 2.0})
    assert handler.process({"speed": 0.5}) is False
    assert handler.process({"speed": 1.9}) is False
    assert handler.process({"speed": 2.5}) is True
    assert handler.process({"speed": 50.0}) is True


def test_event_detector_transitions():
    detector = EventDetector({"speed.overspeedThreshold": 80.0})
    t0 = datetime(2026, 11, 10, 10, 0, 0, tzinfo=timezone.utc)
    t1 = t0 + timedelta(seconds=5)

    # 1. Stopped -> Moving transition
    p_stopped = {"latitude": 12.0, "longitude": 77.0, "speed": 0.0, "motion": False, "recorded_at": t0}
    p_moving = {"latitude": 12.001, "longitude": 77.0, "speed": 30.0, "motion": True, "recorded_at": t1}
    events = detector.detect(p_moving, p_stopped, company_id="c1", device_id="d1")
    assert any(e["type"] == EventType.DEVICE_MOVING.value for e in events)

    # 2. Overspeed transition (30 -> 90 km/h)
    p_fast = {"latitude": 12.003, "longitude": 77.0, "speed": 95.0, "motion": True, "recorded_at": t1 + timedelta(seconds=5)}
    events_fast = detector.detect(p_fast, p_moving, company_id="c1", device_id="d1")
    assert any(e["type"] == EventType.DEVICE_OVERSPEED.value for e in events_fast)

    # 3. Geofence enter/exit
    p_gf1 = {"latitude": 12.0, "longitude": 77.0, "motion": True, "geofence_ids": ["gf-1"], "recorded_at": t0}
    p_gf2 = {"latitude": 12.0, "longitude": 77.0, "motion": True, "geofence_ids": ["gf-2"], "recorded_at": t1}
    events_gf = detector.detect(p_gf2, p_gf1, company_id="c1", device_id="d1")
    types = [e["type"] for e in events_gf]
    assert EventType.GEOFENCE_EXIT.value in types
    assert EventType.GEOFENCE_ENTER.value in types
