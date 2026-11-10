// src/boe-benchmarks.mjs
//
// Bank of England figures for mortgage comparisons.
//  - Bank Rate: read daily from the public "Current official Bank Rate" page.
//  - Quoted household mortgage averages (monthly, by term and LTV): the Bank's
//    robots.txt disallows automated use of its CSV export, so these are loaded
//    from a CSV an admin downloads in a browser; parseBoeBenchmarks parses it.

const BOE_SERIES_CODES = [
  'IUMZICQ', // 2yr fixed, 60% LTV — confirmed via BoE's own chart labels
  'IUMBV34', // 2yr fixed, 75% LTV — confirmed
  'IUMZICR', // 2yr fixed, 85% LTV — confirmed
  'IUMB482', // 2yr fixed, 90% LTV — confirmed
  'IUM2WTL', // 2yr fixed, 95% LTV — confirmed
  'IUMBV37', // 3yr fixed (blended, no LTV breakdown in this older series)
  'IUMZO27', 'IUMBV42', 'IUMZO28', 'IUM5WTL', // 5yr fixed, various tiers
  'IUMBV45', // 10yr fixed
  'IUMBV48', 'IUM2WDT', // 2yr variable / discounted variable
  'CFMBX2D', 'IUMTLMV', // SVR / revert-to-rate
  'IUDBEDR', // Bank Rate itself — confirmed via BoE's own R package docs and an
             // independent MCP server built specifically around this series code.
];

// High-confidence fallback for the 5 series I could confirm precisely,
// independent of whether the title-text parsing below matches BoE's actual
// CSVF=TT format (which I couldn't personally verify — see module header).
const CONFIRMED_2YR_FIXED_LTV_MAP = {
  IUMZICQ: 60,
  IUMBV34: 75,
  IUMZICR: 85,
  IUMB482: 90,
  IUM2WTL: 95,
};

// Same safety-net principle for Bank Rate — this is the single most important
// series (everything else, including live SVR-spread calculations, depends on
// it), so it shouldn't be able to silently fail just because its title text
// doesn't match my regex guess.
const CONFIRMED_TERM_TYPE_MAP = {
  IUDBEDR: 'bank_rate',
};

function parseTermType(title) {
  const lower = title.toLowerCase();
  if (/official bank rate|^bank rate/.test(lower)) return 'bank_rate';
  if (/standard variable|revert.?to.?rate/.test(lower)) return lower.includes('revert') ? 'revert_to_rate' : 'svr';
  if (/2.?year.*variable|2.?year.*discount/.test(lower)) return '2yr_variable';
  const fixedMatch = lower.match(/(\d+)\s*.?year.*fixed/);
  if (fixedMatch) return `${fixedMatch[1]}yr_fixed`;
  return null;
}

function parseLtvTier(title) {
  const match = title.match(/(\d{2})\s*%\s*ltv/i);
  return match ? Number(match[1]) : null;
}

// BoE's IADB wants English 3-letter month abbreviations ("Sep"). Don't use
// toLocaleString — Node 22's ICU formats September as "Sept" in en-GB, which
// makes BoE return an HTML error page for every request whose start date
// falls in September (this broke every run from 1 Nov 2026).
const BOE_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatBoeDate(d) {
  return `${String(d.getDate()).padStart(2, '0')}/${BOE_MONTHS[d.getMonth()]}/${d.getFullYear()}`;
}

// Response shape (seen in production logs): a "SERIES,DESCRIPTION" block with
// one line per series, then a "DATE,<code>,<code>..." data table. Lines end \r\n.
export function parseBoeResponse(csvText) {
  const lines = csvText.replace(/\r/g, '').split('\n');
  const dataIndex = lines.findIndex((l) => /^"?DATE"?,/.test(l.trim()));

  const seriesToTitle = {};
  const headerBlock = dataIndex >= 0 ? lines.slice(0, dataIndex) : [];
  for (const line of headerBlock) {
    const m = line.match(/^"?([A-Z0-9]{5,10})"?,(.*)$/);
    if (m && m[1] !== 'SERIES') seriesToTitle[m[1]] = m[2].replace(/"/g, '').trim();
  }

  const dataLines = dataIndex >= 0 ? lines.slice(dataIndex).filter((l) => l.trim()) : [];
  return { seriesToTitle, dataLines, dataStartFound: dataIndex >= 0 };
}

function parseBoeCsv(dataLines, seriesToTitle) {
  if (dataLines.length < 2) return [];
  const headers = dataLines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
  const rows = [];

  // This table holds a current snapshot, so we only need each series' most
  // recent value. Bank Rate (IUDBEDR) is daily while the mortgage series are
  // monthly, so the newest rows only have Bank Rate filled in. Walk back per
  // series until we find that series' own latest value — previously the loop
  // stopped at the very last row and only ever saved Bank Rate.
  for (let col = 1; col < headers.length; col++) {
    const seriesCode = headers[col];
    for (let i = dataLines.length - 1; i >= 1; i--) {
      const cells = dataLines[i].split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
      if (cells.length !== headers.length) continue;
      const rawValue = cells[col];
      if (!rawValue || rawValue === '..') continue; // BoE's own gap markers
      const ratePercent = Number(rawValue);
      if (!Number.isFinite(ratePercent) || ratePercent <= 0) continue;
      const date = new Date(cells[0]);
      if (Number.isNaN(date.getTime())) continue;
      const effectiveMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`;

      const title = seriesToTitle[seriesCode] || '';
      let termType = parseTermType(title);
      let ltvTier = parseLtvTier(title);
      if (!termType && CONFIRMED_2YR_FIXED_LTV_MAP[seriesCode] !== undefined) {
        termType = '2yr_fixed';
        ltvTier = CONFIRMED_2YR_FIXED_LTV_MAP[seriesCode];
      }
      if (!termType && CONFIRMED_TERM_TYPE_MAP[seriesCode] !== undefined) {
        termType = CONFIRMED_TERM_TYPE_MAP[seriesCode];
      }
      if (termType) rows.push({ seriesCode, termType, ltvTier, ratePercent, effectiveMonth, rawTitle: title });
      break; // latest value found for this series (classified or not)
    }
  }
  return rows;
}

export function parseBoeBenchmarks(csvText) {
  const { seriesToTitle, dataLines, dataStartFound } = parseBoeResponse(csvText);
  const rows = parseBoeCsv(dataLines, seriesToTitle);
  return { rows, seriesToTitle, dataLines, dataStartFound };
}

// The Bank's robots.txt disallows automated access to
// /boeapps/database/_iadb-FromShowColumns.asp (the CSV export), and since
// 31 Oct 2026 it returns an error page to this worker. So the worker no longer
// calls it. Bank Rate comes from the public "Current official Bank Rate" page
// (/boeapps/database/Bank-Rate, not disallowed). The monthly quoted mortgage
// averages are loaded by an admin uploading the CSV they download in a browser
// (parseBoeBenchmarks above handles that file).
const BANK_RATE_URL = 'https://www.bankofengland.co.uk/boeapps/database/Bank-Rate.asp';
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

/** Most recent change in the "Date Changed | Rate" table, e.g. "05 Nov 26 | 4.00". */
export function parseBankRatePage(html) {
  const text = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ');
  const re = /\b(\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* (\d{2}|\d{4}) (\d{1,2}\.\d{1,3})\b/g;
  const changes = [];
  const thisYear = new Date().getUTCFullYear();
  for (const m of text.matchAll(re)) {
    // The table uses two-digit years back to the 1970s: "04 Nov 99" is 1999,
    // not 2099. Anything that would land in the future is the previous century.
    const yy = Number(m[3]);
    const year = m[3].length === 4 ? yy : (2000 + yy > thisYear ? 1900 + yy : 2000 + yy);
    const date = new Date(Date.UTC(year, MONTHS[m[2].toLowerCase()], Number(m[1])));
    const rate = Number(m[4]);
    if (rate > 0 && rate < 20 && date.getTime() <= Date.now() + 86400000) changes.push({ date, rate });
  }
  if (!changes.length) return null;
  changes.sort((a, b) => b.date - a.date);
  return { changedOn: changes[0].date.toISOString().slice(0, 10), ratePercent: changes[0].rate, changesFound: changes.length };
}

export async function refreshBoeBenchmarks(supabase, userAgent) {
  let parsed = null;
  let diagnostics = { requestUrl: BANK_RATE_URL };
  try {
    const res = await fetch(BANK_RATE_URL, { headers: { 'user-agent': userAgent, accept: 'text/html' } });
    const html = await res.text();
    diagnostics = { ...diagnostics, status: res.status, length: html.length };
    if (res.ok) parsed = parseBankRatePage(html);
    if (!parsed) diagnostics.first300 = html.slice(0, 300);
  } catch (error) {
    diagnostics.error = error?.message || String(error);
  }

  if (!parsed) {
    return { checked: 1, inserted: 0, updated: 0, failed: 1, skippedSeries: ['IUDBEDR'], diagnostics, detail: [{ ok: false, error: 'Could not read Bank Rate from the Bank of England page' }] };
  }

  const now = new Date();
  const effectiveMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
  const { error } = await supabase.from('mortgage_market_rate_benchmarks').upsert([{
    series_code: 'IUDBEDR',
    term_type: 'bank_rate',
    ltv_tier: null,
    rate_percent: parsed.ratePercent,
    effective_month: effectiveMonth,
    raw_series_title: `Official Bank Rate (last changed ${parsed.changedOn})`,
    source: 'boe_bank_rate_page',
    fetched_at: now.toISOString(),
  }], { onConflict: 'series_code,effective_month' });

  if (error) {
    return { checked: 1, inserted: 0, updated: 0, failed: 1, skippedSeries: ['IUDBEDR'], diagnostics, detail: [{ ok: false, error: `Upsert failed: ${error.message}` }] };
  }
  return { checked: 1, inserted: 1, updated: 0, failed: 0, skippedSeries: [], diagnostics: { ...diagnostics, ...parsed }, detail: [{ ok: true, bankRate: parsed.ratePercent, changedOn: parsed.changedOn }] };
}
