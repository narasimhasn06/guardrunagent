-- Server-side grouped cost aggregation for GET /cost-summary.
--
-- docs/03-low-level-design.md Section 4.4 requires this to be "grouped and
-- summed server-side," and PostgREST's REST interface (what the backend
-- otherwise talks to via the supabase-py client) doesn't support arbitrary
-- GROUP BY + JOIN aggregation -- 'project' and 'agent' grouping need a
-- join from agent_events to sessions, so this is a Postgres function
-- called via .rpc() instead. Not part of the original six-table schema in
-- Section 1, same rationale as increment_session_totals.
create or replace function cost_summary(
  p_org_id uuid,
  p_group_by text,
  p_start timestamptz,
  p_end timestamptz
) returns table (
  group_key text,
  total_cost_usd numeric,
  total_tokens bigint,
  event_count bigint
)
language plpgsql
as $$
begin
  if p_group_by = 'day' then
    return query
      select
        to_char(date_trunc('day', e.created_at), 'YYYY-MM-DD') as group_key,
        coalesce(sum(e.cost_usd), 0) as total_cost_usd,
        coalesce(sum(e.tokens_used), 0)::bigint as total_tokens,
        count(*)::bigint as event_count
      from agent_events e
      where e.org_id = p_org_id
        and e.created_at >= p_start
        and e.created_at < p_end
      group by 1
      order by 1;

  elsif p_group_by = 'project' then
    return query
      select
        coalesce(s.project_label, 'unlabeled') as group_key,
        coalesce(sum(e.cost_usd), 0) as total_cost_usd,
        coalesce(sum(e.tokens_used), 0)::bigint as total_tokens,
        count(*)::bigint as event_count
      from agent_events e
      join sessions s on s.id = e.session_id
      where e.org_id = p_org_id
        and e.created_at >= p_start
        and e.created_at < p_end
      group by 1
      order by 1;

  elsif p_group_by = 'agent' then
    return query
      select
        s.agent_name as group_key,
        coalesce(sum(e.cost_usd), 0) as total_cost_usd,
        coalesce(sum(e.tokens_used), 0)::bigint as total_tokens,
        count(*)::bigint as event_count
      from agent_events e
      join sessions s on s.id = e.session_id
      where e.org_id = p_org_id
        and e.created_at >= p_start
        and e.created_at < p_end
      group by 1
      order by 1;

  else
    raise exception 'invalid group_by: %', p_group_by;
  end if;
end;
$$;
