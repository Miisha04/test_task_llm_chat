from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import SQLAlchemyError

from models.chat import ChatSession, Message

async def get_chat(
    db: AsyncSession,
    api_key: str
) -> ChatSession | None:
    st = select(ChatSession).where(
        ChatSession.api_key == api_key
    )
    chat = (await db.execute(st)).scalar_one_or_none()
    return chat


async def create_chat(
    db: AsyncSession,
    api_key: str,
) -> ChatSession:
    chat = ChatSession(
        title="Blank",
        api_key=api_key,
    )

    db.add(chat)
    await db.commit()
    await db.refresh(chat)

    return chat


async def get_chat_by_id(db: AsyncSession, chat_id: int) -> ChatSession | None:
    return await db.get(ChatSession, chat_id)


async def get_messages(db: AsyncSession, chat_id: int) -> list[Message]:
    statement = (
        select(Message)
        .where(Message.chat_id == chat_id)
        .order_by(Message.created_at, Message.id)
    )
    return list((await db.scalars(statement)).all())


async def save_messages(
    db: AsyncSession,
    chat_id: int,
    user_content: str,
    assistant_content: str,
) -> list[Message]:
    messages = [
        Message(chat_id=chat_id, role="user", content=user_content),
        Message(chat_id=chat_id, role="assistant", content=assistant_content),
    ]
    db.add_all(messages)

    try:
        await db.commit()
    except SQLAlchemyError:
        await db.rollback()
        raise

    return messages
