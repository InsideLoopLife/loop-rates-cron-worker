begin;

-- Compatibility for the standalone rates worker and richer extraction evidence.
alter table if exists public.savings_rate_deals
  add column if not exists access_type text,
  add column if not exists withdrawal_rules text,
  add column if not exists notice_period_days integer,
  add column if not exists term_length_months integer,
  add column if not exists rate_type text,
  add column if not exists monthly_min_deposit numeric,
  add column if not exists evidence jsonb not null default '{}'::jsonb;

alter table if exists public.savings_rate_recommendations
  add column if not exists action_summary text,
  add column if not exists suitability_payload jsonb not null default '{}'::jsonb;

create index if not exists savings_rate_deals_customer_catalogue_idx
  on public.savings_rate_deals(status, last_checked_at desc, gross_aer desc)
  where status = 'active';

create index if not exists savings_rate_recommendations_user_active_idx
  on public.savings_rate_recommendations(user_id, status, estimated_annual_gain desc)
  where status in ('new', 'seen', 'watching');

-- Old failed mortgage sources must be retried by the corrected worker.
update public.mortgage_lender_sources
set status = 'needs_review', updated_at = now()
where status in ('failed', 'blocked');

insert into public.app_build_notes(build_key, title, notes, payload, updated_at)
values (
  'v29_02_rates_worker_savings_health',
  'Rates worker recovery and Savings Health Score',
  'Makes basic savings matching available to every saver, restores retryable mortgage sources, adds extraction evidence compatibility, uses three observations before mortgage removal and distinguishes an incomplete market check from a genuine zero opportunity.',
  '{"areas":["savings","mortgages","financial_flow","cron"],"requires_sql":true,"worker_version":"2.1.0"}'::jsonb,
  now()
)
on conflict (build_key) do update
set title = excluded.title, notes = excluded.notes, payload = excluded.payload, updated_at = now();

notify pgrst, 'reload schema';
commit;

