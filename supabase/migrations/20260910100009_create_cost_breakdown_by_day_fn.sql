-- Two-dimensional (day x project/agent) cost breakdown for the Cost
-- Dashboard's stacked bar chart (docs/04-ui-ux-design.md Section 3.4:
-- "Main chart: stacked bar chart (cost per day, stacked by project or
-- agent depending on toggle)").
--
-- GET /cost-summary (Section 4.4) only groups by one dimension at a time
-- (day OR project OR agent) -- a stacked-by-day chart needs both at once,
-- which isn't expressible through PostgREST directly (same join+aggregate
-- limitation as cost_summary itself). Long/tidy output (one row per
-- day+group combination) rather than pre-pivoted, since the pivot into
-- per-day stacks is presentation logic that belongs in the dashboard.
create or replace function cost_breakdown_by_day(
  p_org_id uuid,
  p_dimension text,  -- 'project' | 'agent'
  p_start timestamptz,
  p_end timestamptz
) returns table (
  day text,
  group_key text,
  cost_usd numeric
)
language plpgsql
as $$
begin
  if p_dimension = 'project' then
    return query
      select
        to_char(date_trunc('day', e.created_at), 'YYYY-MM-DD') as day,
        coalesce(s.project_label, 'unlabeled') as group_key,
        coalesce(sum(e.cost_usd), 0) as cost_usd
      from agent_events e
      join sessions s on s.id = e.session_id
      where e.org_id = p_org_id
        and e.created_at >= p_start
        and e.created_at < p_end
      group by 1, 2
      order by 1, 2;

  elsif p_dimension = 'agent' then
    return query
      select
        to_char(date_trunc('day', e.created_at), 'YYYY-MM-DD') as day,
        s.agent_name as group_key,
        coalesce(sum(e.cost_usd), 0) as cost_usd
      from agent_events e
      join sessions s on s.id = e.session_id
      where e.org_id = p_org_id
        and e.created_at >= p_start
        and e.created_at < p_end
      group by 1, 2
      order by 1, 2;

  else
    raise exception 'invalid dimension: %', p_dimension;
  end if;
end;
$$;
