# GuardrunAgent MVP — UI/UX Design Document

## 1. Design Principles

1. **Boring is good.** This is a trust/safety tool for engineers — it should feel like Datadog or GitHub, not a flashy consumer app. Dense information, low visual noise, fast to scan.
2. **Time-ordered by default.** Engineers debugging an incident think in "what happened, in what order" — every core view defaults to chronological.
3. **Show cost and risk together.** The two things a buyer cares about (spend, safety) should never be more than one click apart from any session.
4. **Zero-config first look.** A new user should see *something* meaningful (even sample/empty-state guidance) within seconds of logging in — no blank dashboard confusion.
5. **Dark mode as default.** This audience (engineers, terminal-heavy workflows) skews toward dark UIs; light mode as a toggle, not the default.

## 2. Information Architecture

```
Login (email/password or Google)
  └── (first-time self-signup only) Create your organization
  └── Dashboard Home (org overview)
        ├── Sessions
        │     └── Session Detail (Replay view)
        ├── Cost
        ├── Guardrail Rules
        │     └── Activity Log
        ├── Settings
        │     ├── API Key
        │     ├── Guardrail Availability (fail-open / fail-closed)
        │     ├── Slack Integration
        │     └── Team / Users
        └── Organizations (Super Admin only, added during implementation)
              └── Organization Detail (team + pending invites)
```

Five primary nav items, always visible in a left sidebar: **Home, Sessions, Cost, Rules, Settings**. No deeper nesting than two levels for MVP. The sidebar footer (added during implementation, on every page) shows the signed-in user's email and a **Sign out** button — not a sixth nav item, but present throughout the group above.

**Organizations** (added during implementation, closes CLAUDE.md's
"Planned, not yet built" Super Admin entry): a sixth nav item, shown only
when `GET /me` reports `is_platform_admin` — a platform-level operator,
separate from any org's own Admin/Member role, who can see every org.
Invisible to every other signed-in user; see Section 3.7 below.

**Create your organization** (added during implementation): a real signup that wasn't invited by a teammate has no org yet — this screen (a name field, shown instead of the app shell) is where they create one and become its admin, shown their org's API key exactly once before continuing in. Only reachable once, on first login, for a self-signup account; an invited teammate skips straight to Dashboard Home. See Section 4.1 below.

## 3. Screen-by-Screen Design

### 3.0 Login Screen
**Purpose:** get a user into the dashboard with minimal friction, supporting both sign-in methods.

Layout:
- Centered card: GuardrunAgent logo/wordmark
- Primary button: **"Continue with Google"** (prominent, top position — lowest friction for most users)
- Divider: "or"
- Email + password fields, "Sign in" button below
- Below the form: "Forgot password?" link — **shown only when the entered email belongs to a user who signed up via email/password** (Google-auth users are told to sign in with Google instead if they land here)
- New users: same screen handles both sign-up and sign-in (Supabase Auth resolves this) — no separate "Create account" flow needed for MVP

### 3.1 Dashboard Home
**Purpose:** answer "is everything okay?" in 3 seconds.

Layout (top to bottom):
- Header: org name, date range selector (default: last 7 days)
- Row of 4 stat cards: *Total Sessions*, *Total Spend*, *Guardrail Blocks*, *Active Agents*
- Below: a simple line chart — spend per day (last 7/30 days)
- Below that: "Recent Activity" — last 10 events across all sessions, most recent first, with a colored status dot (green = success, red = blocked, yellow = flagged, gray = failure)

**Empty state (new org, no sessions yet):** Replace the charts with a setup checklist: "1. Install the SDK → 2. Add your API key → 3. Run your first session" with copy-paste install command shown directly on the page.

### 3.2 Sessions List
**Purpose:** find the session you're looking for fast.

- Table view, columns: Started At, Project, Agent, Duration, Cost, Event Count, Status (badge)
- Filters at top: Project dropdown, Agent dropdown, Date range, Status (success/blocked/flagged/error)
- Search box: free-text search on project label
- Click a row → Session Detail
- Sort default: most recent first

### 3.3 Session Detail (Replay View) — the flagship screen
**Purpose:** let someone reconstruct exactly what an agent did and why, like a git log crossed with a chat transcript.

Layout:
- Header bar: session ID, project, agent, start/end time, total cost, total tokens
- Left: vertical timeline of events, each as a card:
  - Icon by action type (file edit, bash, git, API call)
  - One-line summary ("Edited `src/api/auth.ts` — 12 lines changed")
  - Timestamp, cost for that event
  - Status badge (success / blocked / flagged)
  - Expandable: click to reveal reasoning snippet (if available) and metadata (file path, command, diff summary — never raw secrets)
- Blocked/flagged events are visually distinct: red left-border on the card, with the matched rule name shown inline ("Blocked by rule: no-force-push-main")
- Sticky right-side panel (optional, collapsible): running cost total and event count as you scroll, so you always know "how far into this session, cost-wise" you are

**Interaction note:** this should feel like scrolling through a well-formatted commit log or CI run log — familiar patterns for the audience, not a novel UI paradigm.

### 3.4 Cost Dashboard
**Purpose:** answer "where is our agent spend going" for budget conversations.

- Top: total spend for selected date range, with % change vs. previous period
- Toggle: group by **Project** / **Agent** / **Day**
- Main chart: stacked bar chart (cost per day, stacked by project or agent depending on toggle)
- Below chart: a sortable table breaking down the same data numerically (some users will want the table, not just the chart — don't force chart-only)
- Export button: "Export CSV" (simple, expected by anyone doing a budget review)

### 3.5 Guardrail Rules
**Purpose:** configure and audit the safety layer — this is the screen that makes the product feel like a safety tool, not just a logger.

Two tabs: **Rules** and **Activity Log**

**Rules tab:**
- List of rules as rows: Name, Pattern (shown in monospace, e.g. `^rm -rf` or path `/prod/*`), Action (Block/Flag badge), Enabled toggle
- "+ New Rule" button opens a simple form:
  - Name
  - Pattern type (dropdown: Command pattern / File path / Action type)
  - Pattern value (text input, with inline example placeholder text)
  - Action on match (Block / Flag — radio)
  - Save
- Ship with 3–5 pre-built starter rules customers can enable with one click (no force-push to main, no `rm -rf`, no edits to `/prod` or `.env` paths) — reduces setup friction dramatically vs. asking users to write rules from scratch

**Activity Log tab:**
- Chronological list of every rule firing: timestamp, rule name, session link, action taken, whether the Slack alert was successfully delivered
- This is the audit trail a security-conscious buyer will actually want to show their own leadership

### 3.6 Settings
- **API Key:** show masked key, "regenerate" button (with confirmation — regenerating breaks existing SDK installs)
- **Guardrail Availability** (added during implementation, promoting docs/05-architecture-document.md Section 8's client-side-only gap to a real setting): one instant-apply toggle switch, same visual language as the Rules tab's "Enabled" toggle — "Fail open" (default) vs. "Fail closed," with copy explaining what it controls (what an agent's action does when GuardrunAgent's own backend is unreachable during a guardrail check). No separate Save step; the toggle applies immediately, matching the Rules tab convention rather than the Slack section's form+Save pattern.
- **Slack Integration:** manual webhook URL paste, built for MVP simplicity as planned; the "Connect Slack" OAuth flow alternative was not built — a pasted Incoming Webhook URL is the only supported path. Test button sends a sample alert.
- **Team/Users:** simple list + invite-by-email, role toggle (Admin/Member). "No granular permissions needed at MVP" means exactly two levels, not that a Member has the same team-management powers as an Admin: inviting, cancelling an invite, and changing anyone's role (including self-promotion) are **Admin-only**, enforced on the backend (`app/routers/settings.py`'s `_require_admin`) and reflected in the UI (a Member sees the same list, read-only — no invite form, role toggle, or cancel-invite button). This was a real gap fixed during implementation, not the original design — see CLAUDE.md's decisions log. Invited members sign in via the same Login screen (email/password or Google), and are linked to the org on first login.

### 3.7 Organizations (Super Admin only, added during implementation)
**Purpose:** let a platform-level operator (not tied to any one org's Admin/Member role) see and support every org on the platform. Closes CLAUDE.md's "Planned, not yet built" Super Admin entry.

- Only reachable via the **Organizations** nav item, itself only rendered when `GET /me` reports `is_platform_admin: true` — every other user never sees this nav item or screen at all. The real access control is the backend's `verify_platform_admin` (`app/auth.py`), not this UI check; the check here only avoids showing a link that would 403.
- **List view:** table of every org — Organization name, Member count, Created date. Click a row to drill in.
- **Organization Detail:** that org's team and pending invites, in the same shape as its own Settings → Team tab, but **read-only** — no invite form, role toggle, or cancel-invite action. A platform admin is here to look, not to manage another org's team on its behalf.
- No self-serve way to become a Super Admin from any screen — granted by adding a row to `platform_admins` directly via SQL (see `DEPLOYMENT.md`), deliberately, given how sensitive cross-org visibility is.

## 4. Key UX Flows

### 4.1 First-time setup (new customer, day 1)
1. Sign up via Login screen (Google or email/password)
2. **If invited by a teammate:** land straight on Dashboard Home with the empty-state setup checklist. **If signing up on their own:** first see the "Create your organization" screen (Section 2); name it, become its admin, and see the org's API key exactly once — then land on Dashboard Home with the same checklist.
3. Copy the install command (real commands: `/plugin marketplace add` then `/plugin install`, run inside a Claude Code session — not `npm install`, see `docs/07-user-manual.md` Section 3), run it
4. Configure the API key (env var or `~/.guardrunagent/config.json`) as instructed
5. Run one Claude Code session → return to dashboard → see it populate in real time (or near-real-time on next page load)
6. Prompted (dismissible banner): "Enable starter guardrail rules?" — one-click enable of the pre-built 3–5 rules

### 4.2 Incident investigation (the core "aha" moment)
1. Slack alert fires: "🚫 GuardrunAgent blocked an action... [link]"
2. Click link → lands directly on the Session Detail view, scrolled to the flagged event
3. User expands the event, reads the reasoning snippet and command, understands what the agent was trying to do and why it was stopped
4. If it was a false positive → user can navigate to Rules tab and adjust/disable that rule directly from context

### 4.3 Monthly budget review
1. Eng manager opens Cost Dashboard, sets date range to "last 30 days"
2. Groups by Project, sees which team/repo is driving spend
3. Exports CSV to paste into a budget doc or forward to finance

## 5. Visual Style Direction

- **Palette:** dark background (near-black, `#0D0F12`-ish), high-contrast text, a single accent color for interactive elements (blue or green — avoid red/orange as primary since those are reserved for status/alert states)
- **Status color coding (consistent everywhere):** green = success, red = blocked, yellow/amber = flagged, gray = neutral/failure-unrelated-to-guardrails
- **Typography:** monospace font for anything code/command/path-related (action summaries, patterns, file paths); standard sans-serif for UI chrome and labels — reinforces "this is real technical data," not a marketing dashboard
- **Density:** favor information density over whitespace-heavy consumer-app spacing — this audience wants to scan a lot of data quickly, not be delighted by generous padding

## 6. Responsive / Platform Scope for MVP

- Desktop-first, optimized for wide screens (this is a tool used at a desk, not on mobile)
- Reasonable tablet degradation is a "nice to have," not a requirement
- No native mobile app or dedicated mobile-optimized layout for MVP

## 7. Explicit Non-Goals for MVP UI

- No customizable dashboards/widgets (fixed layout is fine — configurability is a v2+ ask once you know what users actually want to see)
- No dark/light theme system beyond a simple toggle — don't over-invest in theming infrastructure
- No in-app onboarding tour/tooltips beyond the single empty-state checklist — keep it simple until you have user feedback on where people actually get stuck
- No custom-built password reset flow — delegated entirely to Supabase Auth's built-in reset email
