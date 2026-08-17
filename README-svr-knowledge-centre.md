# Provider-agnostic glimpse + SVR knowledge centre

Two additions, both objective/factual rather than promoting a specific lender's product — same compliance framing as the BoE benchmarks.

## 1. The "glimpse" — no named provider
Already exists as of last message: `mortgage_market_rate_benchmarks`, keyed by `term_type` + `ltv_tier`. A user's glimpse is "at your LTV, a 2yr fix is currently averaging X% across the market" — a real BoE-sourced range, never a specific bank's name. This message adds the missing piece that makes it a genuinely complete picture: **Bank Rate itself.**

## 2. Bank Rate — the real base rate, not a guess
Added `IUDBEDR` (Bank of England's own series code for Bank Rate) to the fetch list. Confirmed via multiple independent sources — an R package built specifically around BoE data, and an unrelated MCP server built specifically around this exact series code, both use `IUDBEDR` for Bank Rate. Same safety-net pattern as before: a confirmed fallback mapping so this can't silently fail to classify even if title-text parsing doesn't match.

This matters beyond just showing "the base rate is 3.75%" — it's what makes the SVR knowledge centre *live* rather than a one-time snapshot.

## 3. SVR knowledge centre — what each provider charges above base rate
New table, `lender_svr_reference` — seeded with real, currently-researched data for 8 major lenders (Halifax, Nationwide, First Direct, NatWest, HSBC, Barclays, Santander, Skipton), each with their SVR, the Bank Rate at time of recording, whether they actually track Bank Rate (**HSBC doesn't** — flagged explicitly, since a spread calculated against a non-tracker is a snapshot, not a predictor), and known policy caps (Skipton caps SVR at Bank Rate + 3%, currently priced exactly at that cap).

New view, `lender_svr_knowledge` — computes a **live implied SVR** for trackers by adjusting the recorded figure for how Bank Rate has moved since, capped at any known policy ceiling. Non-trackers just show the last recorded figure, honestly labelled. Tested against real data — works correctly, currently showing `null` for the live Bank Rate column only because the worker hasn't run with `IUDBEDR` yet; will populate on the next real run.

```sql
select lender_name, implied_current_svr_percent, recorded_spread_percent, tracks_bank_rate
from lender_svr_knowledge order by implied_current_svr_percent;
```

## What this is NOT
Not a specific mortgage product, not something with an "apply now" button. It's answering two separate factual questions: *"roughly what could I get at my LTV"* (market benchmark) and *"roughly what would I pay if I did nothing and rolled onto SVR"* (lender policy fact). Both keep you on the safe side of the FCA framing you laid out.

## Honest limitation on the SVR data specifically
Unlike the BoE benchmarks (auto-fetched, self-updating), `lender_svr_reference` is seeded from research this session, not scraped. SVR changes rarely (only on Bank Rate moves or deliberate lender repricing), so it doesn't need daily refresh — but it does need occasional manual verification. `last_verified_at` and `source_url` are there specifically so staleness is visible rather than silently trusted forever.

## To ship
One file: `src/boe-benchmarks.mjs` (unzip -o, replacing the version from the last delivery). Table and view are already live in Supabase — no migration needed on your end.
