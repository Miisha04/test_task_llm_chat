from contextlib import asynccontextmanager
from fastapi import FastAPI

from models.chat import Message, ChatSession
from routers.auth import router as auth_router
from routers.chat import router as chat_router
from database import init_tables

@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_tables()
    yield

app = FastAPI(
    title="LLM-wrapper-api",
    lifespan=lifespan
)

app.include_router(auth_router)
app.include_router(chat_router)