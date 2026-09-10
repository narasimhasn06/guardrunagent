#!/usr/bin/env python3
"""docs/06-test-plan.md Section 6: "Session Replay load time | Under 2
seconds for a 500-event session | Seed a staging session with 500
synthetic events, measure page load."

This measures the backend half of that budget: how long GET
/sessions/:id?limit=500 actually takes to return a full 500-event
session, over real HTTP, against the real unmodified ASGI app, in a
separate OS process (same technique and same reasoning as
load_test_guardrail_check.py -- see that file for why a separate process
matters). The other half -- how long the dashboard takes to turn that
response into 500 rendered event cards -- is measured separately by
dashboard/tests/event-timeline-perf.test.tsx, since that's a client-side
React rendering cost this script can't observe from here. Add the two
together for an estimate of the full page-load budget; neither one alone
is "the" NFR number.

Not measured by either: real Supabase network latency (get_supabase() is
patched to an in-memory FakeSupabase here, same caveat as the
guardrail-check load test), real network transfer between the Next.js
server and a deployed backend, and real browser paint/layout time. Point
a copy of this at a staging deployment (swap BASE_URL) once one exists
for the real end-to-end number.

Usage: python scripts/load_test_session_detail.py [num_requests]
"""

from __future__ import annotations

import multiprocessing
import statistics
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_ROOT))

import httpx  # noqa: E402
import jwt  # noqa: E402

TARGET_MS = 2000  # the NFR's full page-load budget; see this file's docstring for how the backend fits into it
NUM_EVENTS = 500
NUM_REQUESTS = int(sys.argv[1]) if len(sys.argv) > 1 else 20
PORT = 8812

ORG_ID = "11111111-1111-1111-1111-111111111111"
SESSION_ID = "22222222-2222-2222-2222-222222222222"
AUTH_USER_ID = "33333333-3333-3333-3333-333333333333"
JWT_SECRET = "load-test-jwt-secret-not-a-real-secret"


def _synthetic_events(n: int) -> list[dict]:
    base = datetime(2026, 9, 10, tzinfo=timezone.utc)
    statuses = ["success", "success", "success", "flagged", "blocked", "failure"]
    action_types = ["bash", "file_edit", "git", "api_call"]
    return [
        {
            "id": str(uuid.uuid4()),
            "action_type": action_types[i % len(action_types)],
            "action_summary": f"synthetic action #{i} for load testing",
            "payload_meta": {"index": i},
            "reasoning_snippet": "Synthetic reasoning text for load-test event, long enough to be realistic. " * 3,
            "tokens_used": 120 + i,
            "cost_usd": "0.0050",
            "status": statuses[i % len(statuses)],
            "matched_rule_id": None,
            "created_at": (base + timedelta(seconds=i)).isoformat(),
        }
        for i in range(n)
    ]


def _run_server(port: int) -> None:
    """Runs in a separate OS process -- see module docstring for why."""
    from unittest.mock import patch

    import uvicorn

    from app.config import Settings
    from app.main import app
    from tests.fakes import FakeSupabase

    session_row = {
        "id": SESSION_ID,
        "agent_name": "claude-code",
        "project_label": "guardrunagent",
        "started_at": "2026-09-10T10:00:00+00:00",
        "ended_at": "2026-09-10T10:30:00+00:00",
        "total_cost_usd": "2.5000",
        "total_tokens": 60000,
        "status": "completed",
    }
    fake = FakeSupabase(
        table_data={
            "sessions": session_row,
            "agent_events": {"data": _synthetic_events(NUM_EVENTS), "count": NUM_EVENTS},
            "org_members": {"org_id": ORG_ID, "role": "admin", "email": "loadtest@example.com"},
        }
    )
    settings = Settings(
        supabase_url="https://example.supabase.co",
        supabase_service_role_key="dummy-service-role-key",
        supabase_jwt_secret=JWT_SECRET,
        api_key_pepper="load-test-pepper",
    )

    with (
        patch("app.routers.sessions.get_supabase", return_value=fake),
        patch("app.auth.get_supabase", return_value=fake),
        patch("app.auth.get_settings", return_value=settings),
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


def main() -> None:
    base_url = f"http://127.0.0.1:{PORT}"
    server_process = multiprocessing.get_context("fork").Process(target=_run_server, args=(PORT,), daemon=True)
    server_process.start()

    token = jwt.encode(
        {
            "sub": AUTH_USER_ID,
            "aud": "authenticated",
            "email": "loadtest@example.com",
            "exp": datetime.now(timezone.utc) + timedelta(hours=1),
        },
        JWT_SECRET,
        algorithm="HS256",
    )

    try:
        _wait_for_server(base_url)

        print(f"Loading GET /sessions/:id with {NUM_EVENTS} events, n={NUM_REQUESTS} sequential requests")
        timings: list[float] = []
        with httpx.Client(base_url=base_url, headers={"Authorization": f"Bearer {token}"}, timeout=10.0) as client:
            # One untimed warm-up request -- consistent with the other
            # scripts here, so the first request's process/JIT warm-up
            # cost doesn't skew the reported numbers.
            client.get(f"/sessions/{SESSION_ID}?limit={NUM_EVENTS}")

            for _ in range(NUM_REQUESTS):
                start = time.perf_counter()
                response = client.get(f"/sessions/{SESSION_ID}?limit={NUM_EVENTS}")
                elapsed_ms = (time.perf_counter() - start) * 1000
                response.raise_for_status()
                body = response.json()
                assert len(body["events"]) == NUM_EVENTS, f"expected {NUM_EVENTS} events, got {len(body['events'])}"
                timings.append(elapsed_ms)
    finally:
        server_process.terminate()
        server_process.join(timeout=5)

    sorted_timings = sorted(timings)
    mean = statistics.mean(timings)
    p50 = _percentile(sorted_timings, 50)
    p95 = _percentile(sorted_timings, 95)

    print(f"  min:  {sorted_timings[0]:.1f}ms")
    print(f"  mean: {mean:.1f}ms")
    print(f"  p50:  {p50:.1f}ms")
    print(f"  p95:  {p95:.1f}ms")
    print(f"  max:  {sorted_timings[-1]:.1f}ms")
    print(f"Backend response time -- one piece of the {TARGET_MS}ms full-page-load budget (see this file's docstring)")
    print("Run dashboard's `npm run test:perf` (event-timeline-perf.test.tsx) for the client-render half.")


if __name__ == "__main__":
    main()
