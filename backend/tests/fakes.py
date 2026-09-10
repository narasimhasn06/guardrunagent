"""Minimal fakes for the supabase-py chained query builder, used to unit
test app/auth.py without a real Supabase project. Each auth function only
uses table().select()...execute() chains, so these fakes just need to
support that shape and return canned `.data`.
"""

from __future__ import annotations

from typing import Any


class FakeResult:
    def __init__(self, data: Any):
        self.data = data


class FakeQuery:
    def __init__(self, data: Any):
        self._data = data

    def select(self, *_args: object, **_kwargs: object) -> "FakeQuery":
        return self

    def eq(self, *_args: object, **_kwargs: object) -> "FakeQuery":
        return self

    def maybe_single(self) -> "FakeQuery":
        return self

    def execute(self) -> FakeResult:
        return FakeResult(self._data)


class FakeSupabase:
    """table_data maps table name -> the `.data` its query chain returns."""

    def __init__(self, table_data: dict[str, Any]):
        self._table_data = table_data

    def table(self, name: str) -> FakeQuery:
        return FakeQuery(self._table_data.get(name))
