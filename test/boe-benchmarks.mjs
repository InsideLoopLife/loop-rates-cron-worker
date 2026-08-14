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

function parseTermType(title) {
  const lower = title.toLowerCase();
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

function parseBoeCsv(dataCsv, seriesToTitle) {
  const lines = dataCsv.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
  const rows = [];

  // Only need the most recent month per series — this table holds a current
  // snapshot, not a history; re-running the job just refreshes the latest.
  for (let i = lines.length - 1; i >= 1; i--) {
    const cells = lines[i].split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
    if (cells.length !== headers.length) continue;
    const date = new Date(cells[0]);
    if (Number.isNaN(date.getTime())) continue;
    const effectiveMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`;

    for (let col = 1; col < headers.length; col++) {
      const seriesCode = headers[col];
      const rawValue = cells[col];
      if (!rawValue || rawValue === '..' || rawValue === '0') continue; // BoE's own gap markers
      const ratePercent = Number(rawValue);
      if (!Number.isFinite(ratePercent) || ratePercent <= 0) continue;

      const title = seriesToTitle[seriesCode] || '';
      let termType = parseTermType(title);
      let ltvTier = parseLtvTier(title);
      if (!termType && CONFIRMED_2YR_FIXED_LTV_MAP[seriesCode] !== undefined) {
        termType = '2yr_fixed';
        ltvTier = CONFIRMED_2YR_FIXED_LTV_MAP[seriesCode];
      }
      if (!termType) continue; // can't confidently classify — skip rather than guess

      rows.push({ seriesCode, termType, ltvTier, ratePercent, effectiveMonth, rawTitle: title });
    }
    break; // only the latest row per series
  }
  return rows;
}

async function fetchBoeMortgageBenchmarks(userAgent) {
  const codes = BOE_SERIES_CODES.join(',');
  const dateFrom = new Date();
  dateFrom.setMonth(dateFrom.getMonth() - 2);
  const fmt = (d) => `${String(d.getDate()).padStart(2, '0')}/${d.toLocaleString('en-GB', { month: 'short' })}/${d.getFullYear()}`;

  const url =
    `https://www.bankofengland.co.uk/boeapps/database/_iadb-FromShowColumns.asp?csv.x=yes` +
    `&Datefrom=${fmt(dateFrom)}&Dateto=now&SeriesCodes=${codes}&CSVF=TT&UsingCodes=Y&VPD=Y&VFD=N`;

  const res = await fetch(url, { headers: { 'user-agent': userAgent } });
  if (!res.ok) throw new Error(`BoE IADB request failed: HTTP ${res.status}`);
  const csvText = await res.text();

  const headerLines = csvText.split('\n').slice(0, 6);
  const seriesToTitle = {};
  for (const code of BOE_SERIES_CODES) {
    const titleLine = headerLines.find((l) => l.includes(code));
    if (titleLine) seriesToTitle[code] = titleLine.replace(/"/g, '').trim();
  }

  const dataStart = csvText.indexOf('\nDATE');
  const dataCsv = dataStart >= 0 ? csvText.slice(dataStart + 1) : csvText;

  const rows = parseBoeCsv(dataCsv, seriesToTitle);
  const foundCodes = new Set(rows.map((r) => r.seriesCode));
  const skippedSeries = BOE_SERIES_CODES.filter((c) => !foundCodes.has(c));

  return { rows, skippedSeries };
}

export async function refreshBoeBenchmarks(supabase, userAgent) {
  const { rows, skippedSeries } = await fetchBoeMortgageBenchmarks(userAgent);

  if (!rows.length) {
    return { checked: BOE_SERIES_CODES.length, inserted: 0, updated: 0, failed: BOE_SERIES_CODES.length, skippedSeries, detail: [{ ok: false, error: 'No benchmark rows parsed — BoE response format may have changed, or the fetch was blocked' }] };
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
    return { checked: BOE_SERIES_CODES.length, inserted: 0, updated: 0, failed: BOE_SERIES_CODES.length, skippedSeries, detail: [{ ok: false, error: `Upsert failed: ${error.message}` }] };
  }

  return {
    checked: BOE_SERIES_CODES.length,
    inserted: rows.length,
    updated: 0,
    failed: skippedSeries.length,
    skippedSeries,
    detail: [{ ok: true, rowsWritten: rows.length, skippedSeries }],
  };
}
