from dataclasses import dataclass
from collections.abc import Awaitable, Callable
from sqlalchemy.ext.asyncio import AsyncSession
from langchain_core.messages import HumanMessage, SystemMessage, AIMessage

from models.chat import ChatSession, Message
from schemas.message import UserMessage
from schemas.chat import ChatSessionResponse
from repositories import chat as chat_repos
from llm_client import get_llm
from settings import get_sys_prompt


@dataclass
class PipelineInfo:
    row_content: str
    chat_id: int
    history_messages: list[AIMessage | HumanMessage] | None
    current_user_message: HumanMessage | None
    assistant_response: AIMessage | None
    llm_input_messages: list[AIMessage | HumanMessage | SystemMessage] | None
    chat_exists: bool | None
    session_title: str | None

    errors: list[Exception] | None
    saved_messages: list[Message] | None = None


async def create_chat(db: AsyncSession, api_key: str) -> ChatSession:
    chat = await chat_repos.create_chat(db, api_key)
    return chat


async def get_chat(db: AsyncSession, api_key: str) -> ChatSessionResponse | None:
    chat = await chat_repos.get_chat(db, api_key)

    if chat is None:
        chat = await create_chat(db, api_key)
    
    return ChatSessionResponse.model_validate(chat)


async def validate_user_context(
    db: AsyncSession,
    pipeline_info: PipelineInfo
) -> PipelineInfo:
    chat = await chat_repos.get_chat_by_id(db, pipeline_info.chat_id)
    pipeline_info.chat_exists = chat is not None
    if chat is None:
        raise ValueError("Chat does not exist")

    if not pipeline_info.row_content.strip() or len(pipeline_info.row_content) > 500:
        raise ValueError("Message must contain between 1 and 500 characters")

    history_db = await chat_repos.get_messages(db, pipeline_info.chat_id)
    history_messages: list[AIMessage | HumanMessage] = []
    for message in history_db:
        if message.role == "user":
            history_messages.append(HumanMessage(content=message.content))
        elif message.role == "assistant":
            history_messages.append(AIMessage(content=message.content))
        else:
            raise ValueError("Unsupported message role in chat history")

    pipeline_info.history_messages = history_messages
    pipeline_info.current_user_message = HumanMessage(content=pipeline_info.row_content)

    pipeline_info.llm_input_messages = [
        SystemMessage(content=get_sys_prompt()),
        *pipeline_info.history_messages,
        pipeline_info.current_user_message,
    ]

        
    return pipeline_info


async def send_to_llm(
    db: AsyncSession,
    pipeline_info: PipelineInfo
) -> PipelineInfo:
    if not pipeline_info.llm_input_messages or pipeline_info.current_user_message is None:
        raise ValueError("LLM input has not been prepared")

    llm = get_llm()
    response = await llm.ainvoke(pipeline_info.llm_input_messages)
    response_text = response.text
    if not response_text.strip():
        raise ValueError("LLM returned an empty text response")

    pipeline_info.saved_messages = await chat_repos.save_messages(
        db,
        chat_id=pipeline_info.chat_id,
        user_content=pipeline_info.row_content,
        assistant_content=response_text,
    )
    pipeline_info.assistant_response = AIMessage(content=response_text)

    return pipeline_info



async def chat_pipeline(
    db: AsyncSession,
    user_message: UserMessage
) -> PipelineInfo:

    pipeline_info = PipelineInfo(
        row_content=user_message.content,
        chat_id=user_message.chat_id,
        history_messages=None,
        current_user_message=None,
        assistant_response=None,
        llm_input_messages=None,
        chat_exists=None,
        session_title=user_message.content[:10],
        errors=None
    )

    steps: list[Callable[[AsyncSession, PipelineInfo], Awaitable[PipelineInfo]]] = [
        validate_user_context,
        send_to_llm,
    ]

    try:
        for step in steps:
            pipeline_info = await step(db, pipeline_info)
    except Exception:
        await db.rollback()
        raise
    return pipeline_info
