import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, ConfigDict, Field


class ChatMessage(BaseModel):
    role: str = Field(..., pattern="^(user|assistant|system)$")
    content: str


class AIChatRequest(BaseModel):
    message: str = Field(..., min_length=1)
    conversation_history: List[ChatMessage] = Field(default_factory=list)


class ToolCallRecord(BaseModel):
    tool_name: str
    arguments: Dict[str, Any]
    result: Any


class AIChatResponse(BaseModel):
    response: str
    tool_calls_made: List[ToolCallRecord] = Field(default_factory=list)
    is_fallback: bool = False


class AIInsightResponse(BaseModel):
    id: uuid.UUID
    vehicle_id: Optional[uuid.UUID] = None
    vehicle_registration: Optional[str] = None
    insight_type: str
    description: str
    evidence: Optional[Dict[str, Any]] = None
    insight_source: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


ChatRequest = AIChatRequest
ChatResponse = AIChatResponse

