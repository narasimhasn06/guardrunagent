-- GuardrunAgent MVP schema
-- Source of truth: docs/03-low-level-design.md, Section 1 (Database Schema)
--
-- Supabase manages auth.users internally (email/password, Google OAuth,
-- and email-based account linking). Our application schema references it
-- via org_members.auth_user_id rather than reimplementing user storage.

create extension if not exists pgcrypto;

-- Organizations / workspaces
create table orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  api_key_hash text not null unique,   -- for SDK -> backend machine auth (unrelated to Supabase Auth)
  slack_webhook_url text,
  created_at timestamptz default now()
);
