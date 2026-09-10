"""A minimal fake for the supabase-py chained query builder, used to unit-
and endpoint-test the backend without a real Supabase project.

Only supports the operations app/*.py actually calls: select/insert/update,
eq/gte/lt/order/range/limit/maybe_single, execute(), and rpc(). Every
insert/update/rpc call is recorded on FakeSupabase.recorded_calls so tests
can assert on the payload sent to the database.
"""

from __future__ import annotations

from typing import Any

_PER_OP_KEYS = {"select", "insert", "update"}
_RESULT_KEYS = {"data", "count"}


class Sequence:
    """Wrap responses to hand out one per call, in call order, for
    handlers that query the same table+operation more than once within a
    single request with different filters -- e.g. a range-scoped count
    and a separate unscoped count against the same table. Extra calls
    past the end repeat the last response.
    """

    def __init__(self, *responses: Any):
        self.responses = list(responses)


class FakeResult:
    def __init__(self, data: Any = None, count: int | None = None):
        self.data = data
        self.count = count


def _interpret(raw: Any) -> tuple[Any, int | None]:
    """Turns a configured response value into (data, count). A dict whose
    keys are exactly {"data"} or {"data", "count"} is the count-bearing
    shape; anything else is treated as the `.data` value directly.
    """
    if isinstance(raw, dict) and "data" in raw and set(raw.keys()) <= _RESULT_KEYS:
        return raw["data"], raw.get("count")
    return raw, None


class FakeQuery:
    def __init__(self, client: "FakeSupabase", table_name: str, entry: Any):
        self._client = client
        self._table_name = table_name
        self._entry = entry
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

    def gte(self, *_args: object, **_kwargs: object) -> "FakeQuery":
        return self

    def lt(self, *_args: object, **_kwargs: object) -> "FakeQuery":
        return self

    def order(self, *_args: object, **_kwargs: object) -> "FakeQuery":
        return self

    def range(self, *_args: object, **_kwargs: object) -> "FakeQuery":
        return self

    def limit(self, *_args: object, **_kwargs: object) -> "FakeQuery":
        return self

    def maybe_single(self) -> "FakeQuery":
        return self

    def execute(self) -> FakeResult:
        if isinstance(self._entry, dict) and self._entry and set(self._entry.keys()) <= _PER_OP_KEYS:
            raw = self._entry.get(self._active_op)
        else:
            raw = self._entry

        if isinstance(raw, Sequence):
            raw = self._client._next_sequence_value(self._table_name, self._active_op or "select", raw)

        data, count = _interpret(raw)
        return FakeResult(data, count)


class FakeSupabase:
    """table_data maps table name to one of:

    - a raw value (list/dict/None): returned as `.data` for any operation
      on that table (select, insert, or update alike).
    - {"data": ..., "count": ...}: same, plus a `.count` (e.g. the
      paginated events list on GET /sessions/:id).
    - {"select": ..., "insert": ..., "update": ...}: different canned
      response per operation, for a handler that does more than one kind
      of call against the same table (e.g. POST /rules/starter selects
      existing rule names, then inserts new ones). Each value here can
      itself be a raw value, a {"data","count"} dict, or a Sequence.
    - Wrap any of the above (or a per-op value) in `Sequence(...)` when a
      handler queries the same table+operation more than once with
      different filters and needs different responses each time (see
      Sequence's docstring).

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
        self._sequence_positions: dict[tuple[str, str], int] = {}

    def table(self, name: str) -> FakeQuery:
        return FakeQuery(self, name, self._table_data.get(name))

    def rpc(self, name: str, params: dict[str, Any]) -> FakeQuery:
        self.recorded_calls.append(("rpc", name, params))
        return FakeQuery(self, f"rpc:{name}", self._rpc_data.get(name))

    def _next_sequence_value(self, table_name: str, op: str, seq: Sequence) -> Any:
        key = (table_name, op)
        idx = self._sequence_positions.get(key, 0)
        value = seq.responses[min(idx, len(seq.responses) - 1)]
        self._sequence_positions[key] = idx + 1
        return value
