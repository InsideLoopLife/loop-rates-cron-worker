import { calculateSavingsAccruedBalance } from "@/lib/wealth/savings-accrual";

export type SavingsAccountLike = {
  id: string;
  name?: string | null;
  provider?: string | null;
  provider_slug?: string | null;
  account_type?: string | null;
  current_balance?: number | null;
  balance_last_confirmed_value?: number | null;
  balance_last_confirmed_at?: string | null;
  interest_rate?: number | null;
  monthly_top_up_amount?: number | null;
  savings_limit_scope?: string | null;
  owner_person_id?: string | null;
  ownership_scope?: string | null;
  interest_rate_end_date?: string | null;
  end_date?: string | null;
  updated_at?: string | null;
};

export type SavingsDealLike = {
  id: string;
  provider_slug?: string | null;
  provider_name?: string | null;
  product_name?: string | null;
  account_type?: string | null;
  gross_aer?: number | null;
  bonus_rate?: number | null;
  minimum_balance?: number | null;
  maximum_balance?: number | null;
  monthly_min_deposit?: number | null;
  monthly_max_deposit?: number | null;
  access_type?: string | null;
  withdrawal_rules?: string | null;
  notice_period_days?: number | null;
  term_length_months?: number | null;
  rate_type?: string | null;
  requires_existing_customer?: boolean | null;
  eligible_provider_slug?: string | null;
  eligibility_note?: string | null;
  source_url?: string | null;
  last_checked_at?: string | null;
};

export type ProviderRelationshipLike = {
  provider_slug: string;
  provider_name?: string | null;
  relationship_type?: string | null;
};

export type PayEventLike = {
  id?: string | null;
  person_id?: string | null;
  label?: string | null;
  pay_kind?: string | null;
  gross_annual_salary?: number | null;
  monthly_take_home_override?: number | null;
  effective_from?: string | null;
  effective_until?: string | null;
};

export type PlannedItemLike = {
  direction?: string | null;
  amount?: number | null;
  monthly_cost?: number | null;
  recurrence?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  end_behavior?: string | null;
};

export type SavingsOpportunity = {
  key: string;
  title: string;
  body: string;
  tone: "good" | "warning" | "action" | "info";
  metric?: string;
};

export type SavingsDealMatch = SavingsDealLike & {
  eligible_now: boolean;
  eligibility_status: "eligible_now" | "needs_provider" | "open_market";
  best_gain?: number;
  best_account_id?: string | null;
};

export type SavingsCatalogueHealth = {
  status: "healthy" | "partial" | "unavailable";
  activeDeals: number;
  completeDeals: number;
  freshDeals: number;
  confidence: "high" | "medium" | "low";
};

export type SavingsTaxPosition = {
  personId: string;
  grossIncome: number;
  attributedNonIsaInterest: number;
  attributedIsaBalance: number;
  savingsAllowance: number;
  taxableInterest: number;
  savingsTaxRate: number;
  estimatedSavingsTax: number;
};

const ISA_ALLOWANCE_DEFAULT = 20000;
const BASIC_SAVINGS_ALLOWANCE = 1000;
const HIGHER_SAVINGS_ALLOWANCE = 500;

function n(value: unknown) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num : 0;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function taxYearWindow(date = new Date()) {
  const year = date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1;
  return {
    start: `${year}-04-06`,
    end: `${year + 1}-04-05`,
    label: `${year}/${String(year + 1).slice(2)}`,
  };
}

function activeInMonth(item: PlannedItemLike, month = new Date().toISOString().slice(0, 7)) {
  const [year, monthNum] = month.split("-").map(Number);
  const start = `${month}-01`;
  const end = new Date(year, monthNum, 0).toISOString().slice(0, 10);
  return String(item.start_date || "1900-01-01") <= end && String(item.end_behavior === "drops_off" ? item.end_date || "9999-12-31" : "9999-12-31") >= start;
}

function monthlyAmount(item: PlannedItemLike) {
  const amount = n(item.monthly_cost ?? item.amount);
  const recurrence = String(item.recurrence || "monthly").toLowerCase();
  if (recurrence === "weekly") return amount * 52 / 12;
  if (recurrence === "fortnightly") return amount * 26 / 12;
  if (recurrence === "annual" || recurrence === "annually" || recurrence === "yearly") return amount / 12;
  if (recurrence === "quarterly") return amount / 3;
  return amount;
}

function accountKindMatches(accountType: string | null | undefined, dealAccountType: string | null | undefined) {
  const account = String(accountType || "savings").toLowerCase();
  const deal = String(dealAccountType || "savings").toLowerCase();
  if (deal.includes("isa")) return account.includes("isa") || account.includes("savings");
  if (deal.includes("regular")) return account.includes("regular") || account.includes("savings");
  if (deal.includes("fixed")) return account.includes("fixed") || account.includes("bond") || account.includes("savings");
  if (deal.includes("notice")) return account.includes("notice") || account.includes("savings");
  return !account.includes("mortgage") && !account.includes("investment") && !account.includes("current_account");
}

export function savingsDealEligibleBalance(account: SavingsAccountLike, deal: SavingsDealLike) {
  const balance = Math.max(0, calculateSavingsAccruedBalance(account as any).estimatedBalance);
  const minimum = Math.max(0, n(deal.minimum_balance));
  if (minimum > 0 && balance < minimum) return 0;
  const maximum = n(deal.maximum_balance) > 0 ? n(deal.maximum_balance) : Number.POSITIVE_INFINITY;
  const monthlyCap = Math.max(0, n(deal.monthly_max_deposit));
  const isRegularSaver = String(deal.account_type || deal.access_type || "").toLowerCase().includes("regular");
  // A regular saver cannot receive the whole balance on day one. Six months of the
  // annual deposit allowance is a fair first-year average balance for rate comparisons.
  const regularSaverAverage = isRegularSaver && monthlyCap > 0 ? monthlyCap * 6 : Number.POSITIVE_INFINITY;
  return Math.max(0, Math.min(balance, maximum, regularSaverAverage));
}

export function savingsDealMatchesAccount(account: SavingsAccountLike, deal: SavingsDealLike) {
  if (!accountKindMatches(account.account_type, deal.account_type)) return false;
  return savingsDealEligibleBalance(account, deal) > 0;
}

function catalogueHealth(deals: SavingsDealLike[]): SavingsCatalogueHealth {
  const now = Date.now();
  const activeDeals = deals.filter((deal) => n(deal.gross_aer) > 0).length;
  const completeDeals = deals.filter((deal) => {
    const kind = String(deal.account_type || deal.access_type || "").toLowerCase();
    const hasAccess = Boolean(deal.access_type || deal.withdrawal_rules || deal.notice_period_days || deal.term_length_months);
    const hasLimit = deal.minimum_balance != null && (deal.maximum_balance != null || !kind.includes("regular"));
    return n(deal.gross_aer) > 0 && hasAccess && hasLimit;
  }).length;
  const freshDeals = deals.filter((deal) => {
    if (!deal.last_checked_at) return false;
    const checked = new Date(deal.last_checked_at).getTime();
    return Number.isFinite(checked) && now - checked <= 7 * 86_400_000;
  }).length;
  const status = activeDeals === 0 ? "unavailable" : activeDeals >= 10 && completeDeals >= Math.ceil(activeDeals * 0.6) ? "healthy" : "partial";
  return { activeDeals, completeDeals, freshDeals, status, confidence: status === "healthy" && freshDeals >= Math.ceil(activeDeals * 0.5) ? "high" : status === "unavailable" ? "low" : "medium" };
}

export function providerSlugsFromAccounts(accounts: SavingsAccountLike[], relationships: ProviderRelationshipLike[]) {
  const map = new Map<string, ProviderRelationshipLike>();
  for (const rel of relationships || []) {
    if (rel.provider_slug) map.set(rel.provider_slug, rel);
  }
  for (const account of accounts || []) {
    const slug = String(account.provider_slug || "").trim();
    if (!slug) continue;
    if (!map.has(slug)) {
      map.set(slug, {
        provider_slug: slug,
        provider_name: account.provider || slug,
        relationship_type: "savings_account",
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => String(a.provider_name || a.provider_slug).localeCompare(String(b.provider_name || b.provider_slug)));
}

export function classifySavingsDeals(accounts: SavingsAccountLike[], deals: SavingsDealLike[], heldProviders: ProviderRelationshipLike[]): SavingsDealMatch[] {
  const held = new Set(providerSlugsFromAccounts(accounts, heldProviders).map((item) => item.provider_slug));
  return (deals || []).map((deal) => {
    const providerSlug = String(deal.provider_slug || "");
    const eligibleProvider = String(deal.eligible_provider_slug || providerSlug || "");
    const needsProvider = Boolean(deal.requires_existing_customer);
    const eligibleNow = !needsProvider || held.has(providerSlug) || held.has(eligibleProvider);
    const eligibilityStatus: SavingsDealMatch["eligibility_status"] = needsProvider ? (eligibleNow ? "eligible_now" : "needs_provider") : "open_market";
    let bestGain = 0;
    let bestAccountId: string | null = null;
    for (const account of accounts || []) {
      if (!savingsDealMatchesAccount(account, deal)) continue;
      const suggestedRate = n(deal.gross_aer);
      const currentRate = n(account.interest_rate);
      const eligibleBalance = savingsDealEligibleBalance(account, deal);
      const gain = Math.max(0, (suggestedRate - currentRate) / 100) * eligibleBalance;
      if (gain > bestGain) {
        bestGain = gain;
        bestAccountId = account.id;
      }
    }
    return {
      ...deal,
      eligible_now: eligibleNow,
      eligibility_status: eligibilityStatus,
      best_gain: bestGain,
      best_account_id: bestAccountId,
    };
  }).sort((a, b) => Number(b.eligible_now) - Number(a.eligible_now) || n(b.gross_aer) - n(a.gross_aer));
}

export function estimateMonthlyFlow(plannedItems: PlannedItemLike[]) {
  const active = (plannedItems || []).filter((item) => activeInMonth(item));
  const income = active.filter((item) => item.direction === "income").reduce((sum, item) => sum + monthlyAmount(item), 0);
  const outgoings = active.filter((item) => item.direction !== "income").reduce((sum, item) => sum + monthlyAmount(item), 0);
  return { income, outgoings, spare: income - outgoings };
}

function activeLatestPayEvents(payEvents: PayEventLike[], onDate = todayIso()) {
  const active = (payEvents || []).filter((event) => {
    const start = String(event.effective_from || "1900-01-01");
    const end = String(event.effective_until || "9999-12-31");
    return start <= onDate && end >= onDate;
  });
  // Editing income creates dated versions. Keep only the newest active version for the
  // same person and label so historical rows do not inflate tax-band estimates.
  const latestByIncome = new Map<string, PayEventLike>();
  for (const event of active) {
    const key = `${event.person_id || "household"}:${String(event.label || event.pay_kind || event.id || "salary").toLowerCase()}`;
    const existing = latestByIncome.get(key);
    if (!existing || String(event.effective_from || "1900-01-01") >= String(existing.effective_from || "1900-01-01")) latestByIncome.set(key, event);
  }
  return Array.from(latestByIncome.values());
}

export function estimateGrossAnnualIncome(payEvents: PayEventLike[], onDate = todayIso(), personId?: string | null) {
  return activeLatestPayEvents(payEvents, onDate)
    .filter((event) => !personId || event.person_id === personId)
    .reduce((sum, event) => sum + n(event.gross_annual_salary), 0);
}

export function estimateGrossAnnualIncomeByPerson(payEvents: PayEventLike[], onDate = todayIso()) {
  const totals = new Map<string, number>();
  for (const event of activeLatestPayEvents(payEvents, onDate)) {
    const personId = String(event.person_id || "household");
    totals.set(personId, (totals.get(personId) || 0) + n(event.gross_annual_salary));
  }
  return totals;
}

export function personalSavingsAllowance(totalTaxableIncome: number) {
  // 2026/27 UK Personal Savings Allowance: £1,000 basic, £500 higher, £0 additional.
  // Savings income itself is included when determining the band.
  if (totalTaxableIncome > 125140) return 0;
  if (totalTaxableIncome > 50270) return HIGHER_SAVINGS_ALLOWANCE;
  return BASIC_SAVINGS_ALLOWANCE;
}

export function marginalSavingsTaxRate(totalTaxableIncome: number) {
  // Savings income rates for 2026/27. These rules are intentionally isolated so they can
  // be replaced by the versioned tax-rule table in a later tax year.
  if (totalTaxableIncome > 125140) return 45;
  if (totalTaxableIncome > 50270) return 40;
  return 20;
}

function buildTaxPositions(params: {
  accounts: SavingsAccountLike[];
  payEvents: PayEventLike[];
  adultPersonIds: string[];
}) {
  const incomeByPerson = estimateGrossAnnualIncomeByPerson(params.payEvents);
  const adultIds = params.adultPersonIds.length
    ? params.adultPersonIds
    : Array.from(incomeByPerson.keys()).filter((id) => id !== "household");
  const fallbackIds = adultIds.length ? adultIds : ["household"];
  const nonIsaInterestByPerson = new Map<string, number>();
  const isaBalanceByPerson = new Map<string, number>();

  for (const account of params.accounts) {
    const balance = calculateSavingsAccruedBalance(account as any).estimatedBalance;
    const isIsa = String(account.account_type || account.name || "").toLowerCase().includes("isa")
      || String(account.savings_limit_scope || "").toLowerCase().includes("isa");
    const owners = account.owner_person_id ? [account.owner_person_id] : fallbackIds;
    const share = owners.length > 0 ? 1 / owners.length : 1;
    for (const personId of owners) {
      if (isIsa) isaBalanceByPerson.set(personId, (isaBalanceByPerson.get(personId) || 0) + balance * share);
      else nonIsaInterestByPerson.set(personId, (nonIsaInterestByPerson.get(personId) || 0) + balance * n(account.interest_rate) / 100 * share);
    }
  }

  const allPersonIds = new Set<string>([
    ...fallbackIds,
    ...Array.from(incomeByPerson.keys()).filter((id) => id !== "household"),
    ...nonIsaInterestByPerson.keys(),
    ...isaBalanceByPerson.keys(),
  ]);

  const positions: SavingsTaxPosition[] = Array.from(allPersonIds).map((personId) => {
    const grossIncome = incomeByPerson.get(personId) || 0;
    const attributedNonIsaInterest = nonIsaInterestByPerson.get(personId) || 0;
    const attributedIsaBalance = isaBalanceByPerson.get(personId) || 0;
    const bandIncome = grossIncome + attributedNonIsaInterest;
    const savingsAllowance = personalSavingsAllowance(bandIncome);
    const taxableInterest = Math.max(0, attributedNonIsaInterest - savingsAllowance);
    const savingsTaxRate = marginalSavingsTaxRate(bandIncome);
    return {
      personId,
      grossIncome,
      attributedNonIsaInterest,
      attributedIsaBalance,
      savingsAllowance,
      taxableInterest,
      savingsTaxRate,
      estimatedSavingsTax: taxableInterest * savingsTaxRate / 100,
    };
  });
  return positions;
}

export function buildSavingsIntelligence(params: {
  accounts: SavingsAccountLike[];
  deals: SavingsDealLike[];
  relationships: ProviderRelationshipLike[];
  plannedItems: PlannedItemLike[];
  payEvents: PayEventLike[];
  pensionValue?: number;
  pensionMonthlyContribution?: number;
  subjectPersonId?: string | null;
  adultPersonIds?: string[];
}) {
  const accounts = params.accounts || [];
  const totalSavings = accounts.reduce((sum, account) => sum + calculateSavingsAccruedBalance(account as any).estimatedBalance, 0);
  const monthlyTopUps = accounts.reduce((sum, account) => sum + n(account.monthly_top_up_amount), 0);
  const weightedRate = totalSavings > 0 ? accounts.reduce((sum, account) => sum + calculateSavingsAccruedBalance(account as any).estimatedBalance * n(account.interest_rate), 0) / totalSavings : 0;
  const isaAccounts = accounts.filter((account) => String(account.account_type || account.name || "").toLowerCase().includes("isa") || String(account.savings_limit_scope || "").toLowerCase().includes("isa"));
  const taxableAccounts = accounts.filter((account) => !isaAccounts.includes(account));
  const isaBalance = isaAccounts.reduce((sum, account) => sum + calculateSavingsAccruedBalance(account as any).estimatedBalance, 0);
  const taxableBalance = taxableAccounts.reduce((sum, account) => sum + calculateSavingsAccruedBalance(account as any).estimatedBalance, 0);
  const nonIsaInterest = taxableAccounts.reduce((sum, account) => sum + calculateSavingsAccruedBalance(account as any).estimatedBalance * n(account.interest_rate) / 100, 0);
  const weightedNonIsaRate = taxableBalance > 0
    ? taxableAccounts.reduce((sum, account) => sum + calculateSavingsAccruedBalance(account as any).estimatedBalance * n(account.interest_rate), 0) / taxableBalance
    : 0;
  const taxPositions = buildTaxPositions({
    accounts,
    payEvents: params.payEvents,
    adultPersonIds: params.adultPersonIds || [],
  });
  const subjectPosition = taxPositions.find((position) => position.personId === params.subjectPersonId)
    || taxPositions.sort((a, b) => b.grossIncome - a.grossIncome)[0]
    || {
      personId: params.subjectPersonId || "household",
      grossIncome: 0,
      attributedNonIsaInterest: nonIsaInterest,
      attributedIsaBalance: isaBalance,
      savingsAllowance: personalSavingsAllowance(nonIsaInterest),
      taxableInterest: Math.max(0, nonIsaInterest - personalSavingsAllowance(nonIsaInterest)),
      savingsTaxRate: marginalSavingsTaxRate(nonIsaInterest),
      estimatedSavingsTax: 0,
    };
  const grossIncome = subjectPosition.grossIncome;
  const savingsAllowance = subjectPosition.savingsAllowance;
  const savingsTaxRate = subjectPosition.savingsTaxRate;
  const taxableInterest = subjectPosition.taxableInterest;
  const estimatedSavingsTax = subjectPosition.estimatedSavingsTax;
  const subjectNonIsaInterest = subjectPosition.attributedNonIsaInterest;
  const subjectIsaBalance = subjectPosition.attributedIsaBalance;
  const isaRoom = Math.max(0, ISA_ALLOWANCE_DEFAULT - subjectIsaBalance);
  const subjectTaxableBalance = taxableAccounts.reduce((sum, account) => {
    if (account.owner_person_id && account.owner_person_id !== subjectPosition.personId) return sum;
    const balance = calculateSavingsAccruedBalance(account as any).estimatedBalance;
    if (!account.owner_person_id && (params.adultPersonIds || []).length > 1) return sum + balance / (params.adultPersonIds || []).length;
    return sum + balance;
  }, 0);
  const cashToShelter = weightedNonIsaRate > 0
    ? Math.min(subjectTaxableBalance, isaRoom, taxableInterest / (weightedNonIsaRate / 100))
    : 0;
  const monthlyFlow = estimateMonthlyFlow(params.plannedItems);
  const classifiedDeals = classifySavingsDeals(accounts, params.deals, params.relationships);
  const eligibleDeals = classifiedDeals.filter((deal) => deal.eligible_now);
  const bestEligibleRate = eligibleDeals.reduce((best, deal) => Math.max(best, n(deal.gross_aer)), 0);
  const staleAccounts = accounts.filter((account) => {
    const confirmed = account.balance_last_confirmed_at || account.updated_at;
    if (!confirmed) return true;
    const ageDays = (Date.now() - new Date(confirmed).getTime()) / 86400000;
    return ageDays > 31;
  });
  const lowRateAccounts = accounts.filter((account) => n(account.interest_rate) > 0 && bestEligibleRate > n(account.interest_rate) + 0.5);
  const catalogue = catalogueHealth(params.deals || []);

  const opportunities: SavingsOpportunity[] = [];
  if (eligibleDeals.length > 0 && bestEligibleRate > weightedRate + 0.25) {
    opportunities.push({
      key: "better-rate",
      title: "Better-rate option available",
      body: `Best eligible logged rate is ${bestEligibleRate.toFixed(2)}% vs your blended ${weightedRate.toFixed(2)}%. Review the Better-rate tab before moving money.`,
      tone: "action",
      metric: `+${(bestEligibleRate - weightedRate).toFixed(2)}%`,
    });
  }
  if (subjectNonIsaInterest > savingsAllowance * 0.75 && subjectIsaBalance < ISA_ALLOWANCE_DEFAULT) {
    opportunities.push({
      key: "isa-shield",
      title: "ISA allowance check",
      body: `Estimated non-ISA interest attributed to this person is approaching their Personal Savings Allowance. They have about £${Math.max(0, ISA_ALLOWANCE_DEFAULT - subjectIsaBalance).toLocaleString("en-GB")} of ISA room to review.`,
      tone: "warning",
      metric: "Tax check",
    });
  }
  if (monthlyFlow.spare > monthlyTopUps + 50) {
    opportunities.push({
      key: "spare-cash",
      title: "Possible unused monthly surplus",
      body: `Financial Flow shows roughly £${Math.round(monthlyFlow.spare).toLocaleString("en-GB")}/mo unassigned after logged items. This may not be truly spare, but LOOP can use it as a savings optimisation prompt.`,
      tone: "info",
      metric: `£${Math.round(monthlyFlow.spare)}/mo`,
    });
  }
  if (monthlyTopUps > 0 && accounts.filter((account) => n(account.monthly_top_up_amount) > 0).length === 1) {
    opportunities.push({
      key: "concentration",
      title: "Top-up concentration",
      body: "Most tracked monthly saving is going into one account. Check whether a regular saver, ISA or emergency-cash split would improve the outcome.",
      tone: "info",
      metric: "Split check",
    });
  }
  if (staleAccounts.length > 0) {
    opportunities.push({
      key: "stale-balances",
      title: "Balance refresh needed",
      body: `${staleAccounts.length} saver${staleAccounts.length === 1 ? "" : "s"} have not been confirmed for over a month. Confirming them makes projections and tax prompts more reliable.`,
      tone: "warning",
      metric: `${staleAccounts.length} stale`,
    });
  }
  if (accounts.length > 0 && monthlyTopUps <= 0) {
    opportunities.push({
      key: "no-topups",
      title: "No regular top-ups logged",
      body: "Add monthly top-ups or movement logs so LOOP can forecast savings growth rather than treating the accounts as static balances.",
      tone: "action",
      metric: "Setup",
    });
  }

  const balancesByProvider = new Map<string, number>();
  for (const account of accounts) {
    const provider = String(account.provider_slug || account.provider || account.id);
    balancesByProvider.set(provider, (balancesByProvider.get(provider) || 0) + calculateSavingsAccruedBalance(account as any).estimatedBalance);
  }
  // FSCS protects eligible deposits up to £120,000 per person, per authorised firm
  // from 1 December 2025. Provider slugs are only an approximation until banking-
  // licence groups are stored, so this score is deliberately capped below full marks.
  const largestProviderBalance = Math.max(0, ...balancesByProvider.values());
  const scoreParts = {
    rate: catalogue.status === "unavailable" ? 20 : Math.min(40, Math.max(0, 40 - Math.max(0, bestEligibleRate - weightedRate) * 10)),
    suitability: Math.min(20, accounts.length > 0 && eligibleDeals.length > 0 ? 20 : accounts.length > 0 ? 10 : 4),
    tax: Math.min(15, taxableInterest <= 0 ? 15 : subjectIsaBalance > 0 ? 9 : 4),
    protection: Math.min(10, balancesByProvider.size > 1 ? 9 : largestProviderBalance <= 120000 ? 7 : 2),
    goals: Math.min(10, monthlyTopUps > 0 ? 10 : monthlyFlow.spare > 100 ? 5 : 3),
    data: Math.min(5, Math.max(1, 5 - staleAccounts.length * 2)),
  };
  const score = Math.round(Object.values(scoreParts).reduce((sum, value) => sum + value, 0));
  const taxYear = taxYearWindow();

  return {
    score,
    scoreParts,
    catalogue,
    totalSavings,
    monthlyTopUps,
    weightedRate,
    isaBalance: subjectIsaBalance,
    householdIsaBalance: isaBalance,
    isaAllowance: ISA_ALLOWANCE_DEFAULT,
    nonIsaInterest: subjectNonIsaInterest,
    householdNonIsaInterest: nonIsaInterest,
    savingsAllowance,
    taxableInterest,
    savingsTaxRate,
    estimatedSavingsTax,
    weightedNonIsaRate,
    cashToShelter,
    grossIncome,
    subjectPersonId: subjectPosition.personId,
    taxPositions,
    taxYear,
    isaAccounts,
    taxableAccounts,
    monthlyFlow,
    opportunities,
    classifiedDeals,
    eligibleDeals,
    lowRateAccounts,
    staleAccounts,
    today: todayIso(),
  };
}
