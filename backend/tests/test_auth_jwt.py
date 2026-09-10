"""Unit tests for Supabase JWT auth (app.auth.verify_jwt).

Cases per docs/06-test-plan.md Section 3.2 ("JWT verification middleware"):
- Valid Supabase JWT is accepted
- Expired JWT is rejected
- Malformed/missing JWT is rejected
- JWT for a user with no org_members row is handled gracefully (doesn't crash)
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import patch
from uuid import UUID

import jwt
import pytest
from fastapi import HTTPException

from app.auth import verify_jwt
from app.config import Settings
from tests.fakes import FakeSupabase

JWT_SECRET = "test-jwt-secret-that-is-long-enough-for-hs256"
AUTH_USER_ID = "33333333-3333-3333-3333-333333333333"
ORG_ID = "11111111-1111-1111-1111-111111111111"


def _settings() -> Settings:
    return Settings(
        supabase_url="https://example.supabase.co",
        supabase_service_role_key="dummy-service-role-key",
        supabase_jwt_secret=JWT_SECRET,
    )


def _make_token(
    *,
    sub: str = AUTH_USER_ID,
    exp_delta: timedelta = timedelta(hours=1),
    aud: str = "authenticated",
    email: str = "jane@example.com",
    secret: str = JWT_SECRET,
) -> str:
    payload = {
        "sub": sub,
        "aud": aud,
        "email": email,
        "exp": datetime.now(timezone.utc) + exp_delta,
    }
    return jwt.encode(payload, secret, algorithm="HS256")


def _supabase_with_member(member: dict | None) -> FakeSupabase:
    return FakeSupabase({"org_members": member})


def test_valid_jwt_is_accepted():
    token = _make_token()
    fake = _supabase_with_member({"org_id": ORG_ID, "role": "admin", "email": "jane@example.com"})

    with (
        patch("app.auth.get_settings", return_value=_settings()),
        patch("app.auth.get_supabase", return_value=fake),
    ):
        result = verify_jwt(authorization=f"Bearer {token}")

    assert result.auth_user_id == UUID(AUTH_USER_ID)
    assert result.org_id == UUID(ORG_ID)
    assert result.role == "admin"
    assert result.email == "jane@example.com"


def test_expired_jwt_is_rejected():
    token = _make_token(exp_delta=timedelta(seconds=-10))

    with patch("app.auth.get_settings", return_value=_settings()):
        with pytest.raises(HTTPException) as exc_info:
            verify_jwt(authorization=f"Bearer {token}")

    assert exc_info.value.status_code == 401


def test_malformed_jwt_is_rejected():
    with patch("app.auth.get_settings", return_value=_settings()):
        with pytest.raises(HTTPException) as exc_info:
            verify_jwt(authorization="Bearer not-a-real-jwt")

    assert exc_info.value.status_code == 401


def test_wrong_signature_is_rejected():
    token = _make_token(secret="a-different-secret-entirely")

    with patch("app.auth.get_settings", return_value=_settings()):
        with pytest.raises(HTTPException) as exc_info:
            verify_jwt(authorization=f"Bearer {token}")

    assert exc_info.value.status_code == 401


def test_missing_jwt_is_rejected():
    with pytest.raises(HTTPException) as exc_info:
        verify_jwt(authorization=None)

    assert exc_info.value.status_code == 401


def test_non_bearer_authorization_header_is_rejected():
    with pytest.raises(HTTPException) as exc_info:
        verify_jwt(authorization="Basic dXNlcjpwYXNz")

    assert exc_info.value.status_code == 401


def test_jwt_for_user_with_no_org_members_row_is_handled_gracefully():
    token = _make_token()
    fake = _supabase_with_member(None)

    with (
        patch("app.auth.get_settings", return_value=_settings()),
        patch("app.auth.get_supabase", return_value=fake),
    ):
        with pytest.raises(HTTPException) as exc_info:
            verify_jwt(authorization=f"Bearer {token}")

    # Doesn't crash (no unhandled exception) and doesn't silently grant
    # access -- fails clearly with 403 pending the org-join/creation flow
    # docs/03-low-level-design.md Section 2.2 step 6 describes but doesn't
    # fully specify.
    assert exc_info.value.status_code == 403
