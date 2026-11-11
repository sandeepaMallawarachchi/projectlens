-- ProjectLens API schema (multi-tenant) for Supabase Postgres — for NEW databases.
-- Existing v0.1 databases: run supabase/migrations/002_multitenant.sql instead.
-- All tables have Row Level Security enabled and NO policies: only the server's
-- secret/service-role key can access them. Never expose that key to browsers or clients.

create extension if not exists pgcrypto;

create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  plan text not null default 'free',
  ai_provider text,
  ai_model text,
  created_at timestamptz not null default now()
);

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text,
  email_verified boolean not null default false,
  github_id text unique,
  github_login text,
  name text,
  avatar_url text,
  created_at timestamptz not null default now()
);
create index if not exists users_email_idx on users (email);

create table if not exists memberships (
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index if not exists memberships_user_idx on memberships (user_id);

create table if not exists invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  email text not null,
  role text not null check (role in ('owner', 'admin', 'member')),
  invited_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz
);
create index if not exists invitations_email_idx on invitations (email);

create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  label text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_used_at timestamptz,
  revoked_at timestamptz
);

create table if not exists email_codes (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  code_hash text not null,
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
create index if not exists email_codes_email_idx on email_codes (email, created_at desc);

create table if not exists org_ai_keys (
  org_id uuid not null references organizations(id) on delete cascade,
  provider text not null check (provider in ('groq', 'openai', 'gemini', 'anthropic')),
  key_encrypted text not null,
  last4 text not null,
  updated_at timestamptz not null default now(),
  primary key (org_id, provider)
);

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  provider text not null check (provider in ('github', 'gitlab', 'none', 'local')),
  repository text not null default '',
  base_url text,
  ref text,
  token_encrypted text,
  external_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, external_id)
);
create index if not exists projects_org_idx on projects (org_id, created_at desc);

create table if not exists scans (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  source text not null default 'cloud' check (source in ('cloud', 'upload')),
  status text not null check (status in ('queued', 'running', 'completed', 'failed')),
  mode text not null check (mode in ('quick', 'full')),
  ref text,
  commit_sha text,
  triggered_by text,
  callback_url text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  error text,
  summary jsonb,
  result jsonb
);
create index if not exists scans_project_created_idx on scans (project_id, created_at desc);
create index if not exists scans_org_created_idx on scans (org_id, created_at desc);

create table if not exists ai_insights (
  id text primary key,
  org_id uuid not null references organizations(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  scan_id uuid not null references scans(id) on delete cascade,
  task text not null,
  data jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists ai_insights_project_idx on ai_insights (project_id, created_at desc);
create index if not exists ai_insights_org_idx on ai_insights (org_id, created_at desc);

create table if not exists api_keys (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  prefix text not null,
  key_hash text not null unique,
  scopes text[] not null default array['read']::text[],
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

alter table organizations enable row level security;
alter table users enable row level security;
alter table memberships enable row level security;
alter table invitations enable row level security;
alter table sessions enable row level security;
alter table email_codes enable row level security;
alter table org_ai_keys enable row level security;
alter table projects enable row level security;
alter table scans enable row level security;
alter table ai_insights enable row level security;
alter table api_keys enable row level security;
