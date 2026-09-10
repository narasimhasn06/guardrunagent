
```markdown
# GuardrunAgent

AI-agent observability, cost tracking, and guardrails — starting with Claude Code sessions.

## Source of truth
All product/architecture decisions are documented in /docs. Always check the
relevant doc before making a design decision that isn't already specified:
- Requirements & scope: docs/01-mvp-requirements.md
- Component architecture: docs/02-high-level-design.md
- Schema & API contracts: docs/03-low-level-design.md
- UI/UX behavior: docs/04-ui-ux-design.md
- Architectural rationale: docs/05-architecture-document.md
- Test expectations: docs/06-test-plan.md

## Stack
- SDK: TypeScript, Claude Code hooks
- Backend: FastAPI (Python), hosted on Railway/Render
- DB + Auth: Supabase (Postgres + Supabase Auth — email/password + Google OAuth, linked by email)
- Dashboard: Next.js, hosted on Railway/Render

## Conventions
- Don't introduce new libraries/services not already named in the docs without flagging it first.
- Follow the schema in docs/03-low-level-design.md exactly — don't invent new tables ad hoc.
- Keep the guardrail-check path fast and synchronous; everything else async.
```
4. `git init`, commit this scaffold, then open the repo in Claude Code.

---
