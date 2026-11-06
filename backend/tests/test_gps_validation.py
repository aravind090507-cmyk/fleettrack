from datetime import datetime, timedelta, timezone
from app.services.gps_service import GPSValidator


def test_gps_coordinate_bounds():
    # Valid
    assert GPSValidator.are_coordinates_valid(12.9716, 77.5946) is True
    assert GPSValidator.are_coordinates_valid(0.0, 0.0) is True
    assert GPSValidator.are_coordinates_valid(-90.0, -180.0) is True
    assert GPSValidator.are_coordinates_valid(90.0, 180.0) is True

    # Invalid latitude
    assert GPSValidator.are_coordinates_valid(90.1, 77.5) is False
    assert GPSValidator.are_coordinates_valid(-91.0, 77.5) is False

    # Invalid longitude
    assert GPSValidator.are_coordinates_valid(12.9, 180.1) is False
    assert GPSValidator.are_coordinates_valid(12.9, -181.0) is False


def test_gps_timestamp_validation():
    now = datetime.now(timezone.utc)

    # Valid current timestamp
    assert GPSValidator.is_timestamp_valid(now) is True
    # Valid 10 minutes ago
    assert GPSValidator.is_timestamp_valid(now - timedelta(minutes=10)) is True

    # Future timestamp (> 60s)
    future = now + timedelta(seconds=120)
    assert GPSValidator.is_timestamp_valid(future) is False

    # Stale timestamp (> 24 hours ago)
    old = now - timedelta(hours=25)
    assert GPSValidator.is_timestamp_valid(old) is False


def test_gps_speed_and_accuracy():
    # Valid highway speeds
    assert GPSValidator.is_speed_plausible(0.0) is True
    assert GPSValidator.is_speed_plausible(60.0) is True
    assert GPSValidator.is_speed_plausible(120.0) is True

    # Impossible road speed
    assert GPSValidator.is_speed_plausible(250.0) is False
    assert GPSValidator.is_speed_plausible(-5.0) is False

    # Accuracy check
    assert GPSValidator.is_accuracy_valid(5.0) is True
    assert GPSValidator.is_accuracy_valid(80.0) is True
    assert GPSValidator.is_accuracy_valid(250.0) is False


def test_gps_displacement_teleportation():
    t1 = datetime(2026, 11, 5, 12, 0, 0, tzinfo=timezone.utc)
    # 1 second later
    t2 = datetime(2026, 11, 5, 12, 0, 1, tzinfo=timezone.utc)

    # 10 meters in 1s is plausible (~36 km/h)
    assert GPSValidator.is_displacement_plausible(12.9716, 77.5946, t1, 12.97165, 77.59465, t2) is True

    # 50 kilometers in 1s is impossible teleportation
    assert GPSValidator.is_displacement_plausible(12.9716, 77.5946, t1, 13.5000, 77.5946, t2) is False
