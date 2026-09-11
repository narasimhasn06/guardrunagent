-- Super Admin role: a platform-level operator, separate from each org's
-- own admin/member roles (org_members.role), who can see every org and
-- every org's users across the whole product -- see CLAUDE.md's "Planned,
-- not yet built" entry this closes.
--
-- Deliberately NOT a value inside org_members.role: that would put
-- cross-org visibility one dropdown click away from any org admin
-- managing their own team (components/settings/team-section.tsx,
-- TeamInviteIn.role), which stays 'admin' | 'member', untouched.
-- platform_admins is instead a separate table with no org_id at all --
-- membership isn't scoped to (or granted by) any org.
--
-- No self-serve way to add a row here -- see app/auth.py's
-- verify_platform_admin and DEPLOYMENT.md. Granted manually via SQL,
-- same as the very first "create an org" workaround earlier in this
-- project's history, deliberately, given how sensitive this is.
create table platform_admins (
  auth_user_id uuid primary key,  -- references auth.users(id), managed by Supabase Auth
  created_at timestamptz default now()
);
