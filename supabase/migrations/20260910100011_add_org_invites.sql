-- Settings > Team: "invite teammates by email... linked to your
-- organization automatically" on first login (docs/04-ui-ux-design.md
-- Section 3.6, docs/07-user-manual.md). docs/03-low-level-design.md
-- Section 1's schema has no table for a pending invite -- org_members
-- requires a non-null auth_user_id, which doesn't exist until the invited
-- person actually signs in via Supabase Auth (Section 2.2 step 6:
-- "joining an org via invite" is named but never given storage).
--
-- This table holds that invite until then. app/auth.py's verify_jwt
-- consumes and deletes the matching row (by email) the first time the
-- invited person authenticates, creating their org_members row at that
-- point. `email` is unique so an address can only be invited once
-- (globally, not per-org) -- consistent with org_members.auth_user_id
-- already being globally unique, i.e. one org per user in this schema.
create table org_invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references orgs(id) not null,
  email text not null unique,
  role text not null default 'member',  -- 'admin' | 'member', mirrors org_members.role
  created_at timestamptz default now()
);
