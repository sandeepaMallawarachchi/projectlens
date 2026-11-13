-- Adds a per-organization webhook signing secret (v0.4). Safe to run more than once.
begin;

alter table organizations add column if not exists webhook_secret_encrypted text;
alter table organizations add column if not exists webhook_secret_last4 text;
alter table organizations add column if not exists webhook_secret_created_at timestamptz;

commit;
