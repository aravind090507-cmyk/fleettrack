import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.ai.tools import FleetTools


class RuleBasedInsights:
    def __init__(self, db: AsyncSession, current_user: User):
        self.db = db
        self.current_user = current_user
        self.tools = FleetTools(db, current_user)

    async def generate_insights(self) -> List[Dict[str, Any]]:
        """
        Calculates deterministic operational insights from actual database records:
        - High idle time detection
        - Offline vehicle alerts
        - Active geofence movements
        - Fleet utilization assessment
        """
        insights = []
        now = datetime.now(timezone.utc)

        # 1. Check Idle Vehicles
        idle = await self.tools.get_idle_vehicles()
        if idle:
            regs = [v["registration_number"] for v in idle]
            insights.append({
                "id": str(uuid.uuid4()),
                "insight_type": "idle_time_warning",
                "description": f"{len(idle)} vehicle(s) currently idling at construction job sites: {', '.join(regs)}.",
                "evidence": {"vehicle_count": len(idle), "vehicles": regs},
                "insight_source": "rule_based",
                "created_at": now.isoformat(),
            })

        # 2. Check Offline Vehicles
        offline = await self.tools.get_offline_vehicles()
        if offline:
            regs = [v["registration_number"] for v in offline]
            insights.append({
                "id": str(uuid.uuid4()),
                "insight_type": "connectivity_alert",
                "description": f"{len(offline)} vehicle GPS device(s) have not reported telemetry recently: {', '.join(regs)}.",
                "evidence": {"offline_count": len(offline), "vehicles": regs},
                "insight_source": "rule_based",
                "created_at": now.isoformat(),
            })

        # 3. Fleet Summary Insight
        summary = await self.tools.get_fleet_summary()
        total = summary["total_vehicles"]
        moving = summary["moving_vehicles"]
        utilization = round((moving / total * 100), 1) if total > 0 else 0.0
        insights.append({
            "id": str(uuid.uuid4()),
            "insight_type": "fleet_utilization",
            "description": f"Active fleet operational utilization is currently at {utilization}% ({moving}/{total} moving vehicles).",
            "evidence": summary,
            "insight_source": "rule_based",
            "created_at": now.isoformat(),
        })

        # 4. Geofence Activity
        events = await self.tools.get_geofence_events(hours=12)
        if events:
            insights.append({
                "id": str(uuid.uuid4()),
                "insight_type": "geofence_activity",
                "description": f"Observed {len(events)} geofence site transitions in the last 12 hours.",
                "evidence": {"recent_events": events[:5]},
                "insight_source": "rule_based",
                "created_at": now.isoformat(),
            })

        return insights

    async def answer_query(self, query: str) -> Dict[str, Any]:
        """Provides direct, factual natural language answers using actual database tools."""
        q = query.lower()
        tool_calls = []

        if "summary" in q or "overview" in q or "how many" in q:
            data = await self.tools.get_fleet_summary()
            tool_calls.append({"tool_name": "get_fleet_summary", "arguments": {}, "result": data})
            reply = (
                f"Fleet Overview Summary:\n"
                f"• Total vehicles: {data['total_vehicles']}\n"
                f"• Moving: {data['moving_vehicles']}\n"
                f"• Idle: {data['idle_vehicles']}\n"
                f"• Offline: {data['offline_vehicles']}\n"
                f"• Maintenance: {data['maintenance_vehicles']}"
            )
        elif "idle" in q:
            data = await self.tools.get_idle_vehicles()
            tool_calls.append({"tool_name": "get_idle_vehicles", "arguments": {}, "result": data})
            if not data:
                reply = "There are currently no idle vehicles in your fleet. All active units are moving or offline."
            else:
                names = [f"{v['registration_number']} ({v['vehicle_type']})" for v in data]
                reply = f"There are {len(data)} idle vehicle(s):\n" + "\n".join(f"• {n}" for n in names)
        elif "offline" in q or "missing" in q:
            data = await self.tools.get_offline_vehicles()
            tool_calls.append({"tool_name": "get_offline_vehicles", "arguments": {}, "result": data})
            if not data:
                reply = "All vehicle GPS transmitters are reporting normally with active telemetry."
            else:
                names = [f"{v['registration_number']} ({v['vehicle_type']})" for v in data]
                reply = f"Found {len(data)} offline vehicle(s):\n" + "\n".join(f"• {n}" for n in names)
        elif "geofence" in q or "site" in q or "boundary" in q:
            data = await self.tools.get_geofence_events(hours=24)
            tool_calls.append({"tool_name": "get_geofence_events", "arguments": {"hours": 24}, "result": data})
            if not data:
                reply = "No geofence entry or exit events were recorded in the past 24 hours."
            else:
                lines = [f"• {e['vehicle_registration']} {e['event_type']} '{e['geofence_name']}'" for e in data[:5]]
                reply = f"Recent geofence transitions ({len(data)} total in 24h):\n" + "\n".join(lines)
        else:
            # Default to general status
            data = await self.tools.get_vehicle_status()
            tool_calls.append({"tool_name": "get_vehicle_status", "arguments": {}, "result": data})
            reply = (
                f"Operational Status of your {len(data)} vehicles:\n"
                + "\n".join(
                    f"• {v['registration_number']} ({v['vehicle_type']}): {v['status'].upper()} at {v['speed']} km/h"
                    for v in data[:8]
                )
            )

        return {
            "response": reply,
            "tool_calls_made": tool_calls,
            "is_fallback": True,
        }
