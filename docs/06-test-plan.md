# GuardrunAgent MVP — Unit & System Test Document

## 1. Test Strategy Overview

| Level | Goal | Owner |
|---|---|---|
| Unit tests | Verify individual functions/modules in isolation (SDK redaction logic, rule matching, JWT verification, cost aggregation math) | Written alongside each component during the 6-week build |
| Integration tests | Verify components talk to each other correctly (SDK → backend, backend → Supabase, dashboard → backend) | Written once each component's unit tests pass |
| System tests | Verify complete user-facing flows end-to-end, matching the UX flows in the UI/UX doc | Run before each pilot release |
| Manual / exploratory testing | Catch anything automated tests miss, especially around the dashboard's visual/interaction quality | Before each pilot demo |

**Testing philosophy for MVP:** prioritize coverage on the two paths that matter most — the synchronous guardrail-check path (correctness and latency) and the redaction logic (a security-relevant bug here is the most damaging possible failure). Everything else gets solid but not exhaustive coverage; this is an MVP, not a mission-critical system yet.

## 2. Tooling

| Component | Test framework |
|---|---|
| SDK (TypeScript) | Vitest or Jest |
| Backend (FastAPI/Python) | pytest, with `httpx`/FastAPI's `TestClient` for endpoint tests |
| Dashboard (Next.js/React) | Vitest + React Testing Library for components; Playwright for end-to-end system tests |
| CI | GitHub Actions — runs unit + integration tests on every PR; system tests run on merge to `main` against a staging environment |

## 3. Unit Test Plan

### 3.1 SDK
| Test area | Key cases |
|---|---|
| Local rule cache matching | Command regex match/no-match; path-prefix match/no-match; case sensitivity; rule with `enabled: false` is correctly skipped |
| Redaction logic | Strips API-key-shaped strings from bash commands; strips `.env` file contents; does not over-redact ordinary file paths/commands; file edit events never include full file contents |
| Event buffering | Batches flush at 50 events or 2 seconds, whichever first; buffer survives a single failed send and retries; falls back to local file after 3 failed retries |
| Guardrail decision handling | `block` decision throws and prevents the action; `flag` and `allow` do not block execution; network failure during a guardrail check falls back to the configured fail-open/fail-closed behavior |

### 3.2 Backend
| Test area | Key cases |
|---|---|
| `POST /events` | Valid batch insert succeeds; malformed event payload returns 4xx with a clear error; `org_id` correctly resolved from API key; session totals (`total_cost_usd`, `total_tokens`) update incrementally and correctly |
| `POST /guardrail-check` | Correct rule match returns the right decision and rule ID; no rule match returns `allow`; disabled rules are never matched; latency stays under 200ms for a realistic rule set size (test with 20+ rules) |
| JWT verification middleware | Valid Supabase JWT is accepted; expired JWT is rejected; malformed/missing JWT is rejected; JWT for a user with no `org_members` row is handled gracefully (triggers org-join/creation flow, doesn't crash) |
| API key auth | Valid key resolves correct `org_id`; invalid/revoked key is rejected; hashed comparison is timing-safe |
| Cost aggregation (`GET /cost-summary`) | Correct grouping by day/project/agent; date range filtering is inclusive/exclusive as documented; empty result set (no data yet) returns a valid empty response, not an error |

### 3.3 Dashboard
| Test area | Key cases |
|---|---|
| Login screen | Email/password form validation; Google OAuth button triggers the correct redirect; password-reset link only shown for email/password users |
| Session Replay | Events render in chronological order; blocked/flagged events show the correct visual treatment and matched rule name; expandable event cards show/hide reasoning correctly |
| Cost Dashboard | Chart and table stay in sync when toggling group-by; CSV export produces a correctly formatted file matching the displayed data |
| Guardrail Rules | Rule creation form validates required fields; starter rules can be enabled with one click; rule edits persist and reflect immediately in the Activity Log |

## 4. Integration Test Plan

| Scenario | What it verifies |
|---|---|
| SDK sends a batch of events → backend → Supabase | End-to-end write path works; data lands correctly in `agent_events`, session totals update |
| SDK triggers a guardrail check → backend evaluates → decision returned → SDK acts on it | The full synchronous path works within latency targets, and the SDK correctly respects `block`/`allow`/`flag` |
| Dashboard user logs in via Supabase Auth → backend verifies JWT → org-scoped data returned | Auth handoff between Supabase, the dashboard, and the backend works correctly, including for a brand-new user with no `org_members` row yet |
| Guardrail block fires → Slack alert dispatched | Alert is sent, and if Slack delivery fails, the failure is still recorded (not silently dropped) in `guardrail_activity` |
| Account linking | A user who signs up with email/password and later uses Google OAuth with the same email resolves to the same account, not a duplicate |

## 5. System Test Scenarios (End-to-End)

These map directly to the key UX flows documented in the UI/UX doc — each should be run as a full scripted scenario before any pilot release.

### 5.1 First-time setup flow
1. New user signs up (both via email/password and, separately, via Google — test both paths)
2. Dashboard shows the empty-state setup checklist
3. User installs SDK, configures API key, runs a Claude Code session
4. Session appears in the dashboard's Sessions list within an acceptable delay
5. User enables starter guardrail rules with one click

**Pass criteria:** all steps complete without manual intervention or unhandled errors; session data is accurate and complete.

### 5.2 Incident investigation flow
1. Trigger an action that matches a guardrail rule (e.g. simulate a force-push attempt)
2. Verify the action is blocked and the agent does not proceed
3. Verify a Slack alert fires with a working link
4. Click the link, land on the Session Detail view, scrolled/highlighted to the flagged event
5. Expand the event, verify reasoning snippet and metadata display correctly

**Pass criteria:** the block actually prevents the action (not just logs it), and the investigation path from alert to root cause takes no more than a couple of clicks.

### 5.3 Cost review flow
1. Generate events across multiple projects/days (via test fixtures or a seeded staging dataset)
2. Open Cost Dashboard, toggle between Day/Project/Agent grouping
3. Verify chart and table numbers match
4. Export CSV, verify contents match what's displayed

**Pass criteria:** cost numbers are accurate to the underlying event data (spot-check against a manual sum).

### 5.4 Auth edge cases
1. Sign up with email/password using `user@company.com`
2. Log out, sign in with Google using the same `user@company.com`
3. Verify this resolves to the same account/org, not a duplicate
4. Attempt password reset — verify it's only offered where applicable (email/password users only)

**Pass criteria:** no duplicate accounts are ever created; password-reset visibility is correct per user type.

## 6. Non-Functional / Performance Testing

| Test | Target | Method |
|---|---|---|
| Guardrail-check latency | p99 < 200ms | Load-test the `/guardrail-check` endpoint with a realistic rule set (20+ rules) and concurrent requests |
| Session Replay load time | Under 2 seconds for a 500-event session | Seed a staging session with 500 synthetic events, measure page load |
| SDK overhead per tool call | Under 50ms added latency | Benchmark tool-call execution time with and without the SDK hook active |
| Event ingestion durability | Zero data loss across a simulated backend outage | Kill the backend mid-session, verify all buffered events are recovered and sent once the backend returns |

## 7. Acceptance Criteria for MVP Release (Test Gate)

Before the MVP is released to the first pilot team, the following must all pass:
- All unit tests green in CI
- All integration test scenarios (Section 4) pass against a staging environment
- All four system test scenarios (Section 5) pass via manual or Playwright-scripted run
- Non-functional targets (Section 6) met at least once against a realistic staging dataset
- No known data-loss or redaction bug open (these are release blockers regardless of severity elsewhere)

## 8. Out of Scope for MVP Testing

- Load testing at scale beyond pilot-level traffic (premature — revisit once real usage data exists)
- Penetration testing / formal security audit (appropriate once approaching a paid enterprise customer, not at pilot stage)
- Cross-browser exhaustive testing — target latest Chrome/Edge/Firefox only for MVP, since the audience is engineers on modern browsers
- Automated accessibility (a11y) auditing — noted as a gap to revisit, not a blocker for pilot-stage validation
