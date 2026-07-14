import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

const config = {
  supabaseUrl: required("SUPABASE_URL"),
  supabaseSecretKey: required("SUPABASE_SECRET_KEY"),
  enforceUk8am: bool("ENFORCE_UK_8AM", true),
  forceRun: bool("FORCE_RUN", false),
  sourceLimit: int("SOURCE_LIMIT", 40, 1, 100),
  freshnessHours: int("FRESHNESS_HOURS", 20, 1, 168),
  publishThreshold: int("PUBLISH_CONFIDENCE_THRESHOLD", 92, 1, 100),
  fetchTimeoutMs: int("FETCH_TIMEOUT_MS", 15000, 3000, 60000),
  userAgent: process.env.USER_AGENT || "LOOP rates catalogue worker/1.0",
};

const supabase = createClient(config.supabaseUrl, config.supabaseSecretKey, {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  global: { headers: { "x-loop-worker": "rates-database-worker" } },
});

const ukNow = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
}).formatToParts(new Date()).reduce((acc, part) => ({ ...acc, [part.type]: part.value }), {});

if (config.enforceUk8am && !config.forceRun && Number(ukNow.hour) !== 8) {
  log("worker_skipped", { reason: "Not 08:00 Europe/London", ukTime: `${ukNow.year}-${ukNow.month}-${ukNow.day} ${ukNow.hour}:${ukNow.minute}:${ukNow.second}` });
  process.exit(0);
}

const runKey = `render_rates_${ukNow.year}${ukNow.month}${ukNow.day}_${crypto.randomUUID().slice(0, 8)}`;
const startedAt = new Date().toISOString();
let sourceJobId = null;

try {
  sourceJobId = await createRunLog(runKey);
  const threshold = new Date(Date.now() - config.freshnessHours * 3600_000).toISOString();
  let query = supabase
    .from("savings_rate_sources")
    .select("id,provider_slug,provider_name,source_url,source_kind,product_hint,status,last_checked_at,check_frequency_hours")
    .in("status", ["active", "needs_review"])
    .order("last_checked_at", { ascending: true, nullsFirst: true })
    .limit(config.sourceLimit);

  if (!config.forceRun) query = query.or(`last_checked_at.is.null,last_checked_at.lt.${threshold}`);

  const { data: sources, error: sourceError } = await query;
  if (sourceError) throw new Error(`Could not load savings_rate_sources: ${sourceError.message}`);

  const summary = { checked: 0, inserted: 0, updated: 0, failed: 0, dealsParsed: 0, detail: [] };
  log("worker_started", { runKey, sourceCount: sources?.length || 0, startedAt });

  for (const source of sources || []) {
    summary.checked += 1;
    try {
      const fetched = await fetchSource(source.source_url);
      const deals = parseDeals({
        providerName: source.provider_name,
        providerSlug: source.provider_slug,
        productHint: source.product_hint,
        sourceUrl: fetched.url,
        text: fetched.text,
      });
      summary.dealsParsed += deals.length;

      for (const deal of deals) {
        const existing = await supabase
          .from("savings_rate_deals")
          .select("id")
          .eq("provider_slug", deal.provider_slug)
          .eq("product_name", deal.product_name)
          .eq("source_url", deal.source_url)
          .maybeSingle();
        if (existing.error) throw new Error(existing.error.message);

        const now = new Date().toISOString();
        const row = {
          ...deal,
          status: deal.confidence >= config.publishThreshold ? "active" : "needs_review",
          detected_by: "render_direct_database_worker",
          source_name: new URL(deal.source_url).hostname,
          last_checked_at: now,
          updated_at: now,
          source_payload: {
            worker: "loop-rates-database-worker",
            run_key: runKey,
            extracted_at: now,
            raw_hash: fetched.hash,
            source_kind: source.source_kind,
            source_id: source.id,
          },
          admin_notes: deal.confidence >= config.publishThreshold
            ? "Auto-published because extraction confidence met the configured threshold."
            : "Direct source extraction requires admin review before publication.",
        };

        const write = existing.data?.id
          ? await supabase.from("savings_rate_deals").update(row).eq("id", existing.data.id).select("id").single()
          : await supabase.from("savings_rate_deals").insert(row).select("id").single();
        if (write.error) throw new Error(write.error.message);
        if (existing.data?.id) summary.updated += 1;
        else summary.inserted += 1;
      }

      const sourceResult = {
        parsed_deals: deals.length,
        highest_rate: deals.reduce((max, item) => Math.max(max, Number(item.gross_aer || 0)), 0),
        raw_hash: fetched.hash,
        run_key: runKey,
      };
      let sourceUpdate = await supabase.from("savings_rate_sources").update({
        last_checked_at: new Date().toISOString(),
        last_success_at: new Date().toISOString(),
        last_error: null,
        updated_at: new Date().toISOString(),
        last_result_payload: sourceResult,
      }).eq("id", source.id);
      if (sourceUpdate.error && /last_result_payload/i.test(sourceUpdate.error.message || "")) {
        sourceUpdate = await supabase.from("savings_rate_sources").update({
          last_checked_at: new Date().toISOString(),
          last_success_at: new Date().toISOString(),
          last_error: null,
          updated_at: new Date().toISOString(),
        }).eq("id", source.id);
      }
      if (sourceUpdate.error) throw new Error(sourceUpdate.error.message);
      summary.detail.push({ sourceId: source.id, provider: source.provider_name, ok: true, deals: deals.length });
    } catch (error) {
      summary.failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      summary.detail.push({ sourceId: source.id, provider: source.provider_name, ok: false, error: message });
      await supabase.from("savings_rate_sources").update({
        last_checked_at: new Date().toISOString(),
        last_error: message.slice(0, 1500),
        updated_at: new Date().toISOString(),
      }).eq("id", source.id);
    }
  }

  await finishRunLog(sourceJobId, summary.failed ? "failed" : "completed", summary, summary.failed ? `${summary.failed} source(s) failed` : null);
  log("worker_succeeded", { runKey, ...summary, detail: undefined });
  if (summary.failed) process.exitCode = 1;
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  await finishRunLog(sourceJobId, "failed", {}, message).catch(() => undefined);
  log("worker_failed", { runKey, error: message });
  process.exitCode = 1;
}

async function createRunLog(runKey) {
  const payload = {
    job_kind: "savings_catalogue_refresh",
    source_url: null,
    status: "running",
    result_payload: { run_key: runKey, triggered_by: "render_direct_database_worker" },
  };
  const result = await supabase.from("wealth_watch_source_jobs").insert(payload).select("id").single();
  if (result.error) {
    log("run_log_unavailable", { table: "wealth_watch_source_jobs", error: result.error.message });
    return null;
  }
  return result.data?.id || null;
}

async function finishRunLog(id, status, resultPayload, error) {
  if (!id) return;
  const result = await supabase.from("wealth_watch_source_jobs").update({
    status,
    updated_at: new Date().toISOString(),
    result_payload: resultPayload,
    error,
  }).eq("id", id);
  if (result.error) log("run_log_finish_failed", { error: result.error.message });
}

async function fetchSource(url) {
  const safe = new URL(url);
  if (!["http:", "https:"].includes(safe.protocol)) throw new Error("Only HTTP and HTTPS source URLs are supported.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.fetchTimeoutMs);
  try {
    const response = await fetch(safe, {
      headers: {
        "user-agent": config.userAgent,
        accept: "text/html,application/xhtml+xml,application/json,text/plain;q=0.9,*/*;q=0.5",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Source returned HTTP ${response.status}`);
    const raw = (await response.text()).slice(0, 750_000);
    return {
      url: response.url || safe.toString(),
      text: stripHtml(raw).slice(0, 300_000),
      hash: crypto.createHash("sha256").update(raw).digest("hex"),
    };
  } finally {
    clearTimeout(timer);
  }
}

function parseDeals({ providerName, providerSlug, productHint, sourceUrl, text }) {
  const windows = collectRateWindows(text);
  const candidates = windows.map((window) => parseWindow(window, { providerName, providerSlug, productHint, sourceUrl })).filter(Boolean);
  const deduped = new Map();
  for (const item of candidates) {
    const key = `${item.provider_slug}|${item.product_name.toLowerCase()}|${item.gross_aer}`;
    const current = deduped.get(key);
    if (!current || item.confidence > current.confidence) deduped.set(key, item);
  }
  return [...deduped.values()].slice(0, 50);
}

function collectRateWindows(text) {
  const compact = text.replace(/\s+/g, " ").trim();
  const regex = /(?:\b\d{1,2}(?:\.\d{1,3})?\s*%\s*(?:AER|gross|variable|fixed)?|(?:AER|gross)\s*(?:rate)?\s*[:\-]?\s*\d{1,2}(?:\.\d{1,3})?\s*%)/gi;
  const windows = [];
  let match;
  while ((match = regex.exec(compact))) {
    const start = Math.max(0, match.index - 220);
    const end = Math.min(compact.length, match.index + match[0].length + 260);
    windows.push(compact.slice(start, end));
    if (windows.length >= 100) break;
  }
  return windows;
}

function parseWindow(window, base) {
  const rateMatch = window.match(/(\d{1,2}(?:\.\d{1,3})?)\s*%\s*(?:AER|gross)?/i) || window.match(/(?:AER|gross)\s*(?:rate)?\s*[:\-]?\s*(\d{1,2}(?:\.\d{1,3})?)\s*%/i);
  if (!rateMatch) return null;
  const grossAer = Number(rateMatch[1]);
  if (!Number.isFinite(grossAer) || grossAer <= 0 || grossAer > 25) return null;

  const lower = window.toLowerCase();
  const accountType = lower.includes("cash isa") || /\bisa\b/.test(lower)
    ? "cash_isa"
    : lower.includes("regular saver") || lower.includes("monthly saver")
      ? "regular_saver"
      : lower.includes("notice")
        ? "notice_saver"
        : lower.includes("fixed") || lower.includes("bond")
          ? "fixed_saver"
          : "easy_access";
  const accessType = accountType === "fixed_saver" ? "fixed_term" : accountType === "notice_saver" ? "notice" : accountType === "regular_saver" ? "regular_saver" : "easy_access";
  const productName = inferProductName(window, base.productHint, accountType);
  const minimumBalance = moneyAfter(window, /(?:minimum|min)\s+(?:opening\s+)?(?:deposit|balance)?\s*[:\-]?/i);
  const maximumBalance = moneyAfter(window, /(?:maximum|max)\s+(?:deposit|balance)?\s*[:\-]?/i);
  const monthlyMaxDeposit = moneyAfter(window, /(?:monthly|max(?:imum)?\s+monthly)\s+(?:deposit|save)?\s*[:\-]?/i);
  const noticePeriodDays = numberBefore(window, /day(?:s)?\s+notice/i);
  const termLengthMonths = inferTermMonths(window);
  const requiresExistingCustomer = /existing customer|current account customer|members only|member exclusive/i.test(window);
  let confidence = 68;
  if (/AER/i.test(window)) confidence += 10;
  if (base.productHint) confidence += 8;
  if (/easy access|instant access|cash isa|fixed rate|fixed term|regular saver|notice account|bond/i.test(window)) confidence += 8;
  if (minimumBalance !== null || maximumBalance !== null || termLengthMonths !== null) confidence += 4;
  confidence = Math.min(99, confidence);

  return {
    provider_slug: normaliseSlug(base.providerSlug || base.providerName),
    provider_name: base.providerName,
    product_name: productName,
    account_type: accountType,
    gross_aer: grossAer,
    bonus_rate: extractBonus(window),
    minimum_balance: minimumBalance,
    maximum_balance: maximumBalance,
    monthly_max_deposit: monthlyMaxDeposit,
    access_type: accessType,
    withdrawal_rules: inferWithdrawalRules(window),
    notice_period_days: noticePeriodDays,
    term_length_months: termLengthMonths,
    rate_type: /fixed/i.test(window) ? "fixed" : "variable",
    requires_existing_customer: requiresExistingCustomer,
    eligible_provider_slug: requiresExistingCustomer ? normaliseSlug(base.providerSlug || base.providerName) : null,
    eligibility_note: requiresExistingCustomer ? "Existing-customer eligibility detected on source page." : null,
    source_url: base.sourceUrl,
    confidence,
    ai_summary: `${base.providerName} ${productName} detected at ${grossAer.toFixed(2)}% AER from the configured source page.`,
  };
}

function inferProductName(window, hint, accountType) {
  if (hint?.trim()) return hint.trim().slice(0, 180);
  const phrases = [
    /([A-Z][A-Za-z0-9&'’\- ]{3,80}(?:Cash ISA|ISA|Regular Saver|Monthly Saver|Easy Access|Instant Access|Notice Account|Fixed Rate Bond|Fixed Saver|Savings Account))/,
    /([A-Z][A-Za-z0-9&'’\- ]{3,80}(?:Saver|Savings|Bond))/,
  ];
  for (const regex of phrases) {
    const found = window.match(regex)?.[1]?.replace(/\s+/g, " ").trim();
    if (found) return found.slice(0, 180);
  }
  return ({ cash_isa: "Cash ISA", regular_saver: "Regular Saver", notice_saver: "Notice Savings", fixed_saver: "Fixed Savings", easy_access: "Easy Access Savings" })[accountType] || "Savings Product";
}

function stripHtml(input) {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&pound;|&#163;/gi, "£")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function moneyAfter(text, prefixRegex) {
  const match = text.match(new RegExp(`${prefixRegex.source}\\s*£?([0-9][0-9,]*(?:\\.[0-9]{1,2})?)`, "i"));
  return match ? Number(match[1].replace(/,/g, "")) : null;
}

function numberBefore(text, suffixRegex) {
  const match = text.match(new RegExp(`(\\d{1,4})\\s*${suffixRegex.source}`, "i"));
  return match ? Number(match[1]) : null;
}

function inferTermMonths(text) {
  const month = text.match(/(\d{1,3})\s*month/i);
  if (month) return Number(month[1]);
  const year = text.match(/(\d{1,2})\s*year/i);
  return year ? Number(year[1]) * 12 : null;
}

function extractBonus(text) {
  const match = text.match(/bonus(?: rate)?\s*(?:of|:|-)?\s*(\d{1,2}(?:\.\d{1,3})?)\s*%/i);
  return match ? Number(match[1]) : null;
}

function inferWithdrawalRules(text) {
  if (/no withdrawals|withdrawals? not permitted/i.test(text)) return "No withdrawals during the term.";
  if (/limited withdrawals|up to \d+ withdrawals/i.test(text)) return "Limited withdrawals; see source terms.";
  if (/easy access|instant access|unlimited withdrawals/i.test(text)) return "Easy-access withdrawals detected; confirm provider conditions.";
  return null;
}

function normaliseSlug(value) {
  return String(value || "provider").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100);
}

function required(key) {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}
function bool(key, fallback) {
  const raw = process.env[key];
  return raw == null ? fallback : /^(1|true|yes|on)$/i.test(raw);
}
function int(key, fallback, min, max) {
  const parsed = Number.parseInt(process.env[key] || "", 10);
  const value = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(min, Math.min(max, value));
}
function log(event, payload) {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), event, ...payload }));
}
