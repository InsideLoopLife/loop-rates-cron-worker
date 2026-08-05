# v29.02 — rates worker recovery and Savings Health Score

- Basic savings comparisons now run for every tracked saver. Paid tiers continue to control automation and alerts, not whether the user receives a useful comparison.
- Savings matching respects minimum/maximum balances and regular-saver monthly caps when estimating annual gain.
- Savings extraction records access, term, deposit-limit and rate evidence in the canonical `savings_rate_deals` catalogue.
- Mortgage sources recover after transient failures; one failed fetch no longer permanently excludes a lender.
- Mortgage products are held for review and removed only after three consecutive successful observations in which they remain missing.
- Mortgage auto-publication can reach its strict threshold only when rate, product context, initial period and LTV evidence are coherent.
- Savings and Financial Flow now show the same six-part Savings Health Score and never present £0 as proof of no opportunity while the catalogue is incomplete.

Apply `db/v29_02_rates_worker_savings_health.sql` before deploying the updated app/cron.
