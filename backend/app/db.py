from functools import lru_cache

from supabase import Client, create_client

from app.config import get_settings


@lru_cache
def get_supabase() -> Client:
    """Server-side Supabase client, authenticated with the service role key.

    This bypasses row-level security (there is none yet — see
    docs/05-architecture-document.md Section 7) and is used for all backend
    reads/writes. Org-scoping is enforced in application code (query
    filters), not by Supabase, until RLS is added as a v2 upgrade.
    """
    settings = get_settings()
    return create_client(settings.supabase_url, settings.supabase_service_role_key)
