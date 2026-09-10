-- Individual events within a session
create table agent_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references sessions(id),
  org_id uuid references orgs(id),   -- denormalized for fast org-scoped queries
  action_type text not null,         -- 'file_edit' | 'bash' | 'git' | 'api_call'
  action_summary text,               -- redacted/truncated description
  payload_meta jsonb,                -- structured metadata (file path, command, no raw secrets)
  reasoning_snippet text,            -- short excerpt if available from agent output
  tokens_used int default 0,
  cost_usd numeric(10,4) default 0,
  status text not null,              -- 'success' | 'failure' | 'blocked' | 'flagged'
  matched_rule_id uuid references guardrail_rules(id),
  created_at timestamptz default now()
);

create index idx_events_session on agent_events(session_id, created_at);
create index idx_events_org_time on agent_events(org_id, created_at);
