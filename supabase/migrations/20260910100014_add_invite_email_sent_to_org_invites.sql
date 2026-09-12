-- Tracks whether app/invites.py's create_pending_invite successfully sent
-- a real invite email via Supabase Auth's admin invite API, added
-- alongside that feature -- see CLAUDE.md's decisions log. Surfaced in
-- the Team/Organizations lists so an admin can tell a pending invite was
-- never actually delivered (most often because that email already has a
-- Supabase Auth account -- e.g. removed from an org via
-- app/routers/settings.py's remove_team_member, which only deletes the
-- org_members row, never auth.users, and later re-invited) and knows to
-- reach out directly instead.
--
-- Defaults to true for pre-existing rows (created before this feature
-- existed, when no email was ever attempted) so they don't suddenly show
-- a false "delivery failed" signal for something that was never tried in
-- the first place -- every new invite from here on stores the real,
-- computed value.
alter table org_invites
  add column invite_email_sent boolean not null default true;
