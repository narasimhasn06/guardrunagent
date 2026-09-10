-- Agent sessions (one row per Claude Code run)
create table sessions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references orgs(id),
  agent_name text not null,          -- e.g. 'claude-code'
  project_label text,                -- user-assigned, e.g. repo name
  started_at timestamptz not null,
  ended_at timestamptz,
  total_cost_usd numeric(10,4) default 0,
  total_tokens int default 0,
  status text default 'active'       -- 'active' | 'completed' | 'error'
);
