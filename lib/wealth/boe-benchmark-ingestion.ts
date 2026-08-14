// lib/wealth/boe-benchmark-ingestion.ts
//
// Fetches the Bank of England's official "Quoted household interest rates" dataset
// and stores it as objective market benchmarks — not lender-specific products.
// This is the FCA-safe alternative discussed for the House mortgage panel: report
// what the market average is, don't promote any single lender's rate.
//
// Free, documented, no API key: https://www.bankofengland.co.uk/boeapps/database/
//
// IMPORTANT — what I could and couldn't verify myself:
// I confirmed this exact URL pattern and response shape (CSV, one column per series
// code) via a public tutorial demonstrating a successful automated fetch, and BoE's
// own "Open Data" documentation explicitly describes this as their intended API.
// I could NOT personally test-fetch it — BoE's robots.txt blocks my own fetch tool,
// which is a client-side policy on my end, not necessarily a server-side block (the
// tutorial's Python `requests` call succeeded against the identical URL). A real
// server-side Node fetch from your cron is a different client and likely unaffected,
// but the very first cron run is the actual proof, not this code.
//
// Series codes below are the ones I could confirm with reasonable confidence from
// BoE's own published chart labels (2yr fixed, all 5 LTV tiers, confirmed via an
// official BoE chart URL with explicit per-series labels). The rest are included
// because they appear in BoE's own "Quoted Rates" series list, but their exact
// LTV-tier mapping is inferred from context rather than an explicit label I saw —
// this is why the parser below extracts the tier/term from BoE's own title text at
// fetch time (CSVF=TT mode returns full series titles) rather than trusting a
// hardcoded map. If BoE's title wording doesn't match the regex, the row is skipped
// and logged rather than silently mis-tagged.

const BOE_SERIES_CODES = [
  // 2yr fixed, confirmed per-LTV-tier via BoE's own chart labels
  'IUMZICQ', // 2yr fixed, 60% LTV
  'IUMBV34', // 2yr fixed, 75% LTV
  'IUMZICR', // 2yr fixed, 85% LTV
  'IUMB482', // 2yr fixed, 90% LTV
  'IUM2WTL', // 2yr fixed, 95% LTV
  // 3yr fixed — BoE's older single blended series (no LTV breakdown in this one)
  'IUMBV37',
  // 5yr fixed — newer per-tier series (IUMZO2x) plus the older blended ones
  'IUMZO27',
  'IUMBV42',
  'IUMZO28',
  'IUM5WTL',
  // 10yr fixed
  'IUMBV45',
  // 2yr variable / discounted variable
  'IUMBV48',
  'IUM2WDT',
  // Standard variable rate / revert-to-rate — not LTV-tiered
  'CFMBX2D',
  'IUMTLMV',
] as const;

export interface ParsedBenchmarkRow {
  seriesCode: string;
  termType: string;
  ltvTier: number | null;
  ratePercent: number;
  effectiveMonth: string; // YYYY-MM-01
  rawTitle: string;
}

// Confirmed with high confidence from BoE's own chart labels (not guessed from
// title-text parsing) — used as a fallback if the TT-format title extraction
// below doesn't work as expected, so the most commonly needed tier (2yr fixed,
// all 5 LTV bands) doesn't silently fail if BoE's title format differs from
// what I inferred without being able to see a live response myself.
const CONFIRMED_2YR_FIXED_LTV_MAP: Record<string, number> = {
  IUMZICQ: 60,
  IUMBV34: 75,
  IUMZICR: 85,
  IUMB482: 90,
  IUM2WTL: 95,
};

function parseTermType(title: string): string | null {
  const lower = title.toLowerCase();
  if (/standard variable|revert.?to.?rate/.test(lower)) return lower.includes('revert') ? 'revert_to_rate' : 'svr';
  if (/2.?year.*variable|2.?year.*discount/.test(lower)) return '2yr_variable';
  const fixedMatch = lower.match(/(\d+)\s*.?year.*fixed/);
  if (fixedMatch) return `${fixedMatch[1]}yr_fixed`;
  return null;
}

function parseLtvTier(title: string): number | null {
  const match = title.match(/(\d{2})\s*%\s*ltv/i);
  return match ? Number(match[1]) : null;
}

function parseBoeCsv(csvText: string, seriesToTitle: Record<string, string>): ParsedBenchmarkRow[] {
  const lines = csvText.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
  const rows: ParsedBenchmarkRow[] = [];

  // Use only the most recent data row per series — this is a monthly snapshot table,
  // not a historical archive; re-running the cron just refreshes the latest month.
  for (let i = lines.length - 1; i >= 1; i--) {
    const cells = lines[i].split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
    if (cells.length !== headers.length) continue;
    const dateRaw = cells[0];
    const date = new Date(dateRaw);
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

      // Fallback for the 5 series I have high-confidence confirmation for,
      // in case title parsing above doesn't match BoE's actual TT format.
      if (!termType && CONFIRMED_2YR_FIXED_LTV_MAP[seriesCode] !== undefined) {
        termType = '2yr_fixed';
        ltvTier = CONFIRMED_2YR_FIXED_LTV_MAP[seriesCode];
      }
      if (!termType) continue; // can't confidently classify — skip rather than guess

      rows.push({ seriesCode, termType, ltvTier, ratePercent, effectiveMonth, rawTitle: title });
    }
    break; // only need the latest row per series, found via the reverse scan above
  }
  return rows;
}

export async function fetchBoeMortgageBenchmarks(): Promise<{ rows: ParsedBenchmarkRow[]; skippedSeries: string[] }> {
  const codes = BOE_SERIES_CODES.join(',');
  const dateFrom = new Date();
  dateFrom.setMonth(dateFrom.getMonth() - 2); // small window — we only need the latest month
  const fmt = (d: Date) => `${String(d.getDate()).padStart(2, '0')}/${d.toLocaleString('en-GB', { month: 'short' })}/${d.getFullYear()}`;

  const url =
    `https://www.bankofengland.co.uk/boeapps/database/_iadb-FromShowColumns.asp?csv.x=yes` +
    `&Datefrom=${fmt(dateFrom)}&Dateto=now&SeriesCodes=${codes}&CSVF=TT&UsingCodes=Y&VPD=Y&VFD=N`;

  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LoopFinanceBot/1.0; +https://insideloop.life)' },
  });
  if (!res.ok) throw new Error(`BoE IADB request failed: HTTP ${res.status}`);
  const csvText = await res.text();

  // CSVF=TT ("Tabular with Titles") puts the full series title in a header block
  // above the data — BoE's own format has the title row separate from the data
  // header row. Extract series-code -> title by matching each code's column.
  const headerLines = csvText.split('\n').slice(0, 6);
  const seriesToTitle: Record<string, string> = {};
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

export async function refreshMortgageMarketBenchmarks(supabase: any) {
  const { rows, skippedSeries } = await fetchBoeMortgageBenchmarks();

  if (!rows.length) {
    throw new Error(
      `No benchmark rows parsed from BoE response — either the fetch failed silently or their title format changed. Skipped series: ${skippedSeries.join(', ')}`,
    );
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

  if (error) throw new Error(`Failed to upsert benchmark rows: ${error.message}`);

  return { inserted: rows.length, skippedSeries };
}
