"""Unit tests for app.db.maybe_single_result.

Regression coverage for a real production bug: postgrest-py's
`.maybe_single().execute()` returns `None` outright (not a response
object with `.data = None`) when zero rows match. Every call site in
app/*.py assumed the latter, which passed 136 tests locally (the
FakeSupabase test double got this wrong too -- see tests/fakes.py) but
produced an unhandled `AttributeError: 'NoneType' object has no
attribute 'data'` -- a 500 -- in staging the first time a query
genuinely found no row against the real client.
"""

from __future__ import annotations

from app.db import maybe_single_result


class _StubBuilder:
    def __init__(self, execute_result: object):
        self._execute_result = execute_result

    def execute(self) -> object:
        return self._execute_result


class _StubResponse:
    def __init__(self, data: object):
        self.data = data


def test_maybe_single_result_normalizes_a_none_response():
    # This is the real postgrest-py 2.x behavior for zero matching rows.
    result = maybe_single_result(_StubBuilder(None))

    assert result.data is None


def test_maybe_single_result_passes_through_a_real_response():
    real_response = _StubResponse(data={"id": "some-id"})

    result = maybe_single_result(_StubBuilder(real_response))

    assert result is real_response
    assert result.data == {"id": "some-id"}
