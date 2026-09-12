# GuardrunAgent — User Manual

## 1. What is GuardrunAgent?

GuardrunAgent gives you visibility into what your AI coding agents (starting with Claude Code) are doing, what they're costing you, and lets you block risky actions before they happen — without changing how your team already works with agents.

This manual covers: getting your account set up, installing the SDK, understanding the dashboard, configuring guardrail rules, and troubleshooting common issues.

## 2. Getting Started

### 2.1 Creating your account
1. Go to the GuardrunAgent dashboard login page.
2. Choose one of two ways to sign in:
   - **Continue with Google** — fastest option, uses your existing Google account.
   - **Email + password** — enter your work email and choose a password.
3. If you later sign in a different way using the *same email address*, GuardrunAgent automatically recognizes it's you — you won't end up with two separate accounts.

### 2.2 Your first login
- **If you were invited by a teammate:** you're linked to their organization automatically — you'll land straight on the Dashboard Home with a setup checklist (below).
- **If you signed up on your own:** you're not part of an organization yet, so you'll first see a "Create your organization" screen. Give it a name — you'll become its admin — and you'll be shown your org's API key exactly once, so copy it somewhere safe before continuing.

Either way, Dashboard Home then shows a setup checklist:
1. Install the SDK
2. Add your API key
3. Run your first agent session

Follow the on-screen instructions — the exact install command and your unique API key are shown directly on this screen.

## 3. Installing the SDK

### 3.1 Requirements
- Claude Code already installed and in use on your team's development machines
- GuardrunAgent ships as a **Claude Code plugin**, not an npm package you install and import yourself — Claude Code loads it directly and wires up its hooks; there's no code to write or call.

### 3.2 Installation steps
1. Inside a Claude Code session, add the GuardrunAgent marketplace once:
   ```
   /plugin marketplace add narasimhasn06/guardrunagent
   ```
2. Install the plugin from it:
   ```
   /plugin install guardrunagent@guardrunagent
   ```
3. Configure your org's API key (copied from the Settings page) and backend endpoint as environment variables, or in `~/.guardrunagent/config.json`:
   ```
   export GUARDRUNAGENT_API_KEY="your-api-key-here"
   export GUARDRUNAGENT_ENDPOINT="https://your-backend-url"
   ```
   ```json
   {
     "apiKey": "your-api-key-here",
     "endpoint": "https://your-backend-url"
   }
   ```
   Either is enough on its own; environment variables take priority if both are set.
4. Run a Claude Code session as you normally would. GuardrunAgent works in the background via its hooks — there's nothing else to change about how you use Claude Code day to day.
5. Return to the dashboard and confirm your session appears under **Sessions**.

### 3.3 What gets sent, and what doesn't
- GuardrunAgent logs: the type of action taken (file edit, command run, git action), a summary, timestamps, and cost/token usage.
- GuardrunAgent does **not** log full file contents, and automatically strips anything that looks like a secret or API key from logged commands before it ever leaves your machine.
- If a network issue prevents an event from sending, it's queued and retried automatically — nothing is silently lost.

## 4. Using the Dashboard

### 4.1 Dashboard Home
Your at-a-glance view: total sessions, total spend, guardrail blocks, and active agents over your selected date range, plus a running feed of recent activity.

### 4.2 Sessions
Lists every agent session GuardrunAgent has logged. Use the filters (project, agent, date, status) to narrow down what you're looking for, or search by project name.

**Session Detail (Replay view):** click into any session to see a full, chronological timeline of everything the agent did — file edits, commands, git actions — including cost and, where available, the agent's reasoning for that step. Click any event to expand it for full detail.

Blocked or flagged actions are highlighted so they're easy to spot in the timeline, along with the name of the guardrail rule that caught them.

### 4.3 Cost
Shows your agent spend broken down by day, project, or agent — toggle between views using the buttons at the top. Use **Export CSV** if you need the numbers for a budget review or to share outside the dashboard.

### 4.4 Guardrail Rules
This is where you control what your agents are and aren't allowed to do without a human in the loop.

**Enabling starter rules:** GuardrunAgent ships with a small set of pre-built rules covering common risk areas (blocking force-pushes to main, blocking `rm -rf`-style commands, blocking edits to protected paths like `/prod` or `.env` files). You can enable any of these with one click from the Rules tab.

**Creating a custom rule:**
1. Go to **Rules → + New Rule**
2. Give it a name
3. Choose a pattern type:
   - *Command pattern* — matches against the text of a command (e.g. anything starting with `git push --force`)
   - *File path* — matches against a file or folder path
   - *Action type* — matches a whole category of action
4. Enter the pattern value
5. Choose what happens on a match: **Block** (the action is prevented) or **Flag** (the action proceeds, but is marked for review)
6. Save

**Activity Log:** shows every time a rule has fired, with a link to the exact session and event, and whether the Slack alert was successfully delivered.

### 4.5 Settings
- **API Key** — view your masked key, or regenerate it (note: regenerating breaks any existing SDK installs using the old key, so update those afterward).
- **Guardrail Availability** — controls what happens when an agent is about to act but GuardrunAgent's own backend can't be reached: **Fail open** (default) lets the action through rather than block your team's work over a networking blip; **Fail closed** blocks actions until the connection is back, for teams that would rather stop than risk an unreviewed action. Applies to your whole organization and takes effect immediately — every machine running the SDK picks it up the next time it refreshes its local rule cache (within 5 minutes).
- **Slack Integration** — connect Slack or paste in a webhook URL to receive guardrail alerts. Use the test button to confirm it's working.
- **Team** — invite teammates by email, change a member's role, or remove them (an org needs at least one Admin, so the last one can't be demoted or removed). Inviting doesn't send anything — no email goes out from GuardrunAgent. Tell the person yourself (Slack, email, however you'd normally reach them) to go to the Login screen and sign in with the **same email address** (Google or email/password); they'll be added to your organization automatically the moment they do. If they sign up with email/password, Supabase sends its own confirmation email for that account — that's Supabase's normal signup flow, separate from your invite, and only applies to that sign-in method (Google accounts don't need it, since Google has already verified the address).

### 4.6 Signing out
Your email and a **Sign out** button are always in the bottom-left corner of the sidebar, on every page.

## 5. Getting Alerts

When a guardrail rule blocks or flags an action, GuardrunAgent sends a Slack message (if configured) with a direct link to the relevant session. Clicking it takes you straight to the flagged moment in the Session Replay view — no need to search for it manually.

## 6. Frequently Asked Questions

**Q: Will this slow down my agent?**
No — almost everything is logged in the background without blocking the agent. The only exception is when an action might match a guardrail rule, in which case there's a brief check (typically under 200ms) before the action proceeds.

**Q: What happens if GuardrunAgent's backend is temporarily unreachable?**
Regular activity logging is queued locally and sent once the connection is restored — you won't lose data. For guardrail checks specifically, it depends on your organization's **Guardrail Availability** setting (Settings → Guardrail Availability): fail-open (the default) lets actions through during an outage, fail-closed blocks them until the connection is back. An admin sets this for the whole organization.

**Q: Can I use GuardrunAgent with tools other than Claude Code?**
Not yet in this version — Claude Code is the only supported integration today. Support for additional agent tools is planned for a future release.

**Q: I signed up with Google, why don't I see a "change password" option?**
Your account is managed through Google, so password changes happen there rather than in GuardrunAgent. If you'd like a separate GuardrunAgent password as a backup sign-in method, use "forgot password" from the login screen with your same email address.

**Q: A rule is blocking something it shouldn't — what do I do?**
Go to **Rules**, find the rule that fired (you can find its name in the Slack alert or the Activity Log), and either edit its pattern or disable it. Changes take effect immediately.

**Q: Where can I see how much we've spent this month?**
Go to **Cost**, set your date range, and group by whichever view is most useful (day, project, or agent).

## 7. Getting Help

If you run into an issue not covered here, reach out to your GuardrunAgent point of contact or check for an in-app support link on the dashboard.
