# BoE Market Rate Benchmarks — FCA-safe rewire

Replaces (or supplements) lender-specific product scraping with official Bank of England market-average data, per the compliance approach you laid out. Zero cost, no financial-promotion risk — this reports economic statistics, not any lender's actual product.

## What's live in Supabase
`mortgage_market_rate_benchmarks` — `term_type` (2yr_fixed / 3yr_fixed / 5yr_fixed / 10yr_fixed / 2yr_variable / svr / revert_to_rate), `ltv_tier` (60/75/85/90/95, null where not tiered), `rate_percent`, `effective_month`, plus `raw_series_title` and `series_code` kept for audit trail.

## New files
```
lib/wealth/boe-benchmark-ingestion.ts        -- fetch + parse + upsert
app/api/cron/boe-benchmark-refresh/route.ts  -- cron endpoint
render.cron-only.yaml                        -- new loop-boe-benchmark-refresh cron,
                                                 monthly (BoE publishes once a month)
```

## The real data source, traced properly
`https://www.bankofengland.co.uk/boeapps/database/_iadb-FromShowColumns.asp` — BoE's own documented open-data CSV export. Confirmed via a public tutorial demonstrating a working automated fetch of this exact endpoint, and BoE's own "Open Data" page describes it as the intended access method. Up to 300 series codes per request, monthly data back to 1995.

**Series codes I have high confidence in** (confirmed via an official BoE chart URL with explicit per-series labels): the full 2-year-fixed set across all 5 LTV tiers — 60/75/85/90/95%.

**Series codes included but less certain**: 3yr/5yr/10yr fixed, 2yr variable, SVR. These are real BoE "Quoted Rates" series (confirmed to exist), but I inferred their exact LTV-tier mapping from context rather than an explicit label I personally saw.

## Honest about what I could NOT verify
BoE's robots.txt blocks my own fetch tool from this exact endpoint — a policy on my end, not proof the server blocks real automated clients (the tutorial's Python script hit the identical URL successfully). So:
- I could not personally see a live response to confirm the exact `CSVF=TT` title format my parser expects
- **Built a safety net for this**: the 5 confirmed 2yr-fixed codes have a hardcoded fallback mapping that doesn't depend on title parsing working correctly, so the most commonly needed benchmark (2yr fixed, all LTV tiers) should populate even if my title-format assumption for the other series is wrong
- Everything else gracefully skips (with the series code logged in `skippedSeries`) rather than inserting a mis-tagged row
- **The first real cron run is the actual test.** Check `result.inserted` and `result.skippedSeries` in the response, or query `mortgage_market_rate_benchmarks` directly afterward

## The bigger find: this unblocks an already-existing, currently-dead feature
`lib/wealth/mortgage-renewal-watch.ts` already exists and already depends on `mortgage_rate_deals` — it explicitly logs *"No sourced mortgage rate deals matched yet"* when that table's empty, which (given only 1 active row exists) means **this renewal-alert feature is currently producing nothing for anyone**. Once benchmarks are flowing, wiring `mortgage-renewal-watch.ts` to compare against `mortgage_market_rate_benchmarks` instead of (or alongside) `mortgage_rate_deals` would revive it — that's the natural next step, not done in this pass since it touches a live, working cron and deserves its own focused pass.

## Verified
```
npx tsc --noEmit -> exit 0
npm run build      -> compiles clean, same one unrelated env-var failure,
                       page count went 155 -> 156 confirming the new route registered
```

## Still to build (the UX flow you described)
- The "Remortgage Window" alert UI (current rate/LTV vs benchmark, payment-shock framing)
- Handoff buttons to Moneyfacts/broker affiliates instead of showing specific products
- Wiring `mortgage-renewal-watch.ts` to actually use this new table
- Deciding what happens to the existing `mortgage_rate_deals` lender scraper — pause it as redundant now that benchmarks cover the compliance-safe use case, or keep it dormant for a future "browse real products" feature that's explicitly separate from the benchmark/advice surface
