# GuardrunAgent MVP — Requirements Specification

## 1. Purpose

Give engineering teams visibility, cost tracking, and basic safety guardrails for AI coding agents (starting with Claude Code) — without requiring any change to how their agents already work.

## 2. Problem Statement

Engineering teams running AI coding agents have no reliable way to answer:
- What did the agent actually do in this session, and why?
- How much are we spending, broken down by agent, project, or team?
- Can we stop an agent from taking a specific risky action without a human approving it first?

## 3. Target User (MVP)

- Engineering managers / tech leads at companies with 20–200 engineers
- Actively using Claude Code (primary) and/or Cursor (stretch) in day-to-day development
- Has felt at least one of: a surprise/incident from agent behavior, no visibility into agent spend, or discomfort granting agents broad permissions

## 4. In Scope (MVP)

| # | Requirement | Priority |
|---|---|---|
| R1 | Capture every tool-call event from a Claude Code session (file edit, bash command, git action, API call) | Must |
| R2 | Log event metadata: timestamp, session ID, action type, payload summary, tokens used, cost, success/failure | Must |
| R3 | Ship logs to a hosted backend over HTTPS | Must |
| R4 | Session Replay view: chronological list of everything an agent did in one run, with reasoning snippet where available | Must |
| R5 | Cost Dashboard: spend by agent, by day, by project/team | Must |
| R6 | Guardrail rule engine: block or flag a defined set of risky actions (e.g. `rm -rf`, force-push, edits to a defined "protected paths" list) | Must |
| R7 | Alerting: Slack or email notification when a guardrail rule fires | Must |
| R8 | Dashboard login via **Supabase Auth**, supporting both email/password and "Login with Google" (OAuth), with accounts linked by email so a user never ends up with duplicate accounts | Must |
| R9 | Manual API key / project config setup (no auto-discovery) for SDK-to-backend authentication | Must |
| R10 | Rollback / auto-undo of flagged actions | Out of scope (v2) |
| R11 | Support for agent frameworks beyond Claude Code (Cursor, Devin, custom agents) | Out of scope (v2), Cursor stretch if time allows |
| R12 | ML-based anomaly detection | Out of scope (v2 — no training data yet) |
| R13 | Enterprise SSO (SAML) / granular RBAC | Out of scope (v2) |
| R14 | On-prem / self-hosted deployment | Out of scope (v2) |

## 5. Non-Functional Requirements

| # | Requirement |
|---|---|
| NFR1 | SDK overhead must add negligible latency to agent tool calls (target: <50ms per event, async/non-blocking) |
| NFR2 | Event ingestion must not lose data on backend hiccups — SDK buffers and retries on failure |
| NFR3 | Dashboard loads a session replay of up to 500 events in under 2 seconds |
| NFR4 | No raw source code or secrets stored in payload logs by default — truncate/redact file contents, log file paths and diffs summary only |
| NFR5 | System must run reliably for a single small team (10–20 engineers) without manual ops intervention |
| NFR6 | Auth tokens (Supabase JWTs) validated on every backend request; service role key never exposed to the frontend/browser bundle |

## 6. User Stories

1. As an eng manager, I want to see everything an agent did in a session so I can debug an incident after the fact.
2. As an eng manager, I want to see agent spend broken down by team/project so I can budget and flag overuse.
3. As a platform/DevOps lead, I want to block agents from force-pushing or touching protected config paths without me writing custom code.
4. As an on-call engineer, I want a Slack alert the moment an agent attempts a blocked action, so I can react in real time.
5. As a new user, I want to sign in with my Google account (or set up a password if I prefer) so I can get into the dashboard quickly without extra friction.

## 7. Success Criteria for MVP

- Installed and actively logging sessions for 3–5 pilot teams within 6 weeks of build start
- At least 1 guardrail rule fired and correctly blocked/flagged a real action in a live pilot
- At least 3 pilot users say they'd be upset if the tool was taken away (qualitative retention signal)
- Cost dashboard numbers independently verified as accurate against the underlying API billing

## 8. Open Questions (to resolve during pilot)

- Do teams want per-engineer cost attribution, or is team/project-level enough for MVP?
- Is Slack the dominant alert channel, or do teams need email/PagerDuty too?
- What's the minimum guardrail rule set that covers 80% of real fear (start with 3–5 rules, not a full engine)?
