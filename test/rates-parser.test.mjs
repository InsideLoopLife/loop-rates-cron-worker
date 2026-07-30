import test from "node:test";
import assert from "node:assert/strict";
import { parseMortgageDeals, parseSavingsDeals } from "../src/rates-parser.mjs";

test("regular saver requires monthly allowance and term before publication", () => {
  const complete = parseSavingsDeals({
    providerName: "Example Bank", providerSlug: "example", productHint: null, sourceUrl: "https://example.com",
    text: "Example Bank Reward Regular Saver. Save at least £25 and up to £300 per month for 12 months. Minimum opening deposit £25. 6.00% AER fixed. No withdrawals.",
  });
  assert.equal(complete.length, 1);
  assert.equal(complete[0].monthly_min_deposit, 25);
  assert.equal(complete[0].monthly_max_deposit, 300);
  assert.equal(complete[0].term_length_months, 12);
  assert.equal(complete[0].publishable, true);

  const incomplete = parseSavingsDeals({
    providerName: "Example Bank", providerSlug: "example", productHint: null, sourceUrl: "https://example.com",
    text: "Example Bank Reward Regular Saver. 6.00% AER fixed.",
  });
  assert.equal(incomplete[0].publishable, false);
});

test("mortgage requires term LTV and fee", () => {
  const deals = parseMortgageDeals({
    lenderName: "Example Lender", lenderSlug: "example", sourceUrl: "https://example.com",
    text: "Example mortgage 4.25% fixed for 2 years, available up to 75% LTV. Product fee £999. Available for remortgage and purchase.",
    market: { median: 4.4, lowerBound: 3.1, upperBound: 6.8, sampleSize: 20 },
  });
  assert.equal(deals.length, 1);
  assert.equal(deals[0].initial_term_months, 24);
  assert.equal(deals[0].ltv_max, 75);
  assert.equal(deals[0].product_fee, 999);
  assert.equal(deals[0].publishable, true);
});

test("mortgage market anomaly is quarantined", () => {
  const deals = parseMortgageDeals({
    lenderName: "Example Lender", lenderSlug: "example", sourceUrl: "https://example.com",
    text: "Example mortgage 1.25% fixed for 5 years, available up to 90% LTV. No product fee.",
    market: { median: 4.5, lowerBound: 3.24, upperBound: 6.98, sampleSize: 50 },
  });
  assert.equal(deals[0].anomaly, true);
  assert.equal(deals[0].publishable, false);
});
