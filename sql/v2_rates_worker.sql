begin;

alter table if exists public.savings_rate_deals
  add column if not exists monthly_min_deposit numeric,
  add column if not exists canonical_source text,
  add column if not exists source_product_id text,
  add column if not exists first_seen_at timestamptz default now(),
  add column if not exists last_seen_at timestamptz,
  add column if not exists last_verified_at timestamptz,
  add column if not exists verification_status text default 'UNVERIFIED',
  add column if not exists lifecycle_status text default 'DATA_REVIEW',
  add column if not exists missing_observation_count integer not null default 0,
  add column if not exists effective_to timestamptz,
  add column if not exists raw_payload_hash text,
  add column if not exists source_payload jsonb not null default '{}'::jsonb;

create unique index if not exists savings_rate_deals_worker_identity_idx
  on public.savings_rate_deals(canonical_source, source_product_id)
  where canonical_source is not null and source_product_id is not null;

create index if not exists savings_rate_deals_worker_lifecycle_idx
  on public.savings_rate_deals(lifecycle_status, last_seen_at desc);

alter table if exists public.mortgage_rate_deals
  add column if not exists catalogue_status text not null default 'needs_review',
  add column if not exists ingestion_method text,
  add column if not exists source_id uuid references public.mortgage_lender_sources(id) on delete set null,
  add column if not exists external_product_key text,
  add column if not exists admin_review_reason text,
  add column if not exists removed_detected_at timestamptz,
  add column if not exists missing_observation_count integer not null default 0;

create unique index if not exists mortgage_rate_deals_worker_identity_idx
  on public.mortgage_rate_deals(external_product_key)
  where external_product_key is not null;

create index if not exists mortgage_rate_deals_worker_source_idx
  on public.mortgage_rate_deals(source_id, catalogue_status, source_checked_at desc);

notify pgrst, 'reload schema';
commit;
