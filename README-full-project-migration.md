# Mortgage/savings consolidated into the rates project - full sweep

9 files, whole-file replacements, unzip -o. This closes out the split-database problem properly rather than patching just the piece that happened to be broken.

## What's live in ulborvxhellknobealnj now (created this session)
```
mortgage_market_rate_benchmarks   (BoE data)
lender_svr_reference + view       (SVR knowledge centre)
user_submitted_mortgage_products  (URL importer)
mortgage_deal_preferences         (shortlist/star - 1 real row migrated + verified)
mortgage_renewal_recommendations  (empty - 0 rows existed to migrate)
savings_rate_recommendations      (empty - see note below)
savings_rate_watch_runs           (empty - see note below)
```

## Files changed and why
| File | What moved to ratesSupabase |
|---|---|
| domains/wealth/house/HousePage.tsx | mortgage_renewal_recommendations, mortgage_deal_preferences reads |
| lib/wealth/mortgage-renewal-watch.ts | The actual cron-side write to mortgage_renewal_recommendations |
| lib/wealth/savings-rate-watch.ts | Writes/reads for savings_rate_recommendations and savings_rate_watch_runs (3 + 3 call sites) |
| app/mortgage/actions.ts | saveMortgageDealPreference - this is the one actually imported by the live MortgagePlannerClient.tsx, confirmed via import search |
| app/api/mortgage/actions.ts | Same fix, kept in sync (near-duplicate file, not currently used by the live component but fixed for consistency) |
| app/api/house/mortgage/import-product-url/route.ts | user_submitted_mortgage_products reads/writes - was pointed at the wrong project entirely since I built it |
| app/admin/wealth-watch/page.tsx | savings_rate_recommendations, mortgage_renewal_recommendations, savings_rate_watch_runs reads |
| app/admin/savings/page.tsx | All 4 queries (savings_rate_deals, savings_rate_recommendations, savings_rate_watch_runs, savings_rate_sources) - needed a new ratesSupabase client added, didn't have one |
| app/accounts/page.tsx | savings_rate_recommendations - user-facing, this is what a real person sees on their own accounts page |

## A real bug caught mid-fix, not introduced by it
saveMortgageDealPreference's validation only allowed source_kind of "market" or "recommendation" - missing "user_submitted". Without this fix, clicking "Shortlist this" on an imported product (the feature from two messages ago) would have thrown "Invalid mortgage deal preference." every time. Fixed in both copies of the action.

## Data migration decisions, made explicitly rather than defaulted into
- mortgage_deal_preferences: 1 real row (an actual user shortlist action) - migrated, and verified its source_id genuinely resolves against the real mortgage_rate_deals in the correct project before moving it
- savings_rate_recommendations: 105 rows, but 104/105 are auto-generated market_better_rate suggestions and 60 were already expired. Did not force a risky bulk transplant of computed, regenerable output - table created empty, will repopulate fresh on the next savings-rate-watch run now that it writes to the right place
- savings_rate_watch_runs: 18 rows of daily run-history logs, pure observability data, same call - empty table, repopulates going forward
- mortgage_renewal_recommendations: had 0 rows to begin with, nothing to decide

## Verified
```
npx tsc --noEmit -> exit 0
npm run build      -> compiles clean, same one unrelated env-var failure
                       (/account/money-strategy) as every previous check
```

Also ran a final repo-wide grep for any remaining supabase.from(...) call on a rates-domain table after every fix, to confirm nothing was missed - zero results.

## What I did not touch, deliberately
- home_mortgage_deals, home_owners, homes, people, mortgage_liability_allocation_effective - these stay in the main project. They're core household records joined together (the liability-split view specifically needs people/home_owners/home_mortgage_deals in the same database to work at all), not rate-catalogue data, and moving them would break every join rather than save meaningful egress.
- The now-redundant old copies of these tables sitting in vuqlgderfszguttdnxsr (mortgage_rate_deals, mortgage_lender_sources, savings_rate_deals, savings_rate_sources, and the now-empty mortgage_deal_preferences/mortgage_renewal_recommendations/savings_rate_recommendations/savings_rate_watch_runs I just emptied by repointing the app) - these are safe to drop now to actually realize the storage savings, but I haven't dropped anything. Want me to prepare exact DROP TABLE statements as a follow-up once you've confirmed the app is working correctly against the new project?
