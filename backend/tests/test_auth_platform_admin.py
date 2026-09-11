"""Unit tests for app.auth.verify_platform_admin -- the Super Admin auth
dependency guarding the cross-org /admin/* endpoints (app/routers/admin.py).
See CLAUDE.md's "Planned, not yet built" entry this closes.

Mirrors tests/test_auth_jwt.py's shape (verify_jwt), swapping the
org_members membership check for a platform_admins one.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import patch
from uuid import UUID

import jwt
import pytest
from fastapi import HTTPException

from app.auth import verify_platform_admin
from app.config import Settings
from tests.fakes import FakeSupabase

JWT_SECRET = "test-jwt-secret-that-is-long-enough-for-hs256"
AUTH_USER_ID = "33333333-3333-3333-3333-333333333333"


def _settings() -> Settings:
    return Settings(
        supabase_url="https://example.supabase.co",
        supabase_service_role_key="dummy-service-role-key",
        supabase_jwt_secret=JWT_SECRET,
    )


def _make_token(*, sub: str = AUTH_USER_ID, email: str = "admin@example.com") -> str:
    payload = {
        "sub": sub,
        "aud": "authenticated",
        "email": email,
        "exp": datetime.now(timezone.utc) + timedelta(hours=1),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")


def test_platform_admin_row_grants_access():
    token = _make_token()
    fake = FakeSupabase({"platform_admins": {"auth_user_id": AUTH_USER_ID}})

    with (
        patch("app.auth.get_settings", return_value=_settings()),
        patch("app.auth.get_supabase", return_value=fake),
    ):
        result = verify_platform_admin(authorization=f"Bearer {token}")

    assert result.auth_user_id == UUID(AUTH_USER_ID)
    assert result.email == "admin@example.com"


def test_no_platform_admin_row_is_rejected():
    # An ordinary org member/admin with no platform_admins row must never
    # reach the cross-org endpoints -- this is the entire point of the
    # role being a separate table, not a value inside org_members.role.
    token = _make_token()
    fake = FakeSupabase({"platform_admins": None})

    with (
        patch("app.auth.get_settings", return_value=_settings()),
        patch("app.auth.get_supabase", return_value=fake),
    ):
        with pytest.raises(HTTPException) as exc_info:
            verify_platform_admin(authorization=f"Bearer {token}")

    assert exc_info.value.status_code == 403


def test_missing_jwt_is_rejected():
    with pytest.raises(HTTPException) as exc_info:
        verify_platform_admin(authorization=None)

    assert exc_info.value.status_code == 401


def test_invalid_jwt_is_rejected_before_any_platform_admin_check():
    with patch("app.auth.get_settings", return_value=_settings()):
        with pytest.raises(HTTPException) as exc_info:
            verify_platform_admin(authorization="Bearer not-a-real-jwt")

    assert exc_info.value.status_code == 401
