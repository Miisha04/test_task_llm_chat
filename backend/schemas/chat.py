from datetime import datetime
from pydantic import BaseModel, ConfigDict


class ChatSessionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    
    api_key: str
    title: str
    created_at: datetime