# LOOP Rates Database Worker

A standalone Render cron service that writes shared savings, Cash ISA and fixed-term product data directly to the LOOP Supabase database.

It does **not** call localhost or a deployed LOOP web app.

## Data flow

```text
Configured provider/source pages
        ↓
Render cron worker
        ↓
Supabase savings_rate_sources
Supabase savings_rate_deals
Supabase wealth_watch_source_jobs
        ↓
LOOP app reads the shared catalogue
```

## Required existing tables

The LOOP database must already include:

- `savings_rate_sources`
- `savings_rate_deals`
- `wealth_watch_source_jobs` (optional for logging; the worker still runs if unavailable)

Sources must be added to `savings_rate_sources`. Only rows with status `active` or `needs_review` are checked.

## Render setup

Create a Render Blueprint from this repository, or create a Cron Job manually with:

- Runtime: Node
- Build command: `npm ci`
- Command: `node src/run.mjs`
- Schedule: `0 7,8 * * *`
- Plan: Starter

Environment variables:

- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`

The secret key is server-only. Never add it to frontend code or commit it to GitHub.

The worker runs at 07:00 and 08:00 UTC and only proceeds when the Europe/London local hour is 08:00. Set `FORCE_RUN=true` temporarily to test immediately.

## Test

1. Set `FORCE_RUN=true` in Render.
2. Trigger the cron job manually.
3. Inspect Render logs.
4. Confirm rows were updated in `savings_rate_sources` and `savings_rate_deals`.
5. Restore `FORCE_RUN=false`.

## Important

This worker is an ingestion and normalisation layer. It does not claim that a product is suitable for a user. High-confidence rows can be marked `active`; lower-confidence rows are stored as `needs_review` for admin verification.
