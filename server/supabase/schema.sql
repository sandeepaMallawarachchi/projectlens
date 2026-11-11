-- ProjectLens API schema for Supabase Postgres.
-- Run once in the Supabase SQL editor (or `supabase db push`).
-- All tables have Row Level Security enabled and NO policies: only the server's
-- service-role key can access them. Never expose the service-role key to browsers.

create extension if not exists pgcrypto;

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  provider text not null check (provider in ('github', 'gitlab', 'local')),
  repository text not null,
  base_url text,
  ref text,
  token_encrypted text,
  external_id text unique,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists scans (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
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

create table if not exists ai_insights (
  id text primary key,
  project_id uuid not null references projects(id) on delete cascade,
  scan_id uuid not null references scans(id) on delete cascade,
  task text not null,
  data jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists ai_insights_project_idx on ai_insights (project_id, created_at desc);

create table if not exists api_keys (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  prefix text not null,
  key_hash text not null unique,
  scopes text[] not null default array['read']::text[],
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

alter table projects enable row level security;
alter table scans enable row level security;
alter table ai_insights enable row level security;
alter table api_keys enable row level security;
