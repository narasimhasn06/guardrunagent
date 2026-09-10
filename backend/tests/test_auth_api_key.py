"""Unit tests for API key auth (app.auth.verify_api_key).

Cases per docs/06-test-plan.md Section 3.2 ("API key auth"):
- Valid key resolves correct org_id
- Invalid/revoked key is rejected
- Hashed comparison is timing-safe
"""

from __future__ import annotations

from unittest.mock import patch
from uuid import UUID

import bcrypt
import pytest
from fastapi import HTTPException

from app.auth import verify_api_key
from tests.fakes import FakeSupabase

ORG_ID = "11111111-1111-1111-1111-111111111111"
OTHER_ORG_ID = "22222222-2222-2222-2222-222222222222"
PLAINTEXT_KEY = "grn_live_testkey123"
HASHED_KEY = bcrypt.hashpw(PLAINTEXT_KEY.encode(), bcrypt.gensalt()).decode()


def _supabase_with_orgs(orgs: list[dict]) -> FakeSupabase:
    return FakeSupabase({"orgs": orgs})


def test_valid_key_resolves_correct_org_id():
    fake = _supabase_with_orgs(
        [
            {"id": OTHER_ORG_ID, "api_key_hash": bcrypt.hashpw(b"someone-elses-key", bcrypt.gensalt()).decode()},
            {"id": ORG_ID, "api_key_hash": HASHED_KEY},
        ]
    )
    with patch("app.auth.get_supabase", return_value=fake):
        result = verify_api_key(x_api_key=PLAINTEXT_KEY)

    assert result.org_id == UUID(ORG_ID)


def test_invalid_key_is_rejected():
    fake = _supabase_with_orgs([{"id": ORG_ID, "api_key_hash": HASHED_KEY}])
    with patch("app.auth.get_supabase", return_value=fake):
        with pytest.raises(HTTPException) as exc_info:
            verify_api_key(x_api_key="wrong-key")

    assert exc_info.value.status_code == 401


def test_revoked_key_no_longer_matches_any_org():
    # Simulates a key that's been regenerated (LLD Settings page 'regenerate'
    # flow) -- the old plaintext no longer matches any stored hash.
    fake = _supabase_with_orgs([])
    with patch("app.auth.get_supabase", return_value=fake):
        with pytest.raises(HTTPException) as exc_info:
            verify_api_key(x_api_key=PLAINTEXT_KEY)

    assert exc_info.value.status_code == 401


def test_missing_key_is_rejected():
    with pytest.raises(HTTPException) as exc_info:
        verify_api_key(x_api_key=None)

    assert exc_info.value.status_code == 401


def test_malformed_stored_hash_is_skipped_not_crashed():
    # A row with a corrupt/foreign hash format shouldn't 500 the request --
    # it should just fail to match and let matching continue.
    fake = _supabase_with_orgs(
        [
            {"id": OTHER_ORG_ID, "api_key_hash": "not-a-bcrypt-hash"},
            {"id": ORG_ID, "api_key_hash": HASHED_KEY},
        ]
    )
    with patch("app.auth.get_supabase", return_value=fake):
        result = verify_api_key(x_api_key=PLAINTEXT_KEY)

    assert result.org_id == UUID(ORG_ID)


def test_comparison_delegates_to_bcrypt_checkpw_for_timing_safety():
    # docs/03-low-level-design.md Section 7: "hashed comparison is
    # timing-safe" -- bcrypt.checkpw is constant-time by construction, so
    # asserting verify_api_key calls it (rather than e.g. `==` on decoded
    # hashes) is what we can meaningfully assert at the unit level.
    fake = _supabase_with_orgs([{"id": ORG_ID, "api_key_hash": HASHED_KEY}])
    with (
        patch("app.auth.bcrypt.checkpw", wraps=bcrypt.checkpw) as spy,
        patch("app.auth.get_supabase", return_value=fake),
    ):
        verify_api_key(x_api_key=PLAINTEXT_KEY)

    spy.assert_called_once_with(PLAINTEXT_KEY.encode("utf-8"), HASHED_KEY.encode("utf-8"))
