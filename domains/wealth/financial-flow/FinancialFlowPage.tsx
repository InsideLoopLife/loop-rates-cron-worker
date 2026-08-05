import Link from "next/link";
import {
  ArrowDownRight,
  ArrowLeft,
  ArrowRight,
  ArrowRightLeft,
  Banknote,
  CalendarDays,
  CreditCard,
  HeartPulse,
  Home,
  PiggyBank,
  PlusCircle,
  ShieldCheck,
  Sparkles,
  Target,
  Utensils,
  WalletCards,
  type LucideIcon,
} from "lucide-react";
import { Nav } from "@/components/Nav";
import { PageLandingExperience } from "@/components/landing/PageLandingExperience";
import { SavingsFlowDetail, type SavingsFlowAccountRow, type SavingsFlowPotRow } from "@/components/financial-flow/SavingsFlowDetail";
import { formatMoney } from "@/lib/format/money";
import { calculateSavingsAccruedBalance } from "@/lib/wealth/savings-accrual";
import { buildSavingsTrajectory, movementDelta, movementDirection } from "@/lib/wealth/savings-ledger";
import { estimateSavingsInterestForMonth } from "@/lib/wealth/savings-interest";
import { buildSavingsIntelligence, savingsDealEligibleBalance, savingsDealMatchesAccount } from "@/lib/wealth/savings-intelligence";
import { estimateAnnualTakeHome, type PensionMethod, type StudentLoanPlan } from "@/lib/calculations/tax";
import { calculateNhsMaternityMonthlyAmount, type MaternityPayMode } from "@/lib/calculations/maternity";
import { getChildCostMonthlyAmount, type ChildCostForPlan } from "@/lib/planning/month-plan";
import {
  dedupeHouseholdPeople,
  householdMemberDataOrFilter,
  householdPeopleOrFilter,
  visibleDataOrFilter,
} from "@/lib/auth/household-context";
import { requireWealthPageAccess } from "@/domains/wealth/access";

type TabKey = "flow" | "income" | "spending" | "savings";
type Tone = "orange" | "green" | "blue" | "slate";

type Person = {
  id: string;
  name: string;
  relationship: string | null;
  user_id?: string | null;
  linked_user_id?: string | null;
  email?: string | null;
  invite_email?: string | null;
  birth_date?: string | null;
  account_status?: string | null;
  active_until?: string | null;
  avatar_url?: string | null;
};

type PayEvent = {
  id: string;
  person_id: string | null;
  label: string;
  pay_kind?: string | null;
  gross_annual_salary: number | null;
  monthly_take_home_override: number | null;
  pension_percent: number | null;
  pension_method: PensionMethod | null;
  student_loan_plan: StudentLoanPlan | null;
  effective_from: string | null;
  effective_until: string | null;
  maternity_leave_start?: string | null;
  maternity_leave_end?: string | null;
  maternity_pay_mode?: MaternityPayMode | null;
  maternity_full_pay_weeks?: number | null;
  maternity_half_pay_weeks?: number | null;
  maternity_smp_only_weeks?: number | null;
  maternity_unpaid_weeks?: number | null;
  maternity_smp_weekly_rate?: number | null;
};

type IncomeEntry = {
  id: string;
  person_id: string | null;
  label: string;
  gross_amount: number | null;
  net_amount: number | null;
  frequency: "monthly" | "annual" | "weekly" | string | null;
  entry_date: string | null;
};

type PlannedItem = {
  id: string;
  person_id: string | null;
  category_id: string | null;
  direction: "income" | "outgoing" | string;
  label: string;
  amount: number | null;
  recurrence: "monthly" | "one_off" | string | null;
  start_date: string | null;
  end_date: string | null;
  item_type?: string | null;
  notes?: string | null;
};

type SpendingEntry = {
  id: string;
  person_id: string | null;
  category_id: string | null;
  label: string;
  amount: number | null;
  spent_at: string | null;
  notes?: string | null;
};

type SpendingCategory = {
  id: string;
  name: string;
  type: "fixed" | "variable" | "saving" | "debt" | string;
  monthly_budget: number | null;
  category_icon?: string | null;
  group_id?: string | null;
};

type SpendingCategoryGroup = { id: string; name: string; icon?: string | null };

type FinancialAccount = {
  id: string;
  person_id?: string | null;
  owner_person_id?: string | null;
  ownership_scope?: string | null;
  name: string;
  provider?: string | null;
  provider_slug?: string | null;
  account_type: string;
  current_balance: number | null;
  balance_last_confirmed_value?: number | null;
  balance_last_confirmed_at?: string | null;
  interest_rate?: number | null;
  interest_accrual_frequency?: string | null;
  interest_compounding_frequency?: string | null;
  interest_rate_end_date?: string | null;
  end_date?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  is_liability: boolean | null;
  monthly_top_up_amount?: number | null;
};

type SavingsMovement = {
  id: string;
  financial_account_id: string;
  movement_type: string;
  amount: number;
  previous_balance?: number | null;
  balance_delta?: number | null;
  resulting_balance?: number | null;
  effective_at?: string | null;
  created_at?: string | null;
  note?: string | null;
  source_type?: string | null;
};

type SavingsPot = {
  id: string;
  person_id?: string | null;
  name: string;
  target_amount?: number | null;
  target_date?: string | null;
  monthly_target?: number | null;
  current_allocated_amount?: number | null;
  priority?: number | null;
  status?: string | null;
};

type SavingsPotAllocation = {
  id: string;
  savings_pot_id: string;
  financial_account_id?: string | null;
  amount: number;
  allocation_percent?: number | null;
};

type SavingsRateDeal = {
  id: string;
  account_type?: string | null;
  gross_aer?: number | null;
  minimum_balance?: number | null;
  maximum_balance?: number | null;
  status?: string | null;
  provider_slug?: string | null;
  provider_name?: string | null;
  product_name?: string | null;
  access_type?: string | null;
  withdrawal_rules?: string | null;
  notice_period_days?: number | null;
  term_length_months?: number | null;
  monthly_min_deposit?: number | null;
  monthly_max_deposit?: number | null;
  requires_existing_customer?: boolean | null;
  last_checked_at?: string | null;
};

type PensionAccount = {
  id: string;
  person_id: string | null;
  label?: string | null;
  provider?: string | null;
  fixed_monthly_contribution: number | null;
};

type FlowEvidence = {
  key: string;
  label: string;
  amount: number;
  tone?: Tone;
  href?: string;
};

type FlowLine = {
  key: string;
  label: string;
  amount: number;
  icon: LucideIcon;
  tone: Tone;
  personId?: string | null;
  categoryKey?: string;
  href?: string;
  evidence?: FlowEvidence[];
};

type PersonMonthTotal = {
  personId: string | null;
  label: string;
  colour: string;
  income: number;
  spending: number;
  savings: number;
};

type MonthModel = {
  key: string;
  incomeLines: FlowLine[];
  spendRows: FlowLine[];
  savingsRows: FlowLine[];
  totalIncome: number;
  committedSpending: number;
  savingsTotal: number;
  investmentsTotal: number;
  savingsOnlyTotal: number;
  leftoverCash: number;
  spendByRealGroup: Map<string, number>;
  hasAnyRealGroups: boolean;
  personTotals: PersonMonthTotal[];
};

const tabs: Array<{ key: TabKey; label: string; icon: LucideIcon }> = [
  { key: "flow", label: "Flow", icon: ArrowRightLeft },
  { key: "income", label: "Income", icon: Banknote },
  { key: "spending", label: "Spending", icon: CreditCard },
  { key: "savings", label: "Savings", icon: PiggyBank },
];

const STANDARD_CATEGORIES: Array<{ key: string; label: string; icon: LucideIcon; tone: Tone; terms: string[] }> = [
  { key: "house", label: "House", icon: Home, tone: "orange", terms: ["mortgage", "rent", "house", "home", "property"] },
  { key: "bills", label: "Bills", icon: CreditCard, tone: "orange", terms: ["bill", "energy", "water", "council", "broadband", "phone", "utility", "gas", "electric"] },
  { key: "insurance", label: "Insurance", icon: ShieldCheck, tone: "orange", terms: ["insurance", "cover", "policy", "life cover"] },
  { key: "food", label: "Food shopping", icon: Utensils, tone: "orange", terms: ["food", "grocery", "grocer", "supermarket", "tesco", "aldi", "sainsbury", "asda", "morrisons"] },
  { key: "car", label: "Car & motoring", icon: CreditCard, tone: "orange", terms: ["car finance", "vehicle finance", "car lease", "vehicle lease", "pcp", "hire purchase", "volkswagen", "vw", "ford"] },
  { key: "travel", label: "Travel", icon: ArrowRight, tone: "orange", terms: ["travel", "fuel", "car", "train", "bus", "flight", "parking", "uber", "taxi"] },
  { key: "childcare", label: "Childcare", icon: Sparkles, tone: "orange", terms: ["child", "nursery", "school", "wraparound", "activity", "club"] },
  { key: "subscriptions", label: "Subscriptions", icon: CreditCard, tone: "orange", terms: ["subscription", "sub", "netflix", "spotify", "prime", "disney", "icloud", "streaming"] },
  { key: "fun", label: "Fun", icon: Sparkles, tone: "orange", terms: ["fun", "entertainment", "lottery", "postcode lottery", "leisure", "hobby"] },
  { key: "health", label: "Health", icon: HeartPulse, tone: "orange", terms: ["health", "gym", "dental", "doctor", "pharmacy", "medical"] },
  { key: "debt", label: "Debt", icon: CreditCard, tone: "orange", terms: ["loan", "debt", "credit card", "student loan", "repayment"] },
  { key: "savings", label: "Savings", icon: PiggyBank, tone: "green", terms: ["saving", "savings", "isa", "cash", "top-up", "top up"] },
  { key: "investments", label: "Investments", icon: ArrowRightLeft, tone: "green", terms: ["investment", "invest", "shares", "stocks", "etf", "trading"] },
  { key: "pension", label: "Pension", icon: Target, tone: "green", terms: ["pension", "retirement"] },
];

const PERSON_COLOURS = ["#0284c7", "#f97316", "#14b8a6", "#8b5cf6", "#ec4899", "#84cc16", "#f59e0b", "#0f172a"];

function n(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseMonth(value?: string | null) {
  const fallback = new Date();
  const fallbackKey = `${fallback.getFullYear()}-${String(fallback.getMonth() + 1).padStart(2, "0")}`;
  const month = /^\d{4}-\d{2}$/.test(String(value || "")) ? String(value) : fallbackKey;
  const [year, monthIndex] = month.split("-").map(Number);
  const start = new Date(year, monthIndex - 1, 1);
  const end = new Date(year, monthIndex, 0);
  return { key: month, start, end };
}

function addMonths(monthKey: string, delta: number) {
  const [year, month] = monthKey.split("-").map(Number);
  const date = new Date(year, month - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function iso(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function monthLabel(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric" }).format(new Date(year, month - 1, 1));
}

function isActiveInMonth(start: string | null | undefined, end: string | null | undefined, rangeStart: string, rangeEnd: string) {
  const starts = start || "1900-01-01";
  const ends = end || "9999-12-31";
  return starts <= rangeEnd && ends >= rangeStart;
}

// planned_items.recurrence is "monthly" | "four_weekly" | "custom_interval" | "one_off". A plain
// start/end date-range overlap (isActiveInMonth) is only correct for monthly/four_weekly/custom_interval
// items that are genuinely still "live". A one-off item has no ongoing recurrence at all, so it must
// only ever count in the single month it actually falls in — otherwise it keeps counting every month
// forever once its start_date has passed.
function plannedItemAppliesToMonth(item: { recurrence?: string | null; start_date: string | null; end_date?: string | null }, rangeStart: string, rangeEnd: string) {
  if (!item.start_date) return false;
  if (item.recurrence === "one_off") return item.start_date >= rangeStart && item.start_date <= rangeEnd;
  return isActiveInMonth(item.start_date, item.end_date, rangeStart, rangeEnd);
}

// Occurrences of a four_weekly/custom_interval item within the given date range (inclusive), so the
// month total reflects the (rare) months with two paydays instead of always assuming exactly one.
function plannedItemOccurrencesInRange(item: { recurrence?: string | null; recurrence_interval_days?: number | null; start_date: string | null; end_date?: string | null }, rangeStart: string, rangeEnd: string) {
  if (!item.start_date) return 0;
  if (item.recurrence !== "four_weekly" && item.recurrence !== "custom_interval") return 1;
  const stepDays = item.recurrence === "custom_interval" ? Math.max(1, Number(item.recurrence_interval_days || 0) || 7) : 28;
  const cursor = new Date(`${item.start_date}T12:00:00Z`);
  if (Number.isNaN(cursor.getTime())) return 1;
  const start = new Date(`${rangeStart}T12:00:00Z`);
  const end = new Date(`${rangeEnd}T12:00:00Z`);
  const itemEnd = item.end_date ? new Date(`${item.end_date}T12:00:00Z`) : null;
  while (cursor < start) cursor.setUTCDate(cursor.getUTCDate() + stepDays);
  let count = 0;
  while (cursor <= end && (!itemEnd || cursor <= itemEnd)) {
    count += 1;
    cursor.setUTCDate(cursor.getUTCDate() + stepDays);
  }
  return Math.max(1, count);
}

function isEntryInMonth(entryDate: string | null | undefined, monthKey: string) {
  if (!entryDate) return true;
  return String(entryDate).slice(0, 7) === monthKey;
}

function isLinkedSavingsTransfer(item: PlannedItem) {
  const notes = String(item.notes || "");
  const itemType = String(item.item_type || "").toLowerCase();
  return itemType === "saving_investment" && notes.includes("[linked_savings_account:");
}

function monthlyise(value: number, frequency?: string | null) {
  if (frequency === "annual") return value / 12;
  if (frequency === "weekly") return (value * 52) / 12;
  return value;
}

function monthsBetweenDates(start: Date, end: Date) {
  return Math.max(0, (end.getFullYear() - start.getFullYear()) * 12 + end.getMonth() - start.getMonth());
}

function selectedScopeIds(people: Person[], requestedPeople?: string, legacyPerson?: string) {
  const requested = requestedPeople || legacyPerson || "all";
  if (!requested || requested === "all") return [];
  const valid = new Set(people.map((person) => person.id));
  return Array.from(new Set(requested.split(",").map((id) => id.trim()).filter((id) => valid.has(id))));
}

function personOwned<T extends { person_id?: string | null; owner_person_id?: string | null; ownership_scope?: string | null }>(row: T, scopeIds: string[]) {
  if (!scopeIds.length) return true;
  const owner = row.owner_person_id || row.person_id || null;
  if (owner && scopeIds.includes(owner)) return true;
  return !owner && ["household", "joint", "shared"].includes(String(row.ownership_scope || ""));
}

function isMaternityPay(event: PayEvent) {
  const text = `${event.pay_kind || ""} ${event.label || ""}`.toLowerCase();
  return text.includes("maternity");
}

function monthlyPay(event: PayEvent, monthKey: string) {
  if (isMaternityPay(event)) {
    const estimate = calculateNhsMaternityMonthlyAmount({
      month: monthKey,
      grossAnnualSalary: n(event.gross_annual_salary),
      leaveStart: event.maternity_leave_start || event.effective_from || monthKey,
      leaveEnd: event.maternity_leave_end || event.effective_until || event.effective_from || monthKey,
      fullPayWeeks: n(event.maternity_full_pay_weeks) || 8,
      halfPayWeeks: n(event.maternity_half_pay_weeks) || 18,
      smpOnlyWeeks: n(event.maternity_smp_only_weeks) || 13,
      unpaidWeeks: n(event.maternity_unpaid_weeks) || 13,
      smpWeeklyRate: n(event.maternity_smp_weekly_rate) || 194.32,
      payMode: event.maternity_pay_mode || "nhs_spread_occupational_actual_smp",
      pensionPercent: n(event.pension_percent),
      pensionMethod: event.pension_method || "net_pay",
      studentLoanPlan: event.student_loan_plan || "none",
    });
    if (estimate.estimatedNetAmount > 0) return estimate.estimatedNetAmount;
  }
  if (event.monthly_take_home_override !== null && event.monthly_take_home_override !== undefined) {
    return n(event.monthly_take_home_override);
  }
  const gross = n(event.gross_annual_salary);
  if (!gross) return 0;
  return estimateAnnualTakeHome({
    grossAnnual: gross,
    pensionPercent: n(event.pension_percent),
    pensionMethod: event.pension_method || "net_pay",
    studentLoanPlan: event.student_loan_plan || "none",
  }).monthlyTakeHome;
}

function profileLabel(person: Person | null | undefined, index = 0) {
  if (!person) return "Household";
  const rel = String(person.relationship || "").toLowerCase();
  if (rel === "child") return `Child profile ${index + 1}`;
  if (rel === "partner") return `Adult profile ${index + 1}`;
  if (rel === "self") return "Your profile";
  return `Profile ${index + 1}`;
}

function personColour(personId: string | null | undefined, people: Person[]) {
  if (!personId) return "#64748b";
  const index = Math.max(0, people.findIndex((person) => person.id === personId));
  return PERSON_COLOURS[index % PERSON_COLOURS.length];
}

function classifyCategory(label: string, explicit?: SpendingCategory | null) {
  const explicitName = String(explicit?.name || "").toLowerCase();
  const text = `${label} ${explicitName} ${explicit?.type || ""}`.toLowerCase();
  const found = STANDARD_CATEGORIES.find((hint) => hint.terms.some((term) => text.includes(term)) || explicitName === hint.label.toLowerCase());
  if (found) return found;
  if (explicit?.type === "saving") return STANDARD_CATEGORIES.find((hint) => hint.key === "savings")!;
  if (explicit?.type === "debt") return STANDARD_CATEGORIES.find((hint) => hint.key === "debt")!;
  return { key: explicit?.name?.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "other", label: explicit?.name || label || "Other", icon: Sparkles, tone: "orange" as Tone, terms: [] };
}

function percentNumber(value: number, total: number) {
  if (total <= 0) return 0;
  return Math.max(0, Math.round((value / total) * 100));
}

function percent(value: number, total: number) {
  return `${percentNumber(value, total)}%`;
}

function queryHref(tab: TabKey, month: string, scopeIds: string[], nextScope?: string[] | "all") {
  const params = new URLSearchParams();
  params.set("tab", tab);
  params.set("month", month);
  const chosen = nextScope === undefined ? scopeIds : nextScope;
  if (chosen !== "all" && chosen.length) params.set("people", chosen.join(","));
  return `/financial-flow?${params.toString()}`;
}

function toggleScope(scopeIds: string[], id: string) {
  const set = new Set(scopeIds);
  if (set.has(id)) set.delete(id);
  else set.add(id);
  return Array.from(set);
}

function childIcon(person: Person, index: number) {
  const options = ["🦊", "🦖", "🐢", "⭐", "🌙", "🚀", "🧸", "🐝"];
  const seed = Array.from(person.id || String(index)).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return options[seed % options.length];
}

function ProfileToken({ person, selected, index }: { person: Person; selected: boolean; index: number }) {
  const isChild = String(person.relationship || "").toLowerCase() === "child";
  const label = isChild ? childIcon(person, index) : "👤";
  return (
    <span className={`grid h-10 w-10 place-items-center overflow-hidden rounded-full text-lg font-black shadow-sm ring-2 ${selected ? "bg-slate-950 text-white ring-slate-950" : isChild ? "bg-sky-50 text-sky-700 ring-sky-100" : "bg-orange-50 text-orange-700 ring-orange-100"}`} aria-hidden="true">
      {person.avatar_url ? <img src={person.avatar_url} alt="" className="h-full w-full object-cover" /> : label}
    </span>
  );
}

function ScopeSelector({ people, activeTab, month, scopeIds }: { people: Person[]; activeTab: TabKey; month: string; scopeIds: string[] }) {
  const allSelected = scopeIds.length === 0;
  return (
    <div className="flex flex-wrap items-center gap-2" aria-label="Choose household scope">
      <Link href={queryHref(activeTab, month, scopeIds, "all")} className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-black ${allSelected ? "bg-slate-950 text-white" : "border border-slate-200 bg-white text-slate-700"}`}>
        <Home className="h-4 w-4" /> Household
      </Link>
      {people.map((person, index) => {
        const selected = scopeIds.includes(person.id);
        const nextScope = toggleScope(scopeIds, person.id);
        return (
          <Link key={person.id} href={queryHref(activeTab, month, scopeIds, nextScope.length ? nextScope : "all")} title={person.name} className={`rounded-full p-1 transition ${selected ? "bg-slate-950" : "bg-white/80 hover:bg-white"}`} aria-label={`Toggle ${person.name}`}>
            <ProfileToken person={person} selected={selected} index={index} />
          </Link>
        );
      })}
    </div>
  );
}

function MonthControls({ activeTab, month, scopeIds }: { activeTab: TabKey; month: string; scopeIds: string[] }) {
  const left = addMonths(month, -1);
  const right = addMonths(month, 1);
  return (
    <div className="flex items-center gap-2 rounded-[2rem] border border-slate-800 bg-slate-950 p-1 text-sm font-black text-white shadow-sm">
      <Link href={queryHref(activeTab, addMonths(month, -2), scopeIds)} className="grid h-11 w-11 place-items-center rounded-full bg-white/10 hover:bg-white/15" aria-label="Move back"><ArrowLeft className="h-4 w-4" /></Link>
      <Link href={queryHref(activeTab, left, scopeIds)} className="hidden rounded-2xl bg-white/10 px-4 py-3 text-white/70 hover:bg-white/15 md:block">{monthLabel(left)}</Link>
      <form action="/financial-flow" className="flex items-center gap-2 rounded-2xl bg-white px-3 py-2 text-slate-950 shadow-sm">
        <input type="hidden" name="tab" value={activeTab} />
        {scopeIds.length ? <input type="hidden" name="people" value={scopeIds.join(",")} /> : null}
        <CalendarDays className="h-4 w-4 text-slate-500" />
        <input name="month" type="month" defaultValue={month} className="w-[8.5rem] bg-transparent text-center font-black outline-none" aria-label="Selected month" />
        <button className="rounded-full bg-slate-950 px-3 py-1.5 text-xs text-white">View</button>
      </form>
      <Link href={queryHref(activeTab, right, scopeIds)} className="hidden rounded-2xl bg-white/10 px-4 py-3 text-white/70 hover:bg-white/15 md:block">{monthLabel(right)}</Link>
      <Link href={queryHref(activeTab, addMonths(month, 2), scopeIds)} className="grid h-11 w-11 place-items-center rounded-full bg-white/10 hover:bg-white/15" aria-label="Move forward"><ArrowRight className="h-4 w-4" /></Link>
    </div>
  );
}

const NODE_PALETTE = { spending: "#f97316", savings: "#10b981", investments: "#8b5cf6", cashflow: "#334155" };
const SPEND_GROUP_COLOURS = ["#fb923c", "#f59e0b", "#fb7185", "#c084fc", "#38bdf8", "#4ade80", "#f472b6"];

const NODE_ICON: Record<string, string> = {
  spending: "💳",
  savings: "🐷",
  investments: "📈",
  cashflow: "👛",
};

function FlowSankeyDiagram({ model, people }: { model: MonthModel; people: Person[] }) {
  const total = Math.max(1, model.totalIncome);

  // --- Column 0: income, notched by source (person/pay event), not shown as separate nodes ---
  const incomeBySource = Array.from(
    model.incomeLines.reduce((map, line) => {
      const key = line.personId || "__household";
      map.set(key, (map.get(key) || 0) + line.amount);
      return map;
    }, new Map<string, number>()),
  )
    .map(([personId, amount]) => ({
      personId: personId === "__household" ? null : personId,
      label: personId === "__household" ? "Household / shared" : people.find((p) => p.id === personId)?.name || "Household",
      amount,
      colour: personColour(personId === "__household" ? null : personId, people),
    }))
    .filter((row) => row.amount > 0)
    .sort((a, b) => b.amount - a.amount);

  // --- Column 1: the four main destinations for income ---
  const stage1 = [
    { key: "spending", label: "Spending", amount: model.committedSpending, colour: NODE_PALETTE.spending },
    { key: "savings", label: "Savings", amount: model.savingsOnlyTotal, colour: NODE_PALETTE.savings },
    { key: "investments", label: "Investments", amount: model.investmentsTotal, colour: NODE_PALETTE.investments },
    { key: "cashflow", label: "Cashflow", amount: Math.max(0, model.leftoverCash), colour: NODE_PALETTE.cashflow },
  ].filter((row) => row.amount > 0);

  if (stage1.length === 0) {
    return null;
  }

  // --- Column 2: only Spending splits further, and only if the household has actually set up
  // groups on the categories board. No groups yet? A single line runs straight to "Spending". ---
  let spendGroups: { label: string; amount: number; colour: string }[] = [];
  if (model.hasAnyRealGroups) {
    const rawGroups = Array.from(model.spendByRealGroup.entries())
      .map(([key, amount]) => ({ label: key === "__ungrouped" ? "Ungrouped" : key, amount }))
      .filter((row) => row.amount > 0)
      .sort((a, b) => b.amount - a.amount);
    const groupedTotal = rawGroups.reduce((sum, row) => sum + row.amount, 0);
    const residual = model.committedSpending - groupedTotal;
    if (residual > 1) rawGroups.push({ label: "Other spending", amount: residual });
    spendGroups = rawGroups.map((row, index) => ({ ...row, colour: SPEND_GROUP_COLOURS[index % SPEND_GROUP_COLOURS.length] }));
  }

  // --- Geometry: the viewBox is sized close to a typical rendered width on purpose. Earlier this
  // used a much smaller coordinate system (e.g. 560 units) stretched via CSS to fill a wide
  // container — since SVG text scales with the whole coordinate system, that stretch blew a
  // "small" 10px label up into an oversized, overlapping mess. Using a bigger, more realistic
  // canvas keeps the scale factor close to 1:1 regardless of container width.
  const rowH = 48;
  const rowGap = 14;
  const topPad = 24;
  const leftLabelPad = 130;
  const nodeThickness = 14;
  const hasStage2 = spendGroups.length > 1;
  const width = hasStage2 ? 1500 : 1100;
  const colIncomeX = leftLabelPad;
  const col1X = hasStage2 ? 560 : width - 260;
  const col2X = width - 260;

  const stage1RowsHeight = stage1.length * rowH + (stage1.length - 1) * rowGap;
  const stage2RowsHeight = hasStage2 ? spendGroups.length * rowH + (spendGroups.length - 1) * rowGap : 0;
  const height = Math.max(240, Math.max(stage1RowsHeight, stage2RowsHeight) + topPad * 2);

  const incomeBarHeight = Math.max(stage1RowsHeight, 80);
  let cIncome = topPad;
  const incomeSegments = incomeBySource.map((source) => {
    const segHeight = Math.max(4, (source.amount / total) * incomeBarHeight);
    const y0 = cIncome;
    cIncome += segHeight;
    return { ...source, y0, y1: cIncome - 2 };
  });

  let cStage1Source = topPad;
  let cStage1Target = topPad;
  const stage1Ribbons = stage1.map((row) => {
    const sourceHeight = Math.max(4, (row.amount / total) * incomeBarHeight);
    const sourceY0 = cStage1Source;
    const sourceY1 = cStage1Source + sourceHeight;
    cStage1Source = sourceY1;
    const targetY0 = cStage1Target;
    const targetY1 = cStage1Target + rowH;
    cStage1Target = targetY1 + rowGap;
    const midX = (colIncomeX + col1X) / 2;
    const path = `M ${colIncomeX + nodeThickness} ${sourceY0} C ${midX} ${sourceY0} ${midX} ${targetY0} ${col1X - (row.key === "spending" && hasStage2 ? 0 : nodeThickness)} ${targetY0} L ${col1X - (row.key === "spending" && hasStage2 ? 0 : nodeThickness)} ${targetY1} C ${midX} ${targetY1} ${midX} ${sourceY1} ${colIncomeX + nodeThickness} ${sourceY1} Z`;
    return { ...row, sourceY0, sourceY1, targetY0, targetY1, path, percent: Math.round((row.amount / total) * 100) };
  });

  const spendingStage1 = stage1Ribbons.find((row) => row.key === "spending");
  let cStage2Target = topPad;
  const stage2Ribbons = hasStage2 && spendingStage1
    ? spendGroups.map((group) => {
        const sourceHeight = Math.max(4, (group.amount / Math.max(1, model.committedSpending)) * (spendingStage1.targetY1 - spendingStage1.targetY0));
        const targetY0 = cStage2Target;
        const targetY1 = cStage2Target + rowH;
        cStage2Target = targetY1 + rowGap;
        return { ...group, targetY0, targetY1, sourceHeight, percent: Math.round((group.amount / total) * 100) };
      })
    : [];
  let cStage2Source = spendingStage1?.targetY0 ?? topPad;
  const stage2RibbonsWithPaths = stage2Ribbons.map((ribbon) => {
    const sourceY0 = cStage2Source;
    const sourceY1 = cStage2Source + ribbon.sourceHeight;
    cStage2Source = sourceY1;
    const midX = (col1X + col2X) / 2;
    const path = `M ${col1X} ${sourceY0} C ${midX} ${sourceY0} ${midX} ${ribbon.targetY0} ${col2X - nodeThickness} ${ribbon.targetY0} L ${col2X - nodeThickness} ${ribbon.targetY1} C ${midX} ${ribbon.targetY1} ${midX} ${sourceY1} ${col1X} ${sourceY1} Z`;
    return { ...ribbon, sourceY0, sourceY1, path };
  });

  return (
    <div className="overflow-x-auto rounded-3xl border border-white/70 bg-white/92 p-5 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">This month's flow</p>
      <h2 className="mb-3 text-base font-bold text-slate-900">Where {formatMoney(model.totalIncome)} of income goes</h2>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label="Diagram of income splitting into spending, savings, investments and cashflow, with spending broken down by group">
        {stage1Ribbons.map((ribbon) => (
          <path key={ribbon.key} d={ribbon.path} fill={ribbon.colour} opacity={0.18}>
            <title>{`${ribbon.label}: ${formatMoney(ribbon.amount)} (${ribbon.percent}% of income)`}</title>
          </path>
        ))}
        {stage2RibbonsWithPaths.map((ribbon, index) => (
          <path key={`s2-${index}`} d={ribbon.path} fill={ribbon.colour} opacity={0.22}>
            <title>{`${ribbon.label}: ${formatMoney(ribbon.amount)} (${ribbon.percent}% of income)`}</title>
          </path>
        ))}

        {/* Income bar, notched by source */}
        {incomeSegments.map((segment) => (
          <rect key={segment.personId || "household"} x={colIncomeX} y={segment.y0} width={nodeThickness} height={Math.max(1, segment.y1 - segment.y0)} fill={segment.colour} rx={3}>
            <title>{`${segment.label}: ${formatMoney(segment.amount)}`}</title>
          </rect>
        ))}
        <text x={colIncomeX - 18} y={topPad + incomeBarHeight / 2 - 6} textAnchor="end" className="fill-slate-900 text-[22px] font-bold">👥 Income</text>
        <text x={colIncomeX - 18} y={topPad + incomeBarHeight / 2 + 20} textAnchor="end" className="fill-slate-500 text-[18px] font-medium">{formatMoney(model.totalIncome)}</text>

        {/* Stage 1 nodes */}
        {stage1Ribbons.map((ribbon) => (
          <g key={`node-${ribbon.key}`}>
            <rect x={col1X - nodeThickness} y={ribbon.targetY0} width={nodeThickness} height={ribbon.targetY1 - ribbon.targetY0} rx={3} fill={ribbon.colour} />
            {!(ribbon.key === "spending" && hasStage2) ? (
              <>
                <text x={col1X + 20} y={(ribbon.targetY0 + ribbon.targetY1) / 2 - 6} textAnchor="start" className="fill-slate-900 text-[20px] font-bold">{NODE_ICON[ribbon.key] || ""} {ribbon.label}</text>
                <text x={col1X + 20} y={(ribbon.targetY0 + ribbon.targetY1) / 2 + 18} textAnchor="start" className="fill-slate-500 text-[16px] font-medium">{formatMoney(ribbon.amount)} · {ribbon.percent}%</text>
              </>
            ) : (
              <text x={col1X - nodeThickness - 16} y={(ribbon.targetY0 + ribbon.targetY1) / 2 + 6} textAnchor="end" className="fill-slate-700 text-[17px] font-semibold">{NODE_ICON.spending} Spending</text>
            )}
          </g>
        ))}

        {/* Stage 2 nodes: spending's groups */}
        {stage2RibbonsWithPaths.map((ribbon, index) => (
          <g key={`s2-node-${index}`}>
            <rect x={col2X - nodeThickness} y={ribbon.targetY0} width={nodeThickness} height={ribbon.targetY1 - ribbon.targetY0} rx={3} fill={ribbon.colour} />
            <text x={col2X + 20} y={(ribbon.targetY0 + ribbon.targetY1) / 2 - 6} textAnchor="start" className="fill-slate-900 text-[20px] font-bold">{ribbon.label.toLowerCase() === "ungrouped" ? "📁" : "🏷️"} {ribbon.label}</text>
            <text x={col2X + 20} y={(ribbon.targetY0 + ribbon.targetY1) / 2 + 18} textAnchor="start" className="fill-slate-500 text-[16px] font-medium">{formatMoney(ribbon.amount)}</text>
          </g>
        ))}
      </svg>
      {!model.hasAnyRealGroups ? <p className="mt-2 text-xs font-medium text-slate-400">Set up groups on "Manage categories and groups" to break Spending down further here.</p> : null}
    </div>
  );
}

const FLOW_TONE_BADGE: Record<Tone, string> = {
  orange: "bg-orange-50 text-orange-600",
  green: "bg-emerald-50 text-emerald-600",
  blue: "bg-sky-50 text-sky-600",
  slate: "bg-slate-100 text-slate-500",
};

function MainFlowDiagram({ model, people }: { model: MonthModel; people: Person[] }) {
  const spendingPct = percentNumber(model.committedSpending, model.totalIncome);
  const savingsPct = percentNumber(model.savingsTotal, model.totalIncome);
  const leftoverPct = percentNumber(model.leftoverCash, model.totalIncome);
  const detailRows: FlowLine[] = [...model.spendRows.slice(0, 8), ...model.savingsRows, { key: "leftover", label: "Unallocated cash", amount: model.leftoverCash, icon: WalletCards, tone: "blue" as Tone }].filter((row) => row.amount > 0);
  return <>
    <FlowSankeyDiagram model={model} people={people} />
    <section className="rounded-[2.25rem] border border-white/70 bg-white/92 p-5 shadow-sm md:p-6"><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[
    ["Income", model.totalIncome, "100%", "bg-sky-50 text-sky-800"],
    ["Spending", model.committedSpending, `${spendingPct}%`, "bg-orange-50 text-orange-800"],
    ["Savings", model.savingsTotal, `${savingsPct}%`, "bg-emerald-50 text-emerald-800"],
    ["Available", model.leftoverCash, `${leftoverPct}%`, "bg-slate-950 text-white"],
  ].map(([label, amount, value, classes]) => <article key={String(label)} className={`rounded-3xl p-5 ${classes}`}><p className="text-xs font-black uppercase tracking-wide opacity-65">{label}</p><p className="mt-2 text-3xl font-black">{formatMoney(Number(amount))}</p><p className="mt-1 text-sm font-black opacity-65">{value}</p></article>)}</div><div className="mt-5"><div className="mb-3 flex items-end justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">Household flow lines</p><h2 className="text-xl font-black text-slate-950">Grouped categories and their sources</h2></div><Link href={`/spending?month=${model.key}`} className="rounded-full bg-slate-950 px-4 py-2 text-xs font-black text-white">Manage spending</Link></div><div className="grid gap-2 lg:grid-cols-2">{detailRows.map((row) => <details key={row.key} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4"><summary className="flex cursor-pointer list-none items-center justify-between gap-4"><div className="flex items-center gap-3"><span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${FLOW_TONE_BADGE[row.tone]}`}><row.icon className="h-4 w-4" /></span><div><p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Grouped as</p><p className="font-black text-slate-900">{row.label}</p></div></div><div className="text-right"><p className="font-black text-slate-950">{formatMoney(row.amount)}</p><p className="text-xs font-black text-slate-500">{percent(row.amount, model.totalIncome)} · show sources</p></div></summary><div className="mt-3 space-y-2 border-t border-slate-200 pt-3">{(row.evidence?.length ? row.evidence : [{ key: row.key, label: row.label, amount: row.amount, href: row.href }]).map((item) => <div key={item.key} className="flex items-center justify-between gap-3 rounded-xl bg-white p-3"><div><p className="text-xs font-black text-slate-900">{item.label}</p><p className="text-[10px] font-bold text-slate-400">Category: {row.label}</p></div><div className="flex items-center gap-2"><p className="text-sm font-black">{formatMoney(item.amount)}</p><Link href={item.href || `/spending?month=${model.key}`} className="rounded-full bg-slate-100 px-3 py-1.5 text-[10px] font-black text-slate-700">Change category</Link></div></div>)}</div></details>)}{!detailRows.length ? <p className="rounded-2xl border border-dashed border-slate-200 p-6 text-sm font-bold text-slate-400">Add income, bills and savings to build the flow.</p> : null}</div></div></section>
  </>;
}

function stackedSegments(items: Array<{ amount: number; colour: string; label: string }>, total: number) {
  return items.filter((item) => item.amount > 0).map((item, index) => (
    <span key={`${item.label}-${index}`} className="block h-full" style={{ width: `${Math.max(2, (item.amount / Math.max(total, 1)) * 100)}%`, backgroundColor: item.colour }} title={`${item.label}: ${formatMoney(item.amount)}`} />
  ));
}

function MoneyFlowCalendar({ months, selectedMonth, activeTab, scopeIds }: { months: MonthModel[]; selectedMonth: string; activeTab: TabKey; scopeIds: string[] }) {
  const maxAmount = Math.max(1, ...months.map((month) => Math.max(month.totalIncome, month.committedSpending, month.savingsTotal)));
  return (
    <section className="rounded-[2rem] border border-white/70 bg-white/90 p-6 shadow-sm">
      <div className="mb-5 flex items-end justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.22em] text-slate-400">Year flow calendar</p>
          <h2 className="text-2xl font-black text-slate-950">Income, spending and saving by month</h2>
          <p className="mt-1 text-sm font-semibold text-slate-500">Colours show profile allocation. Hover each bar to see what is using what.</p>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {months.map((summary) => {
          const selected = summary.key === selectedMonth;
          const title = summary.personTotals.map((person) => `${person.label}: income ${formatMoney(person.income)}, spending ${formatMoney(person.spending)}, savings ${formatMoney(person.savings)}`).join("\n");
          return (
            <Link key={summary.key} href={queryHref(activeTab, summary.key, scopeIds)} title={title} className={`rounded-2xl border p-4 transition hover:-translate-y-0.5 hover:shadow-sm ${selected ? "border-orange-300 bg-orange-500 text-white" : "border-slate-200 bg-white text-slate-950"}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-black">{monthLabel(summary.key)}</p>
                  <p className={`mt-1 text-xs ${selected ? "text-white/80" : "text-slate-500"}`}>In {formatMoney(summary.totalIncome)} · Out {formatMoney(summary.committedSpending)}</p>
                </div>
                <span className={`rounded-full px-2 py-1 text-xs font-bold ${selected ? "bg-white/20 text-white" : summary.leftoverCash >= 0 ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>{formatMoney(summary.leftoverCash)}</span>
              </div>
              <div className="mt-3 grid gap-1">
                <div className="h-2 overflow-hidden rounded-full bg-slate-100" aria-label="Income by profile"><div className="flex h-full" style={{ width: `${Math.min(100, Math.round((summary.totalIncome / maxAmount) * 100))}%` }}>{stackedSegments(summary.personTotals.map((p) => ({ amount: p.income, colour: p.colour, label: `${p.label} income` })), summary.totalIncome)}</div></div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-100" aria-label="Spending by profile"><div className="flex h-full" style={{ width: `${Math.min(100, Math.round((summary.committedSpending / maxAmount) * 100))}%` }}>{stackedSegments(summary.personTotals.map((p) => ({ amount: p.spending, colour: p.colour, label: `${p.label} spending` })), summary.committedSpending)}</div></div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-100" aria-label="Savings by profile"><div className="flex h-full" style={{ width: `${Math.min(100, Math.round((summary.savingsTotal / maxAmount) * 100))}%` }}>{stackedSegments(summary.personTotals.map((p) => ({ amount: p.savings, colour: p.colour, label: `${p.label} savings` })), summary.savingsTotal)}</div></div>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function DetailPanel({ activeTab, month, incomeLines, spendRows, savingsRows }: { activeTab: TabKey; month: string; incomeLines: FlowLine[]; spendRows: FlowLine[]; savingsRows: FlowLine[] }) {
  if (activeTab === "flow") return null;
  const config = activeTab === "income"
    ? { title: "Income detail", copy: "Add salary, dividends, benefits or one-off income in the income area. Remove or edit any line from the same detail page.", href: `/income?month=${month}`, add: "Add income", remove: "Edit / remove income", rows: incomeLines, tone: "green" as Tone }
    : activeTab === "spending"
      ? { title: "Spending detail", copy: "Add bills, subscriptions and one-off spend in spending. Categories decide where each item appears in the flow.", href: `/spending?month=${month}`, add: "Add spending", remove: "Edit / remove spending", rows: spendRows, tone: "orange" as Tone }
      : { title: "Savings detail", copy: "Add savings accounts, regular top-ups and goals. Loop then shows whether the household is building enough spare cash.", href: "/accounts?type=savings", add: "Add savings account", remove: "Edit / remove savings", rows: savingsRows, tone: "green" as Tone };

  return (
    <section className="grid gap-5">
      <article className="rounded-[2rem] border border-white/70 bg-white/90 p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div><p className="text-xs font-black uppercase tracking-[0.22em] text-slate-400">{month}</p><h3 className="text-xl font-black text-slate-950">This month's {activeTab} breakdown</h3></div>
          <Link href={config.href} className="rounded-full bg-slate-950 px-4 py-2 text-xs font-black text-white">{config.add}</Link>
        </div>
        <div className="space-y-1">
          {config.rows.map((row) => (
            <details key={row.key} className="rounded-2xl border border-slate-200 bg-white p-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Grouped as</p>
                  <p className="font-black text-slate-900">{row.label}</p>
                </div>
                <div className="text-right">
                  <p className="font-black text-slate-950">{formatMoney(row.amount)}</p>
                  <p className="text-xs font-bold text-slate-400">Show included lines</p>
                </div>
              </summary>
              <div className="mt-3 space-y-2 border-t border-slate-200 pt-3">
                {(row.evidence?.length ? row.evidence : [{ key: row.key, label: row.label, amount: row.amount, href: row.href }]).map((item) => (
                  <div key={item.key} className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 p-3">
                    <div>
                      <p className="text-xs font-black text-slate-900">{item.label}</p>
                      <p className="text-[10px] font-bold text-slate-400">Category: {row.label}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-black">{formatMoney(item.amount)}</p>
                      <Link href={item.href || config.href} className="rounded-full bg-white px-3 py-1.5 text-[10px] font-black text-slate-700 shadow-sm">Change category</Link>
                    </div>
                  </div>
                ))}
              </div>
            </details>
          ))}
          {!config.rows.length ? <p className="rounded-2xl border border-dashed border-slate-200 p-6 text-center text-sm font-bold text-slate-400">No lines yet for this section. Use "{config.add}" above to add some.</p> : null}
        </div>
      </article>
    </section>
  );
}

export default async function FinancialFlowPage({ searchParams }: { searchParams?: Promise<{ tab?: string; person?: string; people?: string; month?: string }> }) {
  const params = searchParams ? await searchParams : {};
  const activeTab: TabKey = tabs.some((tab) => tab.key === params.tab) ? (params.tab as TabKey) : "flow";
  const month = parseMonth(params.month);
  const { supabase, user, householdContext } = await requireWealthPageAccess();
  const memberFilter = householdMemberDataOrFilter(householdContext);
  const visibleFilter = visibleDataOrFilter(householdContext);
  const allocationFilter = householdContext.householdId
    ? `user_id.eq.${user.id},household_id.eq.${householdContext.householdId}`
    : `user_id.eq.${user.id}`;

  const [profileResult, peopleResult, payResult, incomeResult, plannedResult, spendingEntriesResult, categoriesResult, categoryGroupsResult, accountsResult, pensionsResult, movementsResult, potsResult, potAllocationsResult, dealsResult, childCostsResult] = await Promise.all([
    supabase.from("app_user_profiles").select("*").eq("user_id", user.id).maybeSingle(),
    supabase.from("people").select("id, name, relationship, user_id, linked_user_id, email, invite_email, birth_date, account_status, active_until, avatar_url").or(householdPeopleOrFilter(householdContext)).order("relationship").order("name").returns<Person[]>(),
    supabase.from("pay_events").select("id, person_id, label, pay_kind, gross_annual_salary, monthly_take_home_override, pension_percent, pension_method, student_loan_plan, effective_from, effective_until, maternity_leave_start, maternity_leave_end, maternity_pay_mode, maternity_full_pay_weeks, maternity_half_pay_weeks, maternity_smp_only_weeks, maternity_unpaid_weeks, maternity_smp_weekly_rate").or(memberFilter).returns<PayEvent[]>(),
    supabase.from("income_entries").select("id, person_id, label, gross_amount, net_amount, frequency, entry_date").or(memberFilter).returns<IncomeEntry[]>(),
    supabase.from("planned_items").select("id, person_id, category_id, direction, label, amount, recurrence, recurrence_interval_days, start_date, end_date, item_type, notes").or(visibleFilter).returns<PlannedItem[]>(),
    supabase.from("spending_entries").select("id, person_id, category_id, label, amount, spent_at, notes").or(visibleFilter).returns<SpendingEntry[]>(),
    supabase.from("spending_categories").select("id, name, type, monthly_budget, category_icon, group_id").or(visibleFilter).returns<SpendingCategory[]>(),
    supabase.from("spending_category_groups").select("id, name, icon").or(visibleFilter).returns<SpendingCategoryGroup[]>(),
    supabase.from("financial_accounts").select("id, owner_person_id, ownership_scope, name, provider, provider_slug, account_type, current_balance, balance_last_confirmed_value, balance_last_confirmed_at, interest_rate, interest_accrual_frequency, interest_compounding_frequency, interest_rate_end_date, end_date, is_liability, monthly_top_up_amount, created_at, updated_at").or(memberFilter).returns<FinancialAccount[]>(),
    supabase.from("pension_accounts").select("id, person_id, label, provider, fixed_monthly_contribution").or(memberFilter).returns<PensionAccount[]>(),
    supabase.from("savings_account_movements").select("id, financial_account_id, movement_type, amount, previous_balance, balance_delta, resulting_balance, effective_at, created_at, note, source_type").or(visibleFilter).order("effective_at", { ascending: false }).limit(1500).returns<SavingsMovement[]>(),
    supabase.from("savings_pots").select("id, person_id, name, target_amount, target_date, monthly_target, current_allocated_amount, priority, status").or(visibleFilter).in("status", ["active", "paused", "completed"]).order("priority", { ascending: true }).returns<SavingsPot[]>(),
    supabase.from("savings_pot_allocations").select("id, savings_pot_id, financial_account_id, amount, allocation_percent").or(allocationFilter).returns<SavingsPotAllocation[]>(),
    supabase.from("savings_rate_deals").select("id, provider_slug, provider_name, product_name, account_type, gross_aer, minimum_balance, maximum_balance, monthly_min_deposit, monthly_max_deposit, access_type, withdrawal_rules, notice_period_days, term_length_months, requires_existing_customer, last_checked_at, status").eq("status", "active").order("gross_aer", { ascending: false }).limit(150).returns<SavingsRateDeal[]>(),
    supabase.from("child_costs").select("id, child_id, label, cost_kind, category_id, monthly_cost, billing_month, daily_rate, extra_daily_cost, funded_hours_per_week, funding_mode, hourly_funding_credit, term_weeks_per_year, billing_schedule, bank_holidays_are_free, tax_free_childcare_enabled, tax_free_childcare_cap_per_quarter, part_day_multiplier, full_day_hours, part_day_hours, monday_session, tuesday_session, wednesday_session, thursday_session, friday_session, monday_hours, tuesday_hours, wednesday_hours, thursday_hours, friday_hours, activity_weekly_cost, activity_weekday, activity_billing_mode, activity_term_weeks_per_year, starts_on, ends_on").or(memberFilter).returns<ChildCostForPlan[]>(),
  ]);

  const people = dedupeHouseholdPeople(peopleResult.data || [], user.id) as Person[];
  const scopeIds = selectedScopeIds(people, params.people, params.person);
  const scopeLabel = scopeIds.length === 0 ? "Whole household" : `${scopeIds.length} selected`;
  const selectedScopePeople = people.filter((person) => scopeIds.includes(person.id));
  const savingsScopeLabel = scopeIds.length === 0
    ? "household income"
    : selectedScopePeople.length === 1
      ? `${selectedScopePeople[0].name}'s income`
      : "selected people's income";
  const profile = profileResult.data as any;
  const categoryById = new Map((categoriesResult.data || []).map((category) => [category.id, category]));
  const groupById = new Map((categoryGroupsResult.data || []).map((group) => [group.id, group]));

  function buildModel(monthKey: string, scoped = true): MonthModel {
    const parsed = parseMonth(monthKey);
    const rangeStart = iso(parsed.start);
    const rangeEnd = iso(parsed.end);
    const activeScope = scoped ? scopeIds : [];

    const activePay = (payResult.data || []).filter((event) => personOwned(event, activeScope) && isActiveInMonth(event.effective_from, event.effective_until, rangeStart, rangeEnd));
    const maternityPeople = new Set(activePay.filter(isMaternityPay).map((event) => event.person_id || "household"));
    const payLines = activePay
      .filter((event) => !(maternityPeople.has(event.person_id || "household") && !isMaternityPay(event)))
      .map((event) => ({ key: `pay-${event.id}`, label: isMaternityPay(event) ? "Maternity pay" : event.label || "Salary", amount: monthlyPay(event, monthKey), icon: Banknote, tone: "green" as Tone, personId: event.person_id }));
    const loggedIncomeLines = (incomeResult.data || [])
      .filter((entry) => personOwned(entry, activeScope) && isEntryInMonth(entry.entry_date, monthKey))
      .map((entry) => ({ key: `income-${entry.id}`, label: entry.label || "Income", amount: monthlyise(n(entry.net_amount ?? entry.gross_amount), entry.frequency), icon: Banknote, tone: "green" as Tone, personId: entry.person_id }));
    const plannedIncomeLines = (plannedResult.data || [])
      .filter((item) => item.direction === "income" && personOwned(item, activeScope) && plannedItemAppliesToMonth(item, rangeStart, rangeEnd))
      .map((item) => ({ key: `planned-income-${item.id}`, label: item.label || "Planned income", amount: n(item.amount) * plannedItemOccurrencesInRange(item, rangeStart, rangeEnd), icon: ArrowDownRight, tone: "green" as Tone, personId: item.person_id }));
    const incomeLines = [...payLines, ...loggedIncomeLines, ...plannedIncomeLines].filter((line) => line.amount > 0);
    const totalIncome = incomeLines.reduce((sum, line) => sum + line.amount, 0);

    const groupedSpend = new Map<string, FlowLine>();
    const addSpendLine = (line: FlowLine) => {
      const groupKey = line.categoryKey || line.key;
      const existing = groupedSpend.get(groupKey) || { ...line, amount: 0, evidence: [] as FlowEvidence[] };
      existing.amount += line.amount;
      const fallbackEvidence = { key: line.key, label: line.label, amount: line.amount, tone: line.tone, href: line.href };
      existing.evidence = [...(existing.evidence || []), ...(line.evidence?.length ? line.evidence : [fallbackEvidence])];
      groupedSpend.set(groupKey, existing);
    };

    const monthSpendingEntries = (spendingEntriesResult.data || []).filter((row) => personOwned(row, activeScope) && isEntryInMonth(row.spent_at, monthKey));
    const hasLoggedFoodShopping = monthSpendingEntries.some((entry) => classifyCategory(entry.label || entry.notes || "One-off spend", entry.category_id ? categoryById.get(entry.category_id) || null : null).key === "food");

    for (const item of (plannedResult.data || []).filter((row) => row.direction !== "income" && !isLinkedSavingsTransfer(row) && personOwned(row, activeScope) && plannedItemAppliesToMonth(row, rangeStart, rangeEnd))) {
      if (hasLoggedFoodShopping && String(item.notes || "").includes("[household_assumption:food]")) continue;
      const category = classifyCategory(item.label, item.category_id ? categoryById.get(item.category_id) || null : null);
      const occurrenceAmount = n(item.amount) * plannedItemOccurrencesInRange(item, rangeStart, rangeEnd);
      addSpendLine({ key: `planned-${item.id}`, categoryKey: category.key, label: category.label, amount: occurrenceAmount, icon: category.icon, tone: category.tone, personId: item.person_id, href: `/spending?month=${monthKey}&direction=outgoing`, evidence: [{ key: `planned-${item.id}`, label: item.label || category.label, amount: occurrenceAmount, tone: category.tone, href: `/spending?month=${monthKey}&direction=outgoing` }] });
    }

    for (const cost of (childCostsResult.data || []).filter((row) => (!activeScope.length || activeScope.includes(row.child_id || "")) && isActiveInMonth(row.starts_on, row.ends_on, rangeStart, rangeEnd))) {
      const monthlyAmount = getChildCostMonthlyAmount(cost, monthKey);
      addSpendLine({ key: `childcost-${cost.id}`, categoryKey: "childcare", label: "Childcare", icon: Sparkles, tone: "orange", personId: cost.child_id, amount: monthlyAmount, href: cost.child_id ? `/household/${cost.child_id}` : "/household", evidence: [{ key: `childcost-${cost.id}`, label: cost.label || "Childcare", amount: monthlyAmount, tone: "orange", href: cost.child_id ? `/household/${cost.child_id}` : "/household" }] });
    }

    for (const entry of monthSpendingEntries) {
      const category = classifyCategory(entry.label || entry.notes || "One-off spend", entry.category_id ? categoryById.get(entry.category_id) || null : null);
      addSpendLine({ key: `spend-${entry.id}`, categoryKey: category.key, label: category.label, amount: n(entry.amount), icon: category.icon, tone: category.tone, personId: entry.person_id, href: `/spending?month=${monthKey}&direction=outgoing`, evidence: [{ key: `spend-${entry.id}`, label: entry.label || entry.notes || category.label, amount: n(entry.amount), tone: category.tone, href: `/spending?month=${monthKey}&direction=outgoing` }] });
    }

    const savingsAccounts = (accountsResult.data || []).filter((account) => !account.is_liability && personOwned(account, activeScope));
    const investmentAccounts = savingsAccounts.filter((account) => String(account.account_type).toLowerCase().includes("investment"));
    const nonInvestmentSavingsAccounts = savingsAccounts.filter((account) => !String(account.account_type).toLowerCase().includes("investment"));
    const accountTopUps = savingsAccounts.reduce((sum, account) => sum + n(account.monthly_top_up_amount), 0);
    const pensionAccounts = (pensionsResult.data || []).filter((account) => personOwned(account, activeScope));
    const pensionTopUps = pensionAccounts.reduce((sum, account) => sum + n(account.fixed_monthly_contribution), 0);

    const groupedGreenRows = Array.from(groupedSpend.values()).filter((item) => item.tone === "green" || item.label.toLowerCase().includes("saving"));
    const plannedSavingsRows = groupedGreenRows.filter((row) => row.key === "savings");
    const plannedInvestmentRows = groupedGreenRows.filter((row) => row.key === "investments");
    const plannedPensionRows = groupedGreenRows.filter((row) => row.key === "pension");
    const otherGreenRows = groupedGreenRows.filter((row) => !["savings", "investments", "pension"].includes(row.key));
    const explicitSavings = groupedGreenRows.reduce((sum, item) => sum + item.amount, 0);
    const savingsTotal = Math.max(accountTopUps + pensionTopUps + explicitSavings, 0);
    const spendRows = Array.from(groupedSpend.values()).filter((row) => row.tone !== "green" && !row.label.toLowerCase().includes("saving")).sort((a, b) => b.amount - a.amount);
    const committedSpending = spendRows.reduce((sum, row) => sum + row.amount, 0);

    // A second, independent breakdown of spending by the real spending_category_groups (not the
    // ad-hoc text-classifier groups spendRows uses) — purely for the flow diagram, which should
    // reflect the groups the household has actually set up on the "Manage categories and groups"
    // board rather than LOOP's best-guess category labels.
    const spendByRealGroup = new Map<string, number>();
    for (const item of (plannedResult.data || []).filter((row) => row.direction !== "income" && !isLinkedSavingsTransfer(row) && personOwned(row, activeScope) && plannedItemAppliesToMonth(row, rangeStart, rangeEnd))) {
      const groupName = item.category_id ? groupById.get(categoryById.get(item.category_id)?.group_id || "")?.name : null;
      const key = groupName || "__ungrouped";
      spendByRealGroup.set(key, (spendByRealGroup.get(key) || 0) + n(item.amount) * plannedItemOccurrencesInRange(item, rangeStart, rangeEnd));
    }
    for (const cost of (childCostsResult.data || []).filter((row) => (!activeScope.length || activeScope.includes(row.child_id || "")) && isActiveInMonth(row.starts_on, row.ends_on, rangeStart, rangeEnd))) {
      const groupName = cost.category_id ? groupById.get(categoryById.get(cost.category_id)?.group_id || "")?.name : null;
      const key = groupName || "__ungrouped";
      spendByRealGroup.set(key, (spendByRealGroup.get(key) || 0) + getChildCostMonthlyAmount(cost, monthKey));
    }
    for (const entry of monthSpendingEntries) {
      const groupName = entry.category_id ? groupById.get(categoryById.get(entry.category_id)?.group_id || "")?.name : null;
      const key = groupName || "__ungrouped";
      spendByRealGroup.set(key, (spendByRealGroup.get(key) || 0) + n(entry.amount));
    }
    const hasAnyRealGroups = groupById.size > 0;
    const leftoverCash = Math.max(totalIncome - committedSpending - savingsTotal, 0);

    const savingsEvidence: FlowEvidence[] = [
      ...nonInvestmentSavingsAccounts.filter((account) => n(account.monthly_top_up_amount) > 0).map((account) => ({ key: `savings-account-${account.id}`, label: account.name || account.provider || "Savings account", amount: n(account.monthly_top_up_amount), tone: "green" as Tone, href: "/accounts?tab=accounts" })),
      ...plannedSavingsRows.flatMap((row) => row.evidence?.length ? row.evidence : [{ key: row.key, label: row.label, amount: row.amount, tone: row.tone, href: row.href }]),
    ];
    const investmentEvidence: FlowEvidence[] = [
      ...investmentAccounts.filter((account) => n(account.monthly_top_up_amount) > 0).map((account) => ({ key: `investment-account-${account.id}`, label: account.name || account.provider || "Investment account", amount: n(account.monthly_top_up_amount), tone: "green" as Tone, href: "/investments" })),
      ...plannedInvestmentRows.flatMap((row) => row.evidence?.length ? row.evidence : [{ key: row.key, label: row.label, amount: row.amount, tone: row.tone, href: row.href }]),
    ];
    const pensionEvidence: FlowEvidence[] = [
      ...pensionAccounts.filter((account) => n(account.fixed_monthly_contribution) > 0).map((account) => ({ key: `pension-${account.id}`, label: account.label || account.provider || "Pension", amount: n(account.fixed_monthly_contribution), tone: "green" as Tone, href: "/investments" })),
      ...plannedPensionRows.flatMap((row) => row.evidence?.length ? row.evidence : [{ key: row.key, label: row.label, amount: row.amount, tone: row.tone, href: row.href }]),
    ];

    const savingsRows = [
      { key: "savings-topups", label: "Tracked account top-ups", amount: savingsEvidence.reduce((sum, row) => sum + row.amount, 0), icon: PiggyBank, tone: "green" as Tone, href: "/accounts?tab=accounts", evidence: savingsEvidence },
      { key: "investment-topups", label: "Investment top-ups", amount: investmentEvidence.reduce((sum, row) => sum + row.amount, 0), icon: ArrowRightLeft, tone: "green" as Tone, href: "/investments", evidence: investmentEvidence },
      { key: "pension-topups", label: "Pension contributions", amount: pensionEvidence.reduce((sum, row) => sum + row.amount, 0), icon: Target, tone: "green" as Tone, href: "/investments", evidence: pensionEvidence },
      ...otherGreenRows,
    ].filter((row) => row.amount > 0);

    const sharedIncomeLines = incomeLines.filter((line) => !line.personId);
    const sharedIncomeLabel = sharedIncomeLines.length === 1 ? sharedIncomeLines[0].label : "Household / shared";

    const profileIds = [null, ...people.map((person) => person.id)];
    const personTotals = profileIds.map((personId) => {
      const person = personId ? people.find((item) => item.id === personId) : null;
      return {
        personId,
        label: personId ? person?.name || "Household member" : sharedIncomeLabel,
        colour: personId ? personColour(personId, people) : "#64748b",
        income: incomeLines.filter((line) => (line.personId || null) === personId).reduce((sum, line) => sum + line.amount, 0),
        spending: spendRows.filter((line) => (line.personId || null) === personId).reduce((sum, line) => sum + line.amount, 0),
        savings: personId ? savingsAccounts.filter((account) => (account.owner_person_id || account.person_id || null) === personId).reduce((sum, account) => sum + n(account.monthly_top_up_amount), 0) : 0,
      };
    }).filter((row) => row.income > 0 || row.spending > 0 || row.savings > 0);

    const investmentsTotal = savingsRows.filter((row) => row.key === "investment-topups").reduce((sum, row) => sum + row.amount, 0);
    const savingsOnlyTotal = Math.max(0, savingsTotal - investmentsTotal);

    return { key: monthKey, incomeLines, spendRows, savingsRows, totalIncome, committedSpending, savingsTotal, investmentsTotal, savingsOnlyTotal, leftoverCash, personTotals, spendByRealGroup, hasAnyRealGroups };
  }

  const model = buildModel(month.key, true);
  const savingsRate = model.totalIncome > 0 ? (model.savingsTotal / model.totalIncome) * 100 : 0;
  const hasFlowData = model.totalIncome > 0 || model.committedSpending > 0 || model.savingsTotal > 0 || (plannedResult.data || []).length > 0 || (accountsResult.data || []).length > 0 || (potsResult.data || []).length > 0;
  const yearMonths = Array.from({ length: 12 }, (_, index) => `${month.key.slice(0, 4)}-${String(index + 1).padStart(2, "0")}`).map((key) => buildModel(key, false));

  const scopedSavingsAccounts = (accountsResult.data || []).filter((account) => {
    if (account.is_liability || !personOwned(account, scopeIds)) return false;
    const kind = String(account.account_type || "").toLowerCase();
    return !kind.includes("investment") && !kind.includes("pension") && !kind.includes("current_account");
  });
  const scopedAccountIds = new Set(scopedSavingsAccounts.map((account) => account.id));
  const scopedMovements = (movementsResult.data || []).filter((movement) => scopedAccountIds.has(movement.financial_account_id));
  const currentCalendarMonth = new Date().toISOString().slice(0, 7);
  const interestMonth = estimateSavingsInterestForMonth(
    scopedSavingsAccounts,
    scopedMovements,
    month.key,
    month.key === currentCalendarMonth ? new Date() : month.end,
  );
  const totalTrackedSavings = scopedSavingsAccounts.reduce((sum, account) => sum + calculateSavingsAccruedBalance(account as any).estimatedBalance, 0);
  const blendedSavingsRate = totalTrackedSavings > 0
    ? scopedSavingsAccounts.reduce((sum, account) => sum + calculateSavingsAccruedBalance(account as any).estimatedBalance * n(account.interest_rate), 0) / totalTrackedSavings
    : 0;
  const savingsTrend = buildSavingsTrajectory(scopedSavingsAccounts as any, scopedMovements as any, 24).map((point) => ({ label: point.date.slice(0, 7), balance: point.balance, kind: point.kind === "actual" ? "recorded" as const : "projected" as const }));
  const savingsHealth = buildSavingsIntelligence({
    accounts: scopedSavingsAccounts as any,
    deals: (dealsResult.data || []) as any,
    relationships: [],
    plannedItems: plannedResult.data || [],
    payEvents: payResult.data || [],
    subjectPersonId: scopeIds[0] || null,
    adultPersonIds: people.filter((person) => String(person.relationship || "").toLowerCase() !== "child").map((person) => person.id),
  });

  const flowAccountRows: SavingsFlowAccountRow[] = scopedSavingsAccounts.map((account) => {
    const balance = calculateSavingsAccruedBalance(account as any).estimatedBalance;
    const deposited = scopedMovements.reduce((sum, movement) => {
      if (movement.financial_account_id !== account.id || String(movement.effective_at || movement.created_at || "").slice(0, 7) !== month.key || movementDirection(movement as any) !== "in" || movement.movement_type === "opening_balance") return sum;
      return sum + Math.max(0, movementDelta(movement as any));
    }, 0);
    const compatibleDeals = (dealsResult.data || [])
      .filter((deal) => !deal.requires_existing_customer)
      .filter((deal) => savingsDealMatchesAccount(account as any, deal as any));
    const compatibleRates = compatibleDeals.map((deal) => n(deal.gross_aer));
    const bestRate = Math.max(n(account.interest_rate), ...compatibleRates, 0);
    const bestDeal = compatibleDeals.sort((a, b) => n(b.gross_aer) - n(a.gross_aer))[0] || null;
    const eligibleBalance = bestDeal ? savingsDealEligibleBalance(account as any, bestDeal as any) : 0;
    const score = bestRate > 0 ? Math.round(Math.min(100, n(account.interest_rate) / bestRate * 100)) : 100;
    return {
      id: account.id,
      name: account.name || "Savings account",
      provider: account.provider || account.provider_slug || "Provider",
      providerSlug: account.provider_slug,
      balance,
      savedThisMonth: deposited > 0 ? deposited : n(account.monthly_top_up_amount),
      interestRate: n(account.interest_rate),
      maximisedScore: score,
      annualOpportunity: Math.max(0, eligibleBalance * (bestRate - n(account.interest_rate)) / 100),
      endDate: account.interest_rate_end_date || account.end_date || null,
    };
  }).sort((a, b) => b.savedThisMonth - a.savedThisMonth || b.balance - a.balance);

  const potAllocationsById = new Map<string, SavingsPotAllocation[]>();
  for (const allocation of potAllocationsResult.data || []) {
    const rows = potAllocationsById.get(allocation.savings_pot_id) || [];
    rows.push(allocation);
    potAllocationsById.set(allocation.savings_pot_id, rows);
  }
  const flowPotRows: SavingsFlowPotRow[] = (potsResult.data || [])
    .filter((pot) => !scopeIds.length || !pot.person_id || scopeIds.includes(pot.person_id))
    .map((pot) => {
      const allocations = potAllocationsById.get(pot.id) || [];
      const allocated = allocations.length
        ? allocations.reduce((sum, allocation) => {
            const account = scopedSavingsAccounts.find((row) => row.id === allocation.financial_account_id);
            if (account && n(allocation.allocation_percent) > 0) return sum + calculateSavingsAccruedBalance(account as any).estimatedBalance * Math.min(100, n(allocation.allocation_percent)) / 100;
            return sum + Math.max(0, n(allocation.amount));
          }, 0)
        : Math.max(0, n(pot.current_allocated_amount));
      const target = Math.max(0, n(pot.target_amount));
      const progress = target > 0 ? Math.min(100, allocated / target * 100) : 0;
      const thisMonthAmount = allocations.reduce((sum, allocation) => {
        if (!allocation.financial_account_id) return sum;
        const deposited = scopedMovements.reduce((movementSum, movement) => {
          if (movement.financial_account_id !== allocation.financial_account_id || String(movement.effective_at || movement.created_at || "").slice(0, 7) !== month.key || movementDirection(movement as any) !== "in" || movement.movement_type === "opening_balance") return movementSum;
          return movementSum + Math.max(0, movementDelta(movement as any));
        }, 0);
        if (n(allocation.allocation_percent) > 0) return sum + deposited * Math.min(100, n(allocation.allocation_percent)) / 100;
        return sum + Math.min(deposited, Math.max(0, n(allocation.amount)));
      }, 0);
      const remaining = Math.max(0, target - allocated);
      const targetDate = pot.target_date ? new Date(`${pot.target_date}T12:00:00`) : null;
      const monthsRemaining = targetDate && Number.isFinite(targetDate.getTime()) ? Math.max(1, monthsBetweenDates(month.start, targetDate) + 1) : null;
      const needed = remaining <= 0 ? 0 : monthsRemaining ? remaining / monthsRemaining : n(pot.monthly_target);
      const pace = n(pot.monthly_target) || thisMonthAmount;
      const score = remaining <= 0 ? 100 : needed > 0 ? Math.round(Math.min(100, pace / needed * 100) * 0.8 + progress * 0.2) : Math.round(progress);
      return { id: pot.id, name: pot.name, allocated, target, progress, thisMonthAmount, thisMonthProgress: target > 0 ? thisMonthAmount / target * 100 : 0, score: Math.max(0, Math.min(100, score)) };
    });
  const earmarkedToPots = Math.min(totalTrackedSavings, flowPotRows.reduce((sum, pot) => sum + pot.allocated, 0));
  const savingsYearMonths = yearMonths.map((row) => {
    const monthMovements = scopedMovements.filter((movement) => String(movement.effective_at || movement.created_at || "").slice(0, 7) === row.key);
    const savedIn = monthMovements.reduce((sum, movement) => {
      if (movement.movement_type === "opening_balance" || movementDirection(movement as any) !== "in") return sum;
      return sum + Math.max(0, movementDelta(movement as any));
    }, 0);
    const withdrawn = monthMovements.reduce((sum, movement) => {
      if (movementDirection(movement as any) !== "out") return sum;
      return sum + Math.abs(Math.min(0, movementDelta(movement as any)));
    }, 0);
    const [yearValue, monthValue] = row.key.split("-").map(Number);
    const monthEnd = new Date(Date.UTC(yearValue, monthValue, 0, 23, 59, 59));
    const interest = estimateSavingsInterestForMonth(
      scopedSavingsAccounts,
      scopedMovements,
      row.key,
      row.key === currentCalendarMonth ? new Date() : monthEnd,
    );
    const closingBalance = scopedSavingsAccounts.reduce((sum, account) => {
      const latest = scopedMovements
        .filter((movement) => movement.financial_account_id === account.id && String(movement.effective_at || movement.created_at || "").slice(0, 10) <= monthEnd.toISOString().slice(0, 10) && movement.resulting_balance != null)
        .sort((a, b) => String(b.effective_at || b.created_at || "").localeCompare(String(a.effective_at || a.created_at || "")))[0];
      if (latest?.resulting_balance != null) return sum + n(latest.resulting_balance);
      return sum + calculateSavingsAccruedBalance(account as any).estimatedBalance;
    }, 0);
    return {
      key: row.key,
      savedIn,
      withdrawn,
      interestConfirmed: interest.providerConfirmed + interest.accruedThroughYesterday,
      interestEstimated: interest.estimated,
      closingBalance,
    };
  });
  const scopeSavingsRate = model.totalIncome > 0 ? model.savingsTotal / model.totalIncome * 100 : 0;

  return (
    <>
      <Nav />
      <main className="mx-auto w-[95vw] max-w-none space-y-6 px-4 py-6 md:px-8">
        {activeTab === "flow" ? <section className="relative overflow-hidden rounded-[2.5rem] border border-white/70 bg-slate-950 p-7 text-white shadow-[0_36px_120px_-70px_rgba(15,23,42,.95)] md:p-9">
          <div className="absolute -right-28 -top-28 h-96 w-96 rounded-full bg-emerald-500/30 blur-3xl" />
          <div className="absolute -bottom-36 left-1/4 h-96 w-96 rounded-full bg-orange-500/20 blur-3xl" />
          <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.24em] text-emerald-200">Your financial flow</p>
              <h1 className="mt-3 text-4xl font-black tracking-tight md:text-5xl">See how your money flows</h1>
              <p className="mt-3 max-w-3xl text-sm font-medium leading-6 text-slate-300">Start with the flow, then jump into income, spending or savings to add, edit or remove the lines that feed it.</p>
            </div>
            <MonthControls activeTab={activeTab} month={month.key} scopeIds={scopeIds} />
          </div>
        </section> : (
          <section className="flex flex-wrap items-center justify-between gap-4 rounded-[2rem] border border-white/70 bg-white/90 p-4 shadow-sm">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.22em] text-slate-400">Financial Flow</p>
              <h1 className="text-2xl font-black text-slate-950 capitalize">{activeTab} detail</h1>
            </div>
            <MonthControls activeTab={activeTab} month={month.key} scopeIds={scopeIds} />
          </section>
        )}

        {!hasFlowData ? <PageLandingExperience kind="financial-flow" /> : null}

        <nav className="grid overflow-hidden rounded-full border border-slate-200 bg-white/90 p-1 shadow-sm backdrop-blur md:grid-cols-4" aria-label="Financial Flow sections">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.key;
            return <Link key={tab.key} href={queryHref(tab.key, month.key, scopeIds)} className={`flex items-center justify-center gap-3 rounded-full px-5 py-4 text-sm font-black transition ${active ? "bg-white text-slate-950 shadow-md ring-1 ring-slate-100" : "text-slate-500 hover:bg-slate-50 hover:text-slate-950"}`}><Icon className="h-5 w-5" /> {tab.label}{active ? <span className="ml-2 h-1.5 w-12 rounded-full bg-gradient-to-r from-cyan-400 via-emerald-400 to-orange-400" /> : null}</Link>;
          })}
        </nav>

        <ScopeSelector people={people} activeTab={activeTab} month={month.key} scopeIds={scopeIds} />

        {activeTab === "savings" ? (
          <SavingsFlowDetail
            monthKey={month.key}
            scopeSavingsPercent={scopeSavingsRate}
            scopeSavingsLabel={savingsScopeLabel}
            blendedRate={blendedSavingsRate}
            providerConfirmedInterest={interestMonth.providerConfirmed}
            accruedThroughYesterday={interestMonth.accruedThroughYesterday}
            estimatedInterest={interestMonth.estimated}
            unassignedEquity={model.leftoverCash}
            totalSavings={totalTrackedSavings}
            earmarkedToPots={earmarkedToPots}
            accounts={flowAccountRows}
            pots={flowPotRows}
            trend={savingsTrend}
            yearMonths={savingsYearMonths}
            healthScore={savingsHealth.score}
            marketStatus={savingsHealth.catalogue.status}
            annualOpportunity={flowAccountRows.reduce((sum, account) => sum + account.annualOpportunity, 0)}
          />
        ) : (
          <>
            <section className={`grid gap-4 md:grid-cols-4 ${activeTab === "spending" ? "xl:grid-cols-5" : ""}`}>
              <article className="rounded-[2rem] border border-white/70 bg-white/90 p-5 shadow-sm"><p className="text-sm font-bold text-slate-500">Total monthly inflow</p><div className="mt-2 flex items-center justify-between"><p className="text-3xl font-black text-slate-950">{formatMoney(model.totalIncome)}</p><span className="grid h-11 w-11 place-items-center rounded-2xl bg-emerald-50 text-emerald-700"><ArrowDownRight className="h-5 w-5" /></span></div><p className="mt-1 text-sm font-medium text-slate-500">After-tax income · {scopeLabel}</p></article>
              <article className="rounded-[2rem] border border-white/70 bg-white/90 p-5 shadow-sm"><p className="text-sm font-bold text-slate-500">Committed spending</p><div className="mt-2 flex items-center justify-between"><p className="text-3xl font-black text-slate-950">{formatMoney(model.committedSpending)}</p><span className="grid h-11 w-11 place-items-center rounded-2xl bg-orange-50 text-orange-700"><CreditCard className="h-5 w-5" /></span></div><p className="mt-1 text-sm font-medium text-slate-500">{percent(model.committedSpending, model.totalIncome)} of income</p></article>
              <article className="rounded-[2rem] border border-white/70 bg-white/90 p-5 shadow-sm"><p className="text-sm font-bold text-slate-500">Savings rate</p><div className="mt-2 flex items-center justify-between"><p className="text-3xl font-black text-slate-950">{Math.round(savingsRate)}%</p><span className="grid h-11 w-11 place-items-center rounded-2xl bg-emerald-50 text-emerald-700"><Target className="h-5 w-5" /></span></div><p className={`mt-1 text-sm font-black ${savingsRate >= 20 ? "text-emerald-700" : "text-amber-700"}`}>{savingsRate >= 20 ? "Above 20% target" : "Below 20% target"}</p></article>
              <article className="rounded-[2rem] border border-white/70 bg-white/90 p-5 shadow-sm"><p className="text-sm font-bold text-slate-500">Leftover cash</p><div className="mt-2 flex items-center justify-between"><p className="text-3xl font-black text-slate-950">{formatMoney(model.leftoverCash)}</p><span className="grid h-11 w-11 place-items-center rounded-2xl bg-sky-50 text-sky-700"><WalletCards className="h-5 w-5" /></span></div><p className="mt-1 text-sm font-medium text-slate-500">{percent(model.leftoverCash, model.totalIncome)} of income</p></article>
              {activeTab === "spending" ? (
                <Link href={`/spending?month=${month.key}`} className="flex flex-col items-center justify-center gap-2 rounded-[2rem] border border-dashed border-slate-300 bg-white/60 p-5 text-center shadow-sm transition hover:border-slate-950 hover:bg-white">
                  <span className="grid h-11 w-11 place-items-center rounded-2xl bg-slate-950 text-white"><PlusCircle className="h-5 w-5" /></span>
                  <p className="text-sm font-black text-slate-950">Add more spending context</p>
                </Link>
              ) : null}
            </section>

            {activeTab === "flow" ? <MainFlowDiagram model={model} people={people} /> : <DetailPanel activeTab={activeTab} month={month.key} incomeLines={model.incomeLines} spendRows={model.spendRows} savingsRows={model.savingsRows.length ? model.savingsRows : [{ key: "savings-plan", label: "Savings plan", amount: 0, icon: PiggyBank, tone: "green" }]} />}

            <MoneyFlowCalendar months={yearMonths} selectedMonth={month.key} activeTab={activeTab} scopeIds={scopeIds} />
          </>
        )}
      </main>
    </>
  );
}
