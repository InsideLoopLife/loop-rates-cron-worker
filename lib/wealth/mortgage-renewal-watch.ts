import { calculateMonthlyMortgagePayment } from "@/lib/calculations/mortgage";
import { createFeatureCache } from "@/lib/wealth/watch-entitlements";
import { loadWealthWatchSettings } from "@/lib/wealth/watch-settings";
import { lenderSlugAliases, normaliseProviderSlug } from "@/lib/wealth/provider-normalise";

export type MortgageWatchOptions = {
  runKey?: string;
  runKind?: string;
  limit?: number;
  triggeredBy?: string | null;
  respectTier?: boolean;
};

function runKey(date = new Date()) {
  return `mortgage-renewal-watch:${date.toISOString().slice(0, 10)}`;
}

function monthsUntil(dateString: string | null | undefined) {
  if (!dateString) return null;
  const end = new Date(dateString);
  if (Number.isNaN(end.getTime())) return null;
  const today = new Date();
  return (end.getFullYear() - today.getFullYear()) * 12 + (end.getMonth() - today.getMonth());
}

function dealMatchesLtv(deal: any, ltv: number) {
  const max = Number(deal.ltv_max || 100);
  const min = Number(deal.ltv_min || 0);
  return ltv <= max && ltv >= min && Number(deal.rate_percent || 0) > 0;
}

export async function runMortgageRenewalWatch(supabase: any, ratesSupabase: any, options: MortgageWatchOptions = {}) {
  const settings = await loadWealthWatchSettings(supabase);
  const key = options.runKey || runKey();
  const limit = Math.max(1, Math.min(Number(options.limit || 250), 500));
  const now = new Date().toISOString();

  const { data: run, error: runError } = await supabase
    .from("mortgage_renewal_watch_runs")
    .upsert({
      run_key: key,
      run_kind: options.runKind || "daily_mortgage_watch",
      status: "started",
      started_at: now,
      payload: { limit, triggeredBy: options.triggeredBy || null, settings },
      error: null,
    }, { onConflict: "run_key" })
    .select("id")
    .single();

  if (runError) throw new Error(runError.message);

  let checked = 0;
  let skippedNoTier = 0;
  let recommendations = 0;
  const detail: any[] = [];
  const hasMortgageWatch = createFeatureCache(supabase, "mortgage_renewal_watch");

  try {
    const [{ data: mortgages, error: dealsError }, { data: homes }, { data: rateDeals, error: rateDealsError }] = await Promise.all([
      supabase
        .from("home_mortgage_deals")
        .select("id, user_id, home_id, lender, product_name, balance, interest_rate, rate_type, repayment_type, initial_period_end, term_years, monthly_payment_override, renewal_watch_enabled, renewal_alert_months, current_lender_watch_enabled, whole_market_watch_enabled")
        .eq("renewal_watch_enabled", true)
        .limit(limit),
      supabase
        .from("homes")
        .select("id, user_id, property_value, estimated_value_mid"),
      ratesSupabase
        .from("mortgage_rate_deals")
        .select("id, lender_slug, lender_name, product_name, rate_type, initial_term_months, ltv_max, ltv_min, rate_percent, product_fee, existing_customer_only, new_customer_available, source_url, status, catalogue_status, source_checked_at, confidence")
        .eq("status", "active")
        .order("rate_percent", { ascending: true })
        .limit(500),
    ]);
    if (dealsError) throw new Error(dealsError.message);
    if (rateDealsError) throw new Error(rateDealsError.message);

    const homeById = new Map<string, any>((homes || []).map((home: any) => [home.id, home]));

    for (const mortgage of mortgages || []) {
      if (options.respectTier !== false && !(await hasMortgageWatch(mortgage.user_id))) {
        skippedNoTier += 1;
        continue;
      }

      const months = monthsUntil(mortgage.initial_period_end);
      const isVariable = String(mortgage.rate_type || "").toLowerCase().includes("variable") || String(mortgage.rate_type || "").toLowerCase().includes("tracker");
      const alertMonths = Number(mortgage.renewal_alert_months || settings.mortgageAlertMonths);
      if (!isVariable && (months === null || months > alertMonths)) continue;
      checked += 1;

      const home = mortgage.home_id ? homeById.get(mortgage.home_id) : null;
      const propertyValue = Number(home?.estimated_value_mid || home?.property_value || 0);
      const balance = Number(mortgage.balance || 0);
      const ltv = propertyValue > 0 ? (balance / propertyValue) * 100 : 75;
      const currentRate = Number(mortgage.interest_rate || 0);
      const currentPayment = Number(mortgage.monthly_payment_override || 0) || calculateMonthlyMortgagePayment({ balance, annualInterestRate: currentRate, termYears: Number(mortgage.term_years || 25) });
      const currentLenderAliases = new Set(lenderSlugAliases(mortgage.lender));

      const candidates = (rateDeals || [])
        .filter((deal: any) => dealMatchesLtv(deal, ltv))
        .map((deal: any) => {
          const dealSlug = normaliseProviderSlug(deal.lender_slug || deal.lender_name);
          const isCurrentLender = currentLenderAliases.has(dealSlug);
          return { ...deal, dealSlug, isCurrentLender };
        })
        .filter((deal: any) => {
          if (deal.isCurrentLender) return mortgage.current_lender_watch_enabled !== false;
          return mortgage.whole_market_watch_enabled !== false && deal.new_customer_available !== false;
        })
        .sort((a: any, b: any) => Number(a.rate_percent || 99) - Number(b.rate_percent || 99))
        .slice(0, settings.mortgageMaxRecommendationsPerDeal);

      if (candidates.length === 0) {
        detail.push({ mortgage_id: mortgage.id, reason: "No sourced mortgage rate deals matched yet. Add lender/whole-market source rows in mortgage_rate_deals." });
        await supabase.from("home_mortgage_deals").update({ last_rate_watch_at: now }).eq("id", mortgage.id);
        continue;
      }

      for (const candidate of candidates) {
        const suggestedRate = Number(candidate.rate_percent || currentRate);
        const newPayment = calculateMonthlyMortgagePayment({ balance, annualInterestRate: suggestedRate, termYears: Number(mortgage.term_years || 25) });
        const recommendationKind = candidate.isCurrentLender ? "current_lender" : "whole_market";
        const reason = `${recommendationKind === "current_lender" ? "Current lender" : "Whole-market"} comparison for ${ltv.toFixed(1)}% LTV. ${months === null ? "Variable/no fixed end date" : `${months} month(s) until the current deal ends`}.`;
        const { error } = await ratesSupabase.from("mortgage_renewal_recommendations").upsert({
          user_id: mortgage.user_id,
          home_id: mortgage.home_id,
          mortgage_deal_id: mortgage.id,
          mortgage_rate_deal_id: candidate.id,
          recommendation_kind: recommendationKind,
          lender_name: candidate.lender_name,
          product_name: candidate.product_name,
          current_lender: mortgage.lender,
          current_rate: currentRate,
          suggested_rate: suggestedRate,
          rate_delta: suggestedRate - currentRate,
          estimated_current_payment: currentPayment,
          estimated_new_payment: newPayment,
          estimated_monthly_saving: currentPayment - newPayment,
          product_fee: candidate.product_fee,
          ltv,
          months_until_end: months,
          source_url: candidate.source_url,
          reason,
          status: "new",
          updated_at: now,
          payload: { currentProductName: mortgage.product_name, candidateStatus: candidate.status, confidence: candidate.confidence, sourceCheckedAt: candidate.source_checked_at, initialTermMonths: candidate.initial_term_months, rateType: candidate.rate_type, ltvMin: candidate.ltv_min, ltvMax: candidate.ltv_max, balance, catalogueStatus: candidate.catalogue_status || candidate.status },
        }, { onConflict: "user_id,mortgage_deal_id,mortgage_rate_deal_id,recommendation_kind" });
        if (!error) {
          recommendations += 1;
          detail.push({ mortgage_id: mortgage.id, candidate_id: candidate.id, recommendationKind });
        }
      }
      await supabase.from("home_mortgage_deals").update({ last_rate_watch_at: now }).eq("id", mortgage.id);
    }

    await supabase.from("mortgage_renewal_watch_runs").update({ status: "completed", finished_at: new Date().toISOString(), mortgages_checked: checked, recommendations_created: recommendations, payload: { detail: detail.slice(0, 100), skippedNoTier, settings } }).eq("id", run.id);
    return { ok: true, checked, recommendations_created: recommendations, skipped_no_tier: skippedNoTier };
  } catch (error: any) {
    await supabase.from("mortgage_renewal_watch_runs").update({ status: "failed", finished_at: new Date().toISOString(), mortgages_checked: checked, recommendations_created: recommendations, error: error?.message || "failed", payload: { detail, skippedNoTier, settings } }).eq("id", run.id);
    throw error;
  }
}

export async function expireStaleMortgageRateDeals(ratesSupabase: any, staleDays: number, triggeredBy?: string | null) {
  const threshold = new Date(Date.now() - Math.max(1, staleDays) * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await ratesSupabase
    .from("mortgage_rate_deals")
    .update({ status: "expired", updated_at: new Date().toISOString(), payload: { expired_by: triggeredBy || "system", stale_threshold: threshold } })
    .in("status", ["active", "needs_review"])
    .or(`source_checked_at.is.null,source_checked_at.lt.${threshold}`)
    .select("id");
  if (error) throw new Error(error.message);
  return { expired: data?.length || 0, threshold };
}
