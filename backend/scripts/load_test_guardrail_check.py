#!/usr/bin/env python3
"""docs/06-test-plan.md Section 6: "Guardrail-check latency | p99 < 200ms
| Load-test the /guardrail-check endpoint with a realistic rule set
(20+ rules) and concurrent requests."

tests/test_guardrails.py already has a microbenchmark for match_rule()
itself, but it explicitly only measures in-memory rule evaluation -- not
the real HTTP request, FastAPI routing/dependency injection, auth, or
JSON (de)serialization cost. This script runs the real ASGI app
(app.main:app, completely unmodified) behind real uvicorn, in a genuinely
separate OS process, hit with real concurrent HTTP requests from this
process over the loopback interface, and reports actual p50/p95/p99.

A separate process for the server (not just a background thread in this
same process) matters: earlier versions of this script ran the server in
a thread here and measured p99 in the *seconds* under 20-way concurrency
-- not because the app is actually that slow, but because the server's
event loop and this script's client threads were fighting over one GIL
in one process, which no real deployment does. Running the server as its
own process removes that artifact.

The one thing this still can't measure is real Supabase network latency:
get_supabase() is patched, inside the server subprocess, to
tests/fakes.py's in-memory FakeSupabase, so this can run standalone with
no live Supabase project or credentials. Treat the result as a floor on
real production latency -- add your Supabase project's typical query
round-trip time (measurable separately, e.g. via `EXPLAIN ANALYZE` or the
Supabase dashboard's query stats) to estimate the real number, or point a
copy of this at a staging deployment (swap BASE_URL / skip spawning the
server) once one exists.

This is exactly the load test that caught app.auth.verify_api_key's real
bcrypt cost (~270ms/check, see app/api_keys.py) -- a cost invisible to
every endpoint test in tests/, since all of them override verify_api_key
as a FastAPI dependency rather than exercising its real body.

Usage: python scripts/load_test_guardrail_check.py [num_requests] [concurrency]
"""

from __future__ import annotations

import multiprocessing
import statistics
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_ROOT))

import httpx  # noqa: E402

TARGET_P99_MS = 200
ORG_ID = "11111111-1111-1111-1111-111111111111"
API_KEY = "grk_loadtest_1234567890abcdef"
NUM_RULES = 25  # "20+ rules", per Section 6's own framing
NUM_REQUESTS = int(sys.argv[1]) if len(sys.argv) > 1 else 500
CONCURRENCY = int(sys.argv[2]) if len(sys.argv) > 2 else 20
PORT = 8811


def _non_matching_rules(n: int) -> list[dict]:
    # Worst case for match_rule: the action matches none of them, so
    # every rule actually gets evaluated (a match would short-circuit).
    return [
        {
            "id": f"rule-{i}",
            "name": f"rule-{i}",
            "pattern_type": "command_regex",
            "pattern_value": rf"^this-command-never-appears-{i}",
            "action_on_match": "block",
            "enabled": True,
        }
        for i in range(n)
    ]


def _run_server(port: int) -> None:
    """Runs in a separate OS process (see module docstring for why). All
    imports and patches happen here, inside the child, after fork -- not
    at module import time in the parent.
    """
    from unittest.mock import patch

    import uvicorn

    from app.config import Settings
    from app.main import app
    from tests.fakes import FakeSupabase

    fake = FakeSupabase(
        table_data={
            "orgs": {"id": ORG_ID},  # verify_api_key's .maybe_single() lookup
            "guardrail_rules": _non_matching_rules(NUM_RULES),
        }
    )
    settings = Settings(
        supabase_url="https://example.supabase.co",
        supabase_service_role_key="dummy-service-role-key",
        supabase_jwt_secret="dummy-jwt-secret",
        api_key_pepper="load-test-pepper",
    )

    with (
        patch("app.routers.guardrail_check.get_supabase", return_value=fake),
        patch("app.auth.get_supabase", return_value=fake),
        patch("app.api_keys.get_settings", return_value=settings),
    ):
        uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")


def _wait_for_server(base_url: str, timeout_s: float = 10.0) -> None:
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        try:
            if httpx.get(f"{base_url}/health", timeout=0.5).status_code == 200:
                return
        except httpx.HTTPError:
            pass
        time.sleep(0.05)
    raise RuntimeError(f"Server at {base_url} never became healthy within {timeout_s}s")


def _percentile(sorted_values: list[float], p: float) -> float:
    idx = min(len(sorted_values) - 1, int(p / 100 * len(sorted_values)))
    return sorted_values[idx]


def _fire_request(client: httpx.Client) -> float:
    start = time.perf_counter()
    response = client.post(
        "/guardrail-check",
        headers={"X-API-Key": API_KEY},
        json={
            "session_id": "22222222-2222-2222-2222-222222222222",
            "action_type": "bash",
            "action_summary": "npm install",
        },
    )
    elapsed_ms = (time.perf_counter() - start) * 1000
    response.raise_for_status()
    assert response.json()["decision"] == "allow"  # sanity check we're hitting the worst-case (no match) path
    return elapsed_ms


def main() -> None:
    base_url = f"http://127.0.0.1:{PORT}"
    server_process = multiprocessing.get_context("fork").Process(target=_run_server, args=(PORT,), daemon=True)
    server_process.start()

    try:
        _wait_for_server(base_url)

        print(f"Load-testing POST /guardrail-check: n={NUM_REQUESTS}, concurrency={CONCURRENCY}, rules={NUM_RULES}")
        timings: list[float] = []
        # One shared, connection-pooled client per worker thread (created
        # lazily) -- httpx.Client keep-alive connections, not a fresh TCP
        # handshake per request, which is what a real SDK/browser client
        # does too.
        thread_local_clients: dict[int, httpx.Client] = {}

        def worker(_: int) -> float:
            import threading

            tid = threading.get_ident()
            client = thread_local_clients.get(tid)
            if client is None:
                client = httpx.Client(base_url=base_url, timeout=5.0)
                thread_local_clients[tid] = client
            return _fire_request(client)

        with ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
            for elapsed_ms in pool.map(worker, range(NUM_REQUESTS)):
                timings.append(elapsed_ms)

        for client in thread_local_clients.values():
            client.close()
    finally:
        server_process.terminate()
        server_process.join(timeout=5)

    sorted_timings = sorted(timings)
    mean = statistics.mean(timings)
    p50 = _percentile(sorted_timings, 50)
    p95 = _percentile(sorted_timings, 95)
    p99 = _percentile(sorted_timings, 99)

    print(f"  min:  {sorted_timings[0]:.1f}ms")
    print(f"  mean: {mean:.1f}ms")
    print(f"  p50:  {p50:.1f}ms")
    print(f"  p95:  {p95:.1f}ms")
    print(f"  p99:  {p99:.1f}ms")
    print(f"  max:  {sorted_timings[-1]:.1f}ms")
    print(f"Target: p99 < {TARGET_P99_MS}ms (excludes real Supabase network latency -- see this file's docstring)")

    if p99 >= TARGET_P99_MS:
        print(f"FAIL -- p99 ({p99:.1f}ms) is at or above target.")
        sys.exit(1)
    print("PASS")


if __name__ == "__main__":
    main()
