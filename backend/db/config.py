"""MySQL settings loaded from backend/.env (local development only)."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

_BACKEND_ROOT = Path(__file__).resolve().parents[1]
_ENV_FILE = _BACKEND_ROOT / ".env"


class DatabaseSettings(BaseSettings):
    """Local MySQL configuration — no remote/cloud/shared server support."""

    model_config = SettingsConfigDict(
        env_file=str(_ENV_FILE),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    MYSQL_ENABLED: bool = Field(default=True, description="Set false to disable DB sync.")
    MYSQL_HOST: str = Field(default="localhost")
    MYSQL_PORT: int = Field(default=3306)
    MYSQL_DATABASE: str = Field(default="RECAI")
    MYSQL_USER: str = Field(default="root")
    MYSQL_PASSWORD: str = Field(default="")

    @property
    def sqlalchemy_url(self) -> str:
        from urllib.parse import quote_plus

        user = quote_plus(self.MYSQL_USER)
        password = quote_plus(self.MYSQL_PASSWORD)
        host = self.MYSQL_HOST
        port = self.MYSQL_PORT
        database = self.MYSQL_DATABASE
        return f"mysql+pymysql://{user}:{password}@{host}:{port}/{database}?charset=utf8mb4"


@lru_cache
def db_settings() -> DatabaseSettings:
    return DatabaseSettings()
