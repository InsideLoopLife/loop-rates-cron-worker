import test from "node:test";
import assert from "node:assert/strict";
import { formatBoeDate, parseBoeBenchmarks } from "../src/boe-benchmarks.mjs";

test("BoE dates use 'Sep', not Node's en-GB 'Sept'", () => {
  assert.equal(formatBoeDate(new Date(2026, 8, 5)), "05/Sep/2026");
  assert.equal(formatBoeDate(new Date(2026, 0, 1)), "01/Jan/2026");
});

// Shape copied from production diagnostics: SERIES/DESCRIPTION block, \r\n line
// endings, daily Bank Rate alongside monthly mortgage series.
const csv = [
  "SERIES,DESCRIPTION",
  "IUMZICQ,Monthly interest rate of UK monetary financial institutions (excl. Central Bank) sterling 2 year (60% LTV) fixed rate mortgage to households (in percent) not seasonally adjusted",
  "IUMBV34,Monthly interest rate of UK monetary financial institutions (excl. Central Bank) sterling 2 year (75% LTV) fixed rate mortgage to households (in percent) not seasonally adjusted",
  "IUMBV42,Monthly interest rate of UK monetary financial institutions (excl. Central Bank) sterling 5 year (75% LTV) fixed rate mortgage to households (in percent) not seasonally adjusted",
  "IUMTLMV,Monthly interest rate of UK monetary financial institutions (excl. Central Bank) sterling standard variable rate mortgage to households (in percent) not seasonally adjusted",
  "IUDBEDR,Official Bank Rate",
  "",
  "DATE,IUMZICQ,IUMBV34,IUMBV42,IUMTLMV,IUDBEDR",
  "30 Sep 2026,4.01,4.22,4.30,7.10,",
  "31 Oct 2026,3.95,4.18,4.27,7.05,",
  "01 Nov 2026,,,,,3.75",
  "04 Nov 2026,,,,,3.75",
].join("\r\n");

test("every series gets its own latest value, not just Bank Rate", () => {
  const { rows } = parseBoeBenchmarks(csv);
  const byCode = Object.fromEntries(rows.map((r) => [r.seriesCode, r]));
  assert.equal(rows.length, 5);
  assert.deepEqual([byCode.IUMZICQ.termType, byCode.IUMZICQ.ltvTier, byCode.IUMZICQ.ratePercent, byCode.IUMZICQ.effectiveMonth], ["2yr_fixed", 60, 3.95, "2026-10-01"]);
  assert.deepEqual([byCode.IUMBV42.termType, byCode.IUMBV42.ltvTier], ["5yr_fixed", 75]);
  assert.equal(byCode.IUMTLMV.termType, "svr");
  assert.deepEqual([byCode.IUDBEDR.termType, byCode.IUDBEDR.ratePercent, byCode.IUDBEDR.effectiveMonth], ["bank_rate", 3.75, "2026-11-01"]);
});

test("HTML error page yields no rows", () => {
  const { rows, dataStartFound } = parseBoeBenchmarks("<!DOCTYPE html>\r\n<html><head><title>Error</title></head></html>");
  assert.equal(rows.length, 0);
  assert.equal(dataStartFound, false);
});

import { parseBankRatePage } from "../src/boe-benchmarks.mjs";

test("Bank Rate page: newest change wins", () => {
  const html = `<table><thead><tr><th>Date Changed</th><th>Rate</th></tr></thead><tbody>
    <tr><td>07 Aug 25</td><td>4.00</td></tr>
    <tr><td>05 Nov 26</td><td>4.00</td></tr>
    <tr><td>18 Dec 25</td><td>3.75</td></tr></tbody></table>`;
  const parsed = parseBankRatePage(html);
  assert.equal(parsed.changedOn, "2026-11-05");
  assert.equal(parsed.ratePercent, 4);
  assert.equal(parsed.changesFound, 3);
});

test("Bank Rate page: nothing recognisable returns null", () => {
  assert.equal(parseBankRatePage("<html><body>Error</body></html>"), null);
});
