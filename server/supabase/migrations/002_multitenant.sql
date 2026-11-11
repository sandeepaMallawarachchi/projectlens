-- Upgrades a v0.1 (single-tenant) ProjectLens database to the multi-tenant schema.
-- Safe to run once in the Supabase SQL editor. Existing projects, scans, insights and
-- API keys are moved into an organization named "Legacy workspace".

begin;

-- 1. New tables (same definitions as schema.sql).
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

-- 2. Legacy organization for existing data.
insert into organizations (id, name) values ('00000000-0000-0000-0000-000000000001', 'Legacy workspace') on conflict (id) do nothing;

-- 3. Tenant columns on existing tables.
alter table projects add column if not exists org_id uuid references organizations(id) on delete cascade;
alter table projects add column if not exists created_by uuid references users(id) on delete set null;
update projects set org_id = '00000000-0000-0000-0000-000000000001' where org_id is null;
alter table projects alter column org_id set not null;
alter table projects alter column repository set default '';
alter table projects drop constraint if exists projects_provider_check;
alter table projects add constraint projects_provider_check check (provider in ('github', 'gitlab', 'none', 'local'));
alter table projects drop constraint if exists projects_external_id_key;
create unique index if not exists projects_org_external_idx on projects (org_id, external_id);
create index if not exists projects_org_idx on projects (org_id, created_at desc);

alter table scans add column if not exists org_id uuid references organizations(id) on delete cascade;
alter table scans add column if not exists source text not null default 'cloud';
update scans s set org_id = p.org_id from projects p where s.project_id = p.id and s.org_id is null;
alter table scans alter column org_id set not null;
alter table scans drop constraint if exists scans_source_check;
alter table scans add constraint scans_source_check check (source in ('cloud', 'upload'));
create index if not exists scans_org_created_idx on scans (org_id, created_at desc);

alter table ai_insights add column if not exists org_id uuid references organizations(id) on delete cascade;
update ai_insights i set org_id = p.org_id from projects p where i.project_id = p.id and i.org_id is null;
alter table ai_insights alter column org_id set not null;
create index if not exists ai_insights_org_idx on ai_insights (org_id, created_at desc);

alter table api_keys add column if not exists org_id uuid references organizations(id) on delete cascade;
alter table api_keys add column if not exists created_by uuid references users(id) on delete set null;
update api_keys set org_id = '00000000-0000-0000-0000-000000000001' where org_id is null;
alter table api_keys alter column org_id set not null;

-- 4. Row Level Security (no policies: server key only).
alter table organizations enable row level security;
alter table users enable row level security;
alter table memberships enable row level security;
alter table invitations enable row level security;
alter table sessions enable row level security;
alter table email_codes enable row level security;
alter table org_ai_keys enable row level security;

commit;
