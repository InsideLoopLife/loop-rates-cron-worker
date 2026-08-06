import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";
import { parseMortgageDeals, parseSavingsDeals } from "./rates-parser.mjs";

const config = {
  supabaseUrl: required("SUPABASE_URL"),
  supabaseSecretKey: required("SUPABASE_SECRET_KEY"),
  enforceUk8am: bool("ENFORCE_UK_8AM", true),
  forceRun: bool("FORCE_RUN", false),
  savingsSourceLimit: int("SAVINGS_SOURCE_LIMIT", int("SOURCE_LIMIT", 40, 1, 100), 1, 100),
  mortgageSourceLimit: int("MORTGAGE_SOURCE_LIMIT", 40, 1, 100),
  freshnessHours: int("FRESHNESS_HOURS", 20, 1, 168),
  publishThreshold: int("PUBLISH_CONFIDENCE_THRESHOLD", 92, 70, 100),
  mortgagePublishThreshold: int("MORTGAGE_PUBLISH_CONFIDENCE_THRESHOLD", 95, 75, 100),
  missingObservationsBeforeExpiry: int("MISSING_OBSERVATIONS_BEFORE_EXPIRY", 3, 2, 10),
  fetchTimeoutMs: int("FETCH_TIMEOUT_MS", 15000, 3000, 60000),
  userAgent: process.env.USER_AGENT || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  appBaseUrl: process.env.APP_BASE_URL?.replace(/\/+$/, "") || null,
  cronSecret: process.env.CRON_SECRET?.trim() || null,
  runAppMaintenance: bool("RUN_APP_MAINTENANCE", true),
};

const supabase = createClient(config.supabaseUrl, config.supabaseSecretKey, {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  global: { headers: { "x-loop-worker": "rates-database-worker-v2" } },
});

const ukNow = londonParts();
if (config.enforceUk8am && !config.forceRun && Number(ukNow.hour) !== 8) {
  log("worker_skipped", { reason: "Not 08:00 Europe/London", ukTime: `${ukNow.year}-${ukNow.month}-${ukNow.day} ${ukNow.hour}:${ukNow.minute}:${ukNow.second}` });
  process.exit(0);
}

const runKey = `render_rates_${ukNow.year}${ukNow.month}${ukNow.day}_${crypto.randomUUID().slice(0, 8)}`;
const startedAt = new Date().toISOString();

try {
  log("worker_started", { runKey, startedAt });
  const savings = await refreshSavings();
  const mortgages = await refreshMortgages();
  const maintenance = config.runAppMaintenance ? await runAppMaintenance() : { skipped: true, reason: "RUN_APP_MAINTENANCE=false" };
  const failed = savings.failed + mortgages.failed + (maintenance.failed || 0);
  const result = { ok: failed === 0, runKey, savings, mortgages, maintenance };
  log(failed ? "worker_completed_with_warnings" : "worker_succeeded", result);
  // Individual provider failures are reported and retried next run. A partial provider
  // outage must not make Render treat an otherwise useful catalogue refresh as crashed.
  process.exitCode = 0;
} catch (error) {
  log("worker_failed", { runKey, error: messageOf(error) });
  process.exitCode = 1;
}

async function refreshSavings() {
  const job = await createRunLog("savings_catalogue_refresh");
  const sources = await loadDueSources({
    table: "savings_rate_sources",
    fields: "id,provider_slug,provider_name,source_url,source_kind,product_hint,status,last_checked_at,check_frequency_hours",
    limit: config.savingsSourceLimit,
  });
  const summary = baseSummary(sources.length);

  for (const source of sources) {
    try {
      const fetched = await fetchSource(source.source_url);
      const parsed = parseSavingsDeals({
        providerName: source.provider_name,
        providerSlug: source.provider_slug,
        productHint: source.product_hint,
        sourceUrl: fetched.url,
        text: fetched.text,
      });
      if (!parsed.length) throw new Error("No coherent savings products found; source requires review");

      const existingRows = await selectRows("savings_rate_deals", "id,source_product_id,status,lifecycle_status,missing_observation_count,source_payload,gross_aer,verification_status,source_url,provider_slug,product_name", (q) =>
        q.eq("canonical_source", String(source.id))
      );
      // BUGFIX (part 2): the database's real uniqueness rule is a PARTIAL
      // index on (provider_slug, product_name, source_url) — a plain
      // Supabase upsert can't target a partial index by column list alone
      // (Postgres needs the exact WHERE predicate too, which the
      // supabase-js upsert syntax doesn't expose), which is why trying
      // that produced "no unique or exclusion constraint matching the ON
      // CONFLICT specification" for every single source. The safer fix:
      // go back to a manual insert-vs-update decision, but key it on the
      // SAME fields the database actually checks, instead of
      // source_product_id — so "is this already there?" agrees with what
      // the database itself considers a duplicate.
      const compositeKey = (row) => `${row.provider_slug || ""}|${row.product_name || ""}|${row.source_url || ""}`;
      const existingByKey = new Map(existingRows.map((row) => [compositeKey(row), row]));
      const seen = new Set();
      const rows = parsed.map((deal) => {
        const sourceProductId = deal.source_product_id;
        seen.add(sourceProductId);
        const prior = existingByKey.get(compositeKey(deal));
        const publishable = deal.publishable && deal.confidence >= config.publishThreshold;
        // BUGFIX: `...deal` was spreading the parser's entire output onto
        // the database row, including a top-level `validation` field that
        // rates-parser.mjs sets on every deal (validation: { required,
        // completeness }) — but no such column exists on
        // savings_rate_deals. This is what caused every single savings
        // source to fail with "Could not find the 'validation' column",
        // consistently, regardless of any schema cache reload, because it
        // was never a caching issue — the code was genuinely sending a
        // field the table doesn't have. Destructuring it out here stops
        // that leak; the data itself isn't lost, since a copy already
        // lives safely nested inside source_payload.validation below.
        const { validation: _validationNotAColumn, ...dealForRow } = deal;
        return {
          ...dealForRow,
          status: prior?.status === "active" && publishable ? "active" : publishable ? "active" : "needs_review",
          detected_by: "render_direct_database_worker_v2",
          source_name: hostname(fetched.url),
          last_checked_at: nowIso(),
          last_seen_at: nowIso(),
          last_verified_at: publishable ? nowIso() : null,
          updated_at: nowIso(),
          canonical_source: String(source.id),
          source_product_id: sourceProductId,
          verification_status: publishable ? "AUTO_VERIFIED" : "REVIEW_REQUIRED",
          lifecycle_status: publishable ? "ACTIVE" : "DATA_REVIEW",
          missing_observation_count: 0,
          raw_payload_hash: fetched.hash,
          source_payload: {
            worker: "loop-rates-database-worker-v2",
            run_key: runKey,
            source_id: source.id,
            source_kind: source.source_kind,
            evidence: deal.evidence,
            validation: deal.validation,
          },
          admin_notes: publishable ? null : deal.review_reasons.join(" "),
        };
      });

      // BUGFIX (part 3, a genuinely different case from parts 1 and 2):
      // the previous fix correctly compares against rows already in the
      // database, but doesn't protect against two deals extracted from
      // the SAME page, in the SAME run, sharing the same real-world
      // identity (provider_slug + product_name + source_url) — the same
      // account mentioned in two places on one page, for example. The
      // first one inserts fine; the second collides with what the first
      // just created, since the in-memory existingByKey snapshot was only
      // built once, before this loop started. Deduping the batch itself
      // first — keeping the highest-confidence extraction when there's a
      // genuine clash — closes this without needing to touch the database
      // mid-loop.
      const dedupedRows = Array.from(
        rows.reduce((map, row) => {
          const key = compositeKey(row);
          const existing = map.get(key);
          if (!existing || Number(row.confidence || 0) > Number(existing.confidence || 0)) map.set(key, row);
          return map;
        }, new Map()).values()
      );

      // BUGFIX, corrected: the database's real uniqueness rule is a
      // PARTIAL index on (provider_slug, product_name, source_url) — a
      // plain PostgREST upsert can't target a partial index by column
      // list alone (confirmed directly: attempting this produced "no
      // unique or exclusion constraint matching the ON CONFLICT
      // specification" for every source). The correct fix is a manual
      // insert-vs-update decision, same shape as the original code, but
      // keyed on the SAME fields the database actually checks — so
      // "is this already there?" agrees with what the database considers
      // a duplicate, instead of the original source_product_id key that
      // could disagree with it.
      for (const row of dedupedRows) {
        const prior = existingByKey.get(compositeKey(row));
        let write = prior
          ? await supabase.from("savings_rate_deals").update(row).eq("id", prior.id).select("id").single()
          : await supabase.from("savings_rate_deals").insert(row).select("id").single();
        // BUGFIX (part 4, the remaining narrow case): the database's real
        // uniqueness rule is GLOBAL across all sources — but the
        // existence check above only looks at rows already tied to THIS
        // source's canonical_source. If the same real product legitimately
        // gets picked up by two different sources (an aggregator like
        // Moneyfacts overlapping with a bank's own direct listing, for
        // example), the scoped check can't see it, and a plain insert
        // collides with the database's own, correctly global, constraint.
        // Rather than restructure how existingRows is fetched, this
        // self-heals: on exactly this error, look up the real conflicting
        // row with no source scoping at all, and update it instead of
        // failing the whole source over what is, in the database's own
        // terms, not actually a new product.
        if (write.error?.code === "23505") {
          const conflict = await supabase
            .from("savings_rate_deals")
            .select("id")
            .eq("provider_slug", row.provider_slug)
            .eq("product_name", row.product_name)
            .eq("source_url", row.source_url)
            .maybeSingle();
          if (conflict.data?.id) {
            write = await supabase.from("savings_rate_deals").update(row).eq("id", conflict.data.id).select("id").single();
            throwIf(write.error);
            summary.updated++;
            continue;
          }
        }
        throwIf(write.error);
        prior ? summary.updated++ : summary.inserted++;
      }
      summary.expired += await markMissingSavings(existingRows, seen);
      summary.dealsParsed += parsed.length;
      await markSourceSuccess("savings_rate_sources", source.id, parsed.length, fetched.hash);
      summary.detail.push({ sourceId: source.id, provider: source.provider_name, ok: true, deals: parsed.length });
    } catch (error) {
      summary.failed++;
      await markSourceFailure("savings_rate_sources", source.id, error);
      summary.detail.push({ sourceId: source.id, provider: source.provider_name, ok: false, error: messageOf(error) });
    }
  }
  await finishRunLog(job, "completed", summary);
  return summary;
}

async function refreshMortgages() {
  const job = await createRunLog("mortgage_catalogue_refresh");
  const sources = await loadDueSources({
    table: "mortgage_lender_sources",
    fields: "id,lender_slug,lender_name,source_url,source_kind,status,last_checked_at,check_frequency_hours",
    limit: config.mortgageSourceLimit,
  });
  const summary = baseSummary(sources.length);

  for (const source of sources) {
    try {
      const fetched = await fetchSource(source.source_url);
      const market = await currentMortgageMarket();
      const parsed = parseMortgageDeals({
        lenderName: source.lender_name,
        lenderSlug: source.lender_slug,
        sourceUrl: fetched.url,
        text: fetched.text,
        market,
      });
      if (!parsed.length) throw new Error("No coherent mortgage products found; source requires review");

      const existingRows = await selectRows("mortgage_rate_deals", "id,external_product_key,status,catalogue_status,missing_observation_count", (q) =>
        q.eq("source_id", source.id).in("catalogue_status", ["active", "needs_review", "broken", "pending_withdrawal"])
      );
      const existingByKey = new Map(existingRows.map((row) => [row.external_product_key, row]));
      const seen = new Set();

      for (const deal of parsed) {
        seen.add(deal.external_product_key);
        const prior = existingByKey.get(deal.external_product_key);
        const publishable = deal.publishable && deal.confidence >= config.mortgagePublishThreshold;
        const catalogueStatus = deal.anomaly ? "broken" : publishable ? "active" : "needs_review";
        const row = {
          lender_slug: deal.lender_slug,
          lender_name: deal.lender_name,
          product_name: deal.product_name,
          rate_type: deal.rate_type,
          initial_term_months: deal.initial_term_months,
          ltv_max: deal.ltv_max,
          ltv_min: deal.ltv_min,
          rate_percent: deal.rate_percent,
          product_fee: deal.product_fee,
          existing_customer_only: deal.existing_customer_only,
          new_customer_available: deal.new_customer_available,
          source_url: fetched.url,
          source_name: hostname(fetched.url),
          source_checked_at: nowIso(),
          confidence: deal.confidence,
          status: catalogueStatus === "active" ? "active" : "needs_review",
          catalogue_status: catalogueStatus,
          ingestion_method: "deterministic_source_catalogue_v2",
          source_id: source.id,
          external_product_key: deal.external_product_key,
          admin_review_reason: publishable ? null : deal.review_reasons.join(" "),
          removed_detected_at: null,
          missing_observation_count: 0,
          updated_at: nowIso(),
          payload: {
            summary: deal.summary,
            evidence: deal.evidence,
            validation: deal.validation,
            market_reference: market,
            worker: "loop-rates-database-worker-v2",
            run_key: runKey,
          },
        };
        const write = prior
          ? await supabase.from("mortgage_rate_deals").update(row).eq("id", prior.id).select("id").single()
          : await supabase.from("mortgage_rate_deals").insert(row).select("id").single();
        throwIf(write.error);
        prior ? summary.updated++ : summary.inserted++;
      }
      summary.expired += await markMissingMortgages(existingRows, seen);
      summary.dealsParsed += parsed.length;
      await markSourceSuccess("mortgage_lender_sources", source.id, parsed.length, fetched.hash);
      summary.detail.push({ sourceId: source.id, lender: source.lender_name, ok: true, deals: parsed.length });
    } catch (error) {
      summary.failed++;
      await markSourceFailure("mortgage_lender_sources", source.id, error);
      summary.detail.push({ sourceId: source.id, lender: source.lender_name, ok: false, error: messageOf(error) });
    }
  }
  await finishRunLog(job, "completed", summary);
  return summary;
}

async function runAppMaintenance() {
  if (!config.appBaseUrl || !config.cronSecret) {
    return { skipped: true, failed: 0, reason: "APP_BASE_URL/CRON_SECRET not configured; catalogue ingestion still completed directly" };
  }
  // These jobs contain user-specific/tier-specific business logic and therefore stay in
  // the app. The Render job is their scheduler; rates ingestion above remains direct.
  const paths = [
    "/api/cron/savings-rate-watch?mode=watch_only",
    "/api/cron/mortgage-renewal-watch",
    "/api/cron/loopwatch-daily",
    "/api/cron/deal-news-review",
    "/api/cron/daily-financial-briefing",
    "/api/cron/daily-snapshot",
    "/api/cron/investment-pension-snapshot",
    "/api/cron/pension-performance-refresh",
    "/api/cron/pensions-daily",
    "/api/cron/product-price-refresh",
    "/api/cron/property-archive-cleanup",
    "/api/cron/provider-glossary-daily-check",
    "/api/cron/notification-insights",
  ];
  if (new Date().getUTCDay() === 1) paths.push("/api/cron/weekly-digest");
  const detail = [];
  for (const path of paths) {
    try {
      const response = await fetch(`${config.appBaseUrl}${path}`, {
        headers: { authorization: `Bearer ${config.cronSecret}`, "x-loop-worker": "rates-database-worker-v2" },
        signal: AbortSignal.timeout(120_000),
      });
      const body = (await response.text()).slice(0, 1500);
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${body}`);
      detail.push({ path, ok: true });
    } catch (error) {
      detail.push({ path, ok: false, error: messageOf(error) });
    }
  }
  return { skipped: false, checked: paths.length, failed: detail.filter((row) => !row.ok).length, detail };
}

async function loadDueSources({ table, fields, limit }) {
  const { data, error } = await supabase.from(table).select(fields).in("status", ["active", "needs_review", "failed"]).order("last_checked_at", { ascending: true, nullsFirst: true }).limit(limit);
  throwIf(error);
  if (config.forceRun) return data || [];
  const now = Date.now();
  return (data || []).filter((source) => {
    if (!source.last_checked_at) return true;
    const frequency = Math.max(1, Number(source.check_frequency_hours || config.freshnessHours));
    return new Date(source.last_checked_at).getTime() <= now - frequency * 3600_000;
  });
}

async function currentMortgageMarket() {
  const { data, error } = await supabase.from("mortgage_rate_deals").select("rate_percent").eq("catalogue_status", "active").gte("source_checked_at", new Date(Date.now() - 14 * 86400_000).toISOString()).limit(500);
  if (error) return { median: null, lowerBound: null, upperBound: null, sampleSize: 0 };
  const rates = (data || []).map((row) => Number(row.rate_percent)).filter((n) => Number.isFinite(n) && n > 0 && n < 20).sort((a, b) => a - b);
  const median = rates.length ? rates[Math.floor(rates.length / 2)] : null;
  return {
    median,
    lowerBound: median ? Math.max(0.5, median * 0.72) : null,
    upperBound: median ? median * 1.55 : null,
    sampleSize: rates.length,
  };
}

async function markMissingSavings(rows, seen) {
  let expired = 0;
  for (const row of rows) {
    if (!row.source_product_id || seen.has(row.source_product_id)) continue;
    const count = Number(row.missing_observation_count || 0) + 1;
    const withdrawn = count >= config.missingObservationsBeforeExpiry;
    const write = await supabase.from("savings_rate_deals").update({
      missing_observation_count: count,
      lifecycle_status: withdrawn ? "WITHDRAWN" : "PENDING_WITHDRAWAL",
      status: withdrawn ? "expired" : row.status,
      effective_to: withdrawn ? nowIso() : null,
      updated_at: nowIso(),
    }).eq("id", row.id);
    throwIf(write.error);
    if (withdrawn) expired++;
  }
  return expired;
}

async function markMissingMortgages(rows, seen) {
  let expired = 0;
  for (const row of rows) {
    if (!row.external_product_key || seen.has(row.external_product_key)) continue;
    const count = Number(row.missing_observation_count || 0) + 1;
    const withdrawn = count >= config.missingObservationsBeforeExpiry;
    const write = await supabase.from("mortgage_rate_deals").update({
      missing_observation_count: count,
      catalogue_status: withdrawn ? "removed" : "pending_withdrawal",
      status: withdrawn ? "expired" : row.status,
      removed_detected_at: withdrawn ? nowIso() : null,
      updated_at: nowIso(),
    }).eq("id", row.id);
    throwIf(write.error);
    if (withdrawn) expired++;
  }
  return expired;
}

async function createRunLog(jobKind) {
  const result = await supabase.from("wealth_watch_source_jobs").insert({
    job_kind: jobKind,
    source_url: null,
    status: "running",
    result_payload: { run_key: runKey, triggered_by: "render_direct_database_worker_v2" },
  }).select("id").single();
  if (result.error) {
    log("run_log_unavailable", { jobKind, error: result.error.message });
    return null;
  }
  return result.data?.id || null;
}

async function finishRunLog(id, status, resultPayload) {
  if (!id) return;
  const result = await supabase.from("wealth_watch_source_jobs").update({
    status,
    updated_at: nowIso(),
    result_payload: resultPayload,
    error: resultPayload.failed ? `${resultPayload.failed} source(s) require retry` : null,
  }).eq("id", id);
  if (result.error) log("run_log_finish_failed", { error: result.error.message });
}

async function markSourceSuccess(table, id, count, hash) {
  const timestamp = nowIso();
  const values = { last_checked_at: timestamp, last_success_at: timestamp, last_error: null, status: "active", updated_at: timestamp };
  if (table === "savings_rate_sources") values.last_result_payload = { parsed_deals: count, raw_hash: hash, run_key: runKey };
  let result = await supabase.from(table).update(values).eq("id", id);
  if (result.error && "last_result_payload" in values) {
    delete values.last_result_payload;
    result = await supabase.from(table).update(values).eq("id", id);
  }
  throwIf(result.error);
}

async function markSourceFailure(table, id, error) {
  // Do not advance last_checked_at on failure: the source remains due for the next run.
  const result = await supabase.from(table).update({
    last_error: messageOf(error).slice(0, 1500),
    status: "needs_review",
    updated_at: nowIso(),
  }).eq("id", id);
  if (result.error) log("source_failure_write_failed", { table, id, error: result.error.message });
}

async function selectRows(table, fields, amend) {
  const query = amend(supabase.from(table).select(fields));
  const { data, error } = await query;
  throwIf(error);
  return data || [];
}

async function fetchSource(url) {
  const safe = new URL(url);
  if (!["http:", "https:"].includes(safe.protocol)) throw new Error("Only HTTP and HTTPS source URLs are supported");
  const response = await fetch(safe, {
    headers: {
      "user-agent": config.userAgent,
      accept: "text/html,application/xhtml+xml,application/json,text/plain;q=0.9,*/*;q=0.5",
      "accept-language": "en-GB,en;q=0.9",
      "sec-fetch-mode": "navigate",
      "sec-fetch-dest": "document",
      "upgrade-insecure-requests": "1",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(config.fetchTimeoutMs),
  });
  if (!response.ok) throw new Error(`Source returned HTTP ${response.status}`);
  const raw = (await response.text()).slice(0, 1_000_000);
  const text = stripHtml(raw).slice(0, 400_000);
  if (text.length < 120) throw new Error("Source returned too little readable content");
  return { url: response.url || safe.toString(), text, hash: crypto.createHash("sha256").update(raw).digest("hex") };
}

function stripHtml(input) {
  return input.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<noscript[\s\S]*?<\/noscript>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/&pound;|&#163;/gi, "£").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/\s+/g, " ").trim();
}

function baseSummary(sourceCount) {
  return { sourceCount, checked: sourceCount, inserted: 0, updated: 0, expired: 0, failed: 0, dealsParsed: 0, detail: [] };
}
function londonParts(date = new Date()) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(date).reduce((acc, part) => ({ ...acc, [part.type]: part.value }), {});
}
function hostname(url) { try { return new URL(url).hostname; } catch { return null; } }
function nowIso() { return new Date().toISOString(); }
function messageOf(error) { return error instanceof Error ? error.message : String(error); }
function throwIf(error) { if (error) throw new Error(error.message || String(error)); }
function required(key) { const value = process.env[key]?.trim(); if (!value) throw new Error(`Missing required environment variable: ${key}`); return value; }
function bool(key, fallback) { const raw = process.env[key]; return raw == null ? fallback : /^(1|true|yes|on)$/i.test(raw); }
function int(key, fallback, min, max) { const parsed = Number.parseInt(process.env[key] || "", 10); const value = Number.isFinite(parsed) ? parsed : fallback; return Math.max(min, Math.min(max, value)); }
function log(event, payload) { console.log(JSON.stringify({ timestamp: nowIso(), event, ...payload })); }
