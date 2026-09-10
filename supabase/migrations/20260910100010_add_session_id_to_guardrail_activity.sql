-- Adds guardrail_activity.session_id so the Activity Log
-- (docs/04-ui-ux-design.md Section 3.5: "session link") can link a rule
-- firing back to its session without going through event_id.
--
-- event_id is left null at guardrail-check time (the flagged/blocked
-- action's agent_events row doesn't exist yet -- it's logged
-- asynchronously afterward, per docs/02-high-level-design.md Section 3),
-- so it was never usable for this. session_id is available at
-- guardrail-check time (POST /guardrail-check's request carries it,
-- added in an earlier step precisely so the Slack alert could link to a
-- session), so this column gets populated directly at insert instead of
-- needing an event_id join that mostly wouldn't resolve to anything.
alter table guardrail_activity
  add column session_id uuid references sessions(id);
