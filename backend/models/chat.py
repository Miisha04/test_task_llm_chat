from datetime import datetime
from sqlalchemy import CheckConstraint, ForeignKey, Integer, DateTime, Text, String, func
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class Message(Base):

    __tablename__ = "messages"
    __table_args__ = (
        CheckConstraint("role IN ('user', 'assistant')", name="ck_messages_role"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    chat_id: Mapped[int] = mapped_column(
        ForeignKey("chat_session.id", name="fk_messages_chat_id"),
        nullable=False,
        index=True,
    )
    role: Mapped[str] = mapped_column(String(16), nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )
    content: Mapped[str] = mapped_column(Text, nullable=False)


class ChatSession(Base):

    __tablename__ = "chat_session"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    api_key: Mapped[str] = mapped_column(String, unique=True)

    title: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
