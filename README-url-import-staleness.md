# User-submitted mortgage product URLs + staleness safeguard

Spans both repos — submission/extraction/fit-assessment lives in the app (`Loop`), the 3-strikes staleness check lives in the worker (`loop-rates-cron-worker`).

## Live in Supabase already
- `user_submitted_mortgage_products` — shared table, one row per unique `source_url`. A second user submitting the same URL reuses the existing row rather than duplicating it.
- `mortgage_deal_preferences.source_kind` constraint extended to allow `'user_submitted'` alongside the existing `'market'`/`'recommendation'` — so shortlisting a user-submitted product uses the exact same mechanism as everything else, no parallel system.

## Files
```
Loop (main app):
  app/api/house/mortgage/import-product-url/route.ts

loop-rates-cron-worker:
  src/user-submitted-staleness.mjs   -- new
  src/run.mjs                        -- one new phase: userSubmittedProducts
```

## How submission + fit assessment works
Mirrors your existing nutrition recipe-import pattern exactly (same headless-capable fetch module, same AI-budget-gated extraction with a graceful non-AI regex fallback, same rate limiting) rather than inventing a new pattern:

1. Auth + rate limit (20/hour/user)
2. `getPublicPageEvidence(url)` — same module nutrition already uses, handles JS-heavy pages
3. If the user has an OpenAI key configured and budget available: AI extracts lender name, rate, LTV cap, term, fee into structured JSON. If not: a conservative regex fallback (same "skip rather than guess" principle as the BoE parser) — extracts a plain rate/LTV/term where clearly stated, leaves lender/product name null rather than guessing
4. Stores the shared row, then computes **fit against the calling user's own mortgage**: current LTV vs the product's LTV ceiling, current payment vs estimated new payment — using your existing `calculateMonthlyMortgagePayment`, not a new formula

## How the staleness safeguard works (your spec, implemented as described)
New phase in the worker, same `isolatedPhase` resilience pattern as savings/mortgages/boeBenchmarks — a bad run here can't take down anything else, and vice versa.

Each active submitted product gets re-fetched. A check fails if: HTTP not OK, near-empty response, or — the more interesting case — **the page loads fine but the originally-extracted rate no longer appears anywhere on it**, which is exactly the "lender quietly pulled this deal" scenario you're trying to catch, not just dead links.

- **Pass** -> `consecutive_failed_checks` resets to 0
- **Fail** -> increments; below 3, stays `active`
- **3rd consecutive fail** -> `status = 'deleted'`, then queries `mortgage_deal_preferences` for every user who'd shortlisted it (`source_kind='user_submitted'`) and inserts a real row into `app_notifications` — your actual in-app notification table, not a new one — with a clear title, explanation, and a CTA back to the mortgage section

## Verified
```
Loop:                    npx tsc --noEmit -> exit 0
                          npm run build     -> compiles clean, same category of
                                               unrelated env-var prerender failure
                                               as every previous check (this time
                                               on /account instead of
                                               /account/money-strategy - different
                                               page, same root cause: my sandbox
                                               has no real Supabase credentials)

loop-rates-cron-worker:  node --check on both new/changed files -> OK
                          npm test -> all 3 existing tests still pass, untouched
```

## Honest gaps, not swept under anything
- Checked `app_notifications` for a `notification_type` check constraint before using a new value (`mortgage_deal_expired`) - there isn't one, so this is safe, but worth knowing I checked rather than assumed, given the exact same class of bug (an unlisted constraint value) broke the shortlist endpoint earlier in this project.
- The staleness check is a liveness/coherence check (does the page still 200 and still mention the rate), not a full re-extraction. If a lender changes the rate on the same page without ever 404ing, this won't catch that the specific number changed - it'll only catch the URL going properly dead or the rate disappearing entirely. Full re-extraction on every check would mean spending AI budget on every submitted product every run, which felt like the wrong tradeoff for a routine liveness sweep - happy to revisit if silent rate-changes matter more than dead links in practice.
- No UI built yet for the submission form itself - this is the API only. Say the word and I'll build the input/results component next.
