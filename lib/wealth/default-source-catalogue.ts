import { normaliseProviderSlug } from "@/lib/wealth/provider-normalise";

/**
 * LOOP RATE SOURCE CATALOGUE
 *
 * This is the only file you need to edit when adding, replacing or pausing
 * savings and mortgage source pages.
 *
 * Adding a source
 * ---------------
 * 1. Copy an existing object in the correct list.
 * 2. Give it the provider/lender name and an official HTTPS product/rate URL.
 * 3. Use a narrow product page where possible. A page containing one product
 *    or one coherent rate table is safer than a general marketing homepage.
 * 4. Add a productHint for savings pages so the extracted row has useful
 *    context. You can add several pages for the same provider.
 * 5. Set enabled: false to pause a source without deleting it.
 *
 * Important
 * ---------
 * - Do not add search-result URLs, logged-in pages or temporary campaign links.
 * - Prefer official provider/lender pages. Comparison pages are useful for
 *   coverage checks, but should not be the only evidence used for publication.
 * - This catalogue controls which pages are checked. The worker's validation
 *   and publication safeguards still decide whether a parsed deal is safe to
 *   show to users.
 */

type SourceKind =
  | "provider_product_page"
  | "provider_rate_table"
  | "best_buy_page"
  | "market_index"
  | "structured_feed"
  | "lender_product_page"
  | "lender_rate_table"
  | "broker_rate_table";

type SourceRole = "primary" | "discovery" | "corroboration";
type ParserStrategy = "deterministic" | "structured_data" | "ai_assisted";

type ProductType =
  | "easy_access"
  | "notice"
  | "fixed_term"
  | "regular_saver"
  | "cash_isa"
  | "lifetime_isa"
  | "childrens_savings"
  | "junior_cash_isa"
  | "purchase"
  | "remortgage"
  | "product_transfer"
  | "first_time_buyer"
  | "buy_to_let"
  | "shared_ownership"
  | "retirement_interest_only"
  | "self_build"
  | "green_mortgage";

type BaseSource = {
  sourceUrl: string;
  sourceKind: SourceKind;
  enabled?: boolean;
  checkFrequencyHours?: number;
  notes?: string;
  /** Primary sources may support publication; the other roles never should. */
  sourceRole?: SourceRole;
  /** AI is a bounded extraction fallback, never a search or publication engine. */
  parserStrategy?: ParserStrategy;
  aiEligible?: boolean;
  productTypes?: ProductType[];
  aliases?: string[];
  /** Optional official alternatives. Each URL is seeded as a separate retryable row. */
  fallbackUrls?: string[];
};

export type DefaultMortgageSource = BaseSource & {
  lenderName: string;
};

export type DefaultSavingsSource = BaseSource & {
  providerName: string;
  productHint?: string;
};

const OFFICIAL_SOURCE_NOTE =
  "LOOP-managed official source. Parsed rows remain subject to completeness, anomaly and publication checks.";

const COMPARISON_SOURCE_NOTE =
  "Discovery/corroboration only. Never publish a product from this page without matching it to official provider evidence.";

/**
 * WHOLE-MARKET OPERATING POLICY
 *
 * A static public-page catalogue can provide broad UK market monitoring, but it
 * cannot prove literal whole-of-market coverage. Broker-only/exclusive mortgage
 * products and some savings products require licensed structured data.
 *
 * The cron must therefore describe public-page results as `broad_market` until
 * a licensed feed is connected and its coverage reconciliation passes.
 */
export const RATE_SOURCE_POLICY = {
  coverageMode: "broad_market" as "broad_market" | "licensed_whole_market",
  webSearchEnabled: false,
  discoveryMethods: ["curated_official_urls", "provider_sitemaps", "comparison_indexes"] as const,
  conditionalRequests: true,
  unchangedContentSkipsParsing: true,
  aiExtraction: {
    enabled: process.env.RATE_AI_EXTRACTION_ENABLED === "true",
    provider: process.env.RATE_AI_PROVIDER || "none",
    model: process.env.RATE_AI_MODEL || null,
    triggers: ["deterministic_parser_empty", "material_layout_change", "low_confidence"] as const,
    neverUseFor: ["web_search", "provider_discovery", "eligibility_advice", "automatic_publication"] as const,
    maxCallsPerRun: 20,
    maxCallsPerSourcePerDay: 1,
    dailyBudgetPence: 100,
    minimumDeterministicConfidenceBeforeReview: 75,
  },
  publication: {
    primaryEvidenceRequired: true,
    minConfidence: 92,
    mortgageMinConfidence: 95,
    comparisonOnlyMayPublish: false,
    requireHumanReviewForChangedProductIdentity: true,
    requireThreeMissingObservationsBeforeWithdrawal: true,
  },
  freshnessHours: {
    primary: 12,
    discovery: 24,
    corroboration: 24,
  },
} as const;

function buildMortgageSources(sources: DefaultMortgageSource[]) {
  return sources.map((source) => ({
    ...source,
    enabled: source.enabled ?? true,
    checkFrequencyHours: source.checkFrequencyHours ?? 12,
    notes: source.notes ?? OFFICIAL_SOURCE_NOTE,
    sourceRole: source.sourceRole ?? "primary",
    parserStrategy: source.parserStrategy ?? "deterministic",
    aiEligible: source.aiEligible ?? true,
    productTypes: source.productTypes ?? (["purchase", "remortgage"] as ProductType[]),
    aliases: source.aliases ?? [],
    fallbackUrls: source.fallbackUrls ?? [],
  }));
}

function buildSavingsSources(sources: DefaultSavingsSource[]) {
  return sources.map((source) => ({
    ...source,
    enabled: source.enabled ?? true,
    checkFrequencyHours: source.checkFrequencyHours ?? 12,
    notes: source.notes ?? OFFICIAL_SOURCE_NOTE,
    sourceRole: source.sourceRole ?? "primary",
    parserStrategy: source.parserStrategy ?? "deterministic",
    aiEligible: source.aiEligible ?? true,
    productTypes: source.productTypes ?? (["easy_access", "notice", "fixed_term", "regular_saver", "cash_isa"] as ProductType[]),
    aliases: source.aliases ?? [],
    fallbackUrls: source.fallbackUrls ?? [],
  }));
}

export const defaultMortgageSources = buildMortgageSources([
  {
    lenderName: "NatWest",
    sourceUrl: "https://www.natwest.com/mortgages/mortgage-rates.html",
    sourceKind: "lender_rate_table",
  },
  {
    lenderName: "Halifax",
    sourceUrl: "https://www.halifax.co.uk/mortgages/mortgage-rates.html",
    sourceKind: "lender_rate_table",
  },
  {
    lenderName: "Nationwide Building Society",
    sourceUrl: "https://www.nationwide.co.uk/mortgages/mortgage-rates/",
    sourceKind: "lender_rate_table",
  },
  {
    lenderName: "Santander",
    sourceUrl: "https://www.santander.co.uk/personal/mortgages/mortgage-rates",
    sourceKind: "lender_rate_table",
  },
  {
    lenderName: "Barclays",
    sourceUrl: "https://www.barclays.co.uk/mortgages/mortgage-rates/",
    sourceKind: "lender_rate_table",
  },
  {
    lenderName: "HSBC",
    sourceUrl: "https://www.hsbc.co.uk/mortgages/our-rates/",
    sourceKind: "lender_rate_table",
  },
  {
    lenderName: "Lloyds Bank",
    sourceUrl: "https://www.lloydsbank.com/mortgages/mortgage-rates.html",
    sourceKind: "lender_rate_table",
  },
  {
    lenderName: "TSB",
    sourceUrl: "https://www.tsb.co.uk/mortgages/mortgage-rates/",
    sourceKind: "lender_rate_table",
  },
  {
    lenderName: "Virgin Money",
    sourceUrl: "https://uk.virginmoney.com/mortgages/find-a-mortgage/",
    sourceKind: "lender_product_page",
  },
  {
    lenderName: "Coventry Building Society",
    sourceUrl: "https://www.coventrybuildingsociety.co.uk/member/mortgages/mortgage-rates.html",
    sourceKind: "lender_rate_table",
  },
  {
    lenderName: "Skipton Building Society",
    sourceUrl: "https://www.skipton.co.uk/mortgages/mortgage-rates",
    sourceKind: "lender_rate_table",
  },
  {
    lenderName: "Leeds Building Society",
    sourceUrl: "https://www.leedsbuildingsociety.co.uk/mortgages/mortgage-rates/",
    sourceKind: "lender_rate_table",
  },
  {
    lenderName: "Yorkshire Building Society",
    sourceUrl: "https://www.ybs.co.uk/mortgages/mortgage-rates",
    sourceKind: "lender_rate_table",
  },
  {
    lenderName: "First Direct",
    sourceUrl: "https://www.firstdirect.com/mortgages/rates/",
    sourceKind: "lender_rate_table",
  },
  {
    lenderName: "Metro Bank",
    sourceUrl: "https://www.metrobankonline.co.uk/mortgages/products/",
    sourceKind: "lender_product_page",
  },
  {
    lenderName: "Accord Mortgages",
    sourceUrl: "https://www.accordmortgages.com/products",
    sourceKind: "lender_product_page",
  },
  {
    lenderName: "Platform",
    sourceUrl: "https://www.platform.co.uk/mortgage-products",
    sourceKind: "lender_product_page",
  },
  {
    lenderName: "Kensington Mortgages",
    sourceUrl: "https://www.kensingtonmortgages.co.uk/intermediaries/products",
    sourceKind: "lender_product_page",
  },

  // ADD NEW MORTGAGE SOURCES ABOVE THIS LINE.
]);

export const defaultSavingsSources = buildSavingsSources([
  {
    providerName: "MoneySavingExpert",
    sourceUrl: "https://www.moneysavingexpert.com/savings/savings-accounts-best-interest/",
    productHint: "UK savings market best buys",
    sourceKind: "best_buy_page",
    sourceRole: "discovery",
    enabled: false,
    notes: COMPARISON_SOURCE_NOTE,
  },
  {
    providerName: "Moneyfacts",
    sourceUrl: "https://moneyfactscompare.co.uk/savings-accounts/",
    productHint: "UK savings market comparison",
    sourceKind: "best_buy_page",
    sourceRole: "discovery",
    enabled: false,
    notes: COMPARISON_SOURCE_NOTE,
  },
  {
    providerName: "Savings Champion",
    sourceUrl: "https://savingschampion.co.uk/best-buys",
    productHint: "UK savings market best buys",
    sourceKind: "best_buy_page",
    sourceRole: "corroboration",
    enabled: false,
    notes: COMPARISON_SOURCE_NOTE,
  },
  {
    providerName: "NS&I",
    sourceUrl: "https://www.nsandi.com/products",
    productHint: "NS&I savings products",
    sourceKind: "provider_product_page",
  },
  {
    providerName: "Nationwide Building Society",
    sourceUrl: "https://www.nationwide.co.uk/savings/",
    productHint: "Savings account rates",
    sourceKind: "provider_rate_table",
  },
  {
    providerName: "NatWest",
    sourceUrl: "https://www.natwest.com/savings.html",
    productHint: "Savings account rates",
    sourceKind: "provider_product_page",
  },
  {
    providerName: "First Direct",
    sourceUrl: "https://www.firstdirect.com/savings-and-investments/savings/",
    productHint: "Savings account rates",
    sourceKind: "provider_product_page",
  },
  {
    providerName: "Revolut",
    sourceUrl: "https://www.revolut.com/savings/",
    productHint: "Savings account",
    sourceKind: "provider_product_page",
  },
  {
    providerName: "Monzo",
    sourceUrl: "https://monzo.com/savings/",
    productHint: "Savings pots and partner accounts",
    sourceKind: "provider_product_page",
  },
  {
    providerName: "Starling Bank",
    sourceUrl: "https://www.starlingbank.com/current-account/saving-spaces/",
    productHint: "Saving Spaces",
    sourceKind: "provider_product_page",
  },
  {
    providerName: "Chase",
    sourceUrl: "https://www.chase.co.uk/gb/en/product/chase-saver-account/",
    productHint: "Chase saver account",
    sourceKind: "provider_product_page",
  },
  {
    providerName: "Marcus by Goldman Sachs",
    sourceUrl: "https://www.marcus.co.uk/uk/en/savings",
    productHint: "Savings account rates",
    sourceKind: "provider_product_page",
  },
  {
    providerName: "Zopa",
    sourceUrl: "https://www.zopa.com/savings",
    productHint: "Savings account rates",
    sourceKind: "provider_product_page",
  },
  {
    providerName: "Chip",
    sourceUrl: "https://www.getchip.uk/savings",
    productHint: "Savings account rates",
    sourceKind: "provider_product_page",
  },
  {
    providerName: "Moneybox",
    sourceUrl: "https://www.moneyboxapp.com/savings/",
    productHint: "Savings and cash ISA rates",
    sourceKind: "provider_product_page",
  },
  {
    providerName: "Plum",
    sourceUrl: "https://withplum.com/savings",
    productHint: "Savings account rates",
    sourceKind: "provider_product_page",
  },
  ...[
    ["Coventry Building Society", "https://www.coventrybuildingsociety.co.uk/member/savings.html"],
    ["Skipton Building Society", "https://www.skipton.co.uk/savings"],
    ["Leeds Building Society", "https://www.leedsbuildingsociety.co.uk/savings/"],
    ["Yorkshire Building Society", "https://www.ybs.co.uk/savings"],
    ["Principality Building Society", "https://www.principality.co.uk/savings"],
    ["Newcastle Building Society", "https://www.newcastle.co.uk/savings"],
    ["Paragon Bank", "https://www.paragonbank.co.uk/savings"],
    ["Shawbrook Bank", "https://www.shawbrook.co.uk/direct/savings/"],
    ["Atom Bank", "https://www.atombank.co.uk/savings/"],
    ["Tandem Bank", "https://www.tandem.co.uk/savings"],
    ["Aldermore", "https://www.aldermore.co.uk/personal/savings-accounts/"],
    ["Cynergy Bank", "https://www.cynergybank.co.uk/personal-savings/"],
    ["Ford Money", "https://www.fordmoney.co.uk/savings-products"],
    ["OakNorth", "https://www.oaknorth.co.uk/personal-savings/"],
    ["Santander", "https://www.santander.co.uk/personal/savings-and-investments/savings"],
    ["Barclays", "https://www.barclays.co.uk/savings/"],
    ["Lloyds Bank", "https://www.lloydsbank.com/savings.html"],
    ["Halifax", "https://www.halifax.co.uk/savings.html"],
    ["HSBC", "https://www.hsbc.co.uk/savings/products/"],
    ["TSB", "https://www.tsb.co.uk/savings/"],
    ["Virgin Money", "https://uk.virginmoney.com/savings/"],
    ["Tesco Bank", "https://www.tescobank.com/savings/"],
    ["Sainsbury's Bank", "https://www.sainsburysbank.co.uk/savings"],
    ["Post Office", "https://www.postoffice.co.uk/savings-accounts"],
    ["Kroo", "https://www.kroo.com/current-account"],
    ["RCI Bank", "https://www.rcibank.co.uk/savings/"],
    ["Raisin", "https://www.raisin.co.uk/savings-accounts/"],
    ["Investec", "https://www.investec.com/en_gb/savings-accounts.html"],
    ["Close Brothers", "https://www.closebrothersam.com/savings/"],
    ["Hampshire Trust Bank", "https://www.htb.co.uk/savings/"],
    ["Gatehouse Bank", "https://gatehousebank.com/personal/savings"],
    ["Al Rayan Bank", "https://www.alrayanbank.co.uk/savings"],
    ["UBL UK", "https://www.ubluk.com/personal/savings/"],
    ["Charter Savings Bank", "https://www.chartersavingsbank.co.uk/"],
    ["Hodge Bank", "https://hodgebank.co.uk/savings/"],
    ["Kent Reliance", "https://www.kentreliance.co.uk/savings"],
    ["Family Building Society", "https://www.familybuildingsociety.co.uk/savings"],
    ["Saffron Building Society", "https://www.saffronbs.co.uk/savings"],
    ["Nottingham Building Society", "https://www.thenottingham.com/savings/"],
  ].map(([providerName, sourceUrl]) => ({
    providerName,
    sourceUrl,
    productHint: "Savings account rates",
    sourceKind: "provider_product_page" as const,
  })),

  // ADD NEW SAVINGS SOURCES ABOVE THIS LINE.
]);

/**
 * Coverage universe, not scrape targets.
 *
 * Keep names here even when a provider has no reliable public endpoint. The
 * admin/cron health report can then distinguish "page failed" from "provider
 * not covered at all". Add a verified source object above when one is found.
 */
export const EXPECTED_SAVINGS_PROVIDER_UNIVERSE = [
  "Access Bank UK",
  "Al Rayan Bank",
  "Aldermore",
  "Atom Bank",
  "Bank of Scotland",
  "Barclays",
  "Bath Building Society",
  "Beverley Building Society",
  "BLME",
  "Buckinghamshire Building Society",
  "Cambridge Building Society",
  "Charter Savings Bank",
  "Chase",
  "Chip",
  "Chorley Building Society",
  "Close Brothers",
  "Co-operative Bank",
  "Coventry Building Society",
  "Cumberland Building Society",
  "Cynergy Bank",
  "Darlington Building Society",
  "DF Capital",
  "Dudley Building Society",
  "Ecology Building Society",
  "Family Building Society",
  "First Direct",
  "Ford Money",
  "Furness Building Society",
  "Gatehouse Bank",
  "Halifax",
  "Hampshire Trust Bank",
  "Hanley Economic Building Society",
  "Harpenden Building Society",
  "Hinckley & Rugby Building Society",
  "Hodge Bank",
  "HSBC",
  "Ikano Bank",
  "Investec",
  "Kent Reliance",
  "Kroo",
  "Leeds Building Society",
  "Leek Building Society",
  "Lloyds Bank",
  "Loughborough Building Society",
  "Marcus by Goldman Sachs",
  "Market Harborough Building Society",
  "Marsden Building Society",
  "Melton Building Society",
  "Monmouthshire Building Society",
  "Monument Bank",
  "Moneybox",
  "Monzo",
  "National Counties Building Society",
  "Nationwide Building Society",
  "NatWest",
  "Newbury Building Society",
  "Newcastle Building Society",
  "Nottingham Building Society",
  "NS&I",
  "OakNorth",
  "Oxbury Bank",
  "Paragon Bank",
  "Penrith Building Society",
  "Plum",
  "Post Office",
  "Principality Building Society",
  "Progressive Building Society",
  "Raisin",
  "RCI Bank",
  "Revolut",
  "Royal Bank of Scotland",
  "Saffron Building Society",
  "Sainsbury's Bank",
  "Santander",
  "Scottish Building Society",
  "Secure Trust Bank",
  "Shawbrook Bank",
  "Skipton Building Society",
  "SmartSave",
  "Starling Bank",
  "Tandem Bank",
  "Teachers Building Society",
  "Tesco Bank",
  "Tipton & Coseley Building Society",
  "TSB",
  "UBL UK",
  "Ulster Bank",
  "United Trust Bank",
  "Vanquis Bank",
  "Vernon Building Society",
  "Virgin Money",
  "West Bromwich Building Society",
  "Yorkshire Building Society",
  "Zopa",
] as const;

export const EXPECTED_MORTGAGE_LENDER_UNIVERSE = [
  "Accord Mortgages",
  "Aldermore",
  "Atom Bank",
  "Bank of Ireland UK",
  "Barclays",
  "Bluestone Mortgages",
  "Cambridge Building Society",
  "Clydesdale Bank",
  "Co-operative Bank",
  "Coventry Building Society",
  "Cumberland Building Society",
  "Family Building Society",
  "First Direct",
  "Foundation Home Loans",
  "Furness Building Society",
  "Gen H",
  "Halifax",
  "HSBC",
  "Kensington Mortgages",
  "Leeds Building Society",
  "LendInvest",
  "Lloyds Bank",
  "Mansfield Building Society",
  "Market Harborough Building Society",
  "Marsden Building Society",
  "Melton Building Society",
  "Metro Bank",
  "Molo",
  "MPowered Mortgages",
  "Nationwide Building Society",
  "NatWest",
  "Newcastle Building Society",
  "Nottingham Building Society",
  "Paragon Bank",
  "Pepper Money",
  "Platform",
  "Precise Mortgages",
  "Principality Building Society",
  "Progressive Building Society",
  "Santander",
  "Scottish Building Society",
  "Scottish Widows Bank",
  "Skipton Building Society",
  "Teachers Building Society",
  "The Mortgage Lender",
  "Tipton & Coseley Building Society",
  "TSB",
  "Vida Homeloans",
  "Virgin Money",
  "West Bromwich Building Society",
  "Yorkshire Building Society",
] as const;

function sourceIdentityNames(source: { lenderName?: string; providerName?: string; aliases?: string[] }) {
  return [source.lenderName, source.providerName, ...(source.aliases || [])]
    .filter(Boolean)
    .map((name) => normaliseProviderSlug(String(name)));
}

export function getDefaultSourceCoverageReport() {
  const activeSavingsNames = new Set(
    defaultSavingsSources.filter((source) => source.enabled).flatMap(sourceIdentityNames),
  );
  const activeMortgageNames = new Set(
    defaultMortgageSources.filter((source) => source.enabled).flatMap(sourceIdentityNames),
  );
  const missingSavingsProviders = EXPECTED_SAVINGS_PROVIDER_UNIVERSE.filter(
    (name) => !activeSavingsNames.has(normaliseProviderSlug(name)),
  );
  const missingMortgageLenders = EXPECTED_MORTGAGE_LENDER_UNIVERSE.filter(
    (name) => !activeMortgageNames.has(normaliseProviderSlug(name)),
  );

  return {
    coverage_mode: RATE_SOURCE_POLICY.coverageMode,
    savings: {
      expected: EXPECTED_SAVINGS_PROVIDER_UNIVERSE.length,
      covered: EXPECTED_SAVINGS_PROVIDER_UNIVERSE.length - missingSavingsProviders.length,
      coverage_percent: Math.round(
        ((EXPECTED_SAVINGS_PROVIDER_UNIVERSE.length - missingSavingsProviders.length) /
          EXPECTED_SAVINGS_PROVIDER_UNIVERSE.length) *
          100,
      ),
      missing: missingSavingsProviders,
    },
    mortgages: {
      expected: EXPECTED_MORTGAGE_LENDER_UNIVERSE.length,
      covered: EXPECTED_MORTGAGE_LENDER_UNIVERSE.length - missingMortgageLenders.length,
      coverage_percent: Math.round(
        ((EXPECTED_MORTGAGE_LENDER_UNIVERSE.length - missingMortgageLenders.length) /
          EXPECTED_MORTGAGE_LENDER_UNIVERSE.length) *
          100,
      ),
      missing: missingMortgageLenders,
    },
  };
}

function validateSourceUrl(sourceUrl: string, label: string) {
  let parsed: URL;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    throw new Error(`${label} has an invalid source URL: ${sourceUrl}`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`${label} must use an HTTPS source URL: ${sourceUrl}`);
  }
  return parsed.toString();
}

function assertNoDuplicateSources(
  sources: Array<{ name: string; sourceUrl: string }>,
  catalogueName: string,
) {
  const seen = new Set<string>();
  for (const source of sources) {
    const key = `${normaliseProviderSlug(source.name)}|${source.sourceUrl}`;
    if (seen.has(key)) {
      throw new Error(`Duplicate ${catalogueName} source: ${source.name} ${source.sourceUrl}`);
    }
    seen.add(key);
  }
}

function expandSourceUrls<T extends BaseSource>(source: T): T[] {
  return [source.sourceUrl, ...(source.fallbackUrls || [])].map((sourceUrl, index) => ({
    ...source,
    sourceUrl,
    fallbackUrls: [],
    notes:
      index === 0
        ? source.notes
        : `${source.notes || OFFICIAL_SOURCE_NOTE} Alternate official endpoint ${index}.`,
  }));
}

/**
 * Upserts this file into Supabase before a full rate-catalogue run.
 * Existing database rows not represented here are left untouched, so adding a
 * source in Admin is safe. Set enabled: false in this file to pause a managed
 * source deliberately.
 */
export async function ensureDefaultSourceUniverse(supabase: any) {
  const mortgageSeedSources = defaultMortgageSources.flatMap(expandSourceUrls);
  const savingsSeedSources = defaultSavingsSources.flatMap(expandSourceUrls);

  assertNoDuplicateSources(
    mortgageSeedSources.map((source) => ({ name: source.lenderName, sourceUrl: source.sourceUrl })),
    "mortgage",
  );
  assertNoDuplicateSources(
    savingsSeedSources.map((source) => ({ name: source.providerName, sourceUrl: source.sourceUrl })),
    "savings",
  );

  const updatedAt = new Date().toISOString();
  const mortgageRows = mortgageSeedSources.map((source) => ({
    lender_slug: normaliseProviderSlug(source.lenderName),
    lender_name: source.lenderName,
    source_url: validateSourceUrl(source.sourceUrl, source.lenderName),
    source_kind: source.sourceKind,
    status: source.enabled === false || source.sourceRole !== "primary" ? "paused" : "active",
    notes: source.notes || null,
    check_frequency_hours: Math.max(1, source.checkFrequencyHours ?? 12),
    payload: {
      managedBy: "default-source-catalogue.ts",
      sourceRole: source.sourceRole,
      parserStrategy: source.parserStrategy,
      aiEligible: source.aiEligible,
      productTypes: source.productTypes,
      aliases: source.aliases,
      coverageMode: RATE_SOURCE_POLICY.coverageMode,
      webSearchEnabled: false,
    },
    updated_at: updatedAt,
  }));
  const savingsRows = savingsSeedSources.map((source) => ({
    provider_slug: normaliseProviderSlug(source.providerName),
    provider_name: source.providerName,
    source_url: validateSourceUrl(source.sourceUrl, source.providerName),
    source_kind: source.sourceKind,
    product_hint: source.productHint || null,
    status: source.enabled === false || source.sourceRole !== "primary" ? "paused" : "active",
    notes: source.notes || null,
    check_frequency_hours: Math.max(1, source.checkFrequencyHours ?? 12),
    payload: {
      managedBy: "default-source-catalogue.ts",
      sourceRole: source.sourceRole,
      parserStrategy: source.parserStrategy,
      aiEligible: source.aiEligible,
      productTypes: source.productTypes,
      aliases: source.aliases,
      coverageMode: RATE_SOURCE_POLICY.coverageMode,
      webSearchEnabled: false,
    },
    updated_at: updatedAt,
  }));

  const mortgage = await supabase
    .from("mortgage_lender_sources")
    .upsert(mortgageRows, { onConflict: "lender_slug,source_url" });
  if (mortgage.error) throw new Error(mortgage.error.message);

  const savings = await supabase
    .from("savings_rate_sources")
    .upsert(savingsRows, { onConflict: "provider_slug,source_url" });
  if (savings.error) throw new Error(savings.error.message);

  return {
    mortgage_sources: mortgageRows.length,
    mortgage_active: mortgageRows.filter((source) => source.status === "active").length,
    savings_sources: savingsRows.length,
    savings_active: savingsRows.filter((source) => source.status === "active").length,
    coverage: getDefaultSourceCoverageReport(),
    ai_extraction_enabled: RATE_SOURCE_POLICY.aiExtraction.enabled,
    web_search_enabled: RATE_SOURCE_POLICY.webSearchEnabled,
  };
}
