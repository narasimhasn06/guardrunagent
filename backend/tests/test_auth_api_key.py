"""Unit tests for API key auth (app.auth.verify_api_key).

Cases per docs/06-test-plan.md Section 3.2 ("API key auth"):
- Valid key resolves correct org_id
- Invalid/revoked key is rejected
- Hashed comparison is timing-safe

Uses HMAC-SHA256 (app/api_keys.py), not bcrypt -- see that module's
docstring for why. get_settings is patched everywhere here since
hash_api_key needs a pepper to compute anything. "Timing-safe" here means
the lookup is a DB equality query on a deterministic keyed hash rather
than a Python-side string comparison -- see test_two_different_orgs_hash_to_different_values
and test_same_key_always_hashes_the_same_way for what's actually
unit-testable about that property.
"""

from __future__ import annotations

from unittest.mock import patch
from uuid import UUID

import pytest
from fastapi import HTTPException

from app.api_keys import hash_api_key
from app.auth import verify_api_key
from app.config import Settings
from tests.fakes import FakeSupabase

ORG_ID = "11111111-1111-1111-1111-111111111111"
PLAINTEXT_KEY = "grk_testkey123"
PEPPER = "test-pepper-not-a-real-secret"


def _settings() -> Settings:
    return Settings(
        supabase_url="https://example.supabase.co",
        supabase_service_role_key="dummy-service-role-key",
        supabase_jwt_secret="dummy-jwt-secret",
        api_key_pepper=PEPPER,
    )


def _hashed(plaintext: str) -> str:
    with patch("app.api_keys.get_settings", return_value=_settings()):
        return hash_api_key(plaintext)


def _supabase_with_org(org: dict | None) -> FakeSupabase:
    # verify_api_key calls .maybe_single(), which (in the real
    # supabase-py client) collapses the result to a single dict or None --
    # tests/fakes.py's FakeQuery doesn't simulate that collapse itself, so
    # the fixture data has to already be in that shape.
    return FakeSupabase({"orgs": org})


def test_valid_key_resolves_correct_org_id():
    fake = _supabase_with_org({"id": ORG_ID})
    with (
        patch("app.api_keys.get_settings", return_value=_settings()),
        patch("app.auth.get_supabase", return_value=fake),
    ):
        result = verify_api_key(x_api_key=PLAINTEXT_KEY)

    assert result.org_id == UUID(ORG_ID)


def test_invalid_key_is_rejected():
    # The real query filters .eq("api_key_hash", <computed hash>), so a
    # non-matching key just means no row comes back.
    fake = _supabase_with_org(None)
    with (
        patch("app.api_keys.get_settings", return_value=_settings()),
        patch("app.auth.get_supabase", return_value=fake),
    ):
        with pytest.raises(HTTPException) as exc_info:
            verify_api_key(x_api_key="wrong-key")

    assert exc_info.value.status_code == 401


def test_revoked_key_no_longer_matches_any_org():
    # Simulates a key that's been regenerated (Settings page 'regenerate'
    # flow) -- the old plaintext's hash no longer matches any stored row.
    fake = _supabase_with_org(None)
    with (
        patch("app.api_keys.get_settings", return_value=_settings()),
        patch("app.auth.get_supabase", return_value=fake),
    ):
        with pytest.raises(HTTPException) as exc_info:
            verify_api_key(x_api_key=PLAINTEXT_KEY)

    assert exc_info.value.status_code == 401


def test_missing_key_is_rejected():
    with pytest.raises(HTTPException) as exc_info:
        verify_api_key(x_api_key=None)

    assert exc_info.value.status_code == 401


def test_two_different_keys_hash_to_different_values():
    assert _hashed("key-for-org-a") != _hashed("key-for-org-b")


def test_same_key_always_hashes_the_same_way():
    # Determinism is what lets verify_api_key use a single equality
    # lookup instead of bcrypt's hash-and-loop-over-every-org.
    assert _hashed(PLAINTEXT_KEY) == _hashed(PLAINTEXT_KEY)
