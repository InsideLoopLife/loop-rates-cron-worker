import { createFeatureCache } from "@/lib/wealth/watch-entitlements";
import { loadWealthWatchSettings } from "@/lib/wealth/watch-settings";
import { savingsDealEligibleBalance, savingsDealMatchesAccount } from "@/lib/wealth/savings-intelligence";

export type SavingsWatchOptions = {
  runKey?: string;
  runKind?: string;
  limit?: number;
  triggeredBy?: string | null;
  respectTier?: boolean;
};

function runKey(date = new Date()) {
  return `savings-rate-watch:${date.toISOString().slice(0, 10)}`;
}

export async function runSavingsRateWatch(supabase: any, options: SavingsWatchOptions = {}) {
  const settings = await loadWealthWatchSettings(supabase);
  const key = options.runKey || runKey();
  const limit = Math.max(1, Math.min(Number(options.limit || 500), 1000));
  const now = new Date().toISOString();

  const { data: run, error: runError } = await supabase
    .from("savings_rate_watch_runs")
    .upsert({
      run_key: key,
      run_kind: options.runKind || "daily_8am",
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
  const hasSavingsWatch = createFeatureCache(supabase, "savings_rate_watch");

  try {
    const [{ data: accounts, error: accountsError }, { data: deals, error: dealsError }, { data: relationships }] = await Promise.all([
      supabase
        .from("financial_accounts")
        .select("id, user_id, name, provider, provider_slug, account_type, current_balance, interest_rate, monthly_top_up_amount, savings_watch_enabled")
        .eq("is_liability", false)
        .neq("account_type", "current_account")
        .limit(limit),
      supabase
        .from("savings_rate_deals")
        .select("id, provider_slug, provider_name, product_name, account_type, gross_aer, bonus_rate, minimum_balance, maximum_balance, monthly_min_deposit, monthly_max_deposit, requires_existing_customer, eligible_provider_slug, eligibility_note, access_type, withdrawal_rules, notice_period_days, term_length_months, rate_type, source_url, status, last_checked_at, confidence")
        .eq("status", "active")
        .order("gross_aer", { ascending: false })
        .limit(500),
      supabase
        .from("user_financial_provider_relationships")
        .select("user_id, provider_slug, provider_name, relationship_type, is_active")
        .eq("is_active", true),
    ]);

    if (accountsError) throw new Error(accountsError.message);
    if (dealsError) throw new Error(dealsError.message);

    const relationshipsByUser = new Map<string, Set<string>>();
    for (const rel of relationships || []) {
      const set = relationshipsByUser.get(rel.user_id) || new Set<string>();
      if (rel.provider_slug) set.add(String(rel.provider_slug));
      relationshipsByUser.set(rel.user_id, set);
    }

    for (const account of accounts || []) {
      if (account.savings_watch_enabled === false) continue;
      // Basic daily matching is available to every saver. Tiers control alerts,
      // automation and advanced modelling, not whether a useful comparison exists.
      if (options.respectTier === true && !(await hasSavingsWatch(account.user_id))) {
        skippedNoTier += 1;
        continue;
      }

      checked += 1;
      const currentRate = Number(account.interest_rate || 0);
      const balance = Math.max(0, Number(account.current_balance || 0));
      const monthlyTopUp = Math.max(0, Number(account.monthly_top_up_amount || 0));
      const held = relationshipsByUser.get(account.user_id) || new Set<string>();
      if (account.provider_slug) held.add(String(account.provider_slug));
      let createdForAccount = 0;

      for (const deal of deals || []) {
        if (createdForAccount >= settings.savingsMaxRecommendationsPerAccount) break;
        if (!savingsDealMatchesAccount(account, deal)) continue;
        const suggestedRate = Number(deal.gross_aer || 0);
        if (!suggestedRate || suggestedRate <= currentRate + settings.savingsMinimumRateDelta) continue;
        const needsExisting = Boolean(deal.requires_existing_customer);
        const eligibleProvider = String(deal.eligible_provider_slug || deal.provider_slug || "");
        const eligible = !needsExisting || held.has(eligibleProvider) || held.has(String(deal.provider_slug || ""));
        if (!eligible) continue;

        const delta = suggestedRate - currentRate;
        const eligibleBalance = savingsDealEligibleBalance(account, deal);
        const isRegularSaver = String(deal.account_type || deal.access_type || "").toLowerCase().includes("regular");
        const monthlyAllowance = Number(deal.monthly_max_deposit || 0) > 0
          ? Math.min(monthlyTopUp, Number(deal.monthly_max_deposit))
          : monthlyTopUp;
        const annualBase = eligibleBalance + (isRegularSaver ? 0 : monthlyAllowance * 6);
        const estimatedGain = annualBase * (delta / 100);
        const recommendationKind = deal.provider_slug === account.provider_slug ? "existing_provider_better_rate" : "market_better_rate";
        const eligibilityStatus = needsExisting ? "eligible_existing" : "eligible_open_market";
        const accessBits = [deal.access_type ? String(deal.access_type).replaceAll("_", " ") : null, deal.notice_period_days ? `${deal.notice_period_days} days notice` : null, deal.term_length_months ? `${deal.term_length_months} month term` : null, deal.withdrawal_rules ? String(deal.withdrawal_rules).slice(0, 140) : null].filter(Boolean).join(" · ");
        const reason = `${deal.provider_name || deal.provider_slug} is showing ${suggestedRate.toFixed(2)}% vs this account at ${currentRate.toFixed(2)}%. ${needsExisting ? "Included because you have marked the required provider as held." : "Included because it appears open-market rather than existing-customer only."}${accessBits ? ` Access: ${accessBits}.` : ""}`;

        const { error } = await supabase.from("savings_rate_recommendations").upsert({
          user_id: account.user_id,
          financial_account_id: account.id,
          savings_rate_deal_id: deal.id,
          provider_slug: deal.provider_slug,
          provider_name: deal.provider_name,
          product_name: deal.product_name,
          recommendation_kind: recommendationKind,
          eligibility_status: eligibilityStatus,
          current_rate: currentRate,
          suggested_rate: suggestedRate,
          rate_delta: delta,
          balance_checked: balance,
          estimated_annual_gain: estimatedGain,
          source_url: deal.source_url,
          reason,
          action_summary: accessBits ? `Review ${deal.provider_name || deal.provider_slug} ${deal.product_name || "savings product"}: ${accessBits}` : `Review ${deal.provider_name || deal.provider_slug} ${deal.product_name || "savings product"}.`,
          suitability_payload: { accessBits, needsExisting, eligibleProvider, accountType: account.account_type, dealAccountType: deal.account_type },
          status: "new",
          updated_at: now,
          payload: {
            monthlyTopUp,
            annualBase,
            eligibleBalance,
            eligibilityNote: deal.eligibility_note,
            confidence: deal.confidence,
            lastCheckedAt: deal.last_checked_at,
            accessType: deal.access_type,
            withdrawalRules: deal.withdrawal_rules,
            noticePeriodDays: deal.notice_period_days,
            termLengthMonths: deal.term_length_months,
            rateType: deal.rate_type,
            minimumBalance: deal.minimum_balance,
            maximumBalance: deal.maximum_balance,
            monthlyMinDeposit: deal.monthly_min_deposit,
            monthlyMaxDeposit: deal.monthly_max_deposit,
          },
        }, { onConflict: "user_id,financial_account_id,savings_rate_deal_id" });

        if (!error) {
          recommendations += 1;
          createdForAccount += 1;
          detail.push({ account_id: account.id, deal_id: deal.id, delta, estimatedGain });
        }
      }

      await supabase.from("financial_accounts").update({ savings_last_recommendation_at: now }).eq("id", account.id);
    }

    await supabase.from("savings_rate_watch_runs").update({ status: "completed", finished_at: new Date().toISOString(), accounts_checked: checked, recommendations_created: recommendations, payload: { detail: detail.slice(0, 100), skippedNoTier, settings } }).eq("id", run.id);
    return { ok: true, checked, recommendations_created: recommendations, skipped_no_tier: skippedNoTier };
  } catch (error: any) {
    await supabase.from("savings_rate_watch_runs").update({ status: "failed", finished_at: new Date().toISOString(), accounts_checked: checked, recommendations_created: recommendations, error: error?.message || "failed", payload: { detail, skippedNoTier, settings } }).eq("id", run.id);
    throw error;
  }
}

export async function expireStaleSavingsDeals(supabase: any, staleDays: number, triggeredBy?: string | null) {
  const now = new Date().toISOString();
  const threshold = new Date(Date.now() - Math.max(1, staleDays) * 24 * 60 * 60 * 1000).toISOString();
  const { data: staleRows, error: readError } = await supabase
    .from("savings_rate_deals")
    .select("id,status,lifecycle_status,missing_observation_count,gross_aer,source_payload,source_url,verification_status")
    .in("status", ["active", "needs_review"])
    .or(`last_checked_at.is.null,last_checked_at.lt.${threshold}`);
  if (readError) throw new Error(readError.message);

  let pending = 0;
  let withdrawn = 0;
  for (const deal of staleRows || []) {
    const missingCount = Number(deal.missing_observation_count || 0) + 1;
    const shouldWithdraw = missingCount >= 3;
    const lifecycleStatus = shouldWithdraw ? "WITHDRAWN" : "PENDING_WITHDRAWAL";
    const { error } = await supabase.from("savings_rate_deals").update({
      status: shouldWithdraw ? "expired" : deal.status,
      lifecycle_status: lifecycleStatus,
      missing_observation_count: missingCount,
      effective_to: shouldWithdraw ? now : null,
      updated_at: now,
      admin_notes: `${shouldWithdraw ? "Withdrawn" : "Pending withdrawal"} after ${missingCount} missing/stale observation(s). Last-check threshold ${threshold}. Triggered by ${triggeredBy || "system"}.`,
    }).eq("id", deal.id);
    if (error) throw new Error(error.message);
    await supabase.from("savings_rate_deal_versions").insert({
      savings_rate_deal_id: deal.id,
      lifecycle_status: lifecycleStatus,
      verification_status: deal.verification_status || "UNVERIFIED",
      gross_aer: deal.gross_aer,
      product_payload: { ...(deal.source_payload || {}), missingObservationCount: missingCount, staleThreshold: threshold },
      source_url: deal.source_url,
      effective_from: now,
      effective_to: shouldWithdraw ? now : null,
    });
    if (shouldWithdraw) withdrawn += 1;
    else pending += 1;
  }
  return { pending_withdrawal: pending, withdrawn, threshold };
}
