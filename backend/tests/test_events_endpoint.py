"""Endpoint-level tests for POST /events.

Cases per docs/06-test-plan.md Section 3.2 ("Backend -> POST /events") and
Section 4 (integration: "SDK sends a batch of events -> backend ->
Supabase"). The Supabase layer is faked (tests/fakes.py) since this
environment has no live project to run true DB integration tests against
-- these exercise the full request/auth/serialization/DB-call pipeline
within the process instead.
"""

from __future__ import annotations

from unittest.mock import patch
from uuid import UUID

from app.auth import OrgAuth, verify_api_key
from app.main import app
from tests.fakes import FakeSupabase

ORG_ID = "11111111-1111-1111-1111-111111111111"
SESSION_ID = "22222222-2222-2222-2222-222222222222"


def _override_org_auth() -> None:
    app.dependency_overrides[verify_api_key] = lambda: OrgAuth(org_id=UUID(ORG_ID))


def test_valid_batch_insert_succeeds(client):
    _override_org_auth()
    fake = FakeSupabase(table_data={"sessions": {"id": SESSION_ID}})  # session already exists

    with patch("app.routers.events.get_supabase", return_value=fake):
        response = client.post(
            "/events",
            json={
                "session_id": SESSION_ID,
                "events": [
                    {
                        "action_type": "bash",
                        "action_summary": "ran: npm install",
                        "tokens_used": 120,
                        "cost_usd": "0.0020",
                        "status": "success",
                    }
                ],
            },
        )

    assert response.status_code == 202
    assert response.json() == {"received": 1}

    event_inserts = [c for c in fake.recorded_calls if c[0] == "insert" and c[1] == "agent_events"]
    assert len(event_inserts) == 1
    assert event_inserts[0][2][0]["org_id"] == ORG_ID

    rpc_calls = [c for c in fake.recorded_calls if c[0] == "rpc"]
    assert rpc_calls[0][1] == "increment_session_totals"
    assert rpc_calls[0][2]["p_tokens_delta"] == 120


def test_org_id_resolved_from_api_key_is_used_for_every_row(client):
    _override_org_auth()
    fake = FakeSupabase(table_data={"sessions": {"id": SESSION_ID}})

    with patch("app.routers.events.get_supabase", return_value=fake):
        client.post(
            "/events",
            json={
                "session_id": SESSION_ID,
                "events": [
                    {"action_type": "bash", "status": "success"},
                    {"action_type": "git", "status": "success"},
                ],
            },
        )

    event_inserts = [c for c in fake.recorded_calls if c[0] == "insert" and c[1] == "agent_events"]
    rows = event_inserts[0][2]
    assert all(row["org_id"] == ORG_ID for row in rows)


def test_malformed_event_payload_returns_4xx(client):
    _override_org_auth()
    response = client.post("/events", json={"session_id": SESSION_ID, "events": []})
    assert 400 <= response.status_code < 500


def test_missing_action_type_returns_4xx(client):
    _override_org_auth()
    response = client.post(
        "/events",
        json={"session_id": SESSION_ID, "events": [{"status": "success"}]},
    )
    assert 400 <= response.status_code < 500


def test_missing_api_key_is_rejected(client):
    app.dependency_overrides.pop(verify_api_key, None)
    response = client.post("/events", json={"session_id": SESSION_ID, "events": []})
    assert response.status_code == 401


def test_session_auto_created_when_unknown(client):
    _override_org_auth()
    fake = FakeSupabase(table_data={"sessions": None})  # no existing session found

    with patch("app.routers.events.get_supabase", return_value=fake):
        response = client.post(
            "/events",
            json={"session_id": SESSION_ID, "events": [{"action_type": "bash", "status": "success"}]},
        )

    assert response.status_code == 202
    session_inserts = [c for c in fake.recorded_calls if c[0] == "insert" and c[1] == "sessions"]
    assert len(session_inserts) == 1
    assert session_inserts[0][2]["agent_name"] == "claude-code"
