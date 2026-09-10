-- Server-side, filtered, paginated session listing with a per-session
-- event count, for GET /sessions (docs/04-ui-ux-design.md Section 3.2:
-- "Table view, columns: Started At, Project, Agent, Duration, Cost,
-- Event Count, Status").
--
-- Not expressible through PostgREST's REST interface: event_count needs
-- a join+aggregate against agent_events per session, and returning a
-- total match count alongside a paginated page needs a window function.
-- Same rationale as cost_summary and increment_session_totals -- not
-- part of the original six-table schema in Section 1.
create or replace function list_sessions(
  p_org_id uuid,
  p_project_label text default null,
  p_agent_name text default null,
  p_search text default null,
  p_status text default null,
  p_start timestamptz default null,
  p_end timestamptz default null,
  p_limit int default 50,
  p_offset int default 0
) returns table (
  id uuid,
  agent_name text,
  project_label text,
  started_at timestamptz,
  ended_at timestamptz,
  total_cost_usd numeric,
  total_tokens int,
  status text,
  event_count bigint,
  total_count bigint
)
language sql
as $$
  select
    s.id,
    s.agent_name,
    s.project_label,
    s.started_at,
    s.ended_at,
    s.total_cost_usd,
    s.total_tokens,
    s.status,
    coalesce(e.event_count, 0) as event_count,
    count(*) over() as total_count
  from sessions s
  left join (
    select session_id, count(*) as event_count
    from agent_events
    group by session_id
  ) e on e.session_id = s.id
  where s.org_id = p_org_id
    and (p_project_label is null or s.project_label = p_project_label)
    and (p_agent_name is null or s.agent_name = p_agent_name)
    and (p_search is null or s.project_label ilike '%' || p_search || '%')
    and (p_status is null or s.status = p_status)
    and (p_start is null or s.started_at >= p_start)
    and (p_end is null or s.started_at < p_end)
  order by s.started_at desc
  limit p_limit
  offset p_offset;
$$;
