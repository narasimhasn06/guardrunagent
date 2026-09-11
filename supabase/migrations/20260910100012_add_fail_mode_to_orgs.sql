-- Promotes fail-open/fail-closed guardrail-check behavior from a
-- client-side-only SDK config (sdk/src/config.ts's GUARDRUNAGENT_FAIL_MODE
-- env var / ~/.guardrunagent/config.json) to a real org-level setting, per
-- docs/05-architecture-document.md Section 8's documented gap ("not as an
-- org-level setting yet -- there's no schema column for it"). The SDK's
-- local env var/config.json now acts as a per-machine override in front
-- of this org-level default -- see CLAUDE.md's decisions log.
alter table orgs
  add column fail_mode text not null default 'open' check (fail_mode in ('open', 'closed'));
