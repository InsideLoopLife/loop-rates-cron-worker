import { Nav } from "@/components/Nav";
import { Suspense } from "react";
import { PageLandingExperience } from "@/components/landing/PageLandingExperience";
import {
  dedupeHouseholdPeople,
  householdMemberDataOrFilter,
  householdPeopleOrFilter,
} from "@/lib/auth/household-context";
import { requireWealthPageAccess } from "@/domains/wealth/access";
import { createWorkerDatabaseClient } from "@/platform/database/worker-client";
import {
  MortgagePlannerClient,
  type Home,
  type HomeMortgageDeal,
  type HomeOwner,
  type HomeValuationSource,
  type MortgageScenario,
  type Person,
  type MortgageRenewalRecommendation,
  type MortgageMarketDeal,
  type PropertyMoveQuery,
  type HomeMortgageLiabilityAllocation,
  type MortgageDealPreference,
  type MortgageWorkspacePreference,
} from "@/components/mortgage/MortgagePlannerClient";
import {
  buildMonthPlan,
  currentMonth,
  type ChildCostForPlan,
  type FinancialProfile,
  type HomeMortgageDealForPlan,
  type IncomeEntryForPlan,
  type PayEventForPlan,
  type PersonForPlan,
  type PlannedItemForPlan,
  type SpendingCategoryForPlan,
} from "@/lib/planning/month-plan";
import { WealthRouteSkeleton } from "@/components/loading/WealthRouteSkeleton";

async function MortgageContent() {
  const { supabase, user, householdContext } = await requireWealthPageAccess({
    feature: "mortgage",
    deniedRedirect: "/account?tab=wealth&feature=mortgage",
  });
  const dataOwnerUserId = householdContext.dataOwnerUserId || user.id;
  // mortgage_rate_deals now lives in the separate rates-catalogue
  // Supabase project.
  const ratesSupabase = createWorkerDatabaseClient("rates");
  const householdVisibleFilter = householdMemberDataOrFilter(householdContext);
  const householdPeopleFilter = householdPeopleOrFilter(householdContext);

  const memberUserIds = householdContext.memberUserIds?.length
    ? householdContext.memberUserIds
    : [dataOwnerUserId];

  const [
    { data: scenarios },
    { data: rawPeople },
    { data: homes },
    { data: owners },
    { data: deals },
    { data: valuations },
    { data: profile },
    { data: categories },
    { data: childCosts },
    { data: payEvents },
    { data: plannedItems },
    { data: incomeEntries },
    { data: savingsAccounts },
    { data: renewalRecommendations },
    { data: marketDeals },
    { data: moveQueries },
  ] = await Promise.all([
    supabase
      .from("mortgage_scenarios")
      .select(
        "id, name, balance, interest_rate, term_years, monthly_overpayment",
      )
      .eq("user_id", dataOwnerUserId)
      .order("created_at", { ascending: false })
      .returns<MortgageScenario[]>(),
    supabase
      .from("people")
      .select(
        "id, user_id, name, relationship, birth_date, linked_user_id, email, avatar_url, account_status, active_until",
      )
      .or(householdPeopleFilter)
      .or("account_status.is.null,account_status.neq.duplicate_merged")
      .is("active_until", null)
      .order("relationship")
      .order("name")
      .returns<
        (Person & {
          user_id?: string | null;
          linked_user_id?: string | null;
          email?: string | null;
          avatar_url?: string | null;
        })[]
      >(),
    supabase
      .from("homes")
      .select(
        "id, label, house_number, address_line, postcode, full_address, city, region, country, latitude, longitude, map_url, lookup_source, uprn, property_type, purchase_source_url, last_lookup_at, ownership_status, property_value, estimated_value_low, estimated_value_mid, estimated_value_high, estimated_value_date, purchase_price, purchase_date, target_purchase_price, target_extra_cash, target_interest_rate, target_term_years, notes",
      )
      .or(householdVisibleFilter)
      .order("created_at", { ascending: false })
      .returns<Home[]>(),
    supabase
      .from("home_owners")
      .select("id, home_id, person_id, ownership_percent")
      .or(householdVisibleFilter)
      .returns<HomeOwner[]>(),
    supabase
      .from("home_mortgage_deals")
      .select(
        "id, home_id, lender, product_name, balance, balance_as_of_date, interest_rate, rate_type, repayment_type, initial_period_end, term_years, monthly_payment_override, start_date, end_date, notes",
      )
      .or(householdVisibleFilter)
      .order("created_at", { ascending: false })
      .returns<HomeMortgageDeal[]>(),
    supabase
      .from("home_valuation_sources")
      .select(
        "id, home_id, source_name, source_type, valuation_low, valuation_mid, valuation_high, valuation_amount, confidence, valuation_date, source_url, notes",
      )
      .or(householdVisibleFilter)
      .order("valuation_date", { ascending: false })
      .returns<HomeValuationSource[]>(),
    supabase
      .from("financial_profiles")
      .select(
        "name, annual_salary, monthly_take_home, monthly_dividends, pension_percent, student_loan_plan, monthly_mortgage, monthly_savings_target",
      )
      .eq("user_id", dataOwnerUserId)
      .maybeSingle(),
    supabase
      .from("spending_categories")
      .select("id, name, type, monthly_budget")
      .or(householdVisibleFilter)
      .returns<SpendingCategoryForPlan[]>(),
    supabase
      .from("child_costs")
      .select(
        "id, child_id, label, cost_kind, monthly_cost, billing_month, daily_rate, extra_daily_cost, funded_hours_per_week, funding_mode, hourly_funding_credit, term_weeks_per_year, billing_schedule, bank_holidays_are_free, tax_free_childcare_enabled, tax_free_childcare_cap_per_quarter, part_day_multiplier, full_day_hours, part_day_hours, monday_session, tuesday_session, wednesday_session, thursday_session, friday_session, monday_hours, tuesday_hours, wednesday_hours, thursday_hours, friday_hours, activity_weekly_cost, activity_weekday, activity_billing_mode, activity_term_weeks_per_year, starts_on, ends_on",
      )
      .or(householdVisibleFilter)
      .returns<ChildCostForPlan[]>(),
    supabase
      .from("pay_events")
      .select(
        "id, person_id, label, pay_kind, gross_annual_salary, monthly_take_home_override, pension_percent, pension_method, student_loan_plan, effective_from, effective_until, maternity_scheme, maternity_leave_start, maternity_leave_end, maternity_pay_mode, maternity_full_pay_weeks, maternity_half_pay_weeks, maternity_smp_only_weeks, maternity_unpaid_weeks, maternity_smp_weekly_rate",
      )
      .or(householdVisibleFilter)
      .returns<PayEventForPlan[]>(),
    supabase
      .from("planned_items")
      .select(
        "id, person_id, direction, item_type, label, amount, recurrence, recurrence_interval_days, start_date, end_date, day_of_month",
      )
      .or(householdVisibleFilter)
      .returns<PlannedItemForPlan[]>(),
    supabase
      .from("income_entries")
      .select(
        "id, person_id, label, gross_amount, net_amount, frequency, entry_date",
      )
      .or(householdVisibleFilter)
      .returns<IncomeEntryForPlan[]>(),
    supabase
      .from("financial_accounts")
      .select("current_balance, account_type, is_liability")
      .or(householdVisibleFilter)
      .eq("is_liability", false),
    ratesSupabase
      .from("mortgage_renewal_recommendations")
      .select(
        "id, home_id, mortgage_deal_id, mortgage_rate_deal_id, recommendation_kind, lender_name, product_name, current_lender, current_rate, suggested_rate, rate_delta, estimated_current_payment, estimated_new_payment, estimated_monthly_saving, product_fee, ltv, months_until_end, source_url, reason, status, created_at, payload",
      )
      .eq("user_id", dataOwnerUserId)
      .in("status", ["new", "seen", "watching", "saved"])
      .order("estimated_monthly_saving", {
        ascending: false,
        nullsFirst: false,
      })
      .limit(12)
      .returns<MortgageRenewalRecommendation[]>(),
    ratesSupabase
      .from("mortgage_rate_deals")
      .select(
        "id, lender_name, product_name, rate_percent, initial_term_months, product_fee, ltv_max, source_url, status, catalogue_status, existing_customer_only",
      )
      .eq("status", "active")
      .eq("catalogue_status", "active")
      .order("rate_percent", { ascending: true, nullsFirst: false })
      .limit(12)
      .returns<MortgageMarketDeal[]>(),
    supabase
      .from("property_move_queries")
      .select(
        "id, home_id, title, property_url, asking_price, postcode, address_hint, bedrooms, council_tax_band, council_tax_estimate_annual, council_tax_confidence, council_tax_authority, council_tax_source_url, epc_rating, epc_energy_cost_estimate_annual, expected_heating_cost_monthly, stamp_duty_estimate, moving_cost_estimate, target_deposit, expected_mortgage_balance, expected_rate, expected_term_years, expected_payment, affordability_score, status, source_status, source_confidence, image_url, property_use, map_latitude, map_longitude, map_embed_url, service_charge_monthly, maintenance_allowance_monthly, running_cost_breakdown, archived_at, delete_after, notes, payload, created_at, updated_at",
      )
      .eq("user_id", dataOwnerUserId)
      .in("status", ["watching", "saved"])
      .order("created_at", { ascending: false })
      .limit(10)
      .returns<PropertyMoveQuery[]>(),
  ]);

  const [
    { data: liabilityAllocations },
    { data: dealPreferences },
    { data: workspacePreference },
  ] = await Promise.all([
    supabase
      .from("mortgage_liability_allocation_effective")
      .select("id, home_mortgage_deal_id, person_id, liability_percent, source")
      .or(householdVisibleFilter)
      .returns<HomeMortgageLiabilityAllocation[]>(),
    ratesSupabase
      .from("mortgage_deal_preferences")
      .select("id, home_id, source_kind, source_id, is_shortlisted, is_starred")
      .eq("user_id", user.id)
      .returns<MortgageDealPreference[]>(),
    supabase
      .from("mortgage_workspace_preferences")
      .select("moving_home_label, moving_home_description")
      .eq("user_id", user.id)
      .maybeSingle<MortgageWorkspacePreference>(),
  ]);

  const allPeopleRows = (rawPeople ?? []) as (Person & {
    user_id?: string | null;
    linked_user_id?: string | null;
    email?: string | null;
  })[];
  const canonicalByKey = new Map<
    string,
    Person & {
      user_id?: string | null;
      linked_user_id?: string | null;
      email?: string | null;
    }
  >();
  const rawToCanonicalId = new Map<string, string>();
  const identityKey = (
    person: Person & { linked_user_id?: string | null; email?: string | null },
  ) =>
    person.linked_user_id
      ? `linked:${person.linked_user_id}`
      : person.email
        ? `email:${String(person.email).toLowerCase()}`
        : `id:${person.id}`;
  const rankPerson = (
    person: Person & {
      user_id?: string | null;
      linked_user_id?: string | null;
    },
  ) => {
    if (person.user_id === dataOwnerUserId && person.linked_user_id) return 0;
    if (person.user_id === dataOwnerUserId) return 1;
    if (person.relationship === "self") return 2;
    return 3;
  };
  for (const person of allPeopleRows) {
    const key = identityKey(person);
    const existing = canonicalByKey.get(key);
    if (!existing || rankPerson(person) < rankPerson(existing))
      canonicalByKey.set(key, person);
  }
  for (const person of allPeopleRows) {
    const canonical = canonicalByKey.get(identityKey(person)) ?? person;
    rawToCanonicalId.set(person.id, canonical.id);
  }
  const peopleRows = dedupeHouseholdPeople(
    Array.from(canonicalByKey.values()) as any[],
    dataOwnerUserId,
  ) as Person[];
  const childProfileCount = peopleRows.filter(
    (person) => person.relationship === "child",
  ).length;
  const peopleForPlan = allPeopleRows.map((person) => {
    const canonical = canonicalByKey.get(identityKey(person)) ?? person;
    return {
      ...person,
      name: canonical.name,
      relationship: canonical.relationship,
    } as PersonForPlan;
  });
  const peopleById = new Map(
    peopleForPlan.map((person) => [person.id, person]),
  );
  const normalisedOwners = ((owners ?? []) as HomeOwner[]).map((owner) => ({
    ...owner,
    person_id: rawToCanonicalId.get(owner.person_id) ?? owner.person_id,
  }));
  const monthPlan = buildMonthPlan({
    month: currentMonth(),
    profile: (profile as FinancialProfile | null) ?? null,
    categories: (categories ?? []) as SpendingCategoryForPlan[],
    childCosts: (childCosts ?? []) as ChildCostForPlan[],
    payEvents: (payEvents ?? []) as PayEventForPlan[],
    mortgageDeals: ((deals ?? []) as HomeMortgageDeal[]).map((deal) => ({
      id: deal.id,
      lender: deal.lender,
      balance: deal.balance,
      interest_rate: deal.interest_rate,
      term_years: deal.term_years,
      monthly_payment_override: deal.monthly_payment_override,
      start_date: deal.start_date,
      end_date: deal.end_date,
    })) as HomeMortgageDealForPlan[],
    plannedItems: (plannedItems ?? []) as PlannedItemForPlan[],
    incomeEntries: (incomeEntries ?? []) as IncomeEntryForPlan[],
    peopleById,
  });

  const normalSalaryPayEvents = ((payEvents ?? []) as PayEventForPlan[]).map(
    (event) => ({
      ...event,
      pay_kind: String(event.pay_kind || "salary")
        .toLowerCase()
        .includes("maternity")
        ? "salary"
        : event.pay_kind,
      maternity_scheme: null,
      maternity_leave_start: null,
      maternity_leave_end: null,
      maternity_pay_mode: null,
      maternity_full_pay_weeks: null,
      maternity_half_pay_weeks: null,
      maternity_smp_only_weeks: null,
      maternity_unpaid_weeks: null,
      maternity_smp_weekly_rate: null,
    }),
  );
  const normalMonthPlan = buildMonthPlan({
    month: currentMonth(),
    profile: (profile as FinancialProfile | null) ?? null,
    categories: (categories ?? []) as SpendingCategoryForPlan[],
    childCosts: (childCosts ?? []) as ChildCostForPlan[],
    payEvents: normalSalaryPayEvents,
    mortgageDeals: ((deals ?? []) as HomeMortgageDeal[]).map((deal) => ({
      id: deal.id,
      lender: deal.lender,
      balance: deal.balance,
      interest_rate: deal.interest_rate,
      term_years: deal.term_years,
      monthly_payment_override: deal.monthly_payment_override,
      start_date: deal.start_date,
      end_date: deal.end_date,
    })) as HomeMortgageDealForPlan[],
    plannedItems: (plannedItems ?? []) as PlannedItemForPlan[],
    incomeEntries: (incomeEntries ?? []) as IncomeEntryForPlan[],
    peopleById,
  });

  return (
    <>
      {(homes ?? []).length +
        (deals ?? []).length +
        (moveQueries ?? []).length ===
      0 ? (
        <main className="mx-auto w-[95vw] max-w-[2000px] px-4 py-6 sm:px-6 lg:px-8">
          <PageLandingExperience kind="mortgage" />
        </main>
      ) : null}
      <MortgagePlannerClient
        scenarios={scenarios ?? []}
        people={peopleRows}
        homes={homes ?? []}
        owners={normalisedOwners}
        deals={deals ?? []}
        valuations={valuations ?? []}
        monthPlan={monthPlan}
        normalMonthPlan={normalMonthPlan}
        emergencySavings={(savingsAccounts ?? []).reduce(
          (sum: number, account: any) =>
            sum + Number(account.current_balance || 0),
          0,
        )}
        childProfileCount={childProfileCount}
        renewalRecommendations={renewalRecommendations ?? []}
        marketDeals={marketDeals ?? []}
        moveQueries={moveQueries ?? []}
        liabilityAllocations={liabilityAllocations ?? []}
        dealPreferences={dealPreferences ?? []}
        workspacePreference={workspacePreference ?? null}
      />
    </>
  );
}

export default function MortgagePage() {
  return (
    <>
      <Nav />
      <Suspense fallback={<WealthRouteSkeleton label="your home and mortgage" />}>
        <MortgageContent />
      </Suspense>
    </>
  );
}
