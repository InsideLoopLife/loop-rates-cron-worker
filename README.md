# LOOP Rates and Daily Maintenance Worker

This Render cron job now refreshes both shared rate catalogues directly in
Supabase:

- savings, Cash ISA, regular saver, notice and fixed-term products;
- mortgage products, including rate type, initial term, LTV and product fee.

It can also call the protected user-specific maintenance routes in the deployed
LOOP app after the catalogues are refreshed. It never needs a user to open a
page.

## Run order

1. Fetch due savings sources.
2. Parse and validate coherent products.
3. Fetch due mortgage lender sources.
4. Validate term, LTV, fee and market-rate plausibility.
5. Mark products missing from three successful observations as withdrawn.
6. If `APP_BASE_URL` and `CRON_SECRET` are configured, run the user-specific
   mortgage watch, LoopWatch, briefings, snapshots, pensions, product pricing,
   archive cleanup, glossary, notification and weekly digest routes.

Investment market quotes and SnapTrade snapshots are deliberately excluded:
they already belong to LOOP's dedicated market-data worker and must not be
duplicated here.

## Required setup

Run `sql/v2_rates_worker.sql` in Supabase before deploying this version.

Required Render environment variables:

- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`

For the app maintenance routes also set:

- `APP_BASE_URL` to the deployed LOOP application, with no trailing slash
- `CRON_SECRET` to the same server-side value used by the LOOP app

The worker still refreshes both catalogues if those two app variables are not
set. Only user-specific maintenance is skipped.

## Schedule

Keep the Render schedule at `0 7,8 * * *`. The worker checks Europe/London and
only proceeds at 08:00 local time, so daylight-saving changes do not create two
runs.

## Manual verification

1. Apply the SQL migration.
2. Deploy to Render.
3. Temporarily set `FORCE_RUN=true`.
4. Run the cron job manually.
5. In the logs, confirm both `savings` and `mortgages` show checked/deal counts.
6. Confirm suspicious or incomplete products are `needs_review`/`broken`.
7. Restore `FORCE_RUN=false`.

Provider failures no longer fail the entire Render execution or advance their
successful-check clock. They remain due for retry.
