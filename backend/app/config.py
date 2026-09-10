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

    # Server-only secret keying the HMAC-SHA256 hash `orgs.api_key_hash`
    # stores (see app/api_keys.py). Never logged, never sent to any
    # client. Rotating it invalidates every issued API key at once (same
    # blast radius as rotating supabase_jwt_secret) -- not something to
    # do casually, but fine for MVP scale.
    api_key_pepper: str

    # Optional: base URL of the Next.js dashboard (e.g.
    # https://app.guardrunagent.com), used to build the "Session [link]" in
    # guardrail Slack alerts (docs/03-low-level-design.md Section 5). Not
    # yet fixed by the docs -- unset until the dashboard is deployed and a
    # real URL exists; alerts omit the link until then.
    dashboard_url: str | None = None


@lru_cache
def get_settings() -> Settings:
    return Settings()
