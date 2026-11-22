from langchain_openai import ChatOpenAI
from langchain_core.tools import tool

from settings import get_settings


settings = get_settings()


def get_llm() -> ChatOpenAI:
    llm = ChatOpenAI(
        base_url=settings.openrouter_base_url,
        api_key=settings.openrouter_api_key.get_secret_value(),
        model=settings.llm_model,
        temperature=settings.llm_temparature,
        timeout=settings.llm_timeout,
        max_retries=settings.llm_max_retries,
    )

    return llm