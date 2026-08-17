"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseAdminKey } from "@/lib/supabase/admin";
import { createWorkerDatabaseClient } from "@/platform/database/worker-client";
import { parseNumber } from "@/lib/format/money";
import { calculateMonthlyMortgagePayment } from "@/lib/calculations/mortgage";
import { calculateStampDutyEngland } from "@/lib/calculations/property";
import {
  applyMutableRecordFilter,
  getActiveHouseholdContext,
  householdWriteFields,
} from "@/lib/auth/household-context";
import {
  buildMoveAssumptions,
  estimateCouncilTaxAnnual,
  fetchSourceText,
  parseMoveListingFromSource,
} from "@/lib/wealth/source-ingestion";

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");
  const householdContext = await getActiveHouseholdContext(supabase, user);
  return { supabase, user, householdContext, dataOwnerUserId: user.id };
}

function ownerRowsFromForm(
  formData: FormData,
  userId: string,
  homeId: string,
  householdContext?: any,
) {
  const ownerIds = formData.getAll("owner_ids").map(String).filter(Boolean);
  if (ownerIds.length === 0) return [];
  const explicit = ownerIds.map((personId) => ({
    personId,
    percent: parseNumber(formData.get(`owner_percent_${personId}`)),
  }));
  const explicitTotal = explicit.reduce(
    (sum, row) => sum + Number(row.percent || 0),
    0,
  );
  const missing = explicit.filter(
    (row) => row.percent === null || row.percent === undefined,
  ).length;
  const autoPercent =
    missing > 0 ? Math.max(0, 100 - explicitTotal) / missing : null;
  return explicit.map((row) => ({
    ...(householdContext
      ? householdWriteFields(householdContext, userId)
      : { user_id: userId }),
    home_id: homeId,
    person_id: row.personId,
    ownership_percent:
      row.percent === null || row.percent === undefined
        ? autoPercent
        : row.percent,
  }));
}

function liabilityRowsFromForm(
  formData: FormData,
  userId: string,
  dealId: string,
  householdContext: any,
) {
  const personIds = formData
    .getAll("liability_person_ids")
    .map(String)
    .filter(Boolean);
  if (personIds.length === 0) return [];
  const explicit = personIds.map((personId) => ({
    personId,
    percent: parseNumber(formData.get(`liability_percent_${personId}`)),
  }));
  const explicitTotal = explicit.reduce(
    (sum, row) => sum + Number(row.percent || 0),
    0,
  );
  const missing = explicit.filter(
    (row) => row.percent === null || row.percent === undefined,
  ).length;
  const autoPercent =
    missing > 0 ? Math.max(0, 100 - explicitTotal) / missing : null;
  return explicit.map((row) => ({
    ...householdWriteFields(householdContext, userId),
    home_mortgage_deal_id: dealId,
    person_id: row.personId,
    liability_percent:
      row.percent === null || row.percent === undefined
        ? autoPercent
        : row.percent,
  }));
}

export async function addHome(formData: FormData) {
  const { supabase, user, householdContext, dataOwnerUserId } =
    await requireUser();

  const { data: home, error } = await supabase
    .from("homes")
    .insert({
      ...householdWriteFields(householdContext, user.id),
      label: String(formData.get("label") || "Home"),
      address_line: String(formData.get("address_line") || "") || null,
      postcode: String(formData.get("postcode") || "") || null,
      house_number: String(formData.get("house_number") || "") || null,
      uprn: String(formData.get("uprn") || "") || null,
      property_type: String(formData.get("property_type") || "") || null,
      lookup_source: String(formData.get("lookup_source") || "") || null,
      purchase_source_url:
        String(formData.get("purchase_source_url") || "") || null,
      full_address: String(formData.get("full_address") || "") || null,
      city: String(formData.get("city") || "") || null,
      region: String(formData.get("region") || "") || null,
      country:
        String(formData.get("country") || "United Kingdom") || "United Kingdom",
      latitude: parseNumber(formData.get("latitude")),
      longitude: parseNumber(formData.get("longitude")),
      map_url: String(formData.get("map_url") || "") || null,
      ownership_status: String(
        formData.get("ownership_status") || "current_home",
      ),
      property_value: parseNumber(formData.get("property_value")) ?? 0,
      estimated_value_low: parseNumber(formData.get("estimated_value_low")),
      estimated_value_mid: parseNumber(formData.get("estimated_value_mid")),
      estimated_value_high: parseNumber(formData.get("estimated_value_high")),
      estimated_value_date:
        String(formData.get("estimated_value_date") || "") || null,
      purchase_price: parseNumber(formData.get("purchase_price")),
      purchase_date: String(formData.get("purchase_date") || "") || null,
      last_lookup_at: String(formData.get("last_lookup_at") || "") || null,
      target_purchase_price: parseNumber(formData.get("target_purchase_price")),
      target_extra_cash: parseNumber(formData.get("target_extra_cash")),
      target_interest_rate: parseNumber(formData.get("target_interest_rate")),
      target_term_years: parseNumber(formData.get("target_term_years")),
      notes: String(formData.get("notes") || ""),
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);

  if (home?.id) {
    const rows = ownerRowsFromForm(
      formData,
      user.id,
      home.id,
      householdContext,
    );
    if (rows.length > 0) {
      const { error: ownerError } = await supabase
        .from("home_owners")
        .insert(rows);
      if (ownerError) throw new Error(ownerError.message);
    }
  }

  revalidatePath("/mortgage");
  revalidatePath("/affordability");
  revalidatePath("/dashboard");
}

export async function updateHome(formData: FormData) {
  const { supabase, user, householdContext, dataOwnerUserId } =
    await requireUser();
  const id = String(formData.get("id") || "");
  if (!id) throw new Error("Missing home id");

  const { error } = await applyMutableRecordFilter(
    supabase.from("homes").update({
      label: String(formData.get("label") || "Home"),
      address_line: String(formData.get("address_line") || "") || null,
      postcode: String(formData.get("postcode") || "") || null,
      house_number: String(formData.get("house_number") || "") || null,
      uprn: String(formData.get("uprn") || "") || null,
      property_type: String(formData.get("property_type") || "") || null,
      lookup_source: String(formData.get("lookup_source") || "") || null,
      purchase_source_url:
        String(formData.get("purchase_source_url") || "") || null,
      full_address: String(formData.get("full_address") || "") || null,
      city: String(formData.get("city") || "") || null,
      region: String(formData.get("region") || "") || null,
      country:
        String(formData.get("country") || "United Kingdom") || "United Kingdom",
      latitude: parseNumber(formData.get("latitude")),
      longitude: parseNumber(formData.get("longitude")),
      map_url: String(formData.get("map_url") || "") || null,
      ownership_status: String(
        formData.get("ownership_status") || "current_home",
      ),
      property_value: parseNumber(formData.get("property_value")) ?? 0,
      estimated_value_low: parseNumber(formData.get("estimated_value_low")),
      estimated_value_mid: parseNumber(formData.get("estimated_value_mid")),
      estimated_value_high: parseNumber(formData.get("estimated_value_high")),
      estimated_value_date:
        String(formData.get("estimated_value_date") || "") || null,
      purchase_price: parseNumber(formData.get("purchase_price")),
      purchase_date: String(formData.get("purchase_date") || "") || null,
      last_lookup_at: String(formData.get("last_lookup_at") || "") || null,
      target_purchase_price: parseNumber(formData.get("target_purchase_price")),
      target_extra_cash: parseNumber(formData.get("target_extra_cash")),
      target_interest_rate: parseNumber(formData.get("target_interest_rate")),
      target_term_years: parseNumber(formData.get("target_term_years")),
      notes: String(formData.get("notes") || ""),
      updated_at: new Date().toISOString(),
    }),
    id,
    householdContext,
  );

  if (error) throw new Error(error.message);

  await supabase
    .from("home_owners")
    .delete()
    .eq("home_id", id)
    .or(
      `user_id.eq.${user.id},and(household_id.eq.${householdContext.householdId},visibility_scope.eq.household)`,
    );
  const rows = ownerRowsFromForm(formData, user.id, id, householdContext);
  if (rows.length > 0) {
    const { error: ownerError } = await supabase
      .from("home_owners")
      .insert(rows);
    if (ownerError) throw new Error(ownerError.message);
  }

  revalidatePath("/mortgage");
  revalidatePath("/affordability");
  revalidatePath("/dashboard");
}

export async function deleteHome(formData: FormData) {
  const { supabase, householdContext } = await requireUser();
  const id = String(formData.get("id") || "");
  if (!id) throw new Error("Missing home id");

  const { error } = await applyMutableRecordFilter(
    supabase.from("homes").delete(),
    id,
    householdContext,
  );
  if (error) throw new Error(error.message);

  revalidatePath("/mortgage");
  revalidatePath("/affordability");
  revalidatePath("/dashboard");
}

export async function addHomeMortgageDeal(formData: FormData) {
  const { supabase, user, householdContext } = await requireUser();

  const { data: deal, error } = await supabase
    .from("home_mortgage_deals")
    .insert({
      ...householdWriteFields(householdContext, user.id),
      home_id: String(formData.get("home_id") || "") || null,
      lender: String(formData.get("lender") || "") || null,
      product_name: String(formData.get("product_name") || "") || null,
      balance: parseNumber(formData.get("balance")) ?? 0,
      balance_as_of_date:
        String(formData.get("balance_as_of_date") || "") ||
        String(formData.get("start_date") || "") ||
        new Date().toISOString().slice(0, 10),
      interest_rate: parseNumber(formData.get("interest_rate")) ?? 0,
      rate_type: String(formData.get("rate_type") || "fixed"),
      repayment_type: String(formData.get("repayment_type") || "repayment"),
      initial_period_end:
        String(formData.get("initial_period_end") || "") || null,
      term_years: parseNumber(formData.get("term_years")) ?? 25,
      monthly_payment_override: parseNumber(
        formData.get("monthly_payment_override"),
      ),
      start_date:
        String(formData.get("start_date") || "") ||
        new Date().toISOString().slice(0, 10),
      end_date: String(formData.get("end_date") || "") || null,
      notes: String(formData.get("notes") || ""),
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);
  if (deal?.id) {
    const rows = liabilityRowsFromForm(
      formData,
      user.id,
      deal.id,
      householdContext,
    );
    if (rows.length > 0) {
      const { error: liabilityError } = await supabase
        .from("home_mortgage_liability_allocations")
        .insert(rows);
      if (liabilityError) throw new Error(liabilityError.message);
    }
  }

  revalidatePath("/mortgage");
  revalidatePath("/affordability");
  revalidatePath("/dashboard");
}

export async function deleteHomeMortgageDeal(formData: FormData) {
  const { supabase, householdContext } = await requireUser();
  const id = String(formData.get("id") || "");
  if (!id) throw new Error("Missing mortgage deal id");

  const { error } = await applyMutableRecordFilter(
    supabase.from("home_mortgage_deals").delete(),
    id,
    householdContext,
  );
  if (error) throw new Error(error.message);

  revalidatePath("/mortgage");
  revalidatePath("/affordability");
  revalidatePath("/dashboard");
}

export async function updateHomeMortgageDeal(formData: FormData) {
  const { supabase, user, householdContext } = await requireUser();
  const id = String(formData.get("id") || "");
  if (!id) throw new Error("Missing mortgage deal id");

  const { error } = await applyMutableRecordFilter(
    supabase.from("home_mortgage_deals").update({
      home_id: String(formData.get("home_id") || "") || null,
      lender: String(formData.get("lender") || "") || null,
      product_name: String(formData.get("product_name") || "") || null,
      balance: parseNumber(formData.get("balance")) ?? 0,
      balance_as_of_date:
        String(formData.get("balance_as_of_date") || "") ||
        String(formData.get("start_date") || "") ||
        new Date().toISOString().slice(0, 10),
      interest_rate: parseNumber(formData.get("interest_rate")) ?? 0,
      rate_type: String(formData.get("rate_type") || "fixed"),
      repayment_type: String(formData.get("repayment_type") || "repayment"),
      initial_period_end:
        String(formData.get("initial_period_end") || "") || null,
      term_years: parseNumber(formData.get("term_years")) ?? 25,
      monthly_payment_override: parseNumber(
        formData.get("monthly_payment_override"),
      ),
      start_date:
        String(formData.get("start_date") || "") ||
        new Date().toISOString().slice(0, 10),
      end_date: String(formData.get("end_date") || "") || null,
      notes: String(formData.get("notes") || ""),
      updated_at: new Date().toISOString(),
    }),
    id,
    householdContext,
  );

  if (error) throw new Error(error.message);

  await supabase
    .from("home_mortgage_liability_allocations")
    .delete()
    .eq("home_mortgage_deal_id", id);
  const liabilityRows = liabilityRowsFromForm(
    formData,
    user.id,
    id,
    householdContext,
  );
  if (liabilityRows.length > 0) {
    const { error: liabilityError } = await supabase
      .from("home_mortgage_liability_allocations")
      .insert(liabilityRows);
    if (liabilityError) throw new Error(liabilityError.message);
  }

  revalidatePath("/mortgage");
  revalidatePath("/affordability");
  revalidatePath("/dashboard");
}

export async function addHomeValuationSource(formData: FormData) {
  const { supabase, user, householdContext } = await requireUser();

  const { error } = await supabase.from("home_valuation_sources").insert({
    ...householdWriteFields(householdContext, user.id),
    home_id: String(formData.get("home_id") || ""),
    source_name: String(formData.get("source_name") || "Valuation source"),
    source_type: String(formData.get("source_type") || "user_estimate"),
    valuation_low: parseNumber(formData.get("valuation_low")),
    valuation_mid:
      parseNumber(formData.get("valuation_mid")) ??
      parseNumber(formData.get("valuation_amount")) ??
      0,
    valuation_high: parseNumber(formData.get("valuation_high")),
    valuation_amount: parseNumber(formData.get("valuation_amount")),
    confidence: String(formData.get("confidence") || "medium"),
    valuation_date:
      String(formData.get("valuation_date") || "") ||
      new Date().toISOString().slice(0, 10),
    source_url: String(formData.get("source_url") || "") || null,
    notes: String(formData.get("notes") || ""),
  });

  if (error) throw new Error(error.message);
  revalidatePath("/mortgage");
  revalidatePath("/affordability");
  revalidatePath("/dashboard");
}

export async function updateHomeValuationSource(formData: FormData) {
  const { supabase, householdContext } = await requireUser();
  const id = String(formData.get("id") || "");
  if (!id) throw new Error("Missing valuation id");

  const { error } = await applyMutableRecordFilter(
    supabase.from("home_valuation_sources").update({
      source_name: String(formData.get("source_name") || "Valuation source"),
      source_type: String(formData.get("source_type") || "user_estimate"),
      valuation_low: parseNumber(formData.get("valuation_low")),
      valuation_mid:
        parseNumber(formData.get("valuation_mid")) ??
        parseNumber(formData.get("valuation_amount")) ??
        0,
      valuation_high: parseNumber(formData.get("valuation_high")),
      valuation_amount: parseNumber(formData.get("valuation_amount")),
      confidence: String(formData.get("confidence") || "medium"),
      valuation_date: String(formData.get("valuation_date") || "") || null,
      source_url: String(formData.get("source_url") || "") || null,
      notes: String(formData.get("notes") || ""),
      updated_at: new Date().toISOString(),
    }),
    id,
    householdContext,
  );

  if (error) throw new Error(error.message);
  revalidatePath("/mortgage");
  revalidatePath("/affordability");
  revalidatePath("/dashboard");
}

export async function deleteHomeValuationSource(formData: FormData) {
  const { supabase, householdContext } = await requireUser();
  const id = String(formData.get("id") || "");
  if (!id) throw new Error("Missing valuation id");

  const { error } = await applyMutableRecordFilter(
    supabase.from("home_valuation_sources").delete(),
    id,
    householdContext,
  );
  if (error) throw new Error(error.message);
  revalidatePath("/mortgage");
  revalidatePath("/affordability");
  revalidatePath("/dashboard");
}

export async function addMortgageScenario(formData: FormData) {
  const { supabase, dataOwnerUserId } = await requireUser();

  const payload = {
    user_id: dataOwnerUserId,
    name: String(formData.get("name") || "Mortgage scenario"),
    balance: parseNumber(formData.get("balance")) ?? 0,
    interest_rate: parseNumber(formData.get("interest_rate")) ?? 0,
    term_years: parseNumber(formData.get("term_years")) ?? 25,
    monthly_overpayment: parseNumber(formData.get("monthly_overpayment")) ?? 0,
  };

  const { error } = await supabase.from("mortgage_scenarios").insert(payload);
  if (error) throw new Error(error.message);

  revalidatePath("/mortgage");
}

export async function deleteMortgageScenario(formData: FormData) {
  const { supabase, dataOwnerUserId } = await requireUser();

  const id = String(formData.get("id"));
  const { error } = await supabase
    .from("mortgage_scenarios")
    .delete()
    .eq("id", id)
    .eq("user_id", dataOwnerUserId);

  if (error) throw new Error(error.message);

  revalidatePath("/mortgage");
}

export async function addPropertyMoveQuery(formData: FormData) {
  const { supabase, dataOwnerUserId } = await requireUser();
  const propertyUrl = String(formData.get("property_url") || "").trim();
  const manualAskingPrice = parseNumber(formData.get("asking_price"));
  const targetDeposit = parseNumber(formData.get("target_deposit")) ?? 0;
  const expectedRate = parseNumber(formData.get("expected_rate")) ?? 4.75;
  const expectedTermYears =
    parseNumber(formData.get("expected_term_years")) ?? 30;
  const purchaseContext = String(
    formData.get("purchase_context") || "primary_home",
  );
  const additionalProperty = ["second_home", "buy_to_let"].includes(
    purchaseContext,
  );

  let parsed: ReturnType<typeof parseMoveListingFromSource> | null = null;
  let ingestionError: string | null = null;
  if (propertyUrl) {
    try {
      const source = await fetchSourceText(propertyUrl);
      parsed = parseMoveListingFromSource({
        sourceUrl: source.url,
        text: source.text,
        rawText: source.rawText,
        fallbackTitle: String(formData.get("title") || "") || undefined,
        fallbackPrice: manualAskingPrice,
      });
    } catch (error: any) {
      ingestionError = error?.message || "Could not ingest listing URL.";
    }
  }

  const askingPrice = parsed?.askingPrice ?? manualAskingPrice ?? 0;
  const assumptions = buildMoveAssumptions({
    askingPrice,
    targetDeposit,
    expectedRate,
    expectedTermYears,
    epcRating: parsed?.epcRating || String(formData.get("epc_rating") || ""),
    councilTaxBand:
      parsed?.councilTaxBand || String(formData.get("council_tax_band") || ""),
    councilTaxAuthority: String(formData.get("council_tax_authority") || ""),
    additionalProperty,
  });
  const movingCostEstimate =
    parseNumber(formData.get("moving_cost_estimate")) ??
    assumptions.movingCostEstimate;
  const manualCouncilBand = String(formData.get("council_tax_band") || "")
    .trim()
    .toUpperCase();
  const councilTaxBand =
    parsed?.councilTaxBand ||
    (/^[A-H]$/.test(manualCouncilBand) ? manualCouncilBand : null);
  const councilTaxEstimate = estimateCouncilTaxAnnual({
    band: councilTaxBand,
    authority: String(
      formData.get("council_tax_authority") ||
        assumptions.councilTaxAuthority ||
        "",
    ),
  });
  const councilTaxAnnual =
    parseNumber(formData.get("council_tax_estimate_annual")) ??
    assumptions.councilTaxAnnual ??
    councilTaxEstimate.annual;
  const serviceChargeMonthly = parseNumber(
    formData.get("service_charge_monthly"),
  );
  const maintenanceAllowanceMonthly =
    askingPrice > 0 ? Math.round((askingPrice * 0.0075) / 12) : null;

  const { error } = await supabase.from("property_move_queries").insert({
    user_id: dataOwnerUserId,
    home_id: String(formData.get("home_id") || "") || null,
    title:
      parsed?.cleanTitle ||
      parsed?.title ||
      String(formData.get("title") || "House search"),
    property_url: propertyUrl || null,
    asking_price: askingPrice || null,
    postcode:
      parsed?.postcode || String(formData.get("postcode") || "") || null,
    address_hint:
      parsed?.addressHint || String(formData.get("address_hint") || "") || null,
    bedrooms: parsed?.bedrooms ?? parseNumber(formData.get("bedrooms")),
    council_tax_band: councilTaxBand,
    council_tax_estimate_annual: councilTaxAnnual,
    epc_rating:
      parsed?.epcRating || String(formData.get("epc_rating") || "") || null,
    epc_energy_cost_estimate_annual:
      parseNumber(formData.get("epc_energy_cost_estimate_annual")) ??
      assumptions.energyAnnual,
    expected_heating_cost_monthly:
      parseNumber(formData.get("expected_heating_cost_monthly")) ??
      assumptions.heatingMonthly,
    stamp_duty_estimate: assumptions.stampDutyEstimate,
    moving_cost_estimate: movingCostEstimate,
    target_deposit: targetDeposit || null,
    expected_mortgage_balance: assumptions.expectedMortgageBalance,
    expected_rate: expectedRate,
    expected_term_years: expectedTermYears,
    expected_payment: assumptions.expectedPayment,
    source_status:
      parsed?.sourceStatus || (propertyUrl ? "url_partial" : "manual_price"),
    source_confidence: parsed?.sourceConfidence ?? (propertyUrl ? 55 : 40),
    image_url: parsed?.imageUrl || null,
    property_use: purchaseContext,
    council_tax_confidence:
      parsed?.councilTaxBandConfidence ?? councilTaxEstimate.confidence ?? null,
    council_tax_authority:
      String(
        formData.get("council_tax_authority") ||
          assumptions.councilTaxAuthority ||
          councilTaxEstimate.authority ||
          "",
      ) || null,
    council_tax_source_url:
      String(
        formData.get("council_tax_source_url") ||
          assumptions.councilTaxSourceUrl ||
          councilTaxEstimate.sourceUrl ||
          "",
      ) || null,
    map_latitude: parseNumber(formData.get("map_latitude")),
    map_longitude: parseNumber(formData.get("map_longitude")),
    map_embed_url: String(formData.get("map_embed_url") || "") || null,
    service_charge_monthly: serviceChargeMonthly,
    maintenance_allowance_monthly: maintenanceAllowanceMonthly,
    running_cost_breakdown: {
      mortgage_monthly: assumptions.expectedPayment,
      council_tax_monthly: councilTaxAnnual ? councilTaxAnnual / 12 : null,
      energy_monthly:
        parseNumber(formData.get("expected_heating_cost_monthly")) ??
        assumptions.heatingMonthly,
      service_charge_monthly: serviceChargeMonthly,
      maintenance_allowance_monthly: maintenanceAllowanceMonthly,
    },
    notes: String(formData.get("notes") || ""),
    payload: {
      created_from: "house_move_box",
      source_url: propertyUrl || null,
      ingestion_error: ingestionError,
      parsed_summary: parsed?.sourceSummary || null,
      council_tax_band_confidence:
        parsed?.councilTaxBandConfidence ||
        councilTaxEstimate.confidence ||
        null,
      council_tax_annual_source:
        assumptions.councilTaxSourceUrl || councilTaxEstimate.sourceUrl || null,
      council_tax_authority:
        assumptions.councilTaxAuthority || councilTaxEstimate.authority || null,
      moving_cost_basis: assumptions.movingCostBasis,
      property_use: purchaseContext,
      additional_property_stamp_duty: additionalProperty,
      image_url: parsed?.imageUrl || null,
      needs_enrichment: Boolean(propertyUrl && ingestionError),
    },
  });

  if (error) throw new Error(error.message);
  revalidatePath("/mortgage");
}

export async function archivePropertyMoveQuery(formData: FormData) {
  const { supabase, dataOwnerUserId } = await requireUser();
  const id = String(formData.get("id") || "");
  if (!id) throw new Error("Missing move query id");
  const { error } = await supabase
    .from("property_move_queries")
    .update({
      status: "archived",
      archived_at: new Date().toISOString(),
      delete_after: new Date(
        Date.now() + 14 * 24 * 60 * 60 * 1000,
      ).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("user_id", dataOwnerUserId);
  if (error) throw new Error(error.message);
  revalidatePath("/mortgage");
}

export async function saveMortgageDealPreference(formData: FormData) {
  const { supabase, user } = await requireUser();
  const ratesSupabase = createWorkerDatabaseClient("rates");
  const sourceKind = String(formData.get("source_kind") || "market");
  const sourceId = String(formData.get("source_id") || "");
  const homeId = String(formData.get("home_id") || "") || null;
  const intent = String(formData.get("intent") || "star");
  const nextValue = String(formData.get("next_value") || "true") === "true";
  if (!sourceId || !["market", "recommendation", "user_submitted"].includes(sourceKind))
    throw new Error("Invalid mortgage deal preference.");

  if (intent === "star" && nextValue) {
    let clearQuery = ratesSupabase
      .from("mortgage_deal_preferences")
      .update({ is_starred: false, updated_at: new Date().toISOString() })
      .eq("user_id", user.id);
    clearQuery = homeId
      ? clearQuery.eq("home_id", homeId)
      : clearQuery.is("home_id", null);
    const { error: clearError } = await clearQuery;
    if (clearError) throw new Error(clearError.message);
  }

  const payload: Record<string, any> = {
    user_id: user.id,
    home_id: homeId,
    source_kind: sourceKind,
    source_id: sourceId,
    updated_at: new Date().toISOString(),
  };
  if (intent === "star") payload.is_starred = nextValue;
  if (intent === "shortlist") payload.is_shortlisted = nextValue;

  const { error } = await ratesSupabase
    .from("mortgage_deal_preferences")
    .upsert(payload, { onConflict: "user_id,source_kind,source_id" });
  if (error) throw new Error(error.message);
  revalidatePath("/mortgage");
}

export async function updateMortgageWorkspacePreference(formData: FormData) {
  const { supabase, user } = await requireUser();
  const movingHomeLabel =
    String(formData.get("moving_home_label") || "Moving home")
      .trim()
      .slice(0, 40) || "Moving home";
  const movingHomeDescription =
    String(
      formData.get("moving_home_description") ||
        "Saved searches and move costs",
    )
      .trim()
      .slice(0, 120) || "Saved searches and move costs";
  const { error } = await supabase
    .from("mortgage_workspace_preferences")
    .upsert(
      {
        user_id: user.id,
        moving_home_label: movingHomeLabel,
        moving_home_description: movingHomeDescription,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
  if (error) throw new Error(error.message);
  revalidatePath("/mortgage");
}

export async function reportMortgageRecommendationIssue(formData: FormData) {
  const { supabase, user, dataOwnerUserId } = await requireUser();
  const recommendationId = String(formData.get("recommendation_id") || "");
  const issueKind =
    String(formData.get("issue_kind") || "broken_or_wrong").trim() ||
    "broken_or_wrong";
  const detail = String(formData.get("detail") || "").trim() || null;
  if (!recommendationId) throw new Error("Missing mortgage recommendation id.");

  const { data: recommendation, error: recError } = await supabase
    .from("mortgage_renewal_recommendations")
    .select("id,user_id,mortgage_rate_deal_id,lender_name,product_name")
    .eq("id", recommendationId)
    .eq("user_id", dataOwnerUserId)
    .maybeSingle();
  if (recError) throw new Error(recError.message);
  if (!recommendation)
    throw new Error("Recommendation not found for your account.");

  const { error } = await supabase.from("mortgage_rate_deal_flags").insert({
    user_id: dataOwnerUserId,
    mortgage_rate_deal_id: recommendation.mortgage_rate_deal_id,
    mortgage_renewal_recommendation_id: recommendation.id,
    issue_kind: issueKind,
    detail,
    status: "open",
  });
  if (error)
    throw new Error(
      `${error.message}. Run db/v28_13_ai_mortgage_catalogue_admin_reorg.sql in Supabase.`,
    );

  if (hasSupabaseAdminKey() && recommendation.mortgage_rate_deal_id) {
    try {
      const admin = createWorkerDatabaseClient("rates");
      const { data: current } = await admin
        .from("mortgage_rate_deals")
        .select("broken_report_count")
        .eq("id", recommendation.mortgage_rate_deal_id)
        .maybeSingle();
      await admin
        .from("mortgage_rate_deals")
        .update({
          broken_report_count: Number(current?.broken_report_count || 0) + 1,
          last_broken_report_at: new Date().toISOString(),
          catalogue_status: "broken",
          status: "broken",
          updated_at: new Date().toISOString(),
        })
        .eq("id", recommendation.mortgage_rate_deal_id);
      await admin.from("app_notifications").insert({
        user_id: user.id,
        notification_type: "mortgage_deal_report_received",
        category: "wealth",
        channel: "in_app",
        action_status: "pending",
        severity: "info",
        status: "unread",
        title: "Mortgage deal report received",
        body: "Thanks — LOOP has sent this mortgage product to admin review. You’ll be notified when the link/data has been checked.",
        cta_label: "Open mortgage deals",
        cta_href: "/mortgage?tab=mortgage_deals",
        data: {
          recommendation_id: recommendation.id,
          mortgage_rate_deal_id: recommendation.mortgage_rate_deal_id,
        },
      });
    } catch (adminError) {
      console.warn("[mortgage-report] admin side-effect skipped", adminError);
    }
  }

  revalidatePath("/mortgage");
  revalidatePath("/admin/houses");
}
