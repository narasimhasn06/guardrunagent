-- Dashboard users — links our org/role data to Supabase's managed auth.users
create table org_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references orgs(id),
  auth_user_id uuid not null unique,   -- references auth.users(id), managed by Supabase Auth
  email text not null,                 -- denormalized copy for display/query convenience
  role text not null default 'member', -- 'admin' | 'member'
  created_at timestamptz default now()
);
