-- Guardrail rules
--
-- Created ahead of agent_events (out of the doc's listed order) because
-- agent_events.matched_rule_id references this table's primary key.
create table guardrail_rules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references orgs(id),
  name text not null,
  pattern_type text not null,        -- 'command_regex' | 'path_prefix' | 'action_type'
  pattern_value text not null,       -- e.g. '^rm -rf' or '/prod/config'
  action_on_match text not null,     -- 'block' | 'flag'
  enabled boolean default true,
  created_at timestamptz default now()
);
