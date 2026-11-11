"""Unit conversions for telematics coordinates, distance, speed, and time.
Ported from Traccar UnitsConverter.
"""

MPS_TO_KMH = 3.6
KMH_TO_MPS = 1.0 / 3.6
METERS_TO_KM = 0.001
KM_TO_METERS = 1000.0


def kmh_from_mps(mps: float) -> float:
    return mps * MPS_TO_KMH


def mps_from_kmh(kmh: float) -> float:
    return kmh * KMH_TO_MPS


def km_from_meters(meters: float) -> float:
    return meters * METERS_TO_KM


def meters_from_km(km: float) -> float:
    return km * KM_TO_METERS
