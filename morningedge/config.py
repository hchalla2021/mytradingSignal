from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


DEFAULT_SHARED_AUTH_FILE = (
    Path(__file__).resolve().parents[1] / "backend" / "data" /
    "morningedge_auth" / "credentials.json"
)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="MORNINGEDGE_", env_file=".env", extra="ignore",
                                      protected_namespaces=("settings_",))
    api_key: str = ""
    shared_zerodha_auth_file: Path = DEFAULT_SHARED_AUTH_FILE
    access_token: str = ""
    public_api_url: str = ""
    frontend_url: str = ""
    database_url: str = ""
    redis_url: str = ""
    allowlisted_host_ip: str = "159.65.147.167"
    model_artifact: str = ""
    model_validated: bool = False
    event_queue_capacity: int = 256
    market_queue_capacity: int = 1024


@lru_cache
def get_settings() -> Settings:
    return Settings()
