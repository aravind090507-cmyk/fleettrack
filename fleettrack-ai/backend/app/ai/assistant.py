import json
import logging
from typing import Any, Dict, List
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.ai.tools import FleetTools
from app.ai.provider import LLMProvider
from app.ai.fallback import RuleBasedInsights
from app.schemas.ai import ChatResponse, ToolCallRecord

logger = logging.getLogger("fleettrack.ai.assistant")


class FleetAssistant:
    def __init__(self, db: AsyncSession, current_user: User):
        self.db = db
        self.current_user = current_user
        self.tools = FleetTools(db, current_user)
        self.provider = LLMProvider()
        self.fallback = RuleBasedInsights(db, current_user)

    async def chat(self, message: str, conversation_history: List[Any]) -> ChatResponse:
        """
        Coordinates AI query resolution:
        1. Always fetches authentic database data using scoped tools
        2. If LLM is configured, synthesizes clear natural language response with tools context
        3. If no LLM configured or call fails, gracefully returns rule-based factual output
        """
        tool_records: List[ToolCallRecord] = []

        # Gather relevant real-time fleet context
        summary = await self.tools.get_fleet_summary()
        tool_records.append(
            ToolCallRecord(tool_name="get_fleet_summary", arguments={}, result=summary)
        )

        status_data = await self.tools.get_vehicle_status()
        tool_records.append(
            ToolCallRecord(tool_name="get_vehicle_status", arguments={}, result=status_data[:10])
        )

        # If LLM configured, attempt enhanced generation
        if self.provider.is_available:
            system_prompt = (
                "You are FleetTrack AI, an intelligent assistant for construction fleet operations. "
                "You answer questions regarding fleet status, vehicles, idle time, and operations. "
                "CRITICAL: Always use the verified facts in the system context. "
                "Never invent vehicle coordinates, ETA values, speeds, or fake registrations. "
                "If information is not in the context, explicitly state that it is unavailable."
            )

            context_str = json.dumps({
                "fleet_summary": summary,
                "vehicles_status": status_data,
            }, default=str)

            history = []
            for h in conversation_history:
                if hasattr(h, "role") and hasattr(h, "content"):
                    history.append({"role": h.role, "content": h.content})
                elif isinstance(h, dict):
                    history.append({"role": h.get("role", "user"), "content": h.get("content", "")})

            history.append({"role": "user", "content": message})

            llm_text = await self.provider.generate_response(
                system_prompt=system_prompt,
                messages=history,
                tools_context=context_str,
            )

            if llm_text:
                return ChatResponse(
                    response=llm_text,
                    tool_calls_made=tool_records,
                    is_fallback=False,
                )

        # Fallback to rule-based analysis
        fallback_res = await self.fallback.answer_query(message)
        fallback_tools = [
            ToolCallRecord(tool_name=tc["tool_name"], arguments=tc["arguments"], result=tc["result"])
            for tc in fallback_res.get("tool_calls_made", [])
        ]
        return ChatResponse(
            response=fallback_res["response"],
            tool_calls_made=fallback_tools or tool_records,
            is_fallback=True,
        )
