import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { calculateMonthlyMortgagePayment } from "@/lib/calculations/mortgage";
import { calculateStampDutyEngland } from "@/lib/calculations/property";
import { normaliseProviderSlug } from "@/lib/wealth/provider-normalise";

export type ParsedSavingsDeal = {
  providerSlug: string;
  providerName: string;
  productName: string;
  accountType: string;
  grossAer: number | null;
  bonusRate?: number | null;
  minimumBalance?: number | null;
  maximumBalance?: number | null;
  monthlyMaxDeposit?: number | null;
  monthlyMinDeposit?: number | null;
  accessType?: string | null;
  withdrawalRules?: string | null;
  noticePeriodDays?: number | null;
  termLengthMonths?: number | null;
  rateType?: string | null;
  requiresExistingCustomer: boolean;
  eligibilityNote: string | null;
  sourceUrl: string;
  confidence: number;
  summary: string;
};

export type ParsedMortgageDeal = {
  lenderSlug: string;
  lenderName: string;
  productName: string;
  rateType: string;
  initialTermMonths: number | null;
  ltvMax: number | null;
  ltvMin: number | null;
  ratePercent: number | null;
  productFee: number | null;
  existingCustomerOnly: boolean;
  newCustomerAvailable: boolean;
  sourceUrl: string;
  confidence: number;
  summary: string;
};

export type ParsedMoveListing = {
  title: string;
  cleanTitle: string;
  askingPrice: number | null;
  postcode: string | null;
  addressHint: string | null;
  bedrooms: number | null;
  councilTaxBand: string | null;
  councilTaxBandConfidence: number | null;
  epcRating: string | null;
  imageUrl: string | null;
  sourceConfidence: number;
  sourceStatus: "url_ingested" | "url_partial" | "manual_price";
  sourceSummary: string;
};

const fetchTimeoutMs = 12_000;
const maxSourceBytes = 800_000;

export class SourceFetchError extends Error {
  readonly httpStatus: number | null;
  readonly failureClass: "blocked" | "not_found" | "rate_limited" | "timeout" | "network" | "invalid_source" | "unsupported_content";
  readonly retryable: boolean;

  constructor(message: string, options: { httpStatus?: number | null; failureClass: SourceFetchError["failureClass"]; retryable: boolean }) {
    super(message);
    this.name = "SourceFetchError";
    this.httpStatus = options.httpStatus ?? null;
    this.failureClass = options.failureClass;
    this.retryable = options.retryable;
  }
}

function assertSafeSourceUrl(url: string) {
  const safeUrl = new URL(url);
  if (!["http:", "https:"].includes(safeUrl.protocol)) {
    throw new SourceFetchError("Only http/https source URLs can be checked.", { failureClass: "invalid_source", retryable: false });
  }
  const hostname = safeUrl.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const privateIpv4 = /^(?:10\.|127\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/;
  const privateIpv6 = /^(?:::1|fc|fd|fe80:)/i;
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || (isIP(hostname) === 4 && privateIpv4.test(hostname)) || (isIP(hostname) === 6 && privateIpv6.test(hostname))) {
    throw new SourceFetchError("Private or local source addresses cannot be checked.", { failureClass: "invalid_source", retryable: false });
  }
  return safeUrl;
}

async function readBoundedText(response: Response) {
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > maxSourceBytes) {
    throw new SourceFetchError(`Source response exceeds ${maxSourceBytes} bytes`, { httpStatus: response.status, failureClass: "unsupported_content", retryable: false });
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let output = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxSourceBytes) {
      await reader.cancel();
      throw new SourceFetchError(`Source response exceeds ${maxSourceBytes} bytes`, { httpStatus: response.status, failureClass: "unsupported_content", retryable: false });
    }
    output += decoder.decode(value, { stream: true });
  }
  return output + decoder.decode();
}

export async function fetchSourceText(url: string, options: { etag?: string | null; lastModified?: string | null } = {}) {
  const safeUrl = assertSafeSourceUrl(url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), fetchTimeoutMs);
  try {
    const response = await fetch(safeUrl.toString(), {
      headers: {
        "user-agent": "LOOP Wealth Watch source check/1.0 (+admin initiated)",
        accept: "text/html,application/xhtml+xml,application/json,text/plain;q=0.8,*/*;q=0.5",
        ...(options.etag ? { "if-none-match": options.etag } : {}),
        ...(options.lastModified ? { "if-modified-since": options.lastModified } : {}),
      },
      signal: controller.signal,
      cache: "no-store",
      redirect: "follow",
    });
    if (response.status === 304) {
      return {
        url: response.url || safeUrl.toString(),
        contentType: response.headers.get("content-type") || "",
        rawText: "",
        text: "",
        contentHash: null as string | null,
        etag: response.headers.get("etag") || options.etag || null,
        lastModified: response.headers.get("last-modified") || options.lastModified || null,
        httpStatus: 304,
        notModified: true,
      };
    }
    if (!response.ok) {
      const failureClass = response.status === 403 ? "blocked" : response.status === 404 ? "not_found" : response.status === 429 ? "rate_limited" : "network";
      throw new SourceFetchError(`Source returned ${response.status}`, {
        httpStatus: response.status,
        failureClass,
        retryable: response.status === 403 || response.status === 408 || response.status === 429 || response.status >= 500,
      });
    }
    const contentType = response.headers.get("content-type") || "";
    if (contentType && !/(?:html|json|text|xml|xhtml)/i.test(contentType)) {
      throw new SourceFetchError(`Unsupported source content type: ${contentType}`, { httpStatus: response.status, failureClass: "unsupported_content", retryable: false });
    }
    const rawText = await readBoundedText(response);
    const contentHash = createHash("sha256").update(rawText).digest("hex");
    return {
      url: response.url || safeUrl.toString(),
      contentType,
      rawText: rawText.slice(0, 600_000),
      text: stripHtml(rawText).slice(0, 250_000),
      contentHash,
      etag: response.headers.get("etag"),
      lastModified: response.headers.get("last-modified"),
      httpStatus: response.status,
      notModified: false,
    };
  } catch (error) {
    if (error instanceof SourceFetchError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new SourceFetchError(`Source timed out after ${fetchTimeoutMs}ms`, { failureClass: "timeout", retryable: true });
    }
    throw new SourceFetchError(error instanceof Error ? error.message : "Source fetch failed", { failureClass: "network", retryable: true });
  } finally {
    clearTimeout(timeout);
  }
}

function stripHtml(input: string) {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function firstRate(text: string) {
  const labelled = Array.from(text.matchAll(/(\d{1,2}(?:\.\d{1,3})?)\s*%\s*(?:AER|gross|tax[- ]free)/gi))
    .map((match) => Number(match[1]))
    .filter((value) => value > 0 && value < 25);
  if (labelled.length) return labelled[0];
  const matches = Array.from(text.matchAll(/(\d{1,2}(?:\.\d{1,3})?)\s*%/g))
    .map((match) => Number(match[1]))
    .filter((value) => value > 0 && value < 25);
  return matches[0] ?? null;
}

function firstMoney(text: string) {
  const match = text.match(/£\s?([0-9][0-9,]*(?:\.\d{1,2})?)/);
  if (!match) return null;
  return Number(match[1].replace(/,/g, ""));
}


function firstBalanceAround(text: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return Number(String(match[1]).replace(/,/g, ""));
  }
  return null;
}

function inferSavingsAccessType(text: string) {
  const lower = text.toLowerCase();
  if (/regular saver|monthly saver/.test(lower)) return "regular_saver";
  if (/notice account|notice period|\b\d{2,3}\s*day\s*notice/.test(lower)) return "notice";
  if (/fixed rate|fixed term|bond|maturity|term deposit/.test(lower)) return "fixed_term";
  if (/cash isa|isa/.test(lower)) return "cash_isa";
  if (/easy access|instant access|access any time|unlimited withdrawal/.test(lower)) return "easy_access";
  return "savings";
}

function inferSavingsRateType(text: string) {
  const lower = text.toLowerCase();
  if (/fixed rate|fixed\s*(?:aer|gross)|rate fixed/.test(lower)) return "fixed";
  if (/tracker|tracks/.test(lower)) return "tracker";
  if (/variable|rate can change|may change/.test(lower)) return "variable";
  return null;
}

function inferNoticeDays(text: string) {
  const match = text.match(/(\d{1,3})\s*(?:calendar\s*)?days?\s*notice/i);
  return match ? Number(match[1]) : null;
}

function inferTermMonths(text: string) {
  const lower = text.toLowerCase();
  const months = lower.match(/(\d{1,3})\s*(?:month|mth)/i);
  if (months) return Number(months[1]);
  const years = lower.match(/(1|2|3|4|5)\s*(?:year|yr)[-\s]*(?:fixed|bond|term|saver|account)?/i);
  if (years) return Number(years[1]) * 12;
  return null;
}

function inferWithdrawalRules(text: string) {
  const windows = Array.from(text.matchAll(/(?:withdrawal|withdraw|access|notice|penalt|closure|maturity|easy access)[^.]{0,220}/gi)).map((m) => m[0].replace(/\s+/g, " ").trim());
  const useful = windows.find((window) => /withdraw|access|notice|penalt|maturity|closure/i.test(window));
  if (useful) return useful.slice(0, 260);
  if (/unlimited withdrawals/i.test(text)) return "Unlimited withdrawals detected. Admin should confirm.";
  if (/no withdrawals/i.test(text)) return "No withdrawals detected before maturity. Admin should confirm.";
  return null;
}

function firstLtv(text: string) {
  const matches = Array.from(text.matchAll(/(\d{2,3})\s*%\s*LTV/gi))
    .map((match) => Number(match[1]))
    .filter((value) => value > 0 && value <= 100);
  return matches.length ? Math.max(...matches) : null;
}

function firstTermMonths(text: string) {
  const years = text.match(/(2|3|5|10)\s*(?:year|yr)[-\s]*(?:fixed|fix)/i);
  if (years) return Number(years[1]) * 12;
  const months = text.match(/(24|36|60|120)\s*month/i);
  return months ? Number(months[1]) : null;
}

function decodeHtmlEntities(input: string) {
  return input
    .replace(/&quot;/gi, '"')
    .replace(/&#x27;/gi, "'")
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/&nbsp;/gi, " ")
    .replace(/&pound;/gi, "£")
    .replace(/\u0026/g, "&")
    .replace(/\u002F/g, "/")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanMoveListingTitle(input: string, postcode?: string | null) {
  let value = decodeHtmlEntities(input || "")
    .replace(/\s*[|\-–—]\s*(Rightmove|Zoopla|OnTheMarket|PrimeLocation).*$/i, "")
    .replace(/\s*Skip to content\s*!?.*$/i, "")
    .replace(/\s*It appears that JavaScript is disabled.*$/i, "")
    .replace(/\s*Marketed by.*$/i, "")
    .replace(/\s*Read full description.*$/i, "")
    .trim();

  const saleMatch = value.match(/(?:for sale|for rent)\s+in\s+(.+)$/i);
  if (saleMatch?.[1]) value = saleMatch[1].trim();
  value = value
    .replace(/^\d+\s+bedroom\s+(?:detached|semi-detached|terraced|end of terrace|house|flat|bungalow|property)\s+(?:house|property|flat|bungalow)?\s*/i, "")
    .replace(/^\d+\s+bed(?:s|room)?\s*/i, "")
    .replace(/^for sale\s+in\s+/i, "")
    .replace(/\bWA\d[A-Z]?\s?\d[A-Z]{2}\b.*$/i, (match) => postcode ? postcode.toUpperCase() : match)
    .replace(/\s+/g, " ")
    .trim();
  if (/javascript is disabled|skip to content|cookie|privacy/i.test(value)) value = "";
  return value.slice(0, 140) || "Move search";
}

function normaliseCouncilBand(value: string | undefined | null) {
  const band = String(value || "").trim().toUpperCase();
  return /^[A-H]$/.test(band) ? band : null;
}

const councilBandRatios: Record<string, number> = {
  A: 6 / 9,
  B: 7 / 9,
  C: 8 / 9,
  D: 1,
  E: 11 / 9,
  F: 13 / 9,
  G: 15 / 9,
  H: 18 / 9,
};

const knownCouncilBandDAnnual: Record<string, { authority: string; annual: number; sourceUrl: string; confidence: number }> = {
  warrington: {
    authority: "Warrington Borough Council",
    annual: 2448,
    sourceUrl: "https://www.warrington.gov.uk/council-tax-bands-and-charges",
    confidence: 86,
  },
};

export function estimateCouncilTaxAnnual(input: { band?: string | null; authority?: string | null }) {
  const band = normaliseCouncilBand(input.band);
  if (!band) return { annual: null as number | null, confidence: 0, sourceUrl: null as string | null, authority: input.authority || null };
  const key = String(input.authority || "").toLowerCase();
  const matched = Object.entries(knownCouncilBandDAnnual).find(([slug, row]) => key.includes(slug) || row.authority.toLowerCase().includes(key));
  const profile = matched?.[1];
  const bandD = profile?.annual ?? 2392; // England average Band D fallback until local council row is added.
  return {
    annual: Math.round(bandD * councilBandRatios[band]),
    confidence: profile ? profile.confidence : 55,
    sourceUrl: profile?.sourceUrl ?? null,
    authority: profile?.authority ?? input.authority ?? null,
  };
}

function titleFromSource(text: string, fallback: string, rawText?: string) {
  const rawCandidates = rawText
    ? [
        rawText.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1],
        rawText.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i)?.[1],
        rawText.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1],
        rawText.match(/"displayAddress"\s*:\s*"([^"]+)"/i)?.[1],
        rawText.match(/"address"\s*:\s*"([^"]+)"/i)?.[1],
      ].filter(Boolean) as string[]
    : [];
  const textCandidates = [
    text.match(/((?:\d+\s+)?bedroom[^£]{8,160}?(?:for sale|for rent)[^£]{0,120})/i)?.[1],
    text.match(/([A-Z][A-Za-z'\- ]+\s(?:Road|Street|Close|Lane|Avenue|Drive|Way|Crescent|Gardens|Brook|Rise|Place|Court|Grove|Mews)[^£]{0,100})/i)?.[1],
    text.slice(0, 180),
  ].filter(Boolean) as string[];
  const candidate = [...rawCandidates, ...textCandidates]
    .map((value) => cleanMoveListingTitle(String(value)))
    .find((value) => value.length >= 8 && !/javascript is disabled|skip to content|cookie|privacy/i.test(value));
  return (candidate || fallback).slice(0, 180).trim();
}

function extractImageUrl(rawText: string | undefined, sourceUrl: string) {
  if (!rawText) return null;
  const candidates = [
    rawText.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1],
    rawText.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)?.[1],
    rawText.match(/"propertyImages"\s*:\s*\{[\s\S]{0,5000}?"url"\s*:\s*"([^"]+)"/i)?.[1],
    rawText.match(/"mainImage"\s*:\s*"([^"]+)"/i)?.[1],
    rawText.match(/"image"\s*:\s*"(https?:\\?\/\\?\/[^"\\]+)"/i)?.[1],
  ].filter(Boolean) as string[];
  for (const candidate of candidates) {
    try {
      const decoded = decodeHtmlEntities(candidate).replace(/\\\//g, "/");
      return new URL(decoded, sourceUrl).toString();
    } catch {
      continue;
    }
  }
  return null;
}

function extractCouncilTaxBand(text: string, rawText?: string) {
  const combined = decodeHtmlEntities(stripHtml(`${rawText || ""} ${text}`));
  const rawCombined = decodeHtmlEntities(`${rawText || ""} ${text}`);
  const structuredPatterns = [
    /"councilTaxBand"\s*:\s*"?([A-H])"?/i,
    /"council_tax_band"\s*:\s*"?([A-H])"?/i,
    /"councilTax"\s*:\s*\{[\s\S]{0,260}?"band"\s*:\s*"?([A-H])"?/i,
    /"councilTax"\s*:\s*"Band\s*([A-H])"/i,
  ];
  for (const pattern of structuredPatterns) {
    const match = rawCombined.match(pattern);
    const band = normaliseCouncilBand(match?.[1]);
    if (band) return { band, confidence: 99 };
  }

  const visibleWindows = Array.from(combined.matchAll(/Council\s*Tax[\s\S]{0,220}/gi)).map((match) => match[0]);
  for (const window of visibleWindows) {
    const explicit = window.match(/\bBand\s*[:\-]?\s*([A-H])\b/i) || window.match(/\bCouncil\s*Tax\s*[:\-]?\s*([A-H])\b/i);
    const band = normaliseCouncilBand(explicit?.[1]);
    if (band && !/ask agent|not known|tbc/i.test(window)) return { band, confidence: 97 };
  }

  // Last-resort visible text pattern. Kept deliberately strict so "Accessibility: Ask agent" cannot become Band A.
  const strict = combined.match(/Council\s*Tax\s*Band\s*[:\-]?\s*([A-H])\b/i);
  const strictBand = normaliseCouncilBand(strict?.[1]);
  if (strictBand) return { band: strictBand, confidence: 96 };

  return { band: null as string | null, confidence: null as number | null };
}

function extractEpcRating(text: string, rawText?: string) {
  const combined = `${rawText || ""} ${text}`;
  const patterns = [
    /"epcRating"\s*:\s*"?([A-G])"?/i,
    /"epc_rating"\s*:\s*"?([A-G])"?/i,
    /EPC[\s\S]{0,60}?(?:rating|current)?\s*[:\-]?\s*([A-G])\b/i,
  ];
  for (const pattern of patterns) {
    const match = combined.match(pattern);
    if (match?.[1]) return match[1].toUpperCase();
  }
  return null;
}

function extractAddressHint(text: string, rawText: string | undefined, postcode: string | null, title: string) {
  const rawAddress = rawText?.match(/"displayAddress"\s*:\s*"([^"]+)"/i)?.[1]
    || rawText?.match(/"address"\s*:\s*"([^"]+)"/i)?.[1]
    || rawText?.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1]
    || null;
  const decodedRaw = rawAddress ? cleanMoveListingTitle(rawAddress, postcode) : null;
  const titleWithoutSale = cleanMoveListingTitle(title, postcode);
  if (decodedRaw && decodedRaw.length >= 6) return decodedRaw.slice(0, 160);
  if (titleWithoutSale && !/javascript|skip to content/i.test(titleWithoutSale)) return titleWithoutSale.slice(0, 160);
  return postcode ? `Near ${postcode.toUpperCase()}` : null;
}


const knownSavingsProviderNames = [
  "Moneybox", "Chip", "Plum", "Zopa", "Atom Bank", "Tandem Bank", "Shawbrook Bank", "Paragon Bank", "OakNorth", "Aldermore",
  "Cynergy Bank", "Ford Money", "Marcus", "Chase", "Monzo", "Starling Bank", "Revolut", "Nationwide", "NatWest", "First Direct",
  "HSBC", "Barclays", "Santander", "Lloyds Bank", "Halifax", "TSB", "Virgin Money", "Coventry Building Society", "Skipton Building Society",
  "Leeds Building Society", "Yorkshire Building Society", "Principality Building Society", "Newcastle Building Society", "Nottingham Building Society",
  "Saffron Building Society", "Family Building Society", "Kent Reliance", "RCI Bank", "Raisin", "Investec", "Close Brothers", "Hampshire Trust Bank",
  "Gatehouse Bank", "Al Rayan Bank", "UBL UK", "Post Office", "Tesco Bank", "Sainsbury's Bank", "NS&I",
];

function inferProviderNameFromWindow(window: string, fallback: string) {
  const normalised = window.replace(/\s+/g, " ");
  const exact = knownSavingsProviderNames.find((provider) => new RegExp(`\\b${provider.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(normalised));
  if (exact) return exact;
  const beforeProduct = normalised.match(/(?:^|[.;:])\s*([A-Z][A-Za-z'&. -]{2,52})\s+(?:Easy Access|Fixed Rate|Regular Saver|Cash ISA|Notice|Saver|Savings|Bond)/);
  const candidate = beforeProduct?.[1]?.trim();
  if (candidate && !/best|top|rate|account|savings|compare|open|apply/i.test(candidate)) return candidate.slice(0, 80);
  return fallback;
}

function inferProductNameFromWindow(window: string, fallback: string) {
  const normalised = window.replace(/\s+/g, " ").trim();
  const productPatterns = [
    /([A-Z][A-Za-z0-9'&. +\/-]{2,90}(?:Easy Access|Instant Access|Regular Saver|Monthly Saver|Cash ISA|Fixed Rate ISA|Fixed Rate Bond|Notice Account|Notice Saver|Savings Account|Saver|Bond|ISA))/,
    /((?:Easy Access|Instant Access|Regular Saver|Monthly Saver|Cash ISA|Fixed Rate ISA|Fixed Rate Bond|Notice Account|Notice Saver|Savings Account|Saver|Bond|ISA)[A-Za-z0-9'&. +\/-]{0,90})/i,
  ];
  for (const pattern of productPatterns) {
    const match = normalised.match(pattern);
    const candidate = match?.[1]
      ?.replace(/\b(?:AER|Gross|variable|fixed|interest|rate|earn|up to)\b.*$/i, "")
      .replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9)]+$/g, "")
      .trim();
    if (candidate && candidate.length >= 6) return candidate.slice(0, 160);
  }
  return fallback;
}

function rateWindows(text: string) {
  const matches = Array.from(text.matchAll(/(\d{1,2}(?:\.\d{1,3})?)\s*%\s*(?:AER|gross|variable|fixed|tax-free)?/gi))
    .map((match) => ({ rate: Number(match[1]), index: match.index || 0 }))
    .filter((item) => item.rate > 0 && item.rate < 25);
  const candidates = matches.slice(0, 60);
  return candidates.map((match, index) => {
    // Split midway between adjacent rates. A wide fixed window lets one product's
    // access rules/deposit cap leak into the next product on comparison tables.
    const previous = candidates[index - 1];
    const next = candidates[index + 1];
    const start = previous ? Math.floor((previous.index + match.index) / 2) : Math.max(0, match.index - 520);
    const end = next ? Math.floor((match.index + next.index) / 2) : Math.min(text.length, match.index + 980);
    return { ...match, window: text.slice(start, end).replace(/\s+/g, " ").trim() };
  }).filter((item) => /\b(?:AER|gross|savings?|saver|cash isa|ISA|easy access|instant access|fixed rate|fixed term|notice|bond|regular saver|monthly saver|withdrawal)\b/i.test(item.window));
}

export function parseSavingsDealsFromSource(args: { providerName: string; productName?: string; sourceUrl: string; text: string }): ParsedSavingsDeal[] {
  const windows = rateWindows(args.text);
  if (windows.length <= 1) return [parseSavingsDealFromSource(args)];

  const byKey = new Map<string, ParsedSavingsDeal>();
  for (const candidate of windows) {
    const providerName = inferProviderNameFromWindow(candidate.window, args.providerName);
    const productName = inferProductNameFromWindow(candidate.window, args.productName || `${providerName} savings product`);
    const parsed = parseSavingsDealFromSource({
      providerName,
      productName,
      sourceUrl: args.sourceUrl,
      text: candidate.window,
      rateHint: candidate.rate,
    });
    if (!parsed.grossAer) continue;
    const key = `${parsed.providerSlug}:${normaliseProviderSlug(parsed.productName)}:${parsed.grossAer.toFixed(3)}`;
    const boosted = {
      ...parsed,
      confidence: Math.min(95, parsed.confidence + (providerName !== args.providerName ? 4 : 0) + (productName !== args.productName ? 3 : 0)),
      summary: `${parsed.summary} Parsed from a rate table/window on ${new URL(args.sourceUrl).hostname}.`,
    };
    const existing = byKey.get(key);
    if (!existing || boosted.confidence > existing.confidence) byKey.set(key, boosted);
  }

  const parsedRows = Array.from(byKey.values()).sort((a, b) => Number(b.grossAer || 0) - Number(a.grossAer || 0));
  return parsedRows.length ? parsedRows.slice(0, 40) : [parseSavingsDealFromSource(args)];
}

export function parseSavingsDealFromSource(args: { providerName: string; productName?: string; sourceUrl: string; text: string; rateHint?: number | null }): ParsedSavingsDeal {
  const lower = args.text.toLowerCase();
  const providerName = args.providerName || "Unknown provider";
  const accessType = inferSavingsAccessType(args.text);
  const accountType = lower.includes("cash isa") || lower.includes("isa") ? "cash_isa" : accessType === "regular_saver" ? "regular_saver" : accessType === "fixed_term" ? "fixed_saver" : accessType === "notice" ? "notice_saver" : "easy_access";
  const requiresExistingCustomer = /existing customer|current account required|must hold|eligible if you already|linked current account|members only|exclusive to/i.test(args.text);
  const grossAer = args.rateHint && args.rateHint > 0 && args.rateHint < 25 ? args.rateHint : firstRate(args.text);
  const productName = args.productName || titleFromSource(args.text, "Savings product");
  const minimumBalance = firstBalanceAround(args.text, [/minimum(?: opening)?(?: balance| deposit)?[^£]{0,80}£\s?([0-9][0-9,]*(?:\.\d{1,2})?)/i, /open(?:ing)?(?: with)?[^£]{0,80}£\s?([0-9][0-9,]*(?:\.\d{1,2})?)/i]);
  const maximumBalance = firstBalanceAround(args.text, [/maximum(?: balance)?[^£]{0,80}£\s?([0-9][0-9,]*(?:\.\d{1,2})?)/i, /up to[^£]{0,50}£\s?([0-9][0-9,]*(?:\.\d{1,2})?)/i]);
  const monthlyMaxDeposit = firstBalanceAround(args.text, [/pay in(?: up to)?[^£]{0,80}£\s?([0-9][0-9,]*(?:\.\d{1,2})?)\s*(?:a|per)?\s*month/i, /monthly(?: maximum|max)?[^£]{0,80}£\s?([0-9][0-9,]*(?:\.\d{1,2})?)/i]);
  const monthlyMinDeposit = firstBalanceAround(args.text, [/pay in(?: at least|a minimum of)[^£]{0,80}£\s?([0-9][0-9,]*(?:\.\d{1,2})?)\s*(?:a|per)?\s*month/i, /monthly(?: minimum|min)[^£]{0,80}£\s?([0-9][0-9,]*(?:\.\d{1,2})?)/i]);
  const noticePeriodDays = inferNoticeDays(args.text);
  const termLengthMonths = inferTermMonths(args.text);
  const withdrawalRules = inferWithdrawalRules(args.text);
  const rateType = inferSavingsRateType(args.text);
  const evidence = [grossAer, minimumBalance, maximumBalance, monthlyMaxDeposit, withdrawalRules, noticePeriodDays, termLengthMonths, rateType].filter((value) => value !== null && value !== undefined && value !== "").length;
  const confidence = grossAer ? Math.min(92, 50 + evidence * 6) : 35;
  return {
    providerSlug: normaliseProviderSlug(providerName),
    providerName,
    productName: productName.slice(0, 160),
    accountType,
    grossAer,
    minimumBalance,
    maximumBalance,
    monthlyMaxDeposit,
    monthlyMinDeposit,
    accessType,
    withdrawalRules,
    noticePeriodDays,
    termLengthMonths,
    rateType,
    requiresExistingCustomer,
    eligibilityNote: requiresExistingCustomer ? "Source appears to reference existing-customer or linked-account eligibility. Admin should confirm." : "Source did not obviously require an existing account. Admin should confirm.",
    sourceUrl: args.sourceUrl,
    confidence,
    summary: grossAer ? `Detected ${productName.slice(0, 80)} at ${grossAer.toFixed(2)}%${withdrawalRules ? `; access note: ${withdrawalRules.slice(0, 90)}` : ""}.` : "Could not confidently detect a savings rate; saved for admin review.",
  };
}

export function parseMortgageDealsFromSource(args: { lenderName: string; sourceUrl: string; text: string }): ParsedMortgageDeal[] {
  const lower = args.text.toLowerCase();
  const lenderName = args.lenderName || "Unknown lender";
  const lenderSlug = normaliseProviderSlug(lenderName);
  const ratePercent = firstRate(args.text);
  const ltvMax = firstLtv(args.text);
  const initialTermMonths = firstTermMonths(args.text);
  const productFee = /fee/i.test(args.text) ? firstMoney(args.text) : null;
  const existingCustomerOnly = /existing customer|product transfer|switching rate|current borrower|existing mortgage customer/i.test(args.text);
  const rateType = lower.includes("tracker") ? "tracker" : lower.includes("variable") ? "variable" : "fixed";
  const productName = titleFromSource(args.text, `${lenderName} mortgage product`);
  return [
    {
      lenderSlug,
      lenderName,
      productName: productName.slice(0, 180),
      rateType,
      initialTermMonths,
      ltvMax,
      ltvMin: null,
      ratePercent,
      productFee,
      existingCustomerOnly,
      newCustomerAvailable: !existingCustomerOnly || /new customer|remortgage|purchase/i.test(args.text),
      sourceUrl: args.sourceUrl,
      confidence: ratePercent ? 55 : 30,
      summary: ratePercent ? `Detected a possible ${rateType} rate of ${ratePercent.toFixed(2)}%.` : "Could not confidently detect a mortgage rate; saved for admin review.",
    },
  ];
}

export function parseMoveListingFromSource(args: { sourceUrl: string; text: string; rawText?: string; fallbackTitle?: string; fallbackPrice?: number | null }): ParsedMoveListing {
  const price = firstMoney(args.text) || args.fallbackPrice || null;
  const postcodeMatch = args.text.match(/\b([A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2})\b/i);
  const bedroomsMatch = args.text.match(/(\d+)\s*(?:bedroom|bed\b)/i);
  const council = extractCouncilTaxBand(args.text, args.rawText);
  const epcRating = extractEpcRating(args.text, args.rawText);
  const imageUrl = extractImageUrl(args.rawText, args.sourceUrl);
  const rawTitle = args.fallbackTitle || titleFromSource(args.text, "Move search", args.rawText);
  const postcode = postcodeMatch?.[1]?.toUpperCase() || null;
  const addressHint = extractAddressHint(args.text, args.rawText, postcode, rawTitle);
  const cleanTitle = cleanMoveListingTitle(addressHint || rawTitle, postcode);
  const evidence = [price, postcode, bedroomsMatch, council.band, epcRating, imageUrl, addressHint].filter(Boolean).length;
  const sourceConfidence = Math.min(99, Math.max(45, 45 + evidence * 8 + (council.confidence ? 10 : 0)));
  return {
    title: cleanTitle,
    cleanTitle,
    askingPrice: price,
    postcode,
    addressHint,
    bedrooms: bedroomsMatch ? Number(bedroomsMatch[1]) : null,
    councilTaxBand: council.band,
    councilTaxBandConfidence: council.confidence,
    epcRating,
    imageUrl,
    sourceConfidence,
    sourceStatus: price || postcodeMatch || bedroomsMatch ? "url_ingested" : "url_partial",
    sourceSummary: `Parsed from listing URL with ${sourceConfidence}% source confidence${council.band ? `; council tax band ${council.band} detected at ${council.confidence}% confidence` : "; council tax band still needs confirmation"}.`,
  };
}

export function buildMoveAssumptions(input: {
  askingPrice: number | null;
  targetDeposit?: number | null;
  expectedRate?: number | null;
  expectedTermYears?: number | null;
  epcRating?: string | null;
  councilTaxBand?: string | null;
  councilTaxAuthority?: string | null;
  additionalProperty?: boolean;
}) {
  const askingPrice = Number(input.askingPrice || 0);
  const targetDeposit = Number(input.targetDeposit || 0);
  const expectedRate = Number(input.expectedRate || 4.75);
  const expectedTermYears = Number(input.expectedTermYears || 30);
  const expectedMortgageBalance = askingPrice > 0 ? Math.max(0, askingPrice - targetDeposit) : null;
  const expectedPayment = expectedMortgageBalance ? calculateMonthlyMortgagePayment({ balance: expectedMortgageBalance, annualInterestRate: expectedRate, termYears: expectedTermYears }) : null;
  const epc = String(input.epcRating || "").toUpperCase();
  const energyAnnual = epc === "A" || epc === "B" ? 1200 : epc === "C" ? 1600 : epc === "D" ? 2100 : epc ? 2800 : null;
  const councilTax = estimateCouncilTaxAnnual({ band: input.councilTaxBand, authority: input.councilTaxAuthority });
  const baseMovingCost = askingPrice > 0 ? Math.max(3000, Math.min(12000, askingPrice * 0.012)) : 4000;
  return {
    stampDutyEstimate: askingPrice > 0 ? calculateStampDutyEngland({ purchasePrice: askingPrice, additionalProperty: Boolean(input.additionalProperty) }) : null,
    movingCostEstimate: baseMovingCost,
    movingCostBasis: askingPrice > 0 ? "1.2% of purchase price, capped between £3,000 and £12,000 until the user overrides it." : "Default £4,000 until price/removal/solicitor assumptions are added.",
    expectedMortgageBalance,
    expectedPayment,
    energyAnnual,
    heatingMonthly: energyAnnual ? energyAnnual / 12 : null,
    councilTaxAnnual: councilTax.annual,
    councilTaxAuthority: councilTax.authority,
    councilTaxSourceUrl: councilTax.sourceUrl,
    councilTaxEstimateConfidence: councilTax.confidence,
  };
}
