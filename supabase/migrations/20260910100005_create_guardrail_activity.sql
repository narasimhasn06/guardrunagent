-- Guardrail firing log (for the alert/audit view)
create table guardrail_activity (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid references guardrail_rules(id),
  event_id uuid references agent_events(id),
  org_id uuid references orgs(id),
  fired_at timestamptz default now(),
  alert_sent boolean default false
);
