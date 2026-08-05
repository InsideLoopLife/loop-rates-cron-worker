import { createHash } from "node:crypto";
import { normaliseProviderSlug } from "@/lib/wealth/provider-normalise";
import { fetchSourceText, parseSavingsDealsFromSource, type ParsedSavingsDeal } from "@/lib/wealth/source-ingestion";
import { isMaterialProductCollapse, sourceFailurePatch, sourceSuccessPatch, sourceWasUnchanged } from "@/lib/wealth/rate-source-health";
import { catalogueHealth } from "@/lib/wealth/rates-worker-runtime";

export type SavingsCatalogueRefreshOptions = {
  runKey?: string;
  limit?: number;
  sourceId?: string | null;
  triggeredBy?: string | null;
  publishConfidenceThreshold?: number;
  force?: boolean;
  freshnessHours?: number;
};

function productSlug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function savingsReviewReasons(parsed: ParsedSavingsDeal, threshold: number, collapsed: boolean) {
  const reasons: string[] = [];
  if (!parsed.providerName?.trim()) reasons.push("provider_missing");
  if (!parsed.productName?.trim()) reasons.push("product_name_missing");
  if (!parsed.grossAer || parsed.grossAer < 0.1 || parsed.grossAer > 20) reasons.push("rate_missing_or_implausible");
  if (!parsed.accessType || parsed.accessType === "savings") reasons.push("access_type_unclear");
  if (parsed.accessType === "regular_saver" && !parsed.monthlyMaxDeposit) reasons.push("regular_saver_monthly_cap_missing");
  if (parsed.accessType === "fixed_term" && !parsed.termLengthMonths) reasons.push("fixed_term_length_missing");
  if (parsed.accessType === "notice" && !parsed.noticePeriodDays) reasons.push("notice_period_missing");
  if (!/^https:\/\//i.test(parsed.sourceUrl)) reasons.push("official_https_evidence_missing");
  if (parsed.confidence < threshold) reasons.push("confidence_below_publish_threshold");
  if (collapsed) reasons.push("source_product_count_collapsed");
  return Array.from(new Set(reasons));
}

async function markUnchangedSavingsSource(supabase: any, source: any, fetched: any, now: string) {
  const patch = { last_seen_at: now, last_verified_at: now, last_checked_at: now, missing_observation_count: 0, updated_at: now };
  let update = await supabase.from("savings_rate_deals").update(patch).eq("canonical_source", String(source.id)).select("id");
  if (update.error) throw new Error(update.error.message);
  if (!(update.data || []).length) {
    update = await supabase.from("savings_rate_deals").update(patch).in("source_url", Array.from(new Set([source.source_url, fetched.url]))).select("id");
    if (update.error) throw new Error(update.error.message);
  }
  return (update.data || []).length;
}

export async function refreshSavingsCatalogueFromSources(supabase: any, options: SavingsCatalogueRefreshOptions = {}) {
  const limit = Math.max(1, Math.min(Number(options.limit || 20), 80));
  const now = new Date().toISOString();
  const publishThreshold = Math.max(80, Math.min(Number(options.publishConfidenceThreshold || 92), 100));
  const runKey = options.runKey || `savings-catalogue:${Date.now()}`;
  const { data: run, error: runError } = await supabase.from("wealth_watch_source_jobs").insert({
    job_kind: "savings_catalogue_refresh",
    source_url: null,
    status: "running",
    created_by: null,
    result_payload: { runKey, limit, sourceId: options.sourceId || null, triggeredBy: options.triggeredBy || null, schemaVersion: 3 },
  }).select("id").single();
  if (runError) throw new Error(runError.message);

  let query = supabase
    .from("savings_rate_sources")
    .select("id,provider_slug,provider_name,source_url,source_kind,product_hint,status,last_checked_at,check_frequency_hours,payload,consecutive_failures,next_check_at,last_http_status,resolved_url,content_hash,source_etag,source_last_modified,last_product_count,last_parse_success_at")
    .in("status", ["active", "needs_review", "failed", "blocked"])
    .order("next_check_at", { ascending: true, nullsFirst: true })
    .limit(limit);
  if (options.sourceId) query = query.eq("id", options.sourceId);
  if (!options.force && !options.sourceId) query = query.or(`next_check_at.is.null,next_check_at.lte.${now}`);
  const { data: sources, error: sourceError } = await query;
  if (sourceError) throw new Error(sourceError.message);

  let checked = 0;
  let inserted = 0;
  let updated = 0;
  let failed = 0;
  let fetchSuccesses = 0;
  let parseSuccesses = 0;
  let accepted = 0;
  let quarantined = 0;
  let unchanged = 0;
  let collapseSources = 0;
  let withdrawals = 0;
  const detail: any[] = [];

  for (const source of sources || []) {
    checked += 1;
    try {
      const fetched = await fetchSourceText(source.resolved_url || source.source_url, { etag: source.source_etag, lastModified: source.source_last_modified });
      fetchSuccesses += 1;
      const contentUnchanged = sourceWasUnchanged(source, fetched);
      if (contentUnchanged) {
        const retained = await markUnchangedSavingsSource(supabase, source, fetched, now);
        unchanged += retained;
        const update = await supabase.from("savings_rate_sources").update(sourceSuccessPatch({
          source,
          now,
          fetched,
          productCount: Number(source.last_product_count || retained),
          parseSucceeded: Boolean(source.last_parse_success_at),
          contentChanged: false,
          resultPayload: { unchanged: true, retained_deals: retained, http_status: fetched.httpStatus },
        })).eq("id", source.id);
        if (update.error) throw new Error(update.error.message);
        detail.push({ source_id: source.id, provider: source.provider_name, outcome: "unchanged", retained_deals: retained });
        continue;
      }

      const parsedDeals = parseSavingsDealsFromSource({ providerName: source.provider_name, productName: source.product_hint || undefined, sourceUrl: fetched.url, text: fetched.text })
        .filter((deal) => Number(deal.grossAer || 0) >= 0.1 && Number(deal.grossAer || 0) <= 20);
      if (!parsedDeals.length) throw new Error("No plausible savings products were extracted from the fetched page.");
      parseSuccesses += 1;
      const collapsed = isMaterialProductCollapse(source.last_product_count, parsedDeals.length);
      if (collapsed) collapseSources += 1;

      let sourceWrites = 0;
      const seenDealIds = new Set<string>();
      for (const parsed of parsedDeals) {
        const providerSlug = parsed.providerSlug || normaliseProviderSlug(parsed.providerName || source.provider_name);
        const productName = parsed.productName || source.product_hint || `${source.provider_name} savings product`;
        const sourceProductId = `${providerSlug}:${productSlug(productName)}:${parsed.accountType || parsed.accessType || "savings"}`;
        const reviewReasons = savingsReviewReasons(parsed, publishThreshold, collapsed);
        const publishable = reviewReasons.length === 0;
        if (publishable) accepted += 1;
        else quarantined += 1;
        const rawPayloadHash = createHash("sha256").update(JSON.stringify({ parsed, sourceId: source.id })).digest("hex");
        const row = {
          provider_slug: providerSlug,
          provider_name: parsed.providerName || source.provider_name,
          product_name: productName,
          account_type: parsed.accountType || "easy_access",
          gross_aer: parsed.grossAer,
          bonus_rate: parsed.bonusRate ?? null,
          minimum_balance: parsed.minimumBalance ?? null,
          maximum_balance: parsed.maximumBalance ?? null,
          monthly_max_deposit: parsed.monthlyMaxDeposit ?? null,
          monthly_min_deposit: parsed.monthlyMinDeposit ?? null,
          access_type: parsed.accessType ?? null,
          withdrawal_rules: parsed.withdrawalRules ?? null,
          notice_period_days: parsed.noticePeriodDays ?? null,
          term_length_months: parsed.termLengthMonths ?? null,
          rate_type: parsed.rateType ?? null,
          requires_existing_customer: parsed.requiresExistingCustomer,
          eligible_provider_slug: parsed.requiresExistingCustomer ? providerSlug : null,
          eligibility_note: parsed.eligibilityNote,
          source_url: fetched.url,
          source_name: new URL(fetched.url).hostname,
          detected_by: parsedDeals.length > 1 ? "deterministic_rate_table" : "deterministic_product_page",
          confidence: parsed.confidence,
          publishable,
          review_reasons: reviewReasons,
          status: publishable ? "active" : "needs_review",
          ai_summary: parsed.summary,
          admin_notes: publishable ? "Auto-published after deterministic field validation." : `Quarantined: ${reviewReasons.join(", ")}`,
          source_payload: { parsed, sourceId: source.id, sourceKind: source.source_kind, extractionMethod: "deterministic", reviewReasons },
          evidence: { rate: parsed.grossAer, accessType: parsed.accessType ?? null, minimumBalance: parsed.minimumBalance ?? null, maximumBalance: parsed.maximumBalance ?? null, monthlyMinimum: parsed.monthlyMinDeposit ?? null, monthlyMaximum: parsed.monthlyMaxDeposit ?? null, noticeDays: parsed.noticePeriodDays ?? null, termMonths: parsed.termLengthMonths ?? null, fetchedAt: now },
          canonical_source: String(source.id),
          source_product_id: sourceProductId,
          provider_product_code: null,
          last_seen_at: now,
          last_verified_at: publishable ? now : null,
          verification_status: publishable ? "AUTO_VERIFIED" : "REVIEW_REQUIRED",
          lifecycle_status: publishable ? "ACTIVE" : "DATA_REVIEW",
          missing_observation_count: 0,
          raw_payload_hash: rawPayloadHash,
          last_checked_at: now,
          updated_at: now,
        } as Record<string, any>;

        let existing = await supabase.from("savings_rate_deals").select("id,status,raw_payload_hash").eq("canonical_source", String(source.id)).eq("source_product_id", sourceProductId).maybeSingle();
        if (existing.error) throw new Error(existing.error.message);
        if (!existing.data) {
          existing = await supabase.from("savings_rate_deals").select("id,status,raw_payload_hash").eq("provider_slug", providerSlug).eq("product_name", productName).eq("source_url", fetched.url).maybeSingle();
          if (existing.error) throw new Error(existing.error.message);
        }
        const write = existing.data?.id
          ? await supabase.from("savings_rate_deals").update(row).eq("id", existing.data.id).select("id").single()
          : await supabase.from("savings_rate_deals").insert(row).select("id").single();
        if (write.error) throw new Error(write.error.message);
        if (write.data?.id) {
          seenDealIds.add(String(write.data.id));
          if (!existing.data || existing.data.raw_payload_hash !== rawPayloadHash || existing.data.status !== row.status) {
            const version = await supabase.from("savings_rate_deal_versions").insert({ savings_rate_deal_id: write.data.id, lifecycle_status: row.lifecycle_status, verification_status: row.verification_status, gross_aer: row.gross_aer, product_payload: row.source_payload, source_url: row.source_url, effective_from: now, raw_payload_hash: rawPayloadHash });
            if (version.error) throw new Error(version.error.message);
          }
        }
        if (existing.data?.id) updated += 1;
        else inserted += 1;
        sourceWrites += 1;
        detail.push({ source_id: source.id, deal_id: write.data?.id, provider: row.provider_name, product: row.product_name, rate: row.gross_aer, publishable, review_reasons: reviewReasons });
      }

      if (!collapsed) {
        const { data: sourceDealRows, error: sourceDealError } = await supabase.from("savings_rate_deals").select("id,status,lifecycle_status,missing_observation_count,gross_aer,source_payload,source_url,verification_status").eq("canonical_source", String(source.id));
        if (sourceDealError) throw new Error(sourceDealError.message);
        for (const existingDeal of sourceDealRows || []) {
          if (seenDealIds.has(String(existingDeal.id))) continue;
          const missingCount = Number(existingDeal.missing_observation_count || 0) + 1;
          const withdrawn = missingCount >= 3;
          const lifecycleStatus = withdrawn ? "WITHDRAWN" : "PENDING_WITHDRAWAL";
          const missingWrite = await supabase.from("savings_rate_deals").update({ missing_observation_count: missingCount, lifecycle_status: lifecycleStatus, status: withdrawn ? "expired" : existingDeal.status, publishable: withdrawn ? false : undefined, effective_to: withdrawn ? now : null, updated_at: now }).eq("id", existingDeal.id);
          if (missingWrite.error) throw new Error(missingWrite.error.message);
          if (withdrawn) withdrawals += 1;
        }
      }

      const sourceUpdate = await supabase.from("savings_rate_sources").update({
        ...sourceSuccessPatch({ source, now, fetched, productCount: parsedDeals.length, parseSucceeded: true, contentChanged: true, resultPayload: { parsed_deals: parsedDeals.length, writes: sourceWrites, accepted: parsedDeals.filter((parsed) => savingsReviewReasons(parsed, publishThreshold, collapsed).length === 0).length, quarantined: parsedDeals.filter((parsed) => savingsReviewReasons(parsed, publishThreshold, collapsed).length > 0).length, collapsed } }),
        status: collapsed ? "needs_review" : "active",
      }).eq("id", source.id);
      if (sourceUpdate.error) throw new Error(sourceUpdate.error.message);
    } catch (error: any) {
      failed += 1;
      const patch = sourceFailurePatch(source, error, now);
      detail.push({ source_id: source.id, provider: source.provider_name, source_url: source.source_url, error: patch.last_error, failure_class: patch.last_failure_class, next_retry_at: patch.next_check_at });
      const failUpdate = await supabase.from("savings_rate_sources").update({ ...patch, status: "needs_review" }).eq("id", source.id);
      if (failUpdate.error) detail.push({ source_id: source.id, provider: source.provider_name, update_error: failUpdate.error.message });
    }
  }

  const health = catalogueHealth({ checked, failed, parseSuccesses, accepted, unchanged, collapseSources });
  const result = { ok: health.status === "healthy", checked, fetch_successes: fetchSuccesses, parse_successes: parseSuccesses, inserted, updated, accepted, quarantined, unchanged, failed, collapse_sources: collapseSources, withdrawals, retry_scheduled: failed, health, detail: detail.slice(0, 150) };
  if (run?.id) await supabase.from("wealth_watch_source_jobs").update({ status: failed === checked && checked > 0 ? "failed" : "completed", updated_at: new Date().toISOString(), result_payload: result, error: failed ? `${failed} source(s) failed; see result payload` : null }).eq("id", run.id);
  return result;
}
