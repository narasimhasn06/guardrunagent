"""Unit tests for Supabase JWT auth (app.auth.verify_jwt).

Cases per docs/06-test-plan.md Section 3.2 ("JWT verification middleware"):
- Valid Supabase JWT is accepted
- Expired JWT is rejected
- Malformed/missing JWT is rejected
- JWT for a user with no org_members row is handled gracefully (doesn't crash)

All the HS256-signed tokens below (_make_token, no `kid` header) exercise
_decode_supabase_jwt's fallback path -- PyJWKClient.get_signing_key_from_jwt
raises immediately on a missing `kid` (no network call attempted), so these
double as coverage for "project hasn't migrated to JWT Signing Keys." The
ES256/JWKS path (the current default -- see CLAUDE.md's decisions log) has
its own dedicated test below.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch
from uuid import UUID

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import HTTPException
from postgrest.exceptions import APIError

from app.auth import verify_jwt
from app.config import Settings
from tests.fakes import FakeSupabase, Raises, Sequence

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


def test_valid_es256_jwt_verified_via_jwks_is_accepted():
    # Supabase's current default: JWT Signing Keys, an asymmetric key
    # (ES256) verified against the project's public JWKS endpoint, not a
    # shared secret. Mocks only the network fetch (get_signing_key_from_jwt)
    # -- the actual signature verification below is real cryptography
    # against a real EC keypair, not a stub.
    private_key = ec.generate_private_key(ec.SECP256R1())
    token = jwt.encode(
        {
            "sub": AUTH_USER_ID,
            "aud": "authenticated",
            "email": "jane@example.com",
            "exp": datetime.now(timezone.utc) + timedelta(hours=1),
        },
        private_key,
        algorithm="ES256",
        headers={"kid": "test-kid"},
    )
    fake = _supabase_with_member({"org_id": ORG_ID, "role": "admin", "email": "jane@example.com"})
    mock_signing_key = MagicMock(key=private_key.public_key())

    with (
        patch("app.auth.get_settings", return_value=_settings()),
        patch("app.auth.get_supabase", return_value=fake),
        patch("app.auth.PyJWKClient.get_signing_key_from_jwt", return_value=mock_signing_key),
    ):
        result = verify_jwt(authorization=f"Bearer {token}")

    assert result.org_id == UUID(ORG_ID)
    assert result.role == "admin"


def test_es256_jwt_with_wrong_key_is_rejected():
    # A JWKS lookup that returns a key that doesn't actually match the
    # token's real signature must still fail closed, not fall through to
    # the HS256 legacy path (that would mean any expired/replaced signing
    # key silently downgrades security).
    real_key = ec.generate_private_key(ec.SECP256R1())
    wrong_key = ec.generate_private_key(ec.SECP256R1())
    token = jwt.encode(
        {
            "sub": AUTH_USER_ID,
            "aud": "authenticated",
            "exp": datetime.now(timezone.utc) + timedelta(hours=1),
        },
        real_key,
        algorithm="ES256",
        headers={"kid": "test-kid"},
    )
    mock_signing_key = MagicMock(key=wrong_key.public_key())

    with (
        patch("app.auth.get_settings", return_value=_settings()),
        patch("app.auth.PyJWKClient.get_signing_key_from_jwt", return_value=mock_signing_key),
    ):
        with pytest.raises(HTTPException) as exc_info:
            verify_jwt(authorization=f"Bearer {token}")

    assert exc_info.value.status_code == 401


def test_missing_legacy_secret_fails_closed_not_500():
    # Regression: supabase_jwt_secret is optional (see app/config.py) --
    # a project running purely on JWKS/ES256 may not set it at all. A
    # token that JWKS can't verify either (no matching `kid`, e.g. an
    # HS256-signed token like the ones _make_token produces) must still
    # fail as an ordinary 401, not blow up with an unhandled exception
    # because there's no secret left to fall back to.
    token = _make_token()
    settings = Settings(
        supabase_url="https://example.supabase.co",
        supabase_service_role_key="dummy-service-role-key",
        supabase_jwt_secret=None,
    )

    with patch("app.auth.get_settings", return_value=settings):
        with pytest.raises(HTTPException) as exc_info:
            verify_jwt(authorization=f"Bearer {token}")

    assert exc_info.value.status_code == 401


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


def test_jwt_for_user_with_no_org_members_row_or_invite_is_rejected():
    token = _make_token()
    fake = FakeSupabase({"org_members": None, "org_invites": None})

    with (
        patch("app.auth.get_settings", return_value=_settings()),
        patch("app.auth.get_supabase", return_value=fake),
    ):
        with pytest.raises(HTTPException) as exc_info:
            verify_jwt(authorization=f"Bearer {token}")

    # Doesn't crash (no unhandled exception) and doesn't silently grant
    # access -- fails clearly with 403. This is the still-unbuilt
    # new-org-signup half of docs/03-low-level-design.md Section 2.2 step
    # 6 ("creating a new org if this is a first-time signup"); the
    # invite half is covered below.
    assert exc_info.value.status_code == 403


def test_first_login_with_a_pending_invite_joins_that_org():
    # docs/04-ui-ux-design.md Section 3.6: "Invited members ... are linked
    # to the org on first login." No org_members row exists yet for this
    # auth_user_id, but a pending org_invites row matches their email.
    token = _make_token(email="new.hire@example.com")
    new_member_row = {"org_id": ORG_ID, "role": "member", "email": "new.hire@example.com"}
    fake = FakeSupabase(
        {
            "org_members": {"select": None, "insert": [new_member_row]},
            "org_invites": {
                "select": {"id": "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee", "org_id": ORG_ID, "role": "member"},
                "delete": None,
            },
        }
    )

    with (
        patch("app.auth.get_settings", return_value=_settings()),
        patch("app.auth.get_supabase", return_value=fake),
    ):
        result = verify_jwt(authorization=f"Bearer {token}")

    assert result.org_id == UUID(ORG_ID)
    assert result.role == "member"
    assert result.email == "new.hire@example.com"

    insert_calls = [c for c in fake.recorded_calls if c[0] == "insert" and c[1] == "org_members"]
    assert insert_calls[0][2] == {
        "org_id": ORG_ID,
        "auth_user_id": AUTH_USER_ID,
        "email": "new.hire@example.com",
        "role": "member",
    }
    delete_calls = [c for c in fake.recorded_calls if c[0] == "delete" and c[1] == "org_invites"]
    assert len(delete_calls) == 1  # the consumed invite is removed so it can't be reused


def test_concurrent_first_login_race_is_handled_not_500():
    # Caught live in production: a brand-new user's very first
    # authenticated page load fires more than one request that each land
    # in resolve_or_join_org concurrently (the dashboard layout's GET /me
    # and the Home page's GET /dashboard-summary, at minimum). Both see
    # no existing org_members row and both try to insert -- the loser
    # hits a real postgrest.exceptions.APIError (Postgres 23505, unique
    # violation on org_members_auth_user_id_key) instead of getting back
    # the winner's row. This simulates being the loser: the insert raises
    # 23505, and verify_jwt must recover by re-fetching and returning the
    # now-existing row, not crash.
    token = _make_token(email="new.hire@example.com")
    winners_row = {"org_id": ORG_ID, "role": "member", "email": "new.hire@example.com"}
    duplicate_key_error = APIError(
        {
            "message": 'duplicate key value violates unique constraint "org_members_auth_user_id_key"',
            "code": "23505",
            "hint": None,
            "details": f"Key (auth_user_id)=({AUTH_USER_ID}) already exists.",
        }
    )
    fake = FakeSupabase(
        {
            "org_members": {"select": Sequence(None, winners_row), "insert": Raises(duplicate_key_error)},
            "org_invites": {
                "select": {"id": "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee", "org_id": ORG_ID, "role": "member"},
            },
        }
    )

    with (
        patch("app.auth.get_settings", return_value=_settings()),
        patch("app.auth.get_supabase", return_value=fake),
    ):
        result = verify_jwt(authorization=f"Bearer {token}")

    assert result.org_id == UUID(ORG_ID)
    assert result.role == "member"
    assert result.email == "new.hire@example.com"

    # Never deleted the invite on the losing path -- the winning request
    # already did.
    delete_calls = [c for c in fake.recorded_calls if c[0] == "delete" and c[1] == "org_invites"]
    assert delete_calls == []


def test_a_genuinely_different_db_error_still_raises():
    # ensure_not_last_admin-style safety: only the specific 23505
    # unique-violation is treated as "a concurrent request won" -- any
    # other database error must still surface, not be swallowed.
    token = _make_token(email="new.hire@example.com")
    other_error = APIError({"message": "connection reset", "code": "08006", "hint": None, "details": None})
    fake = FakeSupabase(
        {
            "org_members": {"select": None, "insert": Raises(other_error)},
            "org_invites": {
                "select": {"id": "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee", "org_id": ORG_ID, "role": "member"},
            },
        }
    )

    with (
        patch("app.auth.get_settings", return_value=_settings()),
        patch("app.auth.get_supabase", return_value=fake),
    ):
        with pytest.raises(APIError):
            verify_jwt(authorization=f"Bearer {token}")
