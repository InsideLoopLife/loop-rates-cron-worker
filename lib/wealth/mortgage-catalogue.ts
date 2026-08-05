import crypto from "node:crypto";
import { fetchSourceText, parseMortgageDealsFromSource, type ParsedMortgageDeal } from "@/lib/wealth/source-ingestion";
import { normaliseProviderSlug } from "@/lib/wealth/provider-normalise";
import { isMaterialProductCollapse, sourceFailurePatch, sourceSuccessPatch, sourceWasUnchanged } from "@/lib/wealth/rate-source-health";
import { catalogueHealth } from "@/lib/wealth/rates-worker-runtime";

export type MortgageCatalogueRefreshOptions = {
  runKey?: string;
  limit?: number;
  sourceId?: string | null;
  triggeredBy?: string | null;
  publishConfidenceThreshold?: number;
  force?: boolean;
};

function cleanText(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function productKey(parts: Array<string | number | boolean | null | undefined>) {
  return crypto.createHash("sha256").update(parts.map((part) => String(part ?? "").toLowerCase().trim()).join("|")).digest("hex");
}

function stableMortgageKey(deal: ParsedMortgageDeal, sourceId: string) {
  return productKey([sourceId, deal.lenderSlug, deal.rateType, deal.initialTermMonths, deal.ltvMax, deal.existingCustomerOnly, deal.newCustomerAvailable, deal.productFee]);
}

function rateMatches(text: string) {
  const out: Array<{ rate: number; index: number }> = [];
  for (const match of text.matchAll(/(\d{1,2}(?:\.\d{1,3})?)\s*%/g)) {
    const rate = Number(match[1]);
    if (Number.isFinite(rate) && rate > 0.1 && rate < 20) out.push({ rate, index: match.index || 0 });
  }
  const seen = new Set<string>();
  return out.filter((row) => {
    const context = text.slice(Math.max(0, row.index - 260), Math.min(text.length, row.index + 520));
    if (!/mortgage|remortgage|ltv|fixed|tracker|product fee|initial rate/i.test(context)) return false;
    if (/representative apr|apr representative|example only/i.test(context) && !/initial rate|fixed rate|tracker rate/i.test(context)) return false;
    const key = `${row.rate.toFixed(3)}:${Math.floor(row.index / 250)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 20);
}

function ltvFromContext(context: string) {
  const direct = Array.from(context.matchAll(/(\d{2,3})\s*%\s*LTV/gi)).map((m) => Number(m[1])).filter((n) => n > 0 && n <= 100);
  if (direct.length) return Math.max(...direct);
  const upto = context.match(/(?:up to|max(?:imum)?|at)\s+(\d{2,3})\s*%\s*(?:loan[- ]to[- ]value|ltv)/i);
  const parsed = upto ? Number(upto[1]) : null;
  return parsed && parsed > 0 && parsed <= 100 ? parsed : null;
}

function termFromContext(context: string) {
  const years = context.match(/\b(2|3|5|7|10)\s*(?:year|yr)[-\s]*(?:fixed|fix|initial rate|tracker)\b/i);
  if (years) return Number(years[1]) * 12;
  const months = context.match(/\b(24|36|60|84|120)\s*month/i);
  return months ? Number(months[1]) : null;
}

function feeFromContext(context: string) {
  if (/\b(?:no|zero)\s+(?:product\s+|arrangement\s+)?fee\b|fee[- ]free/i.test(context)) return 0;
  const explicit = context.match(/(?:fee|product fee|arrangement fee)[^£]{0,40}£\s?([0-9][0-9,]*(?:\.\d{1,2})?)/i);
  if (explicit) return Number(explicit[1].replace(/,/g, ""));
  const money = context.match(/£\s?([0-9][0-9,]*(?:\.\d{1,2})?)\s*(?:fee|product fee|arrangement fee)/i);
  return money ? Number(money[1].replace(/,/g, "")) : null;
}

function rateTypeFromContext(context: string) {
  const lower = context.toLowerCase();
  if (lower.includes("tracker")) return "tracker";
  if (lower.includes("variable") || lower.includes("svr")) return "variable";
  return "fixed";
}

function existingCustomerOnly(context: string) {
  return /existing customer|product transfer|switching rate|current borrower|existing mortgage customer/i.test(context);
}

function titleFor(lenderName: string, rateType: string, initialTermMonths: number | null, ltvMax: number | null, productFee: number | null) {
  const term = initialTermMonths ? `${Math.round(initialTermMonths / 12)} year` : "Lifetime";
  const ltv = ltvMax ? ` · ${ltvMax}% LTV` : "";
  const fee = productFee === 0 ? " · no fee" : productFee ? ` · £${productFee} fee` : "";
  return `${lenderName} ${term} ${rateType}${ltv}${fee}`;
}

export function parseMortgageCatalogueDeals(args: { lenderName: string; sourceUrl: string; text: string; sourceId?: string }) {
  const text = cleanText(args.text);
  const lenderName = cleanText(args.lenderName) || "Unknown lender";
  const lenderSlug = normaliseProviderSlug(lenderName);
  const rates = rateMatches(text);
  if (!rates.length) {
    return parseMortgageDealsFromSource(args).map((deal) => ({ ...deal, externalProductKey: stableMortgageKey(deal, args.sourceId || args.sourceUrl) }));
  }

  return rates.map(({ rate, index }) => {
    const context = text.slice(Math.max(0, index - 600), Math.min(text.length, index + 900));
    const rateType = rateTypeFromContext(context);
    const initialTermMonths = termFromContext(context);
    const ltvMax = ltvFromContext(context);
    const productFee = feeFromContext(context);
    const existingOnly = existingCustomerOnly(context);
    const hasProductRateLabel = /initial rate|mortgage rate|fixed rate|tracker rate/i.test(context);
    const hasMortgagePurpose = /remortgage|moving home|purchase|first[- ]time buyer|mortgage/i.test(context);
    const confidence = 50 + (initialTermMonths || rateType === "variable" ? 15 : 0) + (ltvMax ? 15 : 0) + (productFee !== null ? 5 : 0) + (hasProductRateLabel ? 10 : 0) + (hasMortgagePurpose ? 5 : 0);
    const deal: ParsedMortgageDeal = {
      lenderSlug,
      lenderName,
      productName: titleFor(lenderName, rateType, initialTermMonths, ltvMax, productFee),
      rateType,
      initialTermMonths,
      ltvMax,
      ltvMin: null,
      ratePercent: rate,
      productFee,
      existingCustomerOnly: existingOnly,
      newCustomerAvailable: !existingOnly || /new customer|remortgage|purchase|moving home/i.test(context),
      sourceUrl: args.sourceUrl,
      confidence: rate >= 1 && rate <= 15 ? Math.min(100, confidence) : Math.min(55, confidence),
      summary: `Detected mortgage deal at ${rate.toFixed(2)}%${initialTermMonths ? ` for ${initialTermMonths} months` : ""}${ltvMax ? ` up to ${ltvMax}% LTV` : ""}.`,
    };
    return { ...deal, externalProductKey: stableMortgageKey(deal, args.sourceId || args.sourceUrl) };
  });
}

function mortgageReviewReasons(parsed: ParsedMortgageDeal, threshold: number, collapsed: boolean) {
  const reasons: string[] = [];
  if (!parsed.lenderName?.trim()) reasons.push("lender_missing");
  if (!parsed.ratePercent || parsed.ratePercent < 1 || parsed.ratePercent > 15) reasons.push("rate_missing_or_implausible");
  if (!parsed.rateType) reasons.push("rate_type_missing");
  if (parsed.rateType === "fixed" && !parsed.initialTermMonths) reasons.push("initial_period_missing");
  if (!parsed.ltvMax || parsed.ltvMax <= 0 || parsed.ltvMax > 100) reasons.push("maximum_ltv_missing_or_invalid");
  if (parsed.productFee === null || parsed.productFee < 0 || parsed.productFee > 20_000) reasons.push("product_fee_missing_or_invalid");
  if (!/^https:\/\//i.test(parsed.sourceUrl)) reasons.push("official_https_evidence_missing");
  if (parsed.confidence < threshold) reasons.push("confidence_below_publish_threshold");
  if (collapsed) reasons.push("source_product_count_collapsed");
  return Array.from(new Set(reasons));
}

async function markUnchangedMortgageSource(supabase: any, source: any, fetched: any, now: string) {
  const patch = { source_checked_at: now, missing_observation_count: 0, updated_at: now };
  let update = await supabase.from("mortgage_rate_deals").update(patch).eq("source_id", source.id).select("id");
  if (update.error) throw new Error(update.error.message);
  if (!(update.data || []).length) {
    update = await supabase.from("mortgage_rate_deals").update(patch).in("source_url", Array.from(new Set([source.source_url, fetched.url]))).select("id");
    if (update.error) throw new Error(update.error.message);
  }
  return (update.data || []).length;
}

export async function refreshMortgageCatalogueFromSources(supabase: any, options: MortgageCatalogueRefreshOptions = {}) {
  const limit = Math.max(1, Math.min(Number(options.limit || 10), 50));
  const now = new Date().toISOString();
  const runKey = options.runKey || `mortgage-catalogue-refresh:${Date.now()}`;
  const publishThreshold = Math.max(85, Math.min(Number(options.publishConfidenceThreshold || 95), 100));
  const { data: run, error: runError } = await supabase.from("wealth_watch_source_jobs").insert({ job_kind: "mortgage_catalogue_refresh", status: "running", created_by: null, result_payload: { runKey, limit, sourceId: options.sourceId || null, triggeredBy: options.triggeredBy || null, schemaVersion: 3 } }).select("id").single();
  if (runError) throw new Error(runError.message);

  let sourceQuery = supabase.from("mortgage_lender_sources")
    .select("id,lender_slug,lender_name,source_url,source_kind,status,last_checked_at,check_frequency_hours,payload,consecutive_failures,next_check_at,last_http_status,resolved_url,content_hash,source_etag,source_last_modified,last_product_count,last_parse_success_at")
    .in("status", ["active", "needs_review", "failed", "blocked"])
    .order("next_check_at", { ascending: true, nullsFirst: true })
    .limit(limit);
  if (options.sourceId) sourceQuery = sourceQuery.eq("id", options.sourceId);
  if (!options.force && !options.sourceId) sourceQuery = sourceQuery.or(`next_check_at.is.null,next_check_at.lte.${now}`);
  const { data: sources, error: sourceError } = await sourceQuery;
  if (sourceError) throw new Error(sourceError.message);

  let checked = 0, inserted = 0, updated = 0, failed = 0, removed = 0, fetchSuccesses = 0, parseSuccesses = 0, accepted = 0, quarantined = 0, unchanged = 0, collapseSources = 0;
  const detail: any[] = [];
  for (const source of sources || []) {
    checked += 1;
    try {
      const fetched = await fetchSourceText(source.resolved_url || source.source_url, { etag: source.source_etag, lastModified: source.source_last_modified });
      fetchSuccesses += 1;
      if (sourceWasUnchanged(source, fetched)) {
        const retained = await markUnchangedMortgageSource(supabase, source, fetched, now);
        unchanged += retained;
        const sourceUpdate = await supabase.from("mortgage_lender_sources").update({
          ...sourceSuccessPatch({ source, now, fetched, productCount: Number(source.last_product_count || retained), parseSucceeded: Boolean(source.last_parse_success_at), contentChanged: false }),
          payload: { ...(source.payload || {}), lastResult: { unchanged: true, retainedDeals: retained, checkedAt: now } },
        }).eq("id", source.id);
        if (sourceUpdate.error) throw new Error(sourceUpdate.error.message);
        detail.push({ source_id: source.id, lender: source.lender_name, outcome: "unchanged", retained_deals: retained });
        continue;
      }

      const parsedDeals = parseMortgageCatalogueDeals({ lenderName: source.lender_name, sourceUrl: fetched.url, text: fetched.text, sourceId: source.id })
        .filter((deal) => Number(deal.ratePercent || 0) >= 1 && Number(deal.ratePercent || 0) <= 15);
      if (!parsedDeals.length) throw new Error("No plausible mortgage products were extracted from the fetched page.");
      parseSuccesses += 1;
      const collapsed = isMaterialProductCollapse(source.last_product_count, parsedDeals.length);
      if (collapsed) collapseSources += 1;
      const existingForSource = await supabase.from("mortgage_rate_deals").select("id,external_product_key,status,missing_observation_count").eq("source_id", source.id).in("catalogue_status", ["active", "needs_review", "broken"]);
      if (existingForSource.error) throw new Error(existingForSource.error.message);
      const existingKeys = new Map<string, any>((existingForSource.data || []).map((row: any) => [row.external_product_key, row]));
      const seenKeys = new Set<string>();

      for (const parsed of parsedDeals) {
        const externalProductKey = (parsed as any).externalProductKey || stableMortgageKey(parsed, source.id);
        seenKeys.add(externalProductKey);
        const reasons = mortgageReviewReasons(parsed, publishThreshold, collapsed);
        const publishable = reasons.length === 0;
        if (publishable) accepted += 1;
        else quarantined += 1;
        const existing = existingKeys.get(externalProductKey);
        const row = {
          lender_slug: parsed.lenderSlug,
          lender_name: parsed.lenderName,
          product_name: parsed.productName,
          rate_type: parsed.rateType,
          initial_term_months: parsed.initialTermMonths,
          ltv_max: parsed.ltvMax,
          ltv_min: parsed.ltvMin,
          rate_percent: parsed.ratePercent,
          product_fee: parsed.productFee,
          existing_customer_only: parsed.existingCustomerOnly,
          new_customer_available: parsed.newCustomerAvailable,
          source_url: fetched.url,
          source_name: new URL(fetched.url).hostname,
          source_checked_at: now,
          confidence: parsed.confidence,
          status: publishable ? "active" : "needs_review",
          catalogue_status: publishable ? "active" : "needs_review",
          ingestion_method: "deterministic_source_catalogue",
          source_id: source.id,
          external_product_key: externalProductKey,
          admin_review_reason: publishable ? null : reasons.join(", "),
          removed_detected_at: null,
          missing_observation_count: 0,
          updated_at: now,
          payload: { summary: parsed.summary, source_kind: source.source_kind, source_checked_at: now, auto_publish_threshold: publishThreshold, reviewReasons: reasons, extractionMethod: "deterministic" },
        };
        const { data, error } = await supabase.from("mortgage_rate_deals").upsert(row, { onConflict: "external_product_key" }).select("id").single();
        if (error) throw new Error(error.message);
        if (existing) updated += 1;
        else inserted += 1;
        detail.push({ source_id: source.id, deal_id: data?.id, product: parsed.productName, status: row.status, confidence: parsed.confidence, review_reasons: reasons });
      }

      if (!collapsed) {
        const missing = Array.from(existingKeys.entries()).filter(([key, row]) => key && !seenKeys.has(key) && row.status !== "expired");
        for (const [, row] of missing) {
          const missingCount = Number(row.missing_observation_count || 0) + 1;
          const withdraw = missingCount >= 3;
          const write = await supabase.from("mortgage_rate_deals").update({ missing_observation_count: missingCount, status: withdraw ? "expired" : row.status, catalogue_status: withdraw ? "removed" : "needs_review", removed_detected_at: withdraw ? now : null, admin_review_reason: withdraw ? "Removed after three consecutive missing observations." : `Missing from source observation ${missingCount}/3; held for review.`, updated_at: now }).eq("id", row.id).select("id");
          if (write.error) throw new Error(write.error.message);
          if (withdraw) removed += (write.data || []).length;
        }
      }

      const sourceUpdate = await supabase.from("mortgage_lender_sources").update({
        ...sourceSuccessPatch({ source, now, fetched, productCount: parsedDeals.length, parseSucceeded: true, contentChanged: true }),
        status: collapsed ? "needs_review" : "active",
        payload: { ...(source.payload || {}), lastResult: { parsedDeals: parsedDeals.length, accepted: parsedDeals.filter((deal) => mortgageReviewReasons(deal, publishThreshold, collapsed).length === 0).length, quarantined: parsedDeals.filter((deal) => mortgageReviewReasons(deal, publishThreshold, collapsed).length > 0).length, collapsed, checkedAt: now } },
      }).eq("id", source.id);
      if (sourceUpdate.error) throw new Error(sourceUpdate.error.message);
    } catch (error: any) {
      failed += 1;
      const patch = sourceFailurePatch(source, error, now);
      detail.push({ source_id: source.id, lender: source.lender_name, source_url: source.source_url, error: patch.last_error, failure_class: patch.last_failure_class, next_retry_at: patch.next_check_at });
      const failUpdate = await supabase.from("mortgage_lender_sources").update({ ...patch, status: "needs_review", payload: { ...(source.payload || {}), lastFailure: { class: patch.last_failure_class, at: now } } }).eq("id", source.id);
      if (failUpdate.error) detail.push({ source_id: source.id, lender: source.lender_name, update_error: failUpdate.error.message });
    }
  }

  const health = catalogueHealth({ checked, failed, parseSuccesses, accepted, unchanged, collapseSources });
  const result = { ok: health.status === "healthy", checked, fetch_successes: fetchSuccesses, parse_successes: parseSuccesses, inserted, updated, accepted, quarantined, unchanged, removed, failed, collapse_sources: collapseSources, retry_scheduled: failed, health, detail: detail.slice(0, 150) };
  if (run?.id) await supabase.from("wealth_watch_source_jobs").update({ status: failed === checked && checked > 0 ? "failed" : "completed", updated_at: new Date().toISOString(), result_payload: result, error: failed ? `${failed} source(s) failed; see result payload` : null }).eq("id", run.id);
  return result;
}
