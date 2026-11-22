from pathlib import Path
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field, SecretStr


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    auth_secret_key: SecretStr = Field(validation_alias="AUTH_KEY_SECRET")
    openrouter_api_key: SecretStr = Field(validation_alias="OPENROUTER_API_KEY")
    openrouter_base_url: str = Field(
        default="https://openrouter.ai/api/v1",
        validation_alias="OPENROUTER_BASE_URL",
    )
    llm_model: str = Field(validation_alias="LLM_MODEL")
    llm_temparature: float = Field(validation_alias="LLM_TEMPERATURE")
    llm_timeout: float = Field(validation_alias="LLM_TIMEOUT")
    llm_max_retries: int = Field(validation_alias="LLM_MAX_RETRIES")


    @property
    def auth_secret(self) -> str:
        secret = self.auth_secret_key.get_secret_value()
        if len(secret) < 32:
            raise ValueError("AUTH_KEY_SECRET must be at least 32 chars")
        return secret

@lru_cache
def get_settings() -> Settings:
    return Settings()


BASE_DIR = Path(__file__).resolve().parent
PROMPT_PATH = BASE_DIR / "data" / "prompts" / "system_prompt.txt"

@lru_cache
def get_sys_prompt():
    with open(PROMPT_PATH, 'r', encoding='utf-8') as f:
        return f.read().strip()