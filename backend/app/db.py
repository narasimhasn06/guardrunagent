from functools import lru_cache
from typing import Any

import httpx
from postgrest import SyncMaybeSingleRequestBuilder
from supabase import Client, ClientOptions, create_client

from app.config import get_settings


@lru_cache
def get_supabase() -> Client:
    """Server-side Supabase client, authenticated with the service role key.

    This bypasses row-level security (there is none yet — see
    docs/05-architecture-document.md Section 7) and is used for all backend
    reads/writes. Org-scoping is enforced in application code (query
    filters), not by Supabase, until RLS is added as a v2 upgrade.

    Forces HTTP/1.1 on the underlying httpx client: postgrest-py and
    supabase_auth both hardcode `http2=True` on the httpx.Client they build
    internally unless one is passed in. Caught live in production --
    `httpx.RemoteProtocolError: ConnectionTerminated` (visible as
    `last_stream_id=N` in the traceback, an HTTP/2-only concept) hitting
    `/me` right after a fresh Google sign-in, reproducible on demand, not a
    one-off. Most likely an HTTP/2 connection-pool race against Supabase's
    edge closing an idle connection out from under a reused one -- HTTP/1.1
    doesn't pool connections the same way and doesn't have this failure
    mode, at the cost of one connection per concurrent request instead of
    multiplexing several over one, which is a non-issue at this project's
    traffic volume.

    Also sets an explicit 20s timeout, up from httpx's own 5s default --
    neither postgrest-py nor supabase_auth ever set one either, and the
    HTTP/2 fix above didn't touch it. Caught live right after that fix
    shipped: `httpx.ReadTimeout` on `invite_user_by_email` once Custom
    SMTP was actually working -- Supabase's own `/auth/v1/invite`
    sends the email synchronously as part of handling the request, so a
    real (if slow) delivery can outrun a 5s budget that a table read
    never would. Applied to the one shared client rather than per-call,
    same as the HTTP/2 setting -- normal reads finish in well under 20s
    regardless, so this only changes how long a genuinely stuck request
    takes to fail, not the fast path's actual latency.
    """
    settings = get_settings()
    options = ClientOptions(httpx_client=httpx.Client(http2=False, timeout=20.0))
    return create_client(settings.supabase_url, settings.supabase_service_role_key, options=options)


class _NoRowResult:
    """Stands in for postgrest-py's own response object when zero rows
    match a `.maybe_single()` query, so callers can always do
    `result.data` uniformly. See `maybe_single_result`'s docstring for why
    this exists.
    """

    data: Any = None
    count: int | None = None


def maybe_single_result(builder: SyncMaybeSingleRequestBuilder) -> Any:
    """Call this on a `.maybe_single()` query builder instead of
    `.execute()` directly.

    postgrest-py (2.x, current) returns `None` -- not a response object
    with `.data = None` -- when a `.maybe_single()` query matches zero
    rows. Every one of this backend's call sites was written assuming
    the latter (a response object), which worked fine in tests (the
    FakeSupabase double got this wrong too, now fixed to match) but
    produced an unhandled `AttributeError: 'NoneType' object has no
    attribute 'data'` -- a 500 -- against the real client the first time
    a query genuinely found no row in staging. Normalizes that away in
    one place instead of an `is not None` check at every call site.
    """
    result = builder.execute()
    return result if result is not None else _NoRowResult()
