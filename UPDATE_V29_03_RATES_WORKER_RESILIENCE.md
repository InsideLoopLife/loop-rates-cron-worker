# LOOP v29.03 — Rates worker resilience

This update strengthens both the savings and mortgage catalogue workers without adding paid web search or AI dependencies.

## Included

- Database schema preflight with an explicit worker schema version.
- One durable database lock shared by savings and mortgage catalogue runs.
- Per-source HTTP status, redirect, content hash, ETag, last-modified, parse-success and retry state.
- Exponential retry scheduling while keeping failed sources eligible for future runs.
- Conditional requests and unchanged-page handling to reduce parsing, writes and history growth.
- Three-observation withdrawal protection plus product-count-collapse quarantine.
- Field-level publication reasons for savings and mortgages.
- Stable mortgage identity that is not changed merely because the interest rate moves.
- Run health metrics and gates that prevent an unhealthy import from expiring products or replacing recommendations.
- Bounded source downloads and basic private/local URL blocking.

## Required deployment order

1. Apply `supabase/migrations/202608041900_rates_worker_resilience_v3.sql` to the live Supabase project.
2. Deploy the Loop web application.
3. Deploy or rerun the Render rates cron services.
4. Run savings first, then mortgages, and inspect the returned `health` and `detail` fields.

The worker remains deterministic and licence-free. AI extraction stays disabled and is not required by this update.
