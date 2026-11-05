// src/boe-benchmarks.mjs
//
// Fetches the Bank of England's official "Quoted household interest rates" —
// objective market averages, not lender-specific products. This is the FCA-safe
// approach discussed: report economic statistics, don't promote any lender's
// actual product. Zero cost, no API key, no headless browser needed — BoE's
// data is a plain CSV export, so it fits this worker's existing plain-fetch
// architecture without adding Playwright/Chromium.
//
// Source: https://www.bankofengland.co.uk/boeapps/database/ (BoE's own
// documented open-data access method — confirmed via a public tutorial
// showing a successful automated fetch of this exact endpoint).
//
// HONEST LIMITATION: I could not personally fetch this URL to see a live
// response — BoE's robots.txt blocks my own tooling, a policy on my end, not
// confirmed proof their server blocks this worker's request. The first real
// run is the actual test; check the phase result's `skippedSeries` list.

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

async function requestBoeCsv(url, userAgent) {
  // BoE sometimes returns its HTML "Error" page with HTTP 200 (seen 30 Oct
  // 08:00 with a valid request). Retry once after a pause before giving up.
  let lastText = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await fetch(url, { headers: { 'user-agent': userAgent, accept: 'text/csv,text/plain,*/*' } });
    if (!res.ok) throw new Error(`BoE IADB request failed: HTTP ${res.status}`);
    lastText = await res.text();
    if (!/^\s*<(!DOCTYPE|html)/i.test(lastText)) return { csvText: lastText, attempts: attempt };
    if (attempt === 1) await new Promise((r) => setTimeout(r, 5000));
  }
  return { csvText: lastText, attempts: 2 };
}

async function fetchBoeMortgageBenchmarks(userAgent) {
  const codes = BOE_SERIES_CODES.join(',');
  const dateFrom = new Date();
  dateFrom.setMonth(dateFrom.getMonth() - 3); // 3 months: monthly series publish with a ~1 month lag

  const url =
    `https://www.bankofengland.co.uk/boeapps/database/_iadb-FromShowColumns.asp?csv.x=yes` +
    `&Datefrom=${formatBoeDate(dateFrom)}&Dateto=now&SeriesCodes=${codes}&CSVF=TT&UsingCodes=Y&VPD=Y&VFD=N`;

  const { csvText, attempts } = await requestBoeCsv(url, userAgent);
  const { rows, dataLines, dataStartFound } = parseBoeBenchmarks(csvText);
  const foundCodes = new Set(rows.map((r) => r.seriesCode));
  const skippedSeries = BOE_SERIES_CODES.filter((c) => !foundCodes.has(c));

  const headerColumnsFound = dataLines[0] ? dataLines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, '')) : [];
  const diagnostics = {
    requestUrl: url,
    attempts,
    dataStartFound,
    headerColumnsFound,
    requestedButAbsentFromHeader: BOE_SERIES_CODES.filter((c) => !headerColumnsFound.includes(c)),
    csvTextLength: csvText.length,
    csvTextFirst300Chars: csvText.slice(0, 300),
  };

  return { rows, skippedSeries, diagnostics };
}

export async function refreshBoeBenchmarks(supabase, userAgent) {
  const { rows, skippedSeries, diagnostics } = await fetchBoeMortgageBenchmarks(userAgent);

  if (!rows.length) {
    return { checked: BOE_SERIES_CODES.length, inserted: 0, updated: 0, failed: BOE_SERIES_CODES.length, skippedSeries, diagnostics, detail: [{ ok: false, error: 'No benchmark rows parsed — BoE response format may have changed, or the fetch was blocked' }] };
  }

  const { error } = await supabase.from('mortgage_market_rate_benchmarks').upsert(
    rows.map((r) => ({
      series_code: r.seriesCode,
      term_type: r.termType,
      ltv_tier: r.ltvTier,
      rate_percent: r.ratePercent,
      effective_month: r.effectiveMonth,
      raw_series_title: r.rawTitle,
      source: 'boe_iadb',
      fetched_at: new Date().toISOString(),
    })),
    { onConflict: 'series_code,effective_month' },
  );

  if (error) {
    return { checked: BOE_SERIES_CODES.length, inserted: 0, updated: 0, failed: BOE_SERIES_CODES.length, skippedSeries, diagnostics, detail: [{ ok: false, error: `Upsert failed: ${error.message}` }] };
  }

  return {
    checked: BOE_SERIES_CODES.length,
    inserted: rows.length,
    updated: 0,
    failed: skippedSeries.length,
    skippedSeries,
    diagnostics,
    detail: [{ ok: true, rowsWritten: rows.length, skippedSeries }],
  };
}
