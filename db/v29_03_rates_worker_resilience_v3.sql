begin;

alter table if exists public.savings_rate_sources
  add column if not exists consecutive_failures integer not null default 0,
  add column if not exists next_check_at timestamptz,
  add column if not exists last_http_status integer,
  add column if not exists last_failure_class text,
  add column if not exists resolved_url text,
  add column if not exists content_hash text,
  add column if not exists source_etag text,
  add column if not exists source_last_modified text,
  add column if not exists last_content_changed_at timestamptz,
  add column if not exists last_parse_success_at timestamptz,
  add column if not exists last_product_count integer not null default 0;

alter table if exists public.mortgage_lender_sources
  add column if not exists consecutive_failures integer not null default 0,
  add column if not exists next_check_at timestamptz,
  add column if not exists last_http_status integer,
  add column if not exists last_failure_class text,
  add column if not exists resolved_url text,
  add column if not exists content_hash text,
  add column if not exists source_etag text,
  add column if not exists source_last_modified text,
  add column if not exists last_content_changed_at timestamptz,
  add column if not exists last_parse_success_at timestamptz,
  add column if not exists last_product_count integer not null default 0;

alter table if exists public.savings_rate_deals
  add column if not exists publishable boolean not null default false,
  add column if not exists review_reasons jsonb not null default '[]'::jsonb;

alter table if exists public.savings_rate_sources
  drop constraint if exists savings_rate_sources_consecutive_failures_check;
alter table if exists public.savings_rate_sources
  add constraint savings_rate_sources_consecutive_failures_check check (consecutive_failures >= 0);

alter table if exists public.mortgage_lender_sources
  drop constraint if exists mortgage_lender_sources_consecutive_failures_check;
alter table if exists public.mortgage_lender_sources
  add constraint mortgage_lender_sources_consecutive_failures_check check (consecutive_failures >= 0);

create index if not exists savings_rate_sources_due_idx
  on public.savings_rate_sources(next_check_at, status)
  where status in ('active', 'needs_review', 'failed', 'blocked');

create index if not exists mortgage_lender_sources_due_idx
  on public.mortgage_lender_sources(next_check_at, status)
  where status in ('active', 'needs_review', 'failed', 'blocked');

create table if not exists public.rate_worker_control (
  worker_key text primary key,
  schema_version integer not null,
  lock_token uuid,
  lock_acquired_at timestamptz,
  lock_expires_at timestamptz,
  last_completed_at timestamptz,
  last_result jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint rate_worker_control_schema_version_check check (schema_version > 0)
);

alter table public.rate_worker_control enable row level security;
revoke all on table public.rate_worker_control from anon, authenticated;
grant select, insert, update on table public.rate_worker_control to service_role;

insert into public.rate_worker_control(worker_key, schema_version, updated_at)
values ('rates-catalogue', 3, now())
on conflict (worker_key) do update
set schema_version = excluded.schema_version,
    updated_at = now();

create or replace function public.try_acquire_rate_worker_lock(
  p_worker_key text,
  p_lock_token uuid,
  p_ttl_seconds integer default 1200
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  acquired_token uuid;
begin
  insert into public.rate_worker_control(
    worker_key,
    schema_version,
    lock_token,
    lock_acquired_at,
    lock_expires_at,
    updated_at
  )
  values (
    p_worker_key,
    3,
    p_lock_token,
    now(),
    now() + make_interval(secs => greatest(60, least(p_ttl_seconds, 3600))),
    now()
  )
  on conflict (worker_key) do update
  set lock_token = excluded.lock_token,
      lock_acquired_at = excluded.lock_acquired_at,
      lock_expires_at = excluded.lock_expires_at,
      updated_at = now()
  where public.rate_worker_control.lock_token is null
     or public.rate_worker_control.lock_expires_at is null
     or public.rate_worker_control.lock_expires_at <= now()
  returning lock_token into acquired_token;

  return coalesce(acquired_token = p_lock_token, false);
end;
$$;

create or replace function public.release_rate_worker_lock(
  p_worker_key text,
  p_lock_token uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  released_count integer;
begin
  update public.rate_worker_control
  set lock_token = null,
      lock_acquired_at = null,
      lock_expires_at = null,
      last_completed_at = now(),
      updated_at = now()
  where worker_key = p_worker_key
    and lock_token = p_lock_token;

  get diagnostics released_count = row_count;
  return released_count = 1;
end;
$$;

revoke all on function public.try_acquire_rate_worker_lock(text, uuid, integer) from public, anon, authenticated;
revoke all on function public.release_rate_worker_lock(text, uuid) from public, anon, authenticated;
grant execute on function public.try_acquire_rate_worker_lock(text, uuid, integer) to service_role;
grant execute on function public.release_rate_worker_lock(text, uuid) to service_role;

insert into public.app_build_notes(build_key, title, notes, payload, updated_at)
values (
  'v29_03_rates_worker_resilience',
  'Rates worker resilience v3',
  'Adds schema preflight, a durable cross-service lock, source retry scheduling, HTTP diagnostics, content fingerprints, collapse protection and guarded catalogue publication.',
  '{"areas":["savings","mortgages","rates_worker","supabase"],"requires_sql":true,"worker_schema_version":3}'::jsonb,
  now()
)
on conflict (build_key) do update
set title = excluded.title,
    notes = excluded.notes,
    payload = excluded.payload,
    updated_at = now();

notify pgrst, 'reload schema';
commit;

