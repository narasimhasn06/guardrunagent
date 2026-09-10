"""Unit tests for app.auth.verify_api_key_or_jwt -- the dual-mode
dependency GET /rules actually wires up (see the comment on it in
app/auth.py for why it exists). These call it directly, the same pattern
as tests/test_auth_api_key.py and tests/test_auth_jwt.py, rather than
going through the FastAPI app -- endpoint-level tests
(tests/test_rules_endpoint.py) override it entirely, so its own logic
needs coverage here.
"""

from __future__ import annotations

from unittest.mock import patch
from uuid import UUID

import jwt
import pytest
from fastapi import HTTPException

from app.auth import verify_api_key_or_jwt
from app.config import Settings
from tests.fakes import FakeSupabase

ORG_ID = "11111111-1111-1111-1111-111111111111"
AUTH_USER_ID = "33333333-3333-3333-3333-333333333333"
PLAINTEXT_KEY = "grn_live_testkey123"
JWT_SECRET = "test-jwt-secret-that-is-long-enough-for-hs256"
API_KEY_PEPPER = "test-pepper-not-a-real-secret"


def _settings() -> Settings:
    return Settings(
        supabase_url="https://example.supabase.co",
        supabase_service_role_key="dummy-service-role-key",
        supabase_jwt_secret=JWT_SECRET,
        api_key_pepper=API_KEY_PEPPER,
    )


def _make_token() -> str:
    import datetime

    payload = {
        "sub": AUTH_USER_ID,
        "aud": "authenticated",
        "exp": datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=1),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")


def test_api_key_credential_resolves_as_machine():
    fake = FakeSupabase(table_data={"orgs": {"id": ORG_ID}})

    with (
        patch("app.api_keys.get_settings", return_value=_settings()),
        patch("app.auth.get_supabase", return_value=fake),
    ):
        result = verify_api_key_or_jwt(x_api_key=PLAINTEXT_KEY, authorization=None)

    assert result.org_id == UUID(ORG_ID)
    assert result.is_machine is True


def test_jwt_credential_resolves_as_human():
    fake = FakeSupabase(table_data={"org_members": {"org_id": ORG_ID, "role": "admin", "email": "jane@example.com"}})

    with (
        patch("app.auth.get_settings", return_value=_settings()),
        patch("app.auth.get_supabase", return_value=fake),
    ):
        result = verify_api_key_or_jwt(x_api_key=None, authorization=f"Bearer {_make_token()}")

    assert result.org_id == UUID(ORG_ID)
    assert result.is_machine is False


def test_neither_credential_is_rejected():
    with pytest.raises(HTTPException) as exc_info:
        verify_api_key_or_jwt(x_api_key=None, authorization=None)
    assert exc_info.value.status_code == 401


def test_api_key_takes_precedence_when_both_are_present():
    fake = FakeSupabase(table_data={"orgs": {"id": ORG_ID}})

    with (
        patch("app.api_keys.get_settings", return_value=_settings()),
        patch("app.auth.get_supabase", return_value=fake),
    ):
        result = verify_api_key_or_jwt(x_api_key=PLAINTEXT_KEY, authorization="Bearer some-jwt-too")

    assert result.is_machine is True


def test_invalid_api_key_is_rejected_even_with_no_authorization_fallback():
    fake = FakeSupabase(table_data={"orgs": None})

    with (
        patch("app.api_keys.get_settings", return_value=_settings()),
        patch("app.auth.get_supabase", return_value=fake),
    ):
        with pytest.raises(HTTPException) as exc_info:
            verify_api_key_or_jwt(x_api_key="wrong-key", authorization=None)

    assert exc_info.value.status_code == 401
