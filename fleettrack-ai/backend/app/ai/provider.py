import json
import logging
from typing import Any, Dict, List, Optional
import httpx

from app.core.config import settings

logger = logging.getLogger("fleettrack.ai.provider")


class LLMProvider:
    def __init__(self):
        self.provider = settings.AI_PROVIDER.lower().strip()
        self.api_key = settings.AI_API_KEY.strip()
        self.model = settings.AI_MODEL
        self.base_url = settings.AI_BASE_URL.rstrip("/")

    @property
    def is_available(self) -> bool:
        return self.provider in ("openai", "gemini") and bool(self.api_key)

    async def generate_response(
        self,
        system_prompt: str,
        messages: List[Dict[str, str]],
        tools_context: Optional[str] = None,
    ) -> Optional[str]:
        """Calls external OpenAI-compatible API with provided conversation context."""
        if not self.is_available:
            return None

        prompt_messages = [{"role": "system", "content": system_prompt}]
        if tools_context:
            prompt_messages.append({
                "role": "system",
                "content": f"Verified Fleet Operational Data:\n{tools_context}\nDo not contradict or invent numbers outside this context.",
            })

        for m in messages:
            prompt_messages.append({"role": m["role"], "content": m["content"]})

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

        payload = {
            "model": self.model,
            "messages": prompt_messages,
            "temperature": 0.2,
        }

        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                res = await client.post(
                    f"{self.base_url}/chat/completions",
                    headers=headers,
                    json=payload,
                )
                if res.status_code == 200:
                    data = res.json()
                    choices = data.get("choices", [])
                    if choices and "message" in choices[0]:
                        return choices[0]["message"].get("content", "").strip()
                else:
                    logger.warning(f"LLM API returned {res.status_code}: {res.text}")
        except Exception as e:
            logger.error(f"Error calling LLM provider: {e}")

        return None
