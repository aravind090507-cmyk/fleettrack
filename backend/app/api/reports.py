"""Reports engine for route traces, trip segmentation, stops, and fleet summaries.
Supports JSON, CSV, and GPX output formats.
"""

import io
import csv
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database.session import get_db
from app.models.location import Location
from app.models.device import Device
from app.models.event import Event
from app.models.user import User
from app.security.dependencies import get_current_user
from app.pipeline import geo, units

router = APIRouter(prefix="/api/reports", tags=["Reports & Telematics Analytics"])


def _format_csv(rows: List[Dict[str, Any]], fieldnames: List[str]) -> str:
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=fieldnames)
    writer.writeheader()
    for row in rows:
        writer.writerow({k: row.get(k, "") for k in fieldnames})
    return output.getvalue()


def _format_gpx(locations: List[Location], track_name: str = "Track") -> str:
    xml = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<gpx version="1.1" creator="FleetTrack AI"',
        ' xmlns="http://www.topografix.com/GPX/1/1">',
        f'  <trk><name>{track_name}</name><trkseg>',
    ]
    for loc in locations:
        t_iso = loc.recorded_at.isoformat() if loc.recorded_at else ""
        xml.append(f'    <trkpt lat="{loc.latitude}" lon="{loc.longitude}">')
        if loc.altitude is not None:
            xml.append(f'      <ele>{loc.altitude}</ele>')
        xml.append(f'      <time>{t_iso}</time>')
        xml.append(f'      <speed>{units.mps_from_kmh(loc.speed):.2f}</speed>')
        xml.append('    </trkpt>')
    xml.append('  </trkseg></trk>')
    xml.append('</gpx>')
    return '\n'.join(xml)


def parse_query_datetime(val: Any) -> datetime:
    if isinstance(val, datetime):
        return val
    s = str(val).strip().replace(" ", "+").replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(s)
    except Exception:
        raise HTTPException(status_code=400, detail=f"Invalid datetime format: {val}")


@router.get("/route")
async def get_route_report(
    device_id: str = Query(...),
    from_time: str = Query(..., alias="from"),
    to_time: str = Query(..., alias="to"),
    output_format: str = Query("json", alias="format"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    dt_from = parse_query_datetime(from_time)
    dt_to = parse_query_datetime(to_time)

    # Verify device belongs to company
    d_stmt = select(Device).where(Device.id == device_id)
    device = (await db.execute(d_stmt)).scalars().first()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    if current_user.company_id and device.company_id != current_user.company_id:
        raise HTTPException(status_code=403, detail="Access denied")

    stmt = (
        select(Location)
        .where(
            Location.device_id == device_id,
            Location.recorded_at >= dt_from,
            Location.recorded_at <= dt_to,
        )
        .order_by(Location.recorded_at.asc())
        .limit(5000)
    )
    locs = (await db.execute(stmt)).scalars().all()

    if output_format.lower() == "gpx":
        gpx_data = _format_gpx(locs, track_name=f"Route_{device.name}")
        return Response(content=gpx_data, media_type="application/gpx+xml", headers={
            "Content-Disposition": f'attachment; filename="route_{device_id}.gpx"'
        })

    rows = [
        {
            "id": l.id,
            "latitude": l.latitude,
            "longitude": l.longitude,
            "speed": l.speed,
            "heading": l.heading,
            "accuracy": l.accuracy,
            "distance_m": l.distance_m,
            "total_distance_m": l.total_distance_m,
            "motion": l.motion,
            "valid": l.valid,
            "timestamp": l.recorded_at.isoformat() if l.recorded_at else "",
        }
        for l in locs
    ]

    if output_format.lower() == "csv":
        csv_data = _format_csv(rows, ["id", "timestamp", "latitude", "longitude", "speed", "heading", "accuracy", "distance_m", "total_distance_m", "motion", "valid"])
        return Response(content=csv_data, media_type="text/csv", headers={
            "Content-Disposition": f'attachment; filename="route_{device_id}.csv"'
        })

    return rows


@router.get("/trips")
async def get_trips_report(
    device_id: str = Query(...),
    from_time: str = Query(..., alias="from"),
    to_time: str = Query(..., alias="to"),
    output_format: str = Query("json", alias="format"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    dt_from = parse_query_datetime(from_time)
    dt_to = parse_query_datetime(to_time)

    d_stmt = select(Device).where(Device.id == device_id)
    device = (await db.execute(d_stmt)).scalars().first()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    if current_user.company_id and device.company_id != current_user.company_id:
        raise HTTPException(status_code=403, detail="Access denied")

    stmt = (
        select(Location)
        .where(
            Location.device_id == device_id,
            Location.recorded_at >= dt_from,
            Location.recorded_at <= dt_to,
        )
        .order_by(Location.recorded_at.asc())
    )
    locs = (await db.execute(stmt)).scalars().all()

    trips = []
    current_trip_pts: List[Location] = []

    for loc in locs:
        if loc.motion:
            current_trip_pts.append(loc)
        else:
            if len(current_trip_pts) >= 2:
                # Segment finished
                t_start = current_trip_pts[0].recorded_at
                t_end = current_trip_pts[-1].recorded_at
                dur = (t_end - t_start).total_seconds()
                dist = sum(p.distance_m for p in current_trip_pts)
                speeds = [p.speed for p in current_trip_pts]
                max_spd = max(speeds) if speeds else 0.0
                avg_spd = (dist / dur * 3.6) if dur > 0 else 0.0

                trips.append({
                    "start_time": t_start.isoformat(),
                    "end_time": t_end.isoformat(),
                    "start_latitude": current_trip_pts[0].latitude,
                    "start_longitude": current_trip_pts[0].longitude,
                    "end_latitude": current_trip_pts[-1].latitude,
                    "end_longitude": current_trip_pts[-1].longitude,
                    "distance_km": round(dist / 1000.0, 3),
                    "duration_seconds": int(dur),
                    "max_speed_kmh": round(max_spd, 1),
                    "average_speed_kmh": round(avg_spd, 1),
                })
            current_trip_pts = []

    # Final segment if currently moving
    if len(current_trip_pts) >= 2:
        t_start = current_trip_pts[0].recorded_at
        t_end = current_trip_pts[-1].recorded_at
        dur = (t_end - t_start).total_seconds()
        dist = sum(p.distance_m for p in current_trip_pts)
        speeds = [p.speed for p in current_trip_pts]
        trips.append({
            "start_time": t_start.isoformat(),
            "end_time": t_end.isoformat(),
            "start_latitude": current_trip_pts[0].latitude,
            "start_longitude": current_trip_pts[0].longitude,
            "end_latitude": current_trip_pts[-1].latitude,
            "end_longitude": current_trip_pts[-1].longitude,
            "distance_km": round(dist / 1000.0, 3),
            "duration_seconds": int(dur),
            "max_speed_kmh": round(max(speeds), 1) if speeds else 0.0,
            "average_speed_kmh": round((dist / dur * 3.6) if dur > 0 else 0.0, 1),
        })

    if output_format.lower() == "csv":
        csv_data = _format_csv(
            trips,
            ["start_time", "end_time", "start_latitude", "start_longitude", "end_latitude", "end_longitude", "distance_km", "duration_seconds", "max_speed_kmh", "average_speed_kmh"],
        )
        return Response(content=csv_data, media_type="text/csv", headers={
            "Content-Disposition": f'attachment; filename="trips_{device_id}.csv"'
        })

    return trips


@router.get("/stops")
async def get_stops_report(
    device_id: str = Query(...),
    from_time: str = Query(..., alias="from"),
    to_time: str = Query(..., alias="to"),
    output_format: str = Query("json", alias="format"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    dt_from = parse_query_datetime(from_time)
    dt_to = parse_query_datetime(to_time)

    d_stmt = select(Device).where(Device.id == device_id)
    device = (await db.execute(d_stmt)).scalars().first()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    if current_user.company_id and device.company_id != current_user.company_id:
        raise HTTPException(status_code=403, detail="Access denied")

    stmt = (
        select(Location)
        .where(
            Location.device_id == device_id,
            Location.recorded_at >= dt_from,
            Location.recorded_at <= dt_to,
        )
        .order_by(Location.recorded_at.asc())
    )
    locs = (await db.execute(stmt)).scalars().all()

    stops = []
    stop_pts: List[Location] = []

    for loc in locs:
        if not loc.motion:
            stop_pts.append(loc)
        else:
            if len(stop_pts) >= 2:
                t_start = stop_pts[0].recorded_at
                t_end = stop_pts[-1].recorded_at
                dur = (t_end - t_start).total_seconds()
                if dur >= 30:  # Minimum 30 seconds to count as a stop
                    stops.append({
                        "start_time": t_start.isoformat(),
                        "end_time": t_end.isoformat(),
                        "duration_seconds": int(dur),
                        "latitude": stop_pts[0].latitude,
                        "longitude": stop_pts[0].longitude,
                    })
            stop_pts = []

    if len(stop_pts) >= 2:
        t_start = stop_pts[0].recorded_at
        t_end = stop_pts[-1].recorded_at
        dur = (t_end - t_start).total_seconds()
        if dur >= 30:
            stops.append({
                "start_time": t_start.isoformat(),
                "end_time": t_end.isoformat(),
                "duration_seconds": int(dur),
                "latitude": stop_pts[0].latitude,
                "longitude": stop_pts[0].longitude,
            })

    if output_format.lower() == "csv":
        csv_data = _format_csv(stops, ["start_time", "end_time", "duration_seconds", "latitude", "longitude"])
        return Response(content=csv_data, media_type="text/csv", headers={
            "Content-Disposition": f'attachment; filename="stops_{device_id}.csv"'
        })

    return stops


@router.get("/summary")
async def get_summary_report(
    device_id: str = Query(...),
    from_time: str = Query(..., alias="from"),
    to_time: str = Query(..., alias="to"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    dt_from = parse_query_datetime(from_time)
    dt_to = parse_query_datetime(to_time)

    d_stmt = select(Device).where(Device.id == device_id)
    device = (await db.execute(d_stmt)).scalars().first()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    if current_user.company_id and device.company_id != current_user.company_id:
        raise HTTPException(status_code=403, detail="Access denied")

    stmt = (
        select(Location)
        .where(
            Location.device_id == device_id,
            Location.recorded_at >= dt_from,
            Location.recorded_at <= dt_to,
        )
        .order_by(Location.recorded_at.asc())
    )
    locs = (await db.execute(stmt)).scalars().all()

    total_dist_m = sum(l.distance_m for l in locs)
    speeds = [l.speed for l in locs if l.speed > 0]
    max_speed = max(speeds) if speeds else 0.0
    avg_speed = (sum(speeds) / len(speeds)) if speeds else 0.0

    moving_s = 0.0
    for i in range(1, len(locs)):
        if locs[i].motion:
            dt = (locs[i].recorded_at - locs[i - 1].recorded_at).total_seconds()
            if 0 < dt < 300:
                moving_s += dt

    return {
        "device_id": device.id,
        "device_name": device.name,
        "total_distance_km": round(total_dist_m / 1000.0, 3),
        "max_speed_kmh": round(max_speed, 1),
        "average_speed_kmh": round(avg_speed, 1),
        "moving_duration_seconds": int(moving_s),
        "total_positions_count": len(locs),
    }
