import json

from fastapi import APIRouter, Header, HTTPException, Response, WebSocket, WebSocketDisconnect, Depends, status
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession
from database import get_db

from services.chat import chat_pipeline, get_chat
from schemas.message import MessageResponse, UserMessage
from schemas.chat import ChatSessionResponse
from services.auth import verify_api_key
from repositories import chat as chat_repos

router = APIRouter(prefix="/llm_chat")


@router.get("/history/{chat_id}", response_model=list[MessageResponse])
async def get_history(
    chat_id: int,
    db: AsyncSession = Depends(get_db),
) -> list[MessageResponse]:
    messages = await chat_repos.get_messages(db, chat_id)
    return [MessageResponse.model_validate(message) for message in messages]


@router.get(
    "/get_chat_info",
    response_model=ChatSessionResponse,
    status_code=status.HTTP_200_OK
)
async def get_chat_info(
    response: Response,
    api_key: str = Header(alias="X-API-Key"),
    db: AsyncSession = Depends(get_db)
):
    response.headers["Cache-Control"] = "no-store"
    if not verify_api_key(api_key):
        raise HTTPException(status_code=403, detail="Неверный ключ доступа.")
    chat = await get_chat(db, api_key)
    return chat


@router.websocket("/ws/{chat_id}")
async def llm_chat(
    websocket: WebSocket,
    chat_id: int,
    db: AsyncSession = Depends(get_db)
):
    await websocket.accept()

    try:
        await websocket.send_json({
            "type": "ready",
            "chat_id": chat_id,
        })

        while True:
            try:
                data = await websocket.receive_json()
                if data == {"type": "ping"}:
                    await websocket.send_json({"type": "pong"})
                    continue

                user_message = UserMessage(content=data["content"], chat_id=chat_id)
                pipeline_info = await chat_pipeline(db, user_message)
            except WebSocketDisconnect:
                raise
            except (json.JSONDecodeError, ValidationError, KeyError, TypeError):
                await websocket.send_json({
                    "role": "error",
                    "content": "Некорректный формат сообщения.",
                })
                continue
            except Exception:
                await websocket.send_json({
                    "role": "error",
                    "content": "Не удалось получить ответ. Попробуйте ещё раз.",
                })
                continue

            await websocket.send_json({
                "role": "assistant",
                "content": pipeline_info.assistant_response.content,
                "messages": [
                    MessageResponse.model_validate(message).model_dump(mode="json")
                    for message in pipeline_info.saved_messages or []
                ],
            })

    except WebSocketDisconnect:
        pass
