-- Atomic incremental update for sessions.total_cost_usd / total_tokens.
--
-- POST /events writes potentially-concurrent batches (the SDK flushes
-- every 2s or 50 events — docs/03-low-level-design.md Section 3.3); a
-- read-then-write from the backend would race under concurrent flushes.
-- This keeps the increment atomic inside Postgres.
--
-- Not part of the original six-table schema in Section 1 — added because
-- that same section's API design (4.1) requires session totals to
-- "update incrementally and correctly," which a plain PostgREST update
-- can't guarantee under concurrency.
create or replace function increment_session_totals(
  p_session_id uuid,
  p_cost_delta numeric,
  p_tokens_delta int
) returns void
language sql
as $$
  update sessions
  set total_cost_usd = total_cost_usd + p_cost_delta,
      total_tokens = total_tokens + p_tokens_delta
  where id = p_session_id;
$$;
