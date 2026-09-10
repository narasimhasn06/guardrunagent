from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Backend configuration, loaded from environment variables / .env.

    Per docs/05-architecture-document.md Section 7: the service role key
    bypasses Supabase RLS and must only ever live in this backend's
    environment, never in the Next.js frontend bundle.
    """

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    supabase_url: str
    supabase_service_role_key: str  # server-only, bypasses RLS
    supabase_jwt_secret: str  # verifies dashboard-user Supabase JWTs

    # Optional: base URL of the Next.js dashboard (e.g.
    # https://app.guardrunagent.com), used to build the "Session [link]" in
    # guardrail Slack alerts (docs/03-low-level-design.md Section 5). Not
    # yet fixed by the docs -- unset until the dashboard is deployed and a
    # real URL exists; alerts omit the link until then.
    dashboard_url: str | None = None


@lru_cache
def get_settings() -> Settings:
    return Settings()
