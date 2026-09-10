"""A minimal fake for the supabase-py chained query builder, used to unit-
and endpoint-test the backend without a real Supabase project.

Only supports the operations app/*.py actually calls: select/insert/update,
eq/order/range/maybe_single, execute(), and rpc(). Every insert/update/rpc
call is recorded on FakeSupabase.recorded_calls so tests can assert on the
payload sent to the database.
"""

from __future__ import annotations

from typing import Any

_PER_OP_KEYS = {"select", "insert", "update"}


class FakeResult:
    def __init__(self, data: Any = None, count: int | None = None):
        self.data = data
        self.count = count


class FakeQuery:
    def __init__(
        self,
        client: "FakeSupabase",
        table_name: str,
        data: Any,
        count: int | None = None,
        per_op_data: dict[str, Any] | None = None,
    ):
        self._client = client
        self._table_name = table_name
        self._data = data
        self._count = count
        self._per_op_data = per_op_data
        self._active_op: str | None = None

    def select(self, *_args: object, **_kwargs: object) -> "FakeQuery":
        self._active_op = "select"
        return self

    def insert(self, payload: Any) -> "FakeQuery":
        self._client.recorded_calls.append(("insert", self._table_name, payload))
        self._active_op = "insert"
        return self

    def update(self, payload: Any) -> "FakeQuery":
        self._client.recorded_calls.append(("update", self._table_name, payload))
        self._active_op = "update"
        return self

    def eq(self, *_args: object, **_kwargs: object) -> "FakeQuery":
        return self

    def order(self, *_args: object, **_kwargs: object) -> "FakeQuery":
        return self

    def range(self, *_args: object, **_kwargs: object) -> "FakeQuery":
        return self

    def maybe_single(self) -> "FakeQuery":
        return self

    def execute(self) -> FakeResult:
        if self._per_op_data is not None:
            return FakeResult(self._per_op_data.get(self._active_op), self._count)
        return FakeResult(self._data, self._count)


class FakeSupabase:
    """table_data maps table name to one of:

    - a raw value (list/dict/None): returned as `.data` for any operation
      on that table (select, insert, or update alike).
    - {"data": ..., "count": ...}: same, plus a `.count` (e.g. the
      paginated events list on GET /sessions/:id).
    - {"select": ..., "insert": ..., "update": ...}: different canned
      `.data` per operation, for a handler that does more than one kind
      of call against the same table (e.g. POST /rules/starter selects
      existing rule names, then inserts new ones).

    rpc_data maps RPC function name -> the `.data` its execute() returns.
    """

    def __init__(
        self,
        table_data: dict[str, Any] | None = None,
        rpc_data: dict[str, Any] | None = None,
    ):
        self._table_data = table_data or {}
        self._rpc_data = rpc_data or {}
        self.recorded_calls: list[tuple[str, str, Any]] = []

    def table(self, name: str) -> FakeQuery:
        entry = self._table_data.get(name)
        if isinstance(entry, dict) and "data" in entry and set(entry.keys()) <= {"data", "count"}:
            return FakeQuery(self, name, entry["data"], entry.get("count"))
        if isinstance(entry, dict) and entry and set(entry.keys()) <= _PER_OP_KEYS:
            return FakeQuery(self, name, None, per_op_data=entry)
        return FakeQuery(self, name, entry, None)

    def rpc(self, name: str, params: dict[str, Any]) -> FakeQuery:
        self.recorded_calls.append(("rpc", name, params))
        return FakeQuery(self, f"rpc:{name}", self._rpc_data.get(name))
