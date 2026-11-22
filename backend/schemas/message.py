from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_serializer

class UserMessage(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    
    content: str
    user_id: int | None = None
    chat_id: int
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class MessageResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    role: Literal["user", "assistant"]
    content: str
    created_at: datetime

    @field_serializer("created_at")
    def serialize_created_at(self, value: datetime) -> str:
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.isoformat()
