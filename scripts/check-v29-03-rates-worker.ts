import assert from "node:assert/strict";
import fs from "node:fs";
import { parseMortgageCatalogueDeals } from "../lib/wealth/mortgage-catalogue";
import { isMaterialProductCollapse } from "../lib/wealth/rate-source-health";
import { catalogueHealth, RATES_WORKER_SCHEMA_VERSION } from "../lib/wealth/rates-worker-runtime";

assert.equal(RATES_WORKER_SCHEMA_VERSION, 3);
assert.equal(isMaterialProductCollapse(10, 6), true, "a fall greater than 30% should be quarantined");
assert.equal(isMaterialProductCollapse(10, 7), false, "the 30% boundary should not be treated as a collapse");
assert.equal(isMaterialProductCollapse(3, 1), false, "small catalogues should not trigger collapse protection");

const before = parseMortgageCatalogueDeals({
  lenderName: "Example Bank",
  sourceUrl: "https://example.com/mortgages",
  sourceId: "source-1",
  text: "Purchase mortgage. 2 year fixed mortgage initial rate 4.50% up to 75% LTV. Product fee £999.",
});
const after = parseMortgageCatalogueDeals({
  lenderName: "Example Bank",
  sourceUrl: "https://example.com/mortgages",
  sourceId: "source-1",
  text: "Purchase mortgage. 2 year fixed mortgage initial rate 4.25% up to 75% LTV. Product fee £999.",
});
assert.ok(before.length && after.length, "mortgage parser should return a product");
assert.equal((before[0] as any).externalProductKey, (after[0] as any).externalProductKey, "a rate movement must update the same mortgage product identity");
assert.notEqual(before[0].ratePercent, after[0].ratePercent);

const unhealthy = catalogueHealth({ checked: 40, failed: 40, parseSuccesses: 0, accepted: 0, unchanged: 0, collapseSources: 0 });
assert.equal(unhealthy.recommendations_safe, false);
assert.equal(unhealthy.withdrawals_safe, false);
const healthy = catalogueHealth({ checked: 40, failed: 16, parseSuccesses: 20, accepted: 30, unchanged: 4, collapseSources: 0 });
assert.equal(healthy.recommendations_safe, true);
assert.equal(healthy.status, "healthy");

const migration = fs.readFileSync(new URL("../supabase/migrations/202608041900_rates_worker_resilience_v3.sql", import.meta.url), "utf8");
assert.match(migration, /enable row level security/i);
assert.match(migration, /revoke all on function public\.try_acquire_rate_worker_lock[\s\S]*from public, anon, authenticated/i);
assert.match(migration, /security invoker/i);
assert.doesNotMatch(migration, /security definer/i);

console.log("v29.03 rates worker resilience checks passed");
