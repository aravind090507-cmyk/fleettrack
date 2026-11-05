import logging
from typing import List, Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user
from app.database.session import get_db
from app.models.user import User
from app.ai.assistant import FleetAssistant
from app.schemas.ai import ChatRequest, ChatResponse

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/chat", response_model=ChatResponse)
async def ai_chat(
    request: ChatRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    assistant = FleetAssistant(db, current_user)
    response = await assistant.chat(request.message, request.conversation_history or [])
    return response


@router.get("/insights")
async def ai_insights(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Generate and return rule-based + AI fleet insights."""
    from app.ai.fallback import RuleBasedInsights
    engine = RuleBasedInsights(db, current_user)
    insights = await engine.generate_insights()
    return {"insights": insights}
