# BoE benchmarks — built into the actual worker this time

You confirmed `loop-rates-cron-worker` is what the cron really runs off. Everything below is built and verified against **that** repo, not `loop_work`.

## What was wrong before
The Next.js-shaped files I'd delivered (`app/api/cron/boe-benchmark-refresh/`, `lib/wealth/boe-benchmark-ingestion.ts`) landed in this repo but do nothing here — this is a plain Node script (`node src/run.mjs`), not Next.js. **I deleted `app/` and `lib/` from this repo** — confirmed via grep that nothing in `src/run.mjs` or `src/rates-parser.mjs` ever referenced them.

Also found (and left alone, not mine, predates this): `components/`, `domains/`, and `supabase/migrations/` folders in this repo that look like they're from an earlier cross-upload too. Not touched — I don't have context on whether anything depends on them, so flagging rather than guessing.

## What's actually new
```
src/boe-benchmarks.mjs   -- new module, matches this repo's real conventions
src/run.mjs              -- one new phase wired in: boeBenchmarks, alongside
                             savings/mortgages/maintenance
```

`refreshBoeBenchmarks` is called as a 4th `isolatedPhase`, same resilience pattern already used for the other three — a BoE outage can't take down savings or mortgages.

## Verified against your real repo, for real this time
```
node --check src/run.mjs           -> OK
node --check src/boe-benchmarks.mjs -> OK
npm test                            -> all 3 existing tests still pass, untouched
```

I also tried to actually fetch BoE's live endpoint from a real Node process (not just my restricted tool) to test the parser against a real response. Hit `x-deny-reason: host_not_allowed` — that's my own sandbox's network allowlist blocking `bankofengland.co.uk`, confirmed via the response header, not BoE rejecting anything. So I still could not personally see a live response. Same honest limitation as before — the first real run on Render is the actual test. Check the `boeBenchmarks` block in the run log for `inserted` vs `skippedSeries`.

## No new Supabase migration needed
`mortgage_market_rate_benchmarks` already exists (created directly last session) — this worker's `SUPABASE_URL`/`SUPABASE_SECRET_KEY` write to the same project everything else in this log already writes to, so no schema change required here.

## To ship
Two file replacements (`src/run.mjs`, `src/boe-benchmarks.mjs`) plus deleting `app/` and `lib/` from this repo. No new Render service needed — this rides on whatever cron already runs `node src/run.mjs` (the one that produced the log you showed me).
