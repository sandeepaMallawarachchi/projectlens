-- Adds Prompt Guard (v0.3). Safe to run more than once in the Supabase SQL editor.

begin;

-- Prompt Guard: organization policy, member consent/hook status and flagged-prompt metadata.
-- Prompt text is never stored.
create table if not exists prompt_policies (
  org_id uuid primary key references organizations(id) on delete cascade,
  policy jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists prompt_guard_members (
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  consent_version integer,
  accepted_at timestamptz,
  declined_at timestamptz,
  enabled boolean not null default false,
  tools text[] not null default array[]::text[],
  policy_version integer,
  client_version text,
  last_seen_at timestamptz,
  primary key (org_id, user_id)
);

create table if not exists prompt_events (
  org_id uuid not null references organizations(id) on delete cascade,
  id text not null,
  user_id uuid not null references users(id) on delete cascade,
  tool text not null check (tool in ('claude', 'codex', 'cursor', 'copilot', 'antigravity')),
  action text not null check (action in ('blocked', 'warned', 'detected')),
  rule_ids text[] not null,
  categories text[] not null default array[]::text[],
  project text,
  policy_version integer not null,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  primary key (org_id, id)
);
create index if not exists prompt_events_org_idx on prompt_events (org_id, occurred_at desc);
create index if not exists prompt_events_user_idx on prompt_events (org_id, user_id, occurred_at desc);

alter table prompt_policies enable row level security;
alter table prompt_guard_members enable row level security;
alter table prompt_events enable row level security;

commit;
