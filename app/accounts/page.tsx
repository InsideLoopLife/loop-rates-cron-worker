import Link from "next/link";
import { redirect } from "next/navigation";
import { Nav } from "@/components/Nav";
import { SectionCard } from "@/components/SectionCard";
import { StatCard } from "@/components/StatCard";
import { FormInput } from "@/components/FormInput";
import { SubmitButton } from "@/components/SubmitButton";
import { BalanceHistoryChart } from "@/components/BalanceHistoryChart";
import { SavingsMovementChart, type SavingsMovementPoint } from "@/components/savings/SavingsMovementChart";
import { createClient } from "@/lib/supabase/server";
import { createWorkerDatabaseClient } from "@/platform/database/worker-client";
import { getCachedSavingsRateDeals } from "@/lib/wealth/cached-savings-rate-deals";
import {
  dedupeHouseholdPeople,
  getActiveHouseholdContext,
  householdMemberDataOrFilter,
  householdPeopleOrFilter,
  visibleDataOrFilter,
} from "@/lib/auth/household-context";
import { formatMoney } from "@/lib/format/money";
import {
  FINANCIAL_INSTITUTIONS,
  findInstitution,
} from "@/lib/catalogue/financial-institutions";
import { SavingsAccountWizard } from "@/components/savings/SavingsAccountWizard";
import { SavingsProviderRelationships } from "@/components/savings/SavingsProviderRelationships";
import { SavingsLiveBalance } from "@/components/savings/SavingsLiveBalance";
import { SavingsProjectionPlanner } from "@/components/savings/SavingsProjectionPlanner";
import { SavingsAccountModalShell } from "@/components/savings/SavingsAccountModalShell";
import { SavingsPotsRotator } from "@/components/savings/SavingsPotsRotator";
import { FinancialInstitutionLogo } from "@/components/savings/FinancialInstitutionLogo";
import { SavingsActivityThread } from "@/components/savings/SavingsActivityThread";
import { SavingsOptimiser } from "@/components/savings/SavingsOptimiser";
import { PiggyPotVisual } from "@/components/savings/PiggyPotVisual";
import { SavingsPotJourney } from "@/components/savings/SavingsPotJourney";
import { SavingsGoalVisual } from "@/components/savings/SavingsGoalVisual";
import { SavingsPotThread, type SavingsPotMovementRow } from "@/components/savings/SavingsPotThread";
import { PageLandingExperience } from "@/components/landing/PageLandingExperience";
import { calculateSavingsAccruedBalance } from "@/lib/wealth/savings-accrual";
import {
  buildSavingsTrajectory,
  estimatedSavingsBalanceFromLedger,
  movementDelta,
  movementDirection,
  savingsMonthSummary,
} from "@/lib/wealth/savings-ledger";
import { estimateSavingsInterestForMonth } from "@/lib/wealth/savings-interest";
import {
  classifyIsaWrapper,
  isaAllowanceLimitForPerson,
  isaAllowanceRule,
  isaPersonEligibility,
  isJuniorIsaWrapper,
} from "@/lib/wealth/isa-allowance";
import {
  deriveIncomePensionContribution,
  deriveMonthlyPensionContribution,
  derivePensionAnnualRate,
  derivePensionRateScenarios,
  type PensionPerformanceAssumption,
} from "@/lib/wealth/pension-projection";
import { userHasWealthFeature } from "@/lib/wealth/watch-entitlements";
import {
  buildSavingsIntelligence,
  classifySavingsDeals,
  providerSlugsFromAccounts,
  savingsDealEligibleBalance,
  savingsDealMatchesAccount,
  isChildSavingsDeal,
  type SavingsDealLike,
} from "@/lib/wealth/savings-intelligence";
import {
  addFinancialAccount,
  addSavingsAccountMovement,
  addSavingsPotAllocation,
  addSavingsPotMovement,
  assignSavingsAccountOwner,
  createSavingsPot,
  deleteFinancialAccount,
  deleteSavingsAccountMovement,
  deleteSavingsPot,
  deleteSavingsPotAllocation,
  saveFinancialProviderRelationship,
  savePensionPerformanceAssumption,
  updateFinancialAccount,
  saveSavingsDealEligibility,
} from "./actions";

type FinancialAccount = {
  id: string;
  name: string;
  provider: string | null;
  provider_slug?: string | null;
  savings_product_name?: string | null;
  account_type: string;
  current_balance: number;
  balance_last_confirmed_value?: number | null;
  balance_last_confirmed_at?: string | null;
  interest_rate?: number | null;
  interest_accrual_frequency?: string | null;
  interest_compounding_frequency?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  interest_rate_end_date?: string | null;
  top_up_day?: number | null;
  monthly_top_up_amount?: number | null;
  opening_balance_assumption?: number | null;
  start_date?: string | null;
  end_date?: string | null;
  deal_duration_mode?: string | null;
  savings_rate_deal_id?: string | null;
  is_liability: boolean;
  last_synced_at: string | null;
  owner_person_id?: string | null;
  ownership_scope?: string | null;
  savings_limit_scope?: string | null;
  visibility_scope?: string | null;
  savings_goal_name?: string | null;
  savings_goal_target_amount?: number | null;
  savings_goal_target_date?: string | null;
  savings_goal_monthly_contribution_override?: number | null;
  savings_goal_priority?: number | null;
  savings_goal_status?: string | null;
  owner_is_child?: boolean;
  owner_relationship?: string | null;
  owner_birth_date?: string | null;
};

type InvestmentIsaAccount = {
  id: string;
  person_id?: string | null;
  account_type?: string | null;
  provider_isa_subscribed_amount?: number | null;
  provider_isa_allowance_year?: string | null;
};

type SavingsOwner = {
  id: string;
  user_id?: string | null;
  linked_user_id?: string | null;
  name: string;
  relationship: string | null;
  birth_date?: string | null;
  account_status?: string | null;
  active_until?: string | null;
  avatar_url?: string | null;
};

type HouseholdMeta = {
  id: string;
  name: string | null;
  image_url?: string | null;
};



type SavingsDeal = {
  id: string;
  provider_slug: string | null;
  provider_name: string | null;
  product_name: string | null;
  account_type: string | null;
  gross_aer: number | null;
  bonus_rate: number | null;
  minimum_balance?: number | null;
  maximum_balance?: number | null;
  monthly_min_deposit?: number | null;
  monthly_max_deposit?: number | null;
  access_type?: string | null;
  withdrawal_rules?: string | null;
  notice_period_days?: number | null;
  term_length_months?: number | null;
  rate_type?: string | null;
  requires_existing_customer: boolean | null;
  eligible_provider_slug: string | null;
  eligibility_note: string | null;
  source_url: string | null;
  status: string | null;
  last_checked_at?: string | null;
};

type HeldProvider = {
  provider_slug: string;
  provider_name: string | null;
  relationship_type: string | null;
};

type DealFeedback = {
  eligibility_status?: string | null;
  used_before?: boolean | null;
};

type SavingsRateRecommendation = {
  id: string;
  financial_account_id: string | null;
  savings_rate_deal_id: string | null;
  provider_slug: string | null;
  provider_name: string | null;
  product_name: string | null;
  recommendation_kind: string | null;
  eligibility_status: string | null;
  current_rate: number | null;
  suggested_rate: number | null;
  rate_delta: number | null;
  balance_checked: number | null;
  estimated_annual_gain: number | null;
  source_url: string | null;
  reason: string | null;
  status: string | null;
  created_at: string | null;
};

type SavingsMovement = {
  id: string;
  financial_account_id: string;
  movement_type: string;
  amount: number;
  previous_balance?: number | null;
  balance_delta?: number | null;
  resulting_balance: number | null;
  effective_at: string | null;
  note: string | null;
  created_at: string | null;
  source_type?: string | null;
  tax_year?: string | null;
};

type PlannedItem = {
  label?: string | null;
  direction: string | null;
  amount: number | null;
  monthly_cost?: number | null;
  recurrence: string | null;
  start_date: string | null;
  end_date: string | null;
  end_behavior?: string | null;
  spending_categories?: {
    standard_category_key: string | null;
    emergency_fund_essential?: boolean | null;
    spending_category_groups?: { emergency_fund_essential?: boolean | null } | Array<{ emergency_fund_essential?: boolean | null }> | null;
  } | null;
};

type ChildEssentialCost = {
  label?: string | null;
  monthly_cost?: number | null;
  spending_categories?: PlannedItem["spending_categories"];
};

type PayEvent = {
  id?: string | null;
  person_id?: string | null;
  label?: string | null;
  pay_kind?: string | null;
  gross_annual_salary: number | null;
  monthly_take_home_override: number | null;
  pension_percent?: number | null;
  pension_method?: string | null;
  employer_pension_percent?: number | null;
  employer_pension_monthly_amount?: number | null;
  employer_ni_topup_enabled?: boolean | null;
  employer_ni_rate_percent?: number | null;
  employer_ni_topup_share_percent?: number | null;
  effective_from: string | null;
  effective_until: string | null;
};

type PensionAccount = {
  id: string;
  person_id?: string | null;
  current_value: number | null;
  fixed_monthly_contribution: number | null;
};

type PensionFund = {
  id: string;
  pension_account_id: string | null;
  fund_name?: string | null;
  current_value: number | null;
  units: number | null;
  unit_price: number | null;
};

type PensionSnapshot = {
  pension_account_id?: string | null;
  snapshot_date: string | null;
  value: number | null;
  monthly_contribution_applied?: number | null;
};

type PensionContributionEvent = {
  pension_account_id?: string | null;
  contribution_date?: string | null;
  contribution_due_date?: string | null;
  investment_date?: string | null;
  contribution_amount?: number | null;
  employee_amount?: number | null;
  employer_amount?: number | null;
  employer_ni_topup_amount?: number | null;
  fixed_amount?: number | null;
  event_status?: string | null;
};

type SavingsPot = {
  id: string;
  user_id: string;
  household_id?: string | null;
  person_id?: string | null;
  name: string;
  target_amount?: number | null;
  target_date?: string | null;
  monthly_target?: number | null;
  current_allocated_amount?: number | null;
  priority?: number | null;
  colour?: string | null;
  icon?: string | null;
  status?: string | null;
  visibility_scope?: string | null;
  notes?: string | null;
  reference_image_url?: string | null;
  goal_type?: string | null;
  priority_is_important?: boolean | null;
  priority_score?: number | null;
};

type SavingsPotAllocation = {
  id: string;
  savings_pot_id: string;
  financial_account_id?: string | null;
  allocation_type: string;
  amount: number;
  allocation_percent?: number | null;
  effective_from?: string | null;
  notes?: string | null;
};



const tabs = [
  { key: "overview", label: "Overview" },
  { key: "pots", label: "Pots" },
  { key: "accounts", label: "Tracked accounts" },
  { key: "banks", label: "Your banks", hidden: true },
  { key: "rates", label: "Better-rate watch" },
  { key: "ai", label: "AI optimiser" },
  { key: "projection", label: "Projection" },
  { key: "add", label: "Add account" },
] as const;

type SavingsTab = (typeof tabs)[number]["key"];

function initials(name?: string | null) {
  return String(name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "?";
}

function AvatarBubble({ imageUrl, label, className = "h-10 w-10", active = false }: { imageUrl?: string | null; label?: string | null; className?: string; active?: boolean }) {
  return (
    <span className={`grid shrink-0 place-items-center overflow-hidden rounded-full text-xs font-black shadow-sm ${className} ${active ? "bg-orange-500 text-white ring-2 ring-orange-200" : "bg-slate-950 text-white"}`}>
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt={label || "Owner"} className="h-full w-full object-cover" />
      ) : (
        initials(label || "Household")
      )}
    </span>
  );
}

function ownerScopeFor(person?: SavingsOwner | null) {
  if (!person) return { ownership: "household", allowance: "household" };
  if (String(person.relationship || "").toLowerCase() === "child") return { ownership: "child", allowance: "child" };
  return { ownership: "personal", allowance: "individual" };
}

function valueOfFund(fund: PensionFund) {
  const direct = Number(fund.current_value || 0);
  if (direct > 0) return direct;
  return Number(fund.units || 0) * Number(fund.unit_price || 0);
}

function monthsBetween(start: Date, end: Date) {
  return Math.max(0, (end.getFullYear() - start.getFullYear()) * 12 + end.getMonth() - start.getMonth());
}

function formatGoalTime(months: number | null) {
  if (months == null) return "Set top-up";
  if (months <= 0) return "Ready now";
  if (months === 1) return "About 1 month";
  if (months < 12) return `About ${months} months`;
  const years = Math.floor(months / 12);
  const remainder = months % 12;
  return remainder ? `About ${years}y ${remainder}m` : `About ${years} year${years === 1 ? "" : "s"}`;
}

function buildSavingsGoal(account: FinancialAccount) {
  const target = Number(account.savings_goal_target_amount || 0);
  const balance = calculateSavingsAccruedBalance(account).estimatedBalance;
  if (!target || target <= 0) return null;
  const remaining = Math.max(0, target - balance);
  const monthly = Number(account.savings_goal_monthly_contribution_override || account.monthly_top_up_amount || 0);
  const monthsAtPace = remaining <= 0 ? 0 : monthly > 0 ? Math.ceil(remaining / monthly) : null;
  const progress = Math.max(0, Math.min(100, (balance / target) * 100));
  const targetDate = account.savings_goal_target_date ? new Date(`${account.savings_goal_target_date}T00:00:00`) : null;
  const monthsToTargetDate = targetDate ? Math.max(1, monthsBetween(new Date(), targetDate)) : null;
  const requiredMonthly = monthsToTargetDate ? remaining / monthsToTargetDate : null;
  const monthlyGap = requiredMonthly != null ? Math.max(0, requiredMonthly - monthly) : null;
  const onTrack = remaining <= 0 || (requiredMonthly != null && monthly >= requiredMonthly) || (requiredMonthly == null && monthly > 0);
  return {
    label: account.savings_goal_name || `${account.name || "Savings pot"} goal`,
    target,
    balance,
    remaining,
    monthly,
    monthsAtPace,
    progress,
    targetDate: account.savings_goal_target_date || null,
    requiredMonthly,
    monthlyGap,
    onTrack,
  };
}

function movementLabel(type: string) {
  const clean = String(type || "movement").replaceAll("_", " ");
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

function buildSavingsMovementSeries(movements: SavingsMovement[], months = 12): SavingsMovementPoint[] {
  const now = new Date();
  const rows: SavingsMovementPoint[] = [];
  const byMonth = new Map<string, SavingsMovementPoint>();
  for (let offset = months - 1; offset >= 0; offset -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const row = { month, saved: 0, interest: 0, withdrawn: 0 };
    rows.push(row);
    byMonth.set(month, row);
  }
  for (const movement of movements) {
    const month = String(movement.effective_at || movement.created_at || "").slice(0, 7);
    const row = byMonth.get(month);
    if (!row || movement.movement_type === "opening_balance") continue;
    const amount = Math.abs(movementDelta(movement));
    if (movement.movement_type === "interest") row.interest += amount;
    else if (["withdrawal", "fee"].includes(movement.movement_type) || movementDirection(movement) === "out") row.withdrawn += amount;
    else row.saved += amount;
  }
  return rows;
}

function cleanDealLabel(value?: string | null) {
  return String(value || "Not stated").replaceAll("_", " ");
}

function daysOld(value?: string | null) {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, Math.floor((Date.now() - timestamp) / 86_400_000));
}

function dealInfoRows(deal: SavingsDealLike) {
  return [
    { label: "Rate type", value: cleanDealLabel(deal.rate_type) },
    { label: "Access", value: cleanDealLabel(deal.access_type || deal.account_type) },
    { label: "Notice", value: deal.notice_period_days ? `${deal.notice_period_days} days` : "Not stated" },
    { label: "Term", value: deal.term_length_months ? `${deal.term_length_months} months` : deal.rate_type === "fixed" ? "Fixed term" : "Ongoing / variable" },
    { label: "Min", value: deal.minimum_balance != null ? formatMoney(deal.minimum_balance) : "Not stated" },
    { label: "Max", value: deal.maximum_balance != null ? formatMoney(deal.maximum_balance) : "Not stated" },
    { label: "Monthly min", value: deal.monthly_min_deposit != null ? formatMoney(deal.monthly_min_deposit) : "Not stated" },
    { label: "Monthly max", value: deal.monthly_max_deposit != null ? formatMoney(deal.monthly_max_deposit) : "Not stated" },
  ];
}

// BUGFIX (production build failure): this only ever reads these 4 fields,
// never `status` — but was typed to require the full SavingsDeal shape,
// which broke when eligibleDeals started being populated with
// SavingsDealMatch objects (a different, newer type missing `status`).
// Narrowed to just what's actually used, so it accepts either type. This
// never showed up in local `next dev`, only in a real production build
// (`next build`), which does full strict type-checking that dev mode
// skips — this was likely the first time this code has gone through one.
function maximumDealReturn(deal: {
  gross_aer?: number | null;
  term_length_months?: number | null;
  monthly_max_deposit?: number | null;
  maximum_balance?: number | null;
}) {
  const rate = Number(deal.gross_aer || 0) / 100;
  const months = Math.max(1, Number(deal.term_length_months || 12));
  const monthlyCap = Number(deal.monthly_max_deposit || 0);
  const balanceCap = Number(deal.maximum_balance || 0);
  if (!rate) return null;
  if (monthlyCap > 0) {
    const usableMonths = balanceCap > 0 ? Math.min(months, Math.ceil(balanceCap / monthlyCap)) : months;
    let interest = 0;
    for (let month = 0; month < usableMonths; month += 1) {
      const deposit = balanceCap > 0 ? Math.min(monthlyCap, Math.max(0, balanceCap - monthlyCap * month)) : monthlyCap;
      interest += deposit * rate * ((months - month) / 12);
    }
    return { deposit: Math.min(balanceCap || Infinity, monthlyCap * usableMonths), interest };
  }
  if (balanceCap > 0) return { deposit: balanceCap, interest: balanceCap * rate * (months / 12) };
  return null;
}

function dealMaximumDeposit(deal: SavingsDealLike) {
  const maximum = Number(deal.maximum_balance || 0);
  const minimum = Number(deal.minimum_balance || 0);
  // Tiny extracted maxima (for example £2 beside a £1 minimum) are commonly
  // page-navigation artefacts, not genuine product limits. Do not headline them.
  if (maximum > 0 && !(maximum < 100 && maximum <= Math.max(2, minimum * 2))) return maximum;
  const monthly = Number(deal.monthly_max_deposit || 0);
  const months = Number(deal.term_length_months || 12);
  return monthly > 0 ? monthly * Math.max(1, months) : null;
}

function dealAccessLabel(deal: SavingsDealLike) {
  if (deal.notice_period_days) return `${deal.notice_period_days} days' notice`;
  if (deal.term_length_months) return `${deal.term_length_months}-month term`;
  return cleanDealLabel(deal.access_type || deal.rate_type || "Check access");
}

function SavingsDealCard({
  deal,
  personLabel,
  feedback,
}: {
  deal: SavingsDealLike & { eligible_now?: boolean; best_gain?: number };
  personLabel: string;
  feedback?: { eligibility_status?: string | null; used_before?: boolean | null } | null;
}) {
  const maximumDeposit = dealMaximumDeposit(deal);
  const returnModel = maximumDealReturn(deal);
  const childOnly = isChildSavingsDeal(deal);
  const tone = childOnly ? "border-violet-200 bg-violet-50/60" : deal.eligible_now ? "border-emerald-200 bg-emerald-50/60" : "border-orange-200 bg-orange-50/50";
  const personTone = childOnly ? "bg-violet-700" : deal.eligible_now ? "bg-emerald-700" : "bg-orange-600";
  return (
    <article className={`relative rounded-[1.75rem] border p-5 pt-7 shadow-sm ${tone}`}>
      <span className={`absolute -top-3 left-5 rounded-full px-3 py-1.5 text-[11px] font-black uppercase tracking-wide text-white shadow-sm ${personTone}`}>{personLabel}</span>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">{deal.provider_name ?? deal.provider_slug ?? "Provider"}</p>
          <h4 className="mt-1 text-lg font-black leading-tight text-slate-950">{deal.product_name ?? "Savings account"}</h4>
          <p className="mt-1 text-sm font-bold text-slate-500">{cleanDealLabel(deal.account_type || deal.access_type || "Savings account")}</p>
        </div>
        <div className="shrink-0 text-right"><p className="text-3xl font-black text-slate-950">{deal.gross_aer != null ? `${Number(deal.gross_aer).toFixed(2)}%` : "TBC"}</p><p className="text-[10px] font-black uppercase tracking-wide text-slate-400">AER</p></div>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <div className="rounded-2xl bg-white/90 p-3"><p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Save overall</p><p className="mt-1 text-sm font-black text-slate-950">{maximumDeposit ? `Up to ${formatMoney(maximumDeposit)}` : "No maximum stated"}</p></div>
        <div className="rounded-2xl bg-white/90 p-3"><p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Pay in monthly</p><p className="mt-1 text-sm font-black text-slate-950">{deal.monthly_max_deposit != null ? `Up to ${formatMoney(deal.monthly_max_deposit)}` : "No monthly cap stated"}</p></div>
        <div className="col-span-2 rounded-2xl bg-white/90 p-3 sm:col-span-1"><p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Access</p><p className="mt-1 text-sm font-black text-slate-950">{dealAccessLabel(deal)}</p></div>
      </div>
      {returnModel ? <p className="mt-3 text-sm font-bold text-slate-600">Could earn about <span className="font-black text-slate-950">{formatMoney(returnModel.interest)}</span> at the maximum modelled deposit.</p> : null}
      <details className="mt-4 border-t border-slate-200/80 pt-3">
        <summary className="ml-auto w-fit cursor-pointer list-none rounded-full bg-slate-950 px-4 py-2 text-xs font-black text-white">Explore further →</summary>
        <div className="mt-4 rounded-2xl bg-white/80 p-4">
          <div className="grid grid-cols-2 gap-x-5 gap-y-3 text-sm sm:grid-cols-4">{dealInfoRows(deal).map((row) => <div key={row.label}><p className="text-[10px] font-black uppercase tracking-wide text-slate-400">{row.label}</p><p className="mt-1 font-bold text-slate-700">{row.value}</p></div>)}</div>
          {deal.requires_existing_customer ? <p className="mt-4 text-xs font-bold text-orange-700">Requires an existing relationship with {deal.eligible_provider_slug || deal.provider_name || deal.provider_slug}.</p> : null}
          {deal.withdrawal_rules ? <p className="mt-3 text-xs font-bold leading-5 text-slate-600">{deal.withdrawal_rules}</p> : null}
          <form action={saveSavingsDealEligibility} className="mt-4 flex flex-wrap items-center gap-2">
            <input type="hidden" name="savings_rate_deal_id" value={deal.id} />
            <span className="text-xs font-black text-slate-700">Applicable?</span>
            <button name="eligibility_status" value="eligible" className={`rounded-full px-3 py-1.5 text-xs font-black ${feedback?.eligibility_status === "eligible" ? "bg-emerald-800 text-white" : "bg-emerald-50 text-emerald-800"}`}>Yes</button>
            <button name="eligibility_status" value="not_eligible" className={`rounded-full px-3 py-1.5 text-xs font-black ${feedback?.eligibility_status === "not_eligible" ? "bg-rose-600 text-white" : "bg-rose-50 text-rose-700"}`}>No</button>
            <label className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1.5 text-xs font-black text-blue-700"><input type="checkbox" name="used_before" value="true" defaultChecked={Boolean(feedback?.used_before)} className="h-4 w-4 accent-blue-700" /> Used before</label>
          </form>
          {deal.source_url ? <a href={deal.source_url} target="_blank" rel="noreferrer" className="mt-4 inline-block text-xs font-black text-slate-800 underline">View provider/source details ↗</a> : null}
        </div>
      </details>
    </article>
  );
}

function SavingsRecommendationCard({ recommendation, account, deal, personLabel }: { recommendation: SavingsRateRecommendation; account?: FinancialAccount | null; deal?: SavingsDealLike | null; personLabel: string }) {
  return (
    <article className="relative rounded-[1.75rem] border border-orange-200 bg-gradient-to-br from-orange-50 to-white p-5 pt-7 shadow-sm">
      <span className="absolute -top-3 left-5 rounded-full bg-slate-950 px-3 py-1.5 text-[11px] font-black uppercase tracking-wide text-white shadow-sm">{personLabel}</span>
      <p className="text-xs font-black uppercase tracking-[0.14em] text-orange-700">{recommendation.provider_name || recommendation.provider_slug || "Provider"}</p>
      <h3 className="mt-1 text-xl font-black text-slate-950">{recommendation.product_name || "Better-rate account"}</h3>
      <p className="mt-1 text-sm font-bold text-slate-500">{deal ? cleanDealLabel(deal.account_type || deal.access_type) : "Savings account"}</p>
      <div className="mt-5 grid grid-cols-3 gap-2">
        <div className="rounded-2xl bg-white p-3"><p className="text-[10px] font-black uppercase text-slate-400">Now</p><p className="font-black text-slate-950">{Number(recommendation.current_rate || 0).toFixed(2)}%</p></div>
        <div className="rounded-2xl bg-white p-3"><p className="text-[10px] font-black uppercase text-slate-400">Better rate</p><p className="font-black text-slate-950">{Number(recommendation.suggested_rate || 0).toFixed(2)}%</p></div>
        <div className="rounded-2xl bg-white p-3"><p className="text-[10px] font-black uppercase text-slate-400">Could add</p><p className="font-black text-slate-950">{formatMoney(recommendation.estimated_annual_gain)}/yr</p></div>
      </div>
      {deal ? <div className="mt-3 grid grid-cols-2 gap-2"><div className="rounded-2xl bg-white/90 p-3"><p className="text-[10px] font-black uppercase text-slate-400">Save overall</p><p className="text-sm font-black">{dealMaximumDeposit(deal) ? `Up to ${formatMoney(dealMaximumDeposit(deal))}` : "No maximum stated"}</p></div><div className="rounded-2xl bg-white/90 p-3"><p className="text-[10px] font-black uppercase text-slate-400">Pay in monthly</p><p className="text-sm font-black">{deal.monthly_max_deposit ? `Up to ${formatMoney(deal.monthly_max_deposit)}` : "No cap stated"}</p></div></div> : null}
      <details className="mt-4 border-t border-orange-200 pt-3"><summary className="ml-auto w-fit cursor-pointer list-none rounded-full bg-slate-950 px-4 py-2 text-xs font-black text-white">Explore further →</summary><div className="mt-4 rounded-2xl bg-white p-4"><p className="text-sm font-bold leading-6 text-slate-600">{recommendation.reason || "Check the eligibility, access and deposit rules before moving money."}</p>{account ? <p className="mt-3 text-xs font-bold text-slate-500">Compared with {account.provider || "your provider"} · {account.name || "tracked account"}</p> : null}{recommendation.source_url ? <a href={recommendation.source_url} target="_blank" rel="noreferrer" className="mt-3 inline-block text-xs font-black text-orange-700 underline">View provider/source details ↗</a> : null}</div></details>
    </article>
  );
}

function TabLink({ tab, activeTab }: { tab: SavingsTab; activeTab: SavingsTab }) {
  const config = tabs.find((item) => item.key === tab)!;
  return (
    <Link
      href={`/accounts?tab=${tab}`}
      className={`rounded-full px-4 py-2 text-sm font-black transition ${activeTab === tab ? "bg-slate-950 text-white shadow-sm" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"}`}
    >
      {config.label}
    </Link>
  );
}

function OpportunityCard({ title, body, metric, tone }: { title: string; body: string; metric?: string; tone: string }) {
  const toneClass = tone === "action"
    ? "border-orange-200 bg-orange-50 text-orange-900"
    : tone === "warning"
      ? "border-amber-200 bg-amber-50 text-amber-900"
      : tone === "good"
        ? "border-emerald-200 bg-emerald-50 text-emerald-900"
        : "border-slate-200 bg-white text-slate-900";
  return (
    <article className={`rounded-3xl border p-5 shadow-sm ${toneClass}`}>
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-lg font-black">{title}</h3>
        {metric ? <span className="shrink-0 rounded-full bg-white/80 px-3 py-1 text-xs font-black">{metric}</span> : null}
      </div>
      <p className="mt-2 text-sm font-bold opacity-75">{body}</p>
    </article>
  );
}

export default async function AccountsPage({ searchParams }: { searchParams?: Promise<{ tab?: string }> }) {
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const activeTab = tabs.some((tab) => tab.key === resolvedSearchParams.tab) ? (resolvedSearchParams.tab as SavingsTab) : "overview";

  const supabase = await createClient();
  const ratesSupabase = createWorkerDatabaseClient("rates");
  // The rates catalogue (savings_rate_deals below) now lives in its own,
  // separate Supabase project — moved off the main database due to usage
  // overage. Everything else on this page still uses the regular client.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const householdContext = await getActiveHouseholdContext(supabase, user);
  const householdVisibleFilter = visibleDataOrFilter(householdContext);
  const householdPeopleFilter = householdPeopleOrFilter(householdContext);
  const householdMemberFilter = householdMemberDataOrFilter(householdContext);
  const memberUserIds = householdContext.memberUserIds?.length ? householdContext.memberUserIds : [user.id];
  const householdAllocationFilter = householdContext.householdId
    ? `user_id.eq.${user.id},household_id.eq.${householdContext.householdId}`
    : `user_id.eq.${user.id}`;
  const pensionHistoryStart = new Date();
  pensionHistoryStart.setFullYear(pensionHistoryStart.getFullYear() - 10);
  const pensionHistoryStartDate = pensionHistoryStart.toISOString().slice(0, 10);

  const [
    { data: accounts },
    { data: savingsDeals },
    { data: heldProviders },
    { data: savingsRecommendations },
    { data: peopleRows },
    { data: householdMeta },
    { data: movements },
    { data: plannedItems },
    { data: childEssentialCosts },
    { data: payEventsInitial },
    { data: pensionAccounts },
    { data: pensionFunds },
    { data: pensionSnapshots },
    { data: pensionContributionEvents },
    { data: savingsPots },
    { data: savingsPotAllocations },
    { data: dealEligibilityRows },
    { data: investmentIsaAccounts },
  ] = await Promise.all([
    supabase
      .from("financial_accounts")
      .select(
        "id, name, provider, provider_slug, savings_product_name, account_type, current_balance, balance_last_confirmed_value, balance_last_confirmed_at, interest_rate, interest_accrual_frequency, interest_compounding_frequency, interest_rate_end_date, top_up_day, monthly_top_up_amount, opening_balance_assumption, start_date, end_date, deal_duration_mode, savings_rate_deal_id, is_liability, last_synced_at, owner_person_id, ownership_scope, savings_limit_scope, visibility_scope, savings_goal_name, savings_goal_target_amount, savings_goal_target_date, savings_goal_monthly_contribution_override, savings_goal_priority, savings_goal_status, created_at, updated_at",
      )
      .or(householdVisibleFilter)
      .eq("is_liability", false)
      .order("created_at", { ascending: false })
      .returns<FinancialAccount[]>(),
    getCachedSavingsRateDeals().then((data) => ({ data: data as SavingsDeal[] })),
    supabase
      .from("user_financial_provider_relationships")
      .select("provider_slug, provider_name, relationship_type")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .returns<HeldProvider[]>(),
    ratesSupabase
      .from("savings_rate_recommendations")
      .select(
        "id, financial_account_id, savings_rate_deal_id, provider_slug, provider_name, product_name, recommendation_kind, eligibility_status, current_rate, suggested_rate, rate_delta, balance_checked, estimated_annual_gain, source_url, reason, status, created_at",
      )
      .eq("user_id", user.id)
      .in("status", ["new", "seen", "watching"])
      .order("estimated_annual_gain", { ascending: false, nullsFirst: false })
      .limit(12)
      .returns<SavingsRateRecommendation[]>(),
    supabase
      .from("people")
      .select(
        "id, user_id, linked_user_id, name, relationship, birth_date, account_status, active_until, avatar_url",
      )
      .or(householdPeopleFilter)
      .or("account_status.is.null,account_status.neq.duplicate_merged")
      .is("active_until", null)
      .order("relationship")
      .order("name")
      .returns<SavingsOwner[]>(),
    householdContext.householdId
      ? supabase
          .from("app_households")
          .select("id, name, image_url")
          .eq("id", householdContext.householdId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("savings_account_movements")
      .select("id, financial_account_id, movement_type, amount, previous_balance, balance_delta, resulting_balance, effective_at, note, created_at, source_type, tax_year")
      .or(householdVisibleFilter)
      .order("effective_at", { ascending: false })
      .limit(1000)
      .returns<SavingsMovement[]>(),
    supabase
      .from("planned_items")
      .select("label, direction, amount, recurrence, start_date, end_date, end_behavior, spending_categories(standard_category_key, emergency_fund_essential, spending_category_groups(emergency_fund_essential))")
      .or(householdMemberFilter)
      .returns<PlannedItem[]>(),
    supabase
      .from("child_costs")
      .select("label, monthly_cost, spending_categories(standard_category_key, emergency_fund_essential, spending_category_groups(emergency_fund_essential))")
      .or(householdMemberFilter)
      .returns<ChildEssentialCost[]>(),
    supabase
      .from("pay_events")
      .select("id, person_id, label, pay_kind, gross_annual_salary, monthly_take_home_override, pension_percent, pension_method, employer_pension_percent, employer_pension_monthly_amount, employer_ni_topup_enabled, employer_ni_rate_percent, employer_ni_topup_share_percent, effective_from, effective_until")
      .or(householdMemberFilter)
      .returns<PayEvent[]>(),
    supabase
      .from("pension_accounts")
      .select("id, person_id, current_value, fixed_monthly_contribution")
      .in("user_id", memberUserIds)
      .returns<PensionAccount[]>(),
    supabase
      .from("pension_funds")
      .select("id, pension_account_id, fund_name, current_value, units, unit_price")
      .in("user_id", memberUserIds)
      .returns<PensionFund[]>(),
    activeTab === "projection" ? supabase
      .from("pension_fund_value_snapshots")
      .select("pension_account_id, snapshot_date, value, monthly_contribution_applied, unit_price")
      .in("user_id", memberUserIds)
      .gte("snapshot_date", pensionHistoryStartDate)
      .order("snapshot_date", { ascending: true })
      .returns<PensionSnapshot[]>() : Promise.resolve({ data: [] as PensionSnapshot[] }),
    activeTab === "projection" ? supabase
      .from("pension_contribution_events")
      .select("pension_account_id, contribution_date, contribution_due_date, investment_date, contribution_amount, employee_amount, employer_amount, employer_ni_topup_amount, fixed_amount, event_status")
      .in("user_id", memberUserIds)
      .gte("contribution_date", pensionHistoryStartDate)
      .order("contribution_date", { ascending: true })
      .returns<PensionContributionEvent[]>() : Promise.resolve({ data: [] as PensionContributionEvent[] }),
    supabase
      .from("savings_pots")
      .select("id,user_id,household_id,person_id,name,target_amount,target_date,monthly_target,current_allocated_amount,priority,priority_is_important,priority_score,goal_type,colour,icon,status,visibility_scope,notes,reference_image_url")
      .or(householdVisibleFilter)
      .in("status", ["active", "paused", "completed"])
      .order("priority", { ascending: true })
      .returns<SavingsPot[]>(),
    supabase
      .from("savings_pot_allocations")
      .select("id,savings_pot_id,financial_account_id,allocation_type,amount,allocation_percent,effective_from,notes")
      .or(householdAllocationFilter)
      .order("created_at", { ascending: true })
      .returns<SavingsPotAllocation[]>(),
    supabase
      .from("user_savings_deal_eligibility")
      .select("savings_rate_deal_id, eligibility_status, used_before")
      .eq("user_id", user.id),
    supabase
      .from("investment_accounts")
      .select("id,person_id,account_type,provider_isa_subscribed_amount,provider_isa_allowance_year")
      .in("user_id", memberUserIds)
      .neq("record_status", "archived")
      .returns<InvestmentIsaAccount[]>(),
  ]);

  let payEvents = payEventsInitial ?? [];
  // Older local databases may not yet have every salary-sacrifice field. Fall back to the
  // core pay columns rather than silently treating a known pension contribution as £0.
  if (!payEvents.length) {
    const { data: fallbackPayEvents } = await supabase
      .from("pay_events")
      .select("id, person_id, label, pay_kind, gross_annual_salary, monthly_take_home_override, pension_percent, pension_method, effective_from, effective_until")
      .or(householdMemberFilter)
      .returns<PayEvent[]>();
    payEvents = fallbackPayEvents ?? [];
  }

  const [{ data: pensionPerformanceAssumptions }, { data: savingsPotMovements }] = await Promise.all([
    supabase
      .from("pension_fund_performance_assumptions")
      .select("pension_fund_id,pension_account_id,fund_name,current_value,annualised_5y_percent,annualised_10y_percent,as_of_date,source_url,source_name,verified_at")
      .in("user_id", memberUserIds)
      .order("as_of_date", { ascending: false })
      .returns<PensionPerformanceAssumption[]>(),
    supabase
      .from("savings_pot_movements")
      .select("id,savings_pot_id,amount,movement_type,effective_at,note")
      .or(householdAllocationFilter)
      .order("effective_at", { ascending: false })
      .returns<SavingsPotMovementRow[]>(),
  ]);

  const hasAiSavingsFeature = await userHasWealthFeature(supabase as any, user.id, "savings_rate_watch");

  const people = dedupeHouseholdPeople((peopleRows ?? []) as SavingsOwner[], user.id);
  const ownerOptions = people.filter((person) => ["self", "partner", "child", "other"].includes(String(person.relationship || "other")));
  const defaultOwnerPerson =
    ownerOptions.find((person) => person.linked_user_id === user.id || (person.user_id === user.id && person.relationship === "self")) ??
    ownerOptions.find((person) => person.user_id === user.id) ??
    null;
  const ownerById = new Map(ownerOptions.map((person) => [person.id, person]));

  const childPersonIds = new Set(ownerOptions.filter((person) => String(person.relationship || "").toLowerCase() === "child").map((person) => person.id));
  const accountRows: FinancialAccount[] = (accounts ?? [])
    .filter((account) => !["current_account"].includes(account.account_type))
    .map((account) => {
      const owner = ownerById.get(String(account.owner_person_id || ""));
      return {
        ...account,
        owner_is_child: childPersonIds.has(String(account.owner_person_id || "")),
        owner_relationship: owner?.relationship || null,
        owner_birth_date: owner?.birth_date || null,
      } as FinancialAccount;
    });
  // Everyday / current accounts aren't savings vehicles (no rate, no goal), but they still need to exist
  // as financial_accounts rows so they can be picked as a "paid into" / "paid from" account elsewhere
  // in Financial Flow (spending, income, planner). Surface them here so people can add/manage them.
  const everydayAccountRows = (accounts ?? []).filter((account) => account.account_type === "current_account");
  const personalSavings = accountRows.filter((account) => account.owner_person_id || account.ownership_scope === "personal" || account.ownership_scope === "child");
  const sharedSavings = accountRows.filter((account) => !account.owner_person_id || ["household", "joint"].includes(String(account.ownership_scope || "")));
  const totalSavings = accountRows.reduce((sum, account) => sum + estimatedSavingsBalanceFromLedger(account, movements ?? []), 0);
  const monthlyTopUps = accountRows.reduce((sum, account) => sum + Number(account.monthly_top_up_amount || 0), 0);
  const weightedRate = totalSavings > 0
    ? accountRows.reduce((sum, account) => sum + estimatedSavingsBalanceFromLedger(account, movements ?? []) * Number(account.interest_rate || 0), 0) / totalSavings
    : 0;

  const allHeldProviders = providerSlugsFromAccounts(accountRows, heldProviders ?? []);
  const dealMatches = classifySavingsDeals(accountRows, savingsDeals ?? [], allHeldProviders);
  const adultEligibleDeals = dealMatches.filter((deal) => deal.eligible_now && !isChildSavingsDeal(deal));
  const adultNeedsProviderDeals = dealMatches.filter((deal) => !deal.eligible_now && !isChildSavingsDeal(deal));
  const childDeals = dealMatches.filter((deal) => isChildSavingsDeal(deal));
  const eligibilityByDeal = new Map<string, DealFeedback>((dealEligibilityRows ?? []).map((row) => [String(row.savings_rate_deal_id), row as DealFeedback]));
  const adultPersonIds = ownerOptions
    .filter((person) => String(person.relationship || "").toLowerCase() !== "child")
    .map((person) => person.id);
  const activeIsaRule = isaAllowanceRule();
  const isaAccountById = new Map(accountRows.map((account) => [
    account.id,
    classifyIsaWrapper(account.savings_product_name, account.name, account.savings_limit_scope, account.account_type),
  ]));
  const isaPositions = ownerOptions.map((person) => {
    const isDefault = person.id === defaultOwnerPerson?.id;
    const savingsSubscriptions = (movements ?? []).reduce((sum, movement) => {
      const account = accountRows.find((row) => row.id === movement.financial_account_id);
      if (!account) return sum;
      const wrapper = isaAccountById.get(account.id) || "not_isa";
      if (wrapper === "not_isa" || String(movement.movement_type).toLowerCase() !== "deposit") return sum;
      if (movement.tax_year !== activeIsaRule.taxYear) return sum;
      const belongsToPerson = account.owner_person_id === person.id || (isDefault && !account.owner_person_id);
      return belongsToPerson ? sum + Math.max(0, movementDelta(movement)) : sum;
    }, 0);
    const providerSubscriptions = (investmentIsaAccounts ?? []).reduce((sum, account) => {
      const wrapper = classifyIsaWrapper(account.account_type);
      if (wrapper === "not_isa" || account.provider_isa_allowance_year !== activeIsaRule.taxYear) return sum;
      const belongsToPerson = account.person_id === person.id || (isDefault && !account.person_id);
      return belongsToPerson ? sum + Math.max(0, Number(account.provider_isa_subscribed_amount || 0)) : sum;
    }, 0);
    const representativeWrapper = String(person.relationship || "").toLowerCase() === "child" ? "junior_cash_isa" as const : "cash_isa" as const;
    const eligibility = isaPersonEligibility(person, representativeWrapper);
    const allowance = isaAllowanceLimitForPerson(person, representativeWrapper, activeIsaRule.taxYear);
    const used = savingsSubscriptions + providerSubscriptions;
    return {
      person,
      wrapper: representativeWrapper,
      eligibility,
      allowance,
      used,
      remaining: Math.max(0, allowance - used),
      savingsSubscriptions,
      providerSubscriptions,
    };
  });
  const subjectIsaPosition = isaPositions.find((position) => position.person.id === (defaultOwnerPerson?.id || adultPersonIds[0]));
  const emergencyItems: PlannedItem[] = [
    ...(plannedItems ?? []),
    ...(childEssentialCosts ?? []).map((cost) => ({
      label: cost.label,
      direction: "outgoing",
      amount: Number(cost.monthly_cost || 0),
      recurrence: "monthly",
      start_date: null,
      end_date: null,
      spending_categories: cost.spending_categories,
    })),
  ];
  const intelligence = buildSavingsIntelligence({
    accounts: accountRows,
    deals: savingsDeals ?? [],
    relationships: allHeldProviders,
    plannedItems: emergencyItems.map((item) => {
      const groupRelation = item.spending_categories?.spending_category_groups;
      const groupEssential = Array.isArray(groupRelation) ? groupRelation.some((group) => group.emergency_fund_essential) : Boolean(groupRelation?.emergency_fund_essential);
      return {
        ...item,
        standard_category_key: item.spending_categories?.standard_category_key ?? null,
        emergency_fund_essential: Boolean(item.spending_categories?.emergency_fund_essential || groupEssential),
      };
    }),
    payEvents: payEvents ?? [],
    subjectPersonId: defaultOwnerPerson?.id || adultPersonIds[0] || null,
    adultPersonIds,
    subjectIsaSubscribedAmount: subjectIsaPosition?.used || 0,
    subjectIsaAllowance: subjectIsaPosition?.allowance || activeIsaRule.adultTotalLimit,
  });

  const movementsByAccount = new Map<string, SavingsMovement[]>();
  for (const movement of movements ?? []) {
    const rows = movementsByAccount.get(movement.financial_account_id) || [];
    rows.push(movement);
    movementsByAccount.set(movement.financial_account_id, rows);
  }

  const savingsTrajectory = buildSavingsTrajectory(accountRows, movements ?? [], 24);
  const projectedSavingsPoints = savingsTrajectory.filter((point) => point.kind === "projected");
  const twelveMonthSavings = projectedSavingsPoints[11]?.balance ?? totalSavings;
  const currentMonthKey = intelligence.today.slice(0, 7);
  const currentMonthSummary = savingsMonthSummary(movements ?? [], currentMonthKey);
  const currentMonthInterest = estimateSavingsInterestForMonth(accountRows, movements ?? [], currentMonthKey);
  const savingsMovementSeries = buildSavingsMovementSeries(movements ?? [], 12);
  const essentialItemCount = emergencyItems.filter((item) => {
    const groupRelation = item.spending_categories?.spending_category_groups;
    const groupEssential = Array.isArray(groupRelation) ? groupRelation.some((group) => group.emergency_fund_essential) : Boolean(groupRelation?.emergency_fund_essential);
    return item.direction !== "income" && Boolean(item.spending_categories?.emergency_fund_essential || groupEssential);
  }).length;

  const pensionFundValueByAccount = new Map<string, number>();
  let unassignedPensionFundValue = 0;
  for (const fund of pensionFunds ?? []) {
    const value = valueOfFund(fund);
    if (fund.pension_account_id) {
      pensionFundValueByAccount.set(fund.pension_account_id, (pensionFundValueByAccount.get(fund.pension_account_id) || 0) + value);
    } else {
      unassignedPensionFundValue += value;
    }
  }
  const knownPensionAccountIds = new Set((pensionAccounts ?? []).map((account) => account.id));
  const orphanedPensionFundValue = (pensionFunds ?? []).reduce((sum, fund) => fund.pension_account_id && !knownPensionAccountIds.has(fund.pension_account_id) ? sum + valueOfFund(fund) : sum, 0);
  const pensionTotal = (pensionAccounts ?? []).reduce((sum, account) => {
    const fundValue = pensionFundValueByAccount.get(account.id) || 0;
    return sum + (fundValue > 0 ? fundValue : Number(account.current_value || 0));
  }, 0) + unassignedPensionFundValue + orphanedPensionFundValue;
  const configuredPensionContribution = (pensionAccounts ?? []).reduce((sum, account) => sum + Number(account.fixed_monthly_contribution || 0), 0);
  const incomePensionContribution = deriveIncomePensionContribution(payEvents ?? [], new Date(`${intelligence.today}T12:00:00`));
  const pensionRateModel = derivePensionAnnualRate(pensionSnapshots ?? [], pensionContributionEvents ?? [], 5);
  const pensionFundById = new Map((pensionFunds ?? []).map((fund) => [fund.id, fund]));
  const pensionRateScenarios = derivePensionRateScenarios(
    (pensionPerformanceAssumptions ?? []).map((row) => ({
      ...row,
      current_value: Number(row.current_value || pensionFundById.get(String(row.pension_fund_id || ""))?.current_value || 0),
    })),
    pensionRateModel,
    5,
  );
  const historicalPensionContribution = deriveMonthlyPensionContribution(pensionContributionEvents ?? [], configuredPensionContribution);
  const incomeHasEmployerDetail = incomePensionContribution.employerMonthly > 0 || incomePensionContribution.employerNiTopUpMonthly > 0;
  const useIncomePensionContribution = incomePensionContribution.monthlyContribution > 0
    && (incomeHasEmployerDetail || incomePensionContribution.monthlyContribution >= historicalPensionContribution.monthlyContribution);
  const pensionContributionModel = useIncomePensionContribution
    ? { monthlyContribution: incomePensionContribution.monthlyContribution, source: incomePensionContribution.source }
    : historicalPensionContribution;
  const pensionMonthlyContribution = pensionContributionModel.monthlyContribution;
  const pensionContributionDetail = useIncomePensionContribution
    ? incomePensionContribution.detail
    : historicalPensionContribution.monthlyContribution > 0
      ? `${historicalPensionContribution.source}; income settings currently evidence ${formatMoney(incomePensionContribution.monthlyContribution)}/mo employee/employer detail`
      : "No income or pension contribution settings found";
  const projectionAccounts = accountRows.map((account) => ({
    id: account.id,
    name: account.name || account.savings_product_name || account.provider || "Savings account",
    balance: estimatedSavingsBalanceFromLedger(account, movements ?? []),
    annualRate: Number(account.interest_rate || 0),
    monthlyTopUp: Number(account.monthly_top_up_amount || 0),
  }));
  const projectionPeople = ownerOptions
    .filter((person) => String(person.relationship || "").toLowerCase() !== "child")
    .map((person) => ({ id: person.id, name: person.name, birthDate: person.birth_date || null, isDefault: person.id === defaultOwnerPerson?.id }));

  const projectionSubjects = ownerOptions
    .filter((person) => String(person.relationship || "").toLowerCase() !== "child")
    .map((person) => {
      const isDefault = person.id === defaultOwnerPerson?.id;
      const personSavings = accountRows.filter((account) =>
        account.owner_person_id === person.id ||
        (isDefault && !account.owner_person_id && !["household", "joint"].includes(String(account.ownership_scope || "").toLowerCase())),
      );
      const personPensionAccounts = (pensionAccounts ?? []).filter((account) => account.person_id === person.id || (isDefault && !account.person_id));
      const personPensionIds = new Set(personPensionAccounts.map((account) => account.id));
      const personPensionBalance = personPensionAccounts.reduce((sum, account) => {
        const fundValue = pensionFundValueByAccount.get(account.id) || 0;
        return sum + (fundValue > 0 ? fundValue : Number(account.current_value || 0));
      }, 0);
      const personPayEvents = (payEvents ?? []).filter((event) => event.person_id === person.id);
      const personContributionEvents = (pensionContributionEvents ?? []).filter((event) =>
        event.pension_account_id ? personPensionIds.has(event.pension_account_id) : isDefault,
      );
      const personSnapshots = (pensionSnapshots ?? []).filter((snapshot) =>
        snapshot.pension_account_id ? personPensionIds.has(snapshot.pension_account_id) : isDefault,
      );
      const personConfiguredContribution = personPensionAccounts.reduce((sum, account) => sum + Number(account.fixed_monthly_contribution || 0), 0);
      const personIncomeContribution = deriveIncomePensionContribution(personPayEvents, new Date(`${intelligence.today}T12:00:00`));
      const personHistoricalContribution = deriveMonthlyPensionContribution(personContributionEvents, personConfiguredContribution);
      const personUsesIncome = personIncomeContribution.monthlyContribution > 0 && (
        personIncomeContribution.employerMonthly > 0 ||
        personIncomeContribution.employerNiTopUpMonthly > 0 ||
        personIncomeContribution.monthlyContribution >= personHistoricalContribution.monthlyContribution
      );
      const personContributionModel = personUsesIncome
        ? { monthlyContribution: personIncomeContribution.monthlyContribution, source: personIncomeContribution.source }
        : personHistoricalContribution;
      const personRateModel = derivePensionAnnualRate(personSnapshots, personContributionEvents, 5);
      const personAssumptions = (pensionPerformanceAssumptions ?? []).filter((row) =>
        row.pension_account_id ? personPensionIds.has(String(row.pension_account_id)) : false,
      );
      const personRateScenarios = derivePensionRateScenarios(
        personAssumptions.map((row) => ({
          ...row,
          current_value: Number(row.current_value || pensionFundById.get(String(row.pension_fund_id || ""))?.current_value || 0),
        })),
        personRateModel,
        5,
      );
      const incomeLabels = personPayEvents.map((event) => event.label || event.pay_kind || "income record").filter(Boolean);
      const detailBase = personUsesIncome ? personIncomeContribution.detail : personHistoricalContribution.monthlyContribution > 0 ? personHistoricalContribution.source : "No recurring pension contribution found";
      return {
        person: { id: person.id, name: person.name, birthDate: person.birth_date || null, isDefault },
        savingsAccounts: personSavings.map((account) => ({
          id: account.id,
          name: account.name || account.savings_product_name || account.provider || "Savings account",
          balance: estimatedSavingsBalanceFromLedger(account, movements ?? []),
          annualRate: Number(account.interest_rate || 0),
          monthlyTopUp: Number(account.monthly_top_up_amount || 0),
        })),
        pensionBalance: personPensionBalance,
        monthlyPensionContribution: personContributionModel.monthlyContribution,
        pensionAnnualRate: personRateScenarios.middle,
        pensionRateScenarios: personRateScenarios,
        pensionRateSource: personRateScenarios.source,
        pensionContributionSource: personContributionModel.source,
        pensionContributionDetail: `${detailBase}${incomeLabels.length ? ` · income rows: ${incomeLabels.join(", ")}` : ""}${isDefault && personPensionAccounts.some((account) => !account.person_id) ? " · includes legacy pension accounts not yet assigned to a person" : ""}`,
      };
    });

  const savingsGoals = accountRows
    .map((account) => ({ account, goal: buildSavingsGoal(account) }))
    .filter((row): row is { account: FinancialAccount; goal: NonNullable<ReturnType<typeof buildSavingsGoal>> } => Boolean(row.goal))
    .sort((a, b) => Number(a.account.savings_goal_priority || 99) - Number(b.account.savings_goal_priority || 99));

  const accountById = new Map(accountRows.map((account) => [account.id, account]));
  const dealById = new Map((savingsDeals ?? []).map((deal) => [deal.id, deal]));
  const visibleSavingsRecommendations = (savingsRecommendations ?? []).filter((recommendation) => {
    const account = recommendation.financial_account_id ? accountById.get(recommendation.financial_account_id) : null;
    const deal = recommendation.savings_rate_deal_id ? dealById.get(recommendation.savings_rate_deal_id) : null;
    return !account || !deal || savingsDealMatchesAccount(account, deal);
  });
  const adultRecommendations = visibleSavingsRecommendations.filter((recommendation) => {
    const deal = recommendation.savings_rate_deal_id ? dealById.get(recommendation.savings_rate_deal_id) : null;
    return !deal || !isChildSavingsDeal(deal);
  });
  const childRecommendations = visibleSavingsRecommendations.filter((recommendation) => {
    const deal = recommendation.savings_rate_deal_id ? dealById.get(recommendation.savings_rate_deal_id) : null;
    return Boolean(deal && isChildSavingsDeal(deal));
  });
  const personLabelForAccount = (account?: FinancialAccount | null) => {
    if (account?.owner_person_id) return ownerById.get(account.owner_person_id)?.name || (account.owner_is_child ? "Child" : "Account owner");
    return account?.owner_is_child ? "Child" : defaultOwnerPerson?.name || "You";
  };
  const childAudienceLabel = ownerOptions.filter((person) => String(person.relationship || "").toLowerCase() === "child").length === 1
    ? ownerOptions.find((person) => String(person.relationship || "").toLowerCase() === "child")?.name || "Child"
    : "Children";
  const allocationsByPot = new Map<string, SavingsPotAllocation[]>();
  for (const allocation of savingsPotAllocations ?? []) {
    const rows = allocationsByPot.get(allocation.savings_pot_id) || [];
    rows.push(allocation);
    allocationsByPot.set(allocation.savings_pot_id, rows);
  }
  const potMovementsByPot = new Map<string, SavingsPotMovementRow[]>();
  for (const movement of savingsPotMovements ?? []) {
    const rows = potMovementsByPot.get(movement.savings_pot_id) || [];
    rows.push(movement);
    potMovementsByPot.set(movement.savings_pot_id, rows);
  }
  const potRows = (savingsPots ?? []).map((pot) => {
    const allocations = allocationsByPot.get(pot.id) || [];
    const potMovements = potMovementsByPot.get(pot.id) || [];
    const allocated = allocations.length > 0
      ? allocations.reduce((sum, allocation) => {
          const account = allocation.financial_account_id ? accountById.get(allocation.financial_account_id) : null;
          const percent = Number(allocation.allocation_percent || 0);
          if (account && percent > 0) return sum + estimatedSavingsBalanceFromLedger(account, movements ?? []) * Math.min(100, percent) / 100;
          return sum + Math.max(0, Number(allocation.amount || 0));
        }, 0)
      : Math.max(0, Number(pot.current_allocated_amount || 0));
    const threadedAllocation = potMovements.reduce((sum, movement) => sum + Number(movement.amount || 0), 0);
    const totalAllocated = Math.max(0, allocated + threadedAllocation);
    const target = Math.max(0, Number(pot.target_amount || 0));
    const remaining = Math.max(0, target - totalAllocated);
    const monthly = Math.max(0, Number(pot.monthly_target || 0));
    const targetDate = pot.target_date ? new Date(`${pot.target_date}T12:00:00`) : null;
    const today = new Date(`${intelligence.today}T12:00:00`);
    const monthsRemaining = targetDate && Number.isFinite(targetDate.getTime())
      ? Math.max(1, monthsBetween(today, targetDate) + 1)
      : null;
    const neededPerMonth = remaining <= 0
      ? 0
      : monthsRemaining != null
        ? remaining / monthsRemaining
        : monthly;
    const monthsAtPace = remaining <= 0 ? 0 : monthly > 0 ? Math.ceil(remaining / monthly) : null;
    const linkedThisMonthAmount = allocations.reduce((sum, allocation) => {
      if (!allocation.financial_account_id) return sum;
      const accountMovements = movementsByAccount.get(allocation.financial_account_id) || [];
      const deposited = accountMovements.reduce((movementSum, movement) => {
        const effective = String(movement.effective_at || movement.created_at || "").slice(0, 7);
        if (effective !== currentMonthKey || movementDirection(movement) !== "in" || movement.movement_type === "opening_balance") return movementSum;
        return movementSum + Math.max(0, movementDelta(movement));
      }, 0);
      const percent = Math.max(0, Number(allocation.allocation_percent || 0));
      if (percent > 0) return sum + deposited * Math.min(100, percent) / 100;
      return sum + Math.min(deposited, Math.max(0, Number(allocation.amount || 0)));
    }, 0);
    const threadedThisMonthAmount = potMovements
      .filter((movement) => String(movement.effective_at || "").slice(0, 7) === currentMonthKey)
      .reduce((sum, movement) => sum + Number(movement.amount || 0), 0);
    const thisMonthAmount = Math.max(0, linkedThisMonthAmount + threadedThisMonthAmount);
    const progress = target > 0 ? Math.max(0, Math.min(100, totalAllocated / target * 100)) : 0;
    const thisMonthProgress = target > 0 ? Math.max(0, Math.min(100 - progress, thisMonthAmount / target * 100)) : 0;
    const paceInput = monthly > 0 ? monthly : thisMonthAmount;
    const paceScore = remaining <= 0
      ? 100
      : neededPerMonth > 0
        ? Math.min(100, paceInput / neededPerMonth * 100)
        : progress;
    const onTrackScore = Math.round(Math.max(0, Math.min(100, paceScore * 0.8 + progress * 0.2)));
    const priorityValue = Number(pot.priority ?? 50);
    const priorityLabel = priorityValue <= 25 ? "High" : priorityValue <= 65 ? "Medium" : "Low";
    const firstLinked = allocations.find((allocation) => allocation.financial_account_id)?.financial_account_id;
    const linkedAccount = firstLinked ? accountById.get(firstLinked) : null;
    const attentionStatus: "attention" | "on_track" | "complete" =
      progress >= 100 || onTrackScore >= 90 ? "complete" : onTrackScore < 50 ? "attention" : "on_track";
    return {
      pot,
      allocations,
      allocated: totalAllocated,
      potMovements,
      target,
      remaining,
      monthly,
      monthsAtPace,
      monthsRemaining,
      neededPerMonth,
      thisMonthAmount,
      thisMonthProgress,
      progress,
      onTrackScore,
      priorityLabel,
      linkedAccount,
      owner: pot.person_id ? ownerById.get(pot.person_id) : null,
      attentionStatus,
    };
  });

  // BUGFIX/FEATURE ("do we have logic that changes the way people see
  // pots — so it's not basic"): the data to do this properly already
  // existed (onTrackScore, progress) but was only ever used as a passive
  // badge colour — the list itself was flat, sorted by a manually-set
  // priority number regardless of which pots actually needed attention
  // right now. This groups pots that are genuinely behind pace to the
  // top, so the ones that need a decision are the first thing seen, not
  // buried in the same flat grid as ones already doing fine.
  const attentionOrder = { attention: 0, on_track: 1, complete: 2 } as const;
  const sortedPotRows = [...potRows].sort((a, b) => {
    const statusDiff = attentionOrder[a.attentionStatus] - attentionOrder[b.attentionStatus];
    if (statusDiff !== 0) return statusDiff;
    return a.onTrackScore - b.onTrackScore; // most urgent (lowest score) first within a group
  });
  const attentionPotCount = potRows.filter((row) => row.attentionStatus === "attention").length;

  const optimiserRows = accountRows.map((account) => {
    const balance = estimatedSavingsBalanceFromLedger(account, movementsByAccount.get(account.id) || []);
    const currentRate = Number(account.interest_rate || 0);
    const best = dealMatches
      .filter((deal) => deal.eligible_now && savingsDealMatchesAccount(account, deal))
      .filter((deal) => Number(deal.gross_aer || 0) > currentRate)
      .filter((deal) => deal.minimum_balance == null || balance >= Number(deal.minimum_balance))
      .sort((a, b) => Number(b.gross_aer || 0) - Number(a.gross_aer || 0))[0] || null;
    const bestRate = best?.gross_aer != null ? Number(best.gross_aer) : null;
    const eligibleBalance = best ? savingsDealEligibleBalance(account, best) : 0;
    const accessSummary = best
      ? [
          cleanDealLabel(best.access_type || best.account_type),
          best.notice_period_days ? `${best.notice_period_days} days notice` : null,
          best.term_length_months ? `${best.term_length_months} month term` : null,
          best.monthly_max_deposit ? `${formatMoney(best.monthly_max_deposit)} monthly cap` : null,
          best.withdrawal_rules || null,
        ].filter(Boolean).join(" · ")
      : null;
    return {
      accountId: account.id,
      accountName: account.name || account.savings_product_name || "Savings account",
      providerName: account.provider || account.provider_slug || "Provider",
      balance,
      currentRate,
      bestRate,
      bestProvider: best?.provider_name || best?.provider_slug || null,
      bestProduct: best?.product_name || null,
      annualGain: bestRate != null ? Math.max(0, eligibleBalance * (bestRate - currentRate) / 100) : 0,
      accessSummary,
      sourceUrl: best?.source_url || null,
    };
  });
  const totalOpportunityCost = optimiserRows.reduce((sum, row) => sum + row.annualGain, 0);
  const latestRecommendationAt = visibleSavingsRecommendations
    .map((row) => row.created_at)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) || null;
  const topRateOpportunities = optimiserRows.filter((row) => row.annualGain > 0.01).sort((a, b) => b.annualGain - a.annualGain);
  const potRotatorGoals = [
    ...potRows.map((row) => ({
      id: row.pot.id,
      label: row.pot.name,
      balance: row.allocated,
      target: row.target,
      remaining: row.remaining,
      progress: row.progress,
      monthlyGap: row.monthly > 0 ? 0 : row.remaining,
      timeLabel: formatGoalTime(row.monthsAtPace),
      href: "/accounts?tab=pots",
    })),
    ...savingsGoals.map(({ account, goal }) => ({
      id: account.id,
      label: goal.label,
      balance: goal.balance,
      target: goal.target,
      remaining: goal.remaining,
      progress: goal.progress,
      monthlyGap: goal.monthlyGap ?? 0,
      timeLabel: formatGoalTime(goal.monthsAtPace),
      href: "/accounts?tab=pots",
    })),
  ];

  const accountCards = (
    <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
      {accountRows.map((account) => {
        const institution = findInstitution(account.provider_slug || account.provider);
        const providerName = institution?.name || account.provider || "Savings provider";
        const owner = account.owner_person_id ? ownerById.get(account.owner_person_id) : null;
        const accountMovements = (movementsByAccount.get(account.id) || []);
        return (
          <div key={account.id} className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-start gap-4 p-5">
              <FinancialInstitutionLogo provider={account.provider_slug || account.provider} className="h-14 w-14 rounded-2xl" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-black uppercase tracking-wide text-emerald-700">{providerName}</p>
                <h3 className="mt-1 truncate text-xl font-black text-slate-950">{account.name || account.savings_product_name || "Savings account"}</h3>
                <p className="mt-1 text-sm font-semibold text-slate-500">{account.savings_product_name || account.account_type.replaceAll("_", " ")}</p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-black text-blue-700">Allowance: {(account.savings_limit_scope || "individual").replaceAll("_", " ")}</span>
                  {account.provider_slug ? <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-black text-emerald-700">Provider tracked</span> : null}
                </div>
                {buildSavingsGoal(account) ? (
                  <div className="mt-4 rounded-2xl bg-emerald-50 p-3 ring-1 ring-emerald-100">
                    <div className="flex items-center justify-between gap-3">
                      <p className="truncate text-xs font-black uppercase tracking-wide text-emerald-700">{buildSavingsGoal(account)?.label}</p>
                      <span className="text-xs font-black text-slate-950">{Math.round(buildSavingsGoal(account)?.progress || 0)}%</span>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-white">
                      <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-orange-400" style={{ width: `${Math.round(buildSavingsGoal(account)?.progress || 0)}%` }} />
                    </div>
                    <p className="mt-2 text-xs font-bold text-slate-600">
                      {formatMoney(buildSavingsGoal(account)?.remaining || 0)} left · {formatGoalTime(buildSavingsGoal(account)?.monthsAtPace ?? null)} at current top-up
                    </p>
                  </div>
                ) : null}
              </div>
              <SavingsAccountModalShell
                title={account.name || account.savings_product_name || "Savings account"}
                subtitle="Update ownership, correct balance/rate details or delete this saver from one centred, touch-friendly panel."
                triggerClassName="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-full bg-slate-950 text-sm font-black text-white shadow-sm transition hover:bg-orange-500"
                trigger={(
                  <AvatarBubble
                    imageUrl={owner?.avatar_url || (!owner ? (householdMeta as HouseholdMeta | null)?.image_url : null)}
                    label={owner?.name || (householdMeta as HouseholdMeta | null)?.name || "Household"}
                    className="h-12 w-12"
                    active
                  />
                )}
              >
                <p className="text-xs font-black uppercase tracking-wide text-slate-500">Owner / edit / delete</p>
                <p className="mt-1 text-sm font-bold text-slate-600">Tap a household/person photo to move this saver. Edit and delete are kept inside this centred modal to avoid accidental taps on the account card.</p>
                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <form action={assignSavingsAccountOwner}>
                    <input type="hidden" name="id" value={account.id} />
                    <input type="hidden" name="owner_person_id" value="" />
                    <input type="hidden" name="ownership_scope" value="household" />
                    <input type="hidden" name="savings_limit_scope" value="household" />
                    <input type="hidden" name="visibility_scope" value={account.visibility_scope || "household"} />
                    <button className={`flex w-full items-center gap-2 rounded-2xl px-3 py-2 text-left text-xs font-black ${!account.owner_person_id && account.ownership_scope !== "joint" ? "bg-orange-50 text-orange-700 ring-1 ring-orange-200" : "bg-slate-100 text-slate-700 hover:bg-slate-950 hover:text-white"}`}>
                      <AvatarBubble imageUrl={(householdMeta as HouseholdMeta | null)?.image_url} label={(householdMeta as HouseholdMeta | null)?.name || "Household"} className="h-9 w-9" />
                      <span className="truncate">{(householdMeta as HouseholdMeta | null)?.name || "Household"}</span>
                    </button>
                  </form>
                  {ownerOptions.map((person) => {
                    const scope = ownerScopeFor(person);
                    return (
                      <form action={assignSavingsAccountOwner} key={person.id}>
                        <input type="hidden" name="id" value={account.id} />
                        <input type="hidden" name="owner_person_id" value={person.id} />
                        <input type="hidden" name="ownership_scope" value={scope.ownership} />
                        <input type="hidden" name="savings_limit_scope" value={scope.allowance} />
                        <input type="hidden" name="visibility_scope" value={account.visibility_scope || "household"} />
                        <button className={`flex w-full items-center gap-2 rounded-2xl px-3 py-2 text-left text-xs font-black ${account.owner_person_id === person.id ? "bg-orange-50 text-orange-700 ring-1 ring-orange-200" : "bg-slate-100 text-slate-700 hover:bg-slate-950 hover:text-white"}`}>
                          <AvatarBubble imageUrl={person.avatar_url} label={person.name} className="h-9 w-9" />
                          <span className="truncate">{person.name}</span>
                        </button>
                      </form>
                    );
                  })}
                </div>

                <div className="mt-4 rounded-3xl border border-slate-100 bg-slate-50 p-4">
                  <p className="text-xs font-black uppercase tracking-wide text-slate-500">Edit saver details</p>
                  <form action={updateFinancialAccount} className="mt-3 grid gap-3 sm:grid-cols-2">
                    <input type="hidden" name="id" value={account.id} />
                    <input type="hidden" name="owner_person_id" value={account.owner_person_id || ""} />
                    <input type="hidden" name="ownership_scope" value={account.ownership_scope || (account.owner_person_id ? "personal" : "household")} />
                    <input type="hidden" name="visibility_scope" value={account.visibility_scope || "household"} />
                    <input type="hidden" name="savings_limit_scope" value={account.savings_limit_scope || "individual"} />
                    <FormInput label="Confirmed balance" name="current_balance" type="number" step="0.01" defaultValue={account.balance_last_confirmed_value ?? account.current_balance} />
                    <FormInput label="Rate %" name="interest_rate" type="number" step="0.001" defaultValue={account.interest_rate ?? ""} />
                    <label className="text-sm font-bold text-slate-700">
                      Interest accrues
                      <select name="interest_accrual_frequency" defaultValue={account.interest_accrual_frequency || "daily"} className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 font-bold text-slate-950">
                        <option value="daily">Daily</option>
                        <option value="monthly">Monthly</option>
                        <option value="annually">Annually</option>
                        <option value="maturity">At maturity</option>
                        <option value="none">No automatic interest</option>
                      </select>
                    </label>
                    <label className="text-sm font-bold text-slate-700">
                      Interest paid / compounds
                      <select name="interest_compounding_frequency" defaultValue={account.interest_compounding_frequency || "monthly"} className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 font-bold text-slate-950">
                        <option value="daily">Daily</option>
                        <option value="monthly">Monthly</option>
                        <option value="annually">Annually</option>
                        <option value="maturity">At maturity</option>
                        <option value="none">Not compounded</option>
                      </select>
                    </label>
                    <FormInput label="Top-up" name="monthly_top_up_amount" type="number" step="0.01" defaultValue={account.monthly_top_up_amount ?? ""} />
                    <FormInput label="Top-up day" name="top_up_day" type="number" step="1" defaultValue={account.top_up_day ?? ""} />
                    <FormInput label="Goal name" name="savings_goal_name" defaultValue={account.savings_goal_name ?? ""} />
                    <FormInput label="Goal target" name="savings_goal_target_amount" type="number" step="0.01" defaultValue={account.savings_goal_target_amount ?? ""} />
                    <FormInput label="Goal date" name="savings_goal_target_date" type="date" defaultValue={account.savings_goal_target_date ?? ""} />
                    <FormInput label="Goal top-up override" name="savings_goal_monthly_contribution_override" type="number" step="0.01" defaultValue={account.savings_goal_monthly_contribution_override ?? ""} />
                    <FormInput label="Rate ends" name="interest_rate_end_date" type="date" defaultValue={account.interest_rate_end_date ?? ""} />
                    <div className="flex items-end">
                      <button className="w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-black text-white">Save changes</button>
                    </div>
                  </form>
                </div>

                <form action={deleteFinancialAccount} className="mt-4 border-t border-slate-100 pt-3">
                  <input type="hidden" name="id" value={account.id} />
                  <button className="w-full rounded-2xl bg-red-50 px-4 py-3 text-sm font-black text-red-600 hover:bg-red-100">Delete savings account</button>
                </form>
              </SavingsAccountModalShell>
            </div>

            <dl className="grid grid-cols-2 gap-3 px-5 pb-4">
              <div className="rounded-2xl bg-slate-50 p-3">
                <dt className="text-xs font-bold text-slate-500">Est. balance</dt>
                <dd><SavingsLiveBalance account={account} ledgerBalance={estimatedSavingsBalanceFromLedger(account, movementsByAccount.get(account.id) || [])} /></dd>
              </div>
              <div className="rounded-2xl bg-slate-50 p-3">
                <dt className="text-xs font-bold text-slate-500">Rate</dt>
                <dd className="text-xl font-black text-slate-950">{Number(account.interest_rate || 0).toFixed(2)}%</dd>
              </div>
              <div className="rounded-2xl bg-slate-50 p-3">
                <dt className="text-xs font-bold text-slate-500">Top-up</dt>
                <dd className="font-black text-slate-950">{formatMoney(account.monthly_top_up_amount)}/mo</dd>
              </div>
              <div className="rounded-2xl bg-slate-50 p-3">
                <dt className="text-xs font-bold text-slate-500">Rate/end</dt>
                <dd className="font-black text-slate-950">{account.deal_duration_mode === "ongoing" ? "Ongoing" : account.interest_rate_end_date || account.end_date || "Not set"}</dd>
              </div>
            </dl>

            <div className="grid grid-cols-2 gap-3 border-t border-slate-100 bg-slate-50/60 p-5">
              <SavingsActivityThread account={account} accountName={account.name || account.savings_product_name || "Savings account"} movements={accountMovements} />
              <SavingsAccountModalShell
                title={`Update ${account.name || account.savings_product_name || "savings account"}`}
                subtitle="Log deposits, withdrawals, interest, fees or balance corrections without expanding the card."
                triggerClassName="w-full rounded-2xl bg-slate-950 px-4 py-3 text-center text-sm font-black text-white shadow-sm ring-1 ring-slate-900 transition hover:bg-orange-500"
                trigger="Update balance / log movement"
              >
                <form action={addSavingsAccountMovement} className="grid gap-3 sm:grid-cols-2">
                  <input type="hidden" name="financial_account_id" value={account.id} />
                  <label className="text-sm font-bold text-slate-700">
                    Type
                    <select name="movement_type" defaultValue="deposit" className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 font-bold text-slate-950">
                      <option value="deposit">Money added</option>
                      <option value="withdrawal">Money removed</option>
                      <option value="interest">Interest paid</option>
                      <option value="fee">Fee / charge</option>
                      <option value="balance_correction">Balance correction</option>
                    </select>
                  </label>
                  <FormInput label="Amount / new balance" name="amount" type="number" step="0.01" />
                  <FormInput label="Date" name="effective_at" type="date" defaultValue={intelligence.today} />
                  <FormInput label="Note" name="note" />
                  <div className="sm:col-span-2">
                    <button className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-black text-white">Save movement</button>
                  </div>
                </form>
                <div className="mt-5 space-y-2">
                  {accountMovements.map((movement) => (
                    <div key={movement.id} className="flex items-center justify-between gap-3 rounded-2xl bg-slate-50 p-3 text-xs font-bold text-slate-600">
                      <div>
                        <p className="font-black text-slate-950">{movementLabel(movement.movement_type)} · {formatMoney(movement.amount)}</p>
                        <p>{movement.effective_at || movement.created_at} {movement.resulting_balance != null ? `· balance ${formatMoney(movement.resulting_balance)}` : ""}</p>
                        {movement.note ? <p className="text-slate-400">{movement.note}</p> : null}
                      </div>
                      {movement.movement_type === "opening_balance" ? (
                        <span className="rounded-full bg-slate-100 px-3 py-1 font-black text-slate-500">Baseline</span>
                      ) : (
                        <form action={deleteSavingsAccountMovement}>
                          <input type="hidden" name="id" value={movement.id} />
                          <button className="rounded-full bg-red-50 px-3 py-1 font-black text-red-600">Remove</button>
                        </form>
                      )}
                    </div>
                  ))}
                  {accountMovements.length === 0 ? <p className="rounded-2xl bg-slate-50 p-3 text-xs font-bold text-slate-500">No movements logged yet. Deleting the account removes this movement history too.</p> : null}
                </div>
              </SavingsAccountModalShell>
            </div>
          </div>
        );
      })}
      {accountRows.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-emerald-200 bg-emerald-50/70 p-6 text-sm font-bold text-emerald-900">
          Add your first savings account above and LOOP will turn it into a goal-aware pot with progress, target dates and monthly gap checks.
        </div>
      ) : null}
    </div>
  );

  return (
    <>
      <Nav />
      <main className="mx-auto w-[95vw] max-w-[2000px] space-y-7 px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.22em] text-emerald-700">Savings</p>
            <h1 className="mt-1 text-3xl font-black tracking-tight text-slate-950">Savings, pots and cash optimisation</h1>
            <p className="mt-2 max-w-3xl text-sm font-bold text-slate-500">Track balances, withdrawals, rates, ISA room and savings goals without turning the page into a command centre.</p>
          </div>
          <Link href="/account?tab=wealth" className="rounded-full bg-white px-4 py-2 text-sm font-black text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50">Bank relationships live in Account → Wealth</Link>
        </header>

        {accountRows.length === 0 ? <PageLandingExperience kind="savings" /> : null}

        <section className="grid gap-4 md:grid-cols-5">
          <Link href="/accounts?tab=accounts"><StatCard title="Tracked savings" value={formatMoney(totalSavings)} helper={`${personalSavings.length} personal · ${sharedSavings.length} shared`} /></Link>
          <Link href="/accounts?tab=accounts"><StatCard title="Monthly top-up" value={formatMoney(monthlyTopUps)} helper="Across active ladders" /></Link>
          <SavingsPotsRotator goals={potRotatorGoals} />
          <Link href="/accounts?tab=ai"><StatCard title="Savings health" value={`${intelligence.score}/100`} helper={`${intelligence.catalogue.confidence} confidence · automation ${hasAiSavingsFeature ? "on" : "optional"}`} /></Link>
          <Link href="/accounts?tab=projection"><StatCard title="12m projection" value={formatMoney(twelveMonthSavings)} helper="Savings assumptions" /></Link>
        </section>

        <nav className="sticky top-3 z-20 flex flex-wrap gap-2 rounded-[2rem] border border-white/70 bg-white/80 p-3 shadow-sm backdrop-blur-xl">
          {tabs.filter((tab) => !("hidden" in tab && tab.hidden)).map((tab) => <TabLink key={tab.key} tab={tab.key} activeTab={activeTab} />)}
        </nav>

        {activeTab === "overview" ? (
          <div className="grid gap-7 xl:grid-cols-[1.15fr_0.85fr]">
            <SectionCard title="Savings activity" description="A clean monthly view of what you saved, withdrew and earned in interest. Hover for exact values.">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-2xl bg-orange-50 px-4 py-3"><p className="text-[10px] font-black uppercase tracking-wide text-orange-700">Withdrawn</p><p className="mt-1 font-black text-slate-950">{formatMoney(currentMonthSummary.out)}</p></div>
                  <div className="rounded-2xl bg-blue-50 px-4 py-3"><p className="text-[10px] font-black uppercase tracking-wide text-blue-700">Interest</p><p className="mt-1 font-black text-slate-950">{formatMoney(currentMonthInterest.total)}</p><p className="mt-1 text-xs font-black text-blue-700/70">Provider paid {formatMoney(currentMonthInterest.providerConfirmed)} · through yesterday {formatMoney(currentMonthInterest.accruedThroughYesterday)} · today est. {formatMoney(currentMonthInterest.estimated)}</p></div>
                  <div className="rounded-2xl bg-emerald-50 px-4 py-3"><p className="text-[10px] font-black uppercase tracking-wide text-emerald-700">Saved</p><p className="mt-1 font-black text-slate-950">{formatMoney(currentMonthSummary.in)}</p></div>
                </div>
                <Link href="/accounts?tab=projection" className="rounded-full bg-slate-100 px-4 py-2 text-sm font-black text-slate-600">Expand projection</Link>
              </div>
              <SavingsMovementChart data={savingsMovementSeries} />
            </SectionCard>
            <SectionCard title="LoopWatch" description="LoopWatch checks the whole savings portfolio for rate drag, tax exposure, stale balances and unused Financial Flow.">
              <div className="mb-5 rounded-3xl border border-blue-100 bg-blue-50/70 p-4">
                <div className="flex flex-wrap items-end justify-between gap-2">
                  <div><p className="text-xs font-black uppercase tracking-[0.16em] text-blue-700">Central ISA allowance · {activeIsaRule.taxYear}</p><p className="mt-1 text-sm font-bold text-slate-600">Known current-year subscriptions across savings and investment accounts. Existing ISA balances and ISA-to-ISA transfers do not consume this year&apos;s allowance.</p></div>
                  <a href={activeIsaRule.sourceUrl} target="_blank" rel="noreferrer" className="text-xs font-black text-blue-800 underline">UK rules ↗</a>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {isaPositions.map((position) => (
                    <article key={position.person.id} className="rounded-2xl bg-white p-4 shadow-sm">
                      <div className="flex items-start justify-between gap-3"><div><p className="font-black text-slate-950">{position.person.name}</p><p className="text-xs font-bold text-slate-500">{isJuniorIsaWrapper(position.wrapper) ? "Junior ISA" : "Adult ISA"} allowance</p></div><span className={`rounded-full px-2.5 py-1 text-[10px] font-black ${position.eligibility.eligible ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>{position.eligibility.eligible ? "Eligible" : "Not eligible"}</span></div>
                      <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-emerald-400" style={{ width: `${Math.min(100, position.allowance > 0 ? position.used / position.allowance * 100 : 0)}%` }} /></div>
                      <div className="mt-2 flex justify-between text-xs font-black"><span className="text-slate-500">Known used {formatMoney(position.used)}</span><span className="text-blue-800">{formatMoney(position.remaining)} left</span></div>
                    </article>
                  ))}
                </div>
              </div>
              <div className="space-y-3">
                <OpportunityCard
                  title="Opportunity cost"
                  body={topRateOpportunities.length > 0 ? `${topRateOpportunities.length} account${topRateOpportunities.length === 1 ? " is" : "s are"} below the best broadly compatible eligible rate currently logged. Open Savings Health to model the effect before acting.` : intelligence.catalogue.status === "healthy" ? "No positive compatible rate gap is currently evidenced by the reviewed catalogue." : "The market check is incomplete, so £0 would not mean there is no opportunity. LOOP will show a value once enough fresh, reviewed products are available."}
                  metric={intelligence.catalogue.status === "healthy" ? `${formatMoney(totalOpportunityCost)}/yr` : "Check incomplete"}
                  tone={intelligence.catalogue.status !== "healthy" ? "warning" : totalOpportunityCost > 1 ? "action" : "good"}
                />
                <OpportunityCard
                  title={`${defaultOwnerPerson?.name || "Your"} interest allowance watch`}
                  body={intelligence.taxableInterest > 0 ? `Your Personal Savings Allowance is ${formatMoney(intelligence.savingsAllowance)}/yr. Estimated non-ISA interest is ${formatMoney(intelligence.nonIsaInterest)}/yr, leaving ${formatMoney(intelligence.taxableInterest)}/yr taxable. At ${intelligence.savingsTaxRate}% that is about ${formatMoney(intelligence.estimatedSavingsTax)}/yr. Review moving roughly ${formatMoney(intelligence.cashToShelter)} into an ISA, subject to access needs and eligibility. Known current-year ISA room: ${formatMoney(Math.max(0, intelligence.isaAllowance - intelligence.isaSubscribedAmount))}.` : `Your Personal Savings Allowance is ${formatMoney(intelligence.savingsAllowance)}/yr. Estimated non-ISA interest is ${formatMoney(intelligence.nonIsaInterest)}/yr, so no taxable excess is currently projected. Known current-year ISA room: ${formatMoney(Math.max(0, intelligence.isaAllowance - intelligence.isaSubscribedAmount))}.`}
                  metric={intelligence.nonIsaInterest > intelligence.savingsAllowance ? "Review now" : "Watching"}
                  tone={intelligence.nonIsaInterest > intelligence.savingsAllowance * 0.75 ? "warning" : "good"}
                />
                {topRateOpportunities.slice(0, 2).map((row) => (
                  <OpportunityCard key={row.accountId} title={`${row.providerName}: rate drag`} body={`${row.accountName} is at ${row.currentRate.toFixed(2)}%. The strongest compatible eligible deal logged is ${row.bestRate?.toFixed(2)}%, worth about ${formatMoney(row.annualGain)} a year on the eligible balance.`} metric={`${formatMoney(row.annualGain)}/yr`} tone="action" />
                ))}
                {intelligence.opportunities.filter((item) => !["better-rate", "isa-shield"].includes(item.key)).slice(0, 2).map((item) => <OpportunityCard key={item.key} title={item.title} body={item.body} metric={item.metric} tone={item.tone} />)}
              </div>
            </SectionCard>
          </div>
        ) : null}

        {activeTab === "pots" ? (
          <div className="space-y-7">
            <SavingsPotJourney
              action={createSavingsPot}
              people={ownerOptions.map((person) => ({ id: person.id, name: person.name, relationship: person.relationship }))}
              accounts={accountRows.map((account) => ({ id: account.id, name: account.name, provider: account.provider }))}
              essentialMonthlyOutgoings={Math.max(0, intelligence.essentialOutgoings.essential)}
              essentialItemCount={essentialItemCount}
            />

            <SectionCard title="Your savings pots" description="The visual adapts to the goal. Custom images take priority; otherwise LOOP uses a holiday, emergency, home, car, education, gift or repairs visual. The top-right thread records monthly allocations.">
              {attentionPotCount > 0 ? (
                <p className="mb-4 rounded-2xl bg-amber-50 px-4 py-3 text-sm font-black text-amber-800">
                  {attentionPotCount} pot{attentionPotCount === 1 ? "" : "s"} behind pace — shown first below.
                </p>
              ) : null}
              <div className="grid gap-5 xl:grid-cols-2">
                {sortedPotRows.map(({ pot, allocations, potMovements, allocated, target, remaining, monthly, neededPerMonth, thisMonthAmount, thisMonthProgress, progress, onTrackScore, priorityLabel, linkedAccount, owner, attentionStatus }) => (
                  <article key={pot.id} className={`overflow-hidden rounded-[2rem] border bg-white shadow-sm ${attentionStatus === "attention" ? "border-amber-300 ring-1 ring-amber-100" : "border-slate-200"}`}>
                    <div className="p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-black uppercase tracking-[0.16em] text-emerald-700">{owner?.name || "Household"} · {priorityLabel} priority{attentionStatus === "attention" ? <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">Behind pace</span> : null}</p>
                          <h3 className="mt-1 text-2xl font-black text-slate-950">{pot.name}</h3>
                          <p className="mt-1 text-sm font-bold text-slate-500">{pot.notes || "A goal for your savings"}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <SavingsPotThread potId={pot.id} potName={pot.name} movements={potMovements} action={addSavingsPotMovement} />
                          <form action={deleteSavingsPot}>
                            <input type="hidden" name="id" value={pot.id} />
                            <button className="rounded-2xl bg-red-50 px-3 py-3 text-xs font-black text-red-600">Delete</button>
                          </form>
                        </div>
                      </div>

                      <div className="mt-4"><SavingsGoalVisual goalType={pot.goal_type} referenceImageUrl={pot.reference_image_url} progress={progress} thisMonthProgress={thisMonthProgress} score={onTrackScore} /></div>

                      <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                        <div className="rounded-2xl bg-emerald-50 p-3"><p className="text-xs font-bold text-emerald-700">Saved so far</p><p className="font-black text-slate-950">{formatMoney(allocated)} <span className="text-xs text-emerald-700">({Math.round(progress)}%)</span></p></div>
                        <div className="rounded-2xl bg-slate-50 p-3"><p className="text-xs font-bold text-slate-500">Target</p><p className="font-black text-slate-950">{target > 0 ? formatMoney(target) : "Set target"}</p></div>
                        <div className="rounded-2xl bg-orange-50 p-3"><p className="text-xs font-bold text-orange-700">Needed per month</p><p className="font-black text-slate-950">{neededPerMonth > 0 ? formatMoney(neededPerMonth) : "Complete"}</p></div>
                        <div className="rounded-2xl bg-blue-50 p-3"><p className="text-xs font-bold text-blue-700">This month</p><p className="font-black text-slate-950">{formatMoney(thisMonthAmount)}</p></div>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-slate-50 p-3 text-xs font-bold text-slate-600">
                        <span>{linkedAccount ? `${linkedAccount.provider || "Provider"} · ${linkedAccount.name}` : "No linked account yet"}</span>
                        <span>{pot.target_date ? `Target ${new Date(`${pot.target_date}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}` : "No target date"}</span>
                      </div>
                      <p className="mt-3 text-xs font-bold text-slate-500">On-track score {onTrackScore}/100. Red is materially behind, amber needs review and green is on track. The required monthly amount recalculates after every allocation.</p>

                      <details className="mt-4 rounded-2xl border border-slate-200 bg-white">
                        <summary className="cursor-pointer list-none px-4 py-3 text-sm font-black text-slate-700">Manage linked-account allocations</summary>
                        <div className="space-y-2 border-t border-slate-100 p-3">
                          {allocations.map((allocation) => {
                            const linked = allocation.financial_account_id ? accountById.get(allocation.financial_account_id) : null;
                            return (
                              <div key={allocation.id} className="flex items-center justify-between gap-3 rounded-2xl bg-emerald-50/70 p-3 text-xs font-bold text-slate-600">
                                <span>{linked ? `${linked.provider || "Provider"} · ${linked.name}` : "Manual allocation"} · {Number(allocation.allocation_percent || 0) > 0 ? `${Number(allocation.allocation_percent).toFixed(1)}%` : formatMoney(allocation.amount)}</span>
                                <form action={deleteSavingsPotAllocation}><input type="hidden" name="id" value={allocation.id} /><button className="rounded-full bg-white px-3 py-1 font-black text-red-600">Remove</button></form>
                              </div>
                            );
                          })}
                          <form action={addSavingsPotAllocation} className="grid grid-cols-2 gap-2 rounded-2xl border border-dashed border-slate-200 p-3">
                            <input type="hidden" name="savings_pot_id" value={pot.id} />
                            <select name="financial_account_id" defaultValue="" className="col-span-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700">
                              <option value="">Manual amount</option>
                              {accountRows.map((account) => <option key={account.id} value={account.id}>{account.provider || "Provider"} · {account.name}</option>)}
                            </select>
                            <input name="amount" type="number" step="0.01" placeholder="Fixed £" className="rounded-2xl border border-slate-200 px-3 py-2 text-xs font-bold" />
                            <input name="allocation_percent" type="number" step="0.01" placeholder="Or %" className="rounded-2xl border border-slate-200 px-3 py-2 text-xs font-bold" />
                            <button className="col-span-2 rounded-2xl bg-slate-950 px-3 py-2 text-xs font-black text-white">Add allocation</button>
                          </form>
                        </div>
                      </details>
                    </div>
                  </article>
                ))}
              </div>
              {potRows.length === 0 ? <p className="mt-5 rounded-3xl bg-emerald-50 p-5 text-sm font-bold text-emerald-900">Choose a recommended starting point above. LOOP will turn the target and date into a monthly plan.</p> : null}
            </SectionCard>

            {savingsGoals.length > 0 ? (
              <SectionCard title="Legacy account-linked goals" description="These goals still live directly on an account. They remain visible while you move them into independent pots at your own pace.">
                <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
                  {savingsGoals.map(({ account, goal }) => (
                    <article key={account.id} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                      <p className="text-xs font-black uppercase tracking-wide text-emerald-700">{account.provider || "Savings account"}</p>
                      <h3 className="mt-1 text-xl font-black text-slate-950">{goal.label}</h3>
                      <PiggyPotVisual progress={goal.progress} compact />
                      <p className="mt-3 text-sm font-bold text-slate-600">{formatMoney(goal.balance)} of {formatMoney(goal.target)} · {formatGoalTime(goal.monthsAtPace)}</p>
                    </article>
                  ))}
                </div>
              </SectionCard>
            ) : null}
          </div>
        ) : null}

        {activeTab === "rates" ? (
          <div className="space-y-7">
            <SectionCard title="Better-rate watch" description="The daily comparison checks reviewed products for every saver. Paid tiers add automation and alerts; basic matching is not tier-gated.">
              <div className="grid gap-3 md:grid-cols-4">
                <div className="rounded-3xl bg-slate-950 p-4 text-white"><p className="text-xs font-black uppercase tracking-wide text-white/50">Latest saved match</p><p className="mt-2 text-xl font-black">{latestRecommendationAt ? `${daysOld(latestRecommendationAt) ?? 0} day(s) ago` : "None yet"}</p><p className="mt-1 text-xs font-bold text-white/60">The worker only saves a row when it finds a positive compatible rate gap.</p></div>
                <div className="rounded-3xl bg-blue-50 p-4"><p className="text-xs font-black uppercase tracking-wide text-blue-700">Accounts watched</p><p className="mt-2 text-2xl font-black text-slate-950">{accountRows.length}</p><p className="mt-1 text-xs font-bold text-slate-500">tracked savers eligible for checks</p></div>
                <div className="rounded-3xl bg-emerald-50 p-4"><p className="text-xs font-black uppercase tracking-wide text-emerald-700">Saved actions</p><p className="mt-2 text-2xl font-black text-slate-950">{visibleSavingsRecommendations.length}</p><p className="mt-1 text-xs font-bold text-slate-500">compatible recommendations</p></div>
                <div className="rounded-3xl bg-orange-50 p-4"><p className="text-xs font-black uppercase tracking-wide text-orange-700">Opportunity</p><p className="mt-2 text-2xl font-black text-slate-950">{intelligence.catalogue.status === "healthy" ? `${formatMoney(visibleSavingsRecommendations.reduce((sum, row) => sum + Number(row.estimated_annual_gain || 0), 0))}/yr` : "Check incomplete"}</p><p className="mt-1 text-xs font-bold text-slate-500">{intelligence.catalogue.activeDeals} active · {intelligence.catalogue.completeDeals} complete · {intelligence.catalogue.freshDeals} fresh</p></div>
              </div>
            </SectionCard>

            <SectionCard title="Best options for you" description="A short list for adult accounts. Child-only products are kept separate so they cannot be mistaken for a switch for your own savings.">
              <div className="grid gap-4 lg:grid-cols-2">
                {adultRecommendations.map((recommendation) => {
                  const account = recommendation.financial_account_id ? accountById.get(recommendation.financial_account_id) : null;
                  const deal = recommendation.savings_rate_deal_id ? dealById.get(recommendation.savings_rate_deal_id) : null;
                  return <SavingsRecommendationCard key={recommendation.id} recommendation={recommendation} account={account} deal={deal} personLabel={personLabelForAccount(account)} />;
                })}
                {adultRecommendations.length === 0 ? <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm font-bold text-slate-500">{intelligence.catalogue.status === "healthy" ? "No better compatible adult rate was found." : "The adult market check needs more fresh, complete products before LOOP can make a reliable comparison."}</div> : null}
              </div>
            </SectionCard>

            {childRecommendations.length || childDeals.length ? <SectionCard title="For the children" description="Junior and child-only products live here. They are never compared with an adult account.">
              {childRecommendations.length ? <div className="mb-6 grid gap-4 lg:grid-cols-2">{childRecommendations.map((recommendation) => {
                const account = recommendation.financial_account_id ? accountById.get(recommendation.financial_account_id) : null;
                const deal = recommendation.savings_rate_deal_id ? dealById.get(recommendation.savings_rate_deal_id) : null;
                return <SavingsRecommendationCard key={recommendation.id} recommendation={recommendation} account={account} deal={deal} personLabel={personLabelForAccount(account) || childAudienceLabel} />;
              })}</div> : null}
              <div className="grid gap-4 lg:grid-cols-2">{childDeals.slice(0, 6).map((deal) => <SavingsDealCard key={deal.id} deal={deal} personLabel={childAudienceLabel} feedback={eligibilityByDeal.get(deal.id)} />)}</div>
            </SectionCard> : null}

            <SectionCard title="Explore adult savings accounts" description="Start with the practical limits. Open a card only when the headline rate, pay-in limit and access fit what you need.">
              <div className="grid gap-8 xl:grid-cols-2">
                <div><h3 className="text-xl font-black text-slate-950">Available now</h3><p className="mt-1 text-sm font-bold text-slate-500">Open-market or already eligible through a relationship.</p><div className="mt-5 grid gap-5">{adultEligibleDeals.slice(0, 8).map((deal) => <SavingsDealCard key={deal.id} deal={deal} personLabel={defaultOwnerPerson?.name || "You"} feedback={eligibilityByDeal.get(deal.id)} />)}{adultEligibleDeals.length === 0 ? <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm font-bold text-slate-500">No reviewed adult deals are currently marked as available.</div> : null}</div></div>
                <div><h3 className="text-xl font-black text-slate-950">Needs another relationship</h3><p className="mt-1 text-sm font-bold text-slate-500">Useful to see, but not immediately available to you.</p><div className="mt-5 grid gap-5">{adultNeedsProviderDeals.slice(0, 8).map((deal) => <SavingsDealCard key={deal.id} deal={deal} personLabel={defaultOwnerPerson?.name || "You"} feedback={eligibilityByDeal.get(deal.id)} />)}{adultNeedsProviderDeals.length === 0 ? <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm font-bold text-slate-500">No relationship-only adult deals at the moment.</div> : null}</div></div>
              </div>
            </SectionCard>
          </div>
        ) : null}

        {activeTab === "ai" ? (
          <SectionCard title="Savings Health Score & optimiser" description="See rate competitiveness, access fit, tax efficiency, protection spread, goal funding and data quality in one explainable score.">
            <SavingsOptimiser
              score={intelligence.score}
              scoreParts={intelligence.scoreParts}
              enabled={hasAiSavingsFeature}
              rows={optimiserRows}
              isaRoom={Math.max(0, intelligence.isaAllowance - intelligence.isaBalance)}
              nonIsaInterest={intelligence.nonIsaInterest}
              savingsAllowance={intelligence.savingsAllowance}
              taxableInterest={intelligence.taxableInterest}
              savingsTaxRate={intelligence.savingsTaxRate}
              estimatedSavingsTax={intelligence.estimatedSavingsTax}
              cashToShelter={intelligence.cashToShelter}
              monthlyFlow={intelligence.monthlyFlow.spare}
              monthlyTopUps={monthlyTopUps}
              currentWeightedRate={weightedRate}
              catalogue={intelligence.catalogue}
            />
          </SectionCard>
        ) : null}

        {activeTab === "projection" ? (
          <SectionCard title="Savings + pension projection" description="Rates and contributions are inferred from the accounts and pension history already held in Loop. Manual overrides sit under advanced assumptions rather than driving the default view.">
            <SavingsProjectionPlanner
              savingsAccounts={projectionAccounts}
              pensionBalance={pensionTotal}
              monthlyPensionContribution={pensionMonthlyContribution}
              pensionAnnualRate={pensionRateScenarios.middle}
              pensionRateSource={pensionRateScenarios.source}
              pensionRateScenarios={pensionRateScenarios}
              pensionContributionSource={pensionContributionModel.source}
              pensionContributionDetail={pensionContributionDetail}
              people={projectionPeople}
              subjects={projectionSubjects}
              asOfDate={intelligence.today}
            />
            <details className="mt-5 rounded-3xl border border-slate-200 bg-white">
              <summary className="cursor-pointer list-none px-5 py-4 text-sm font-black text-slate-700">Add official 5-year / 10-year fund performance evidence</summary>
              <form action={savePensionPerformanceAssumption} className="grid gap-3 border-t border-slate-100 p-5 md:grid-cols-2 xl:grid-cols-5">
                <label className="text-xs font-black uppercase tracking-wide text-slate-500">Pension fund<select name="pension_fund_id" required className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-950"><option value="">Choose fund</option>{(pensionFunds ?? []).map((fund) => <option key={fund.id} value={fund.id}>{fund.fund_name || "Pension fund"}</option>)}</select></label>
                <FormInput label="5-year annualised %" name="annualised_5y_percent" type="number" step="0.01" />
                <FormInput label="10-year annualised %" name="annualised_10y_percent" type="number" step="0.01" />
                <FormInput label="Factsheet as of" name="as_of_date" type="date" defaultValue={intelligence.today} />
                <FormInput label="Official source URL" name="source_url" type="url" placeholder="Provider factsheet" />
                <input type="hidden" name="source_name" value="Official provider fund factsheet" />
                <div className="md:col-span-2 xl:col-span-5"><SubmitButton pendingLabel="Saving evidence…">Save annual performance evidence</SubmitButton></div>
              </form>
            </details>
          </SectionCard>
        ) : null}

        {activeTab === "accounts" ? (
          <div className="space-y-7">
            <SectionCard title="Savings activity" description="The chart follows the ledger, so withdrawals create visible dips rather than being hidden by a replacement balance. The three figures reset each calendar month.">
              <div className="mb-5 grid gap-3 sm:grid-cols-3">
                <div className="rounded-3xl bg-emerald-50 p-5 ring-1 ring-emerald-100"><p className="text-xs font-black uppercase tracking-wide text-emerald-700">Put in this month</p><p className="mt-2 text-3xl font-black text-slate-950">{formatMoney(currentMonthSummary.in)}</p></div>
                <div className="rounded-3xl bg-orange-50 p-5 ring-1 ring-orange-100"><p className="text-xs font-black uppercase tracking-wide text-orange-700">Taken out this month</p><p className="mt-2 text-3xl font-black text-slate-950">{formatMoney(currentMonthSummary.out)}</p></div>
                <div className="rounded-3xl bg-blue-50 p-5 ring-1 ring-blue-100"><p className="text-xs font-black uppercase tracking-wide text-blue-700">Interest gained this month</p><p className="mt-2 text-3xl font-black text-slate-950">{formatMoney(currentMonthInterest.total)}</p><p className="mt-1 text-xs font-black text-blue-700/70">Provider paid {formatMoney(currentMonthInterest.providerConfirmed)} · through yesterday {formatMoney(currentMonthInterest.accruedThroughYesterday)} · today est. {formatMoney(currentMonthInterest.estimated)}</p></div>
              </div>
              <BalanceHistoryChart data={savingsTrajectory} />
            </SectionCard>
            <SectionCard title="Tracked savings accounts" description="Provider images, owner, rate and balance sit on each card. Open Thread for the month-by-month ledger or Update to record a change.">
              {accountCards}
            </SectionCard>
            <SectionCard title="Everyday accounts" description="Current/checking accounts don't earn a tracked rate, but adding them here means they show up as an option whenever you pick a 'paid into' or 'paid from' account across Financial Flow — income, spending and childcare included.">
              {everydayAccountRows.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-5 text-sm font-semibold text-slate-500">No everyday accounts added yet. Use the &ldquo;Add account&rdquo; tab and choose &ldquo;Current / everyday account&rdquo; to add the account your bills and salary actually move through.</p>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {everydayAccountRows.map((account) => {
                    const owner = account.owner_person_id ? ownerById.get(account.owner_person_id) : null;
                    return (
                      <div key={account.id} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                        <div className="flex items-start gap-3">
                          <FinancialInstitutionLogo provider={account.provider_slug || account.provider} className="h-12 w-12 rounded-2xl" />
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-black uppercase tracking-wide text-slate-500">{account.provider || "Bank"}</p>
                            <h4 className="truncate text-lg font-black text-slate-950">{account.name}</h4>
                            <p className="mt-1 text-xs font-bold text-slate-400">{owner?.name || "Household / shared"}</p>
                          </div>
                        </div>
                        <p className="mt-3 text-2xl font-black text-slate-950">{formatMoney(account.current_balance)}</p>
                        <div className="mt-4 grid grid-cols-2 gap-2">
                          <form action={updateFinancialAccount}>
                            <input type="hidden" name="id" value={account.id} />
                            <input type="hidden" name="owner_person_id" value={account.owner_person_id || ""} />
                            <input type="hidden" name="ownership_scope" value={account.ownership_scope || (account.owner_person_id ? "personal" : "household")} />
                            <input type="hidden" name="visibility_scope" value={account.visibility_scope || "household"} />
                            <input type="hidden" name="savings_limit_scope" value={account.savings_limit_scope || "individual"} />
                            <input name="current_balance" type="number" step="0.01" defaultValue={account.current_balance ?? 0} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-950" />
                            <button className="mt-2 w-full rounded-xl bg-slate-100 px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-950 hover:text-white">Update balance</button>
                          </form>
                          <form action={deleteFinancialAccount} className="flex items-end">
                            <input type="hidden" name="id" value={account.id} />
                            <button className="w-full rounded-xl bg-red-50 px-3 py-2 text-xs font-black text-red-600 hover:bg-red-100">Delete</button>
                          </form>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </SectionCard>
          </div>
        ) : null}

        {activeTab === "overview" ? (
          <SectionCard title="Tracked savings accounts" description="A quick account preview. Open Tracked accounts for balance logs and edits.">
            {accountCards}
          </SectionCard>
        ) : null}

        {activeTab === "add" ? (
          <SectionCard title="Add account" description="Add any account your household uses — a savings pot to track a rate and goal, or an everyday current account so it's available as a 'paid into' / 'paid from' option across income, spending and childcare.">
            <form action={addFinancialAccount} className="grid gap-4 sm:grid-cols-2">
              <FormInput label="Account name" name="name" placeholder="Santander joint, Chip Easy Access, Nationwide" required />
              <FormInput label="Bank / provider" name="provider" placeholder="Santander, Chip, Nationwide" />
              <label className="text-sm font-bold text-slate-700">
                Account type
                <select name="account_type" defaultValue="current_account" className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 font-bold text-slate-950">
                  <option value="current_account">Current / everyday account</option>
                  <option value="savings">Savings account</option>
                  <option value="credit_card">Credit card</option>
                  <option value="mortgage">Mortgage</option>
                  <option value="loan">Loan</option>
                </select>
                <span className="mt-1 block text-xs font-semibold text-slate-400">Current and savings accounts show up wherever Financial Flow asks "which account?" for income and spending. Credit card, mortgage and loan accounts are tracked as liabilities in net worth instead, since you don't pay money into a debt balance.</span>
              </label>
              <label className="text-sm font-bold text-slate-700">
                Owner
                <select name="owner_person_id" defaultValue={defaultOwnerPerson?.id || ""} className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 font-bold text-slate-950">
                  <option value="">Household / shared</option>
                  {ownerOptions.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
                </select>
              </label>
              <FormInput label="Current balance" name="current_balance" type="number" step="0.01" placeholder="0.00" />
              <FormInput label="Rate % (savings only)" name="interest_rate" type="number" step="0.001" placeholder="Leave blank for non-savings accounts" />
              <div className="sm:col-span-2">
                <SubmitButton pendingLabel="Adding account…">Add account</SubmitButton>
              </div>
            </form>
          </SectionCard>
        ) : null}
      </main>
    </>
  );
}
