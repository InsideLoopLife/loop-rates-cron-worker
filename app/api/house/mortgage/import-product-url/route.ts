// app/api/house/mortgage/import-product-url/route.ts
//
// POST { sourceUrl, homeMortgageDealId? }
//
// User pastes a specific mortgage product's URL. This:
//   1. Fetches it (headless-capable via getPublicPageEvidence, same module the
//      nutrition importer uses)
//   2. Extracts key fields with AI assistance if available (same pattern as
//      recipe import: budget-gated, graceful non-AI fallback if not)
//   3. Stores it in user_submitted_mortgage_products — SHARED across users,
//      keyed by source_url, so a second user submitting the same URL reuses
//      the existing row rather than duplicating it
//   4. Assesses fit against the calling user's own mortgage (LTV, current
//      payment) so the response can say more than just "here's a rate"
//
// Staleness checking (3-strikes -> deleted -> notify watchers) is a separate
// concern, handled by a cron in loop-rates-cron-worker, not this route.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createWorkerDatabaseClient } from "@/platform/database/worker-client";
import { getActiveIntegrationSecret } from "@/lib/integrations/secrets";
import { checkAiRouteAllowed, recordAiRouteUsage } from "@/lib/ai/route-budget";
import { enforceUserRateLimit } from "@/lib/security/rate-limit";
import { cleanText, safeExternalUrl } from "@/lib/security/external-data";
import { getPublicPageEvidence } from "@/lib/imports/public-page-evidence";
import { calculateMonthlyMortgagePayment } from "@/lib/calculations/mortgage";

function extractTextFromResponse(payload: any) {
  if (typeof payload?.output_text === "string") return payload.output_text;
  const chunks: string[] = [];
  for (const item of payload?.output || []) {
    for (const content of item?.content || []) {
      if (typeof content?.text === "string") chunks.push(content.text);
    }
  }
  return chunks.join("\n");
}

function parseJsonLoose(text: string) {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {}
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1]);
    } catch {}
  }
  return null;
}

// Regex-only fallback for when no OpenAI key/budget is available — deliberately
// conservative, same "skip rather than guess" principle as the BoE parser.
function regexFallbackExtract(pageText: string) {
  const rateMatch = pageText.match(/(\d{1,2}\.\d{1,2})\s*%/);
  const ltvMatch = pageText.match(/(\d{2})\s*%\s*ltv/i);
  const termMatch = pageText.match(/(\d+)\s*[- ]?year/i);
  const feeMatch = pageText.match(/£\s?([\d,]+)\s*(product\s*)?fee/i);
  return {
    rate_percent: rateMatch ? Number(rateMatch[1]) : null,
    ltv_max_percent: ltvMatch ? Number(ltvMatch[1]) : null,
    initial_term_months: termMatch ? Number(termMatch[1]) * 12 : null,
    fee_amount: feeMatch ? Number(feeMatch[1].replace(/,/g, "")) : null,
    lender_name: null,
    product_name: null,
    rate_type: /tracker/i.test(pageText) ? "tracker" : /variable/i.test(pageText) ? "variable" : "fixed",
  };
}

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 8_000) return NextResponse.json({ error: "Request too large." }, { status: 413 });

  const supabase = await createClient();
  const ratesSupabase = createWorkerDatabaseClient("rates");
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const limit = await enforceUserRateLimit({ userId: user.id, bucket: "mortgage_product_url_import", limit: 20, windowSeconds: 60 * 60 });
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many product imports. Try again shortly.", resetAt: limit.resetAt }, { status: 429 });
  }

  const body = await request.json().catch(() => ({}));
  const sourceUrl = safeExternalUrl(body.sourceUrl || "");
  if (!sourceUrl) return NextResponse.json({ error: "A valid https:// product URL is required." }, { status: 400 });

  // Shared row — if someone already submitted this exact URL, reuse it rather
  // than re-fetching/re-extracting (and don't waste this user's AI budget).
  const { data: existing } = await ratesSupabase
    .from("user_submitted_mortgage_products")
    .select("*")
    .eq("source_url", sourceUrl)
    .eq("status", "active")
    .maybeSingle();

  let product = existing;

  if (!product) {
    const evidence = await getPublicPageEvidence(sourceUrl).catch(() => null);
    const pageText = cleanText(evidence?.pageText || "", 12000);

    let extracted = regexFallbackExtract(pageText);
    let extractionMethod: "ai_assisted" | "regex_fallback" = "regex_fallback";

    const secret = await getActiveIntegrationSecret(supabase, user.id, "openai");
    if (secret?.value && pageText.length > 200) {
      const budget = await checkAiRouteAllowed(supabase, user.id, "mortgage_product_import");
      if (budget.allowed) {
        try {
          const prompt = `Extract mortgage product details from this page. Return ONLY valid JSON, no commentary.

Page text (${pageText.length} characters):
${pageText}

Return JSON with this exact shape (use null for anything not clearly stated — never guess):
{
  "lender_name": "string or null",
  "product_name": "string or null",
  "rate_percent": number or null,
  "rate_type": "fixed" | "variable" | "tracker" | null,
  "ltv_max_percent": number or null,
  "initial_term_months": number or null,
  "fee_amount": number or null
}`;
          const response = await fetch("https://api.openai.com/v1/responses", {
            method: "POST",
            headers: { Authorization: `Bearer ${secret.value}`, "Content-Type": "application/json" },
            body: JSON.stringify({ model: process.env.OPENAI_RESEARCH_MODEL || "gpt-4.1-mini", input: prompt }),
          });
          if (response.ok) {
            const payload = await response.json();
            const parsed = parseJsonLoose(extractTextFromResponse(payload));
            if (parsed && typeof parsed === "object") {
              extracted = { ...extracted, ...parsed };
              extractionMethod = "ai_assisted";
            }
            await recordAiRouteUsage({
              supabase,
              userId: user.id,
              tierKey: budget.tierKey,
              routeKey: "mortgage_product_import",
              provider: "openai",
              model: process.env.OPENAI_RESEARCH_MODEL || "gpt-4.1-mini",
            });
          }
        } catch {
          // AI extraction failed — regex fallback already computed above, carry on.
        }
      }
    }

    const { data: inserted, error } = await ratesSupabase
      .from("user_submitted_mortgage_products")
      .upsert(
        {
          submitted_by_user_id: user.id,
          source_url: sourceUrl,
          resolved_url: evidence?.finalUrl || sourceUrl,
          lender_name: extracted.lender_name ? cleanText(extracted.lender_name, 120) : null,
          product_name: extracted.product_name ? cleanText(extracted.product_name, 200) : null,
          rate_percent: extracted.rate_percent,
          rate_type: extracted.rate_type,
          ltv_max_percent: extracted.ltv_max_percent,
          initial_term_months: extracted.initial_term_months,
          fee_amount: extracted.fee_amount,
          extraction_summary: extracted,
          extraction_method: extractionMethod,
          status: "active",
          consecutive_failed_checks: 0,
          last_checked_at: new Date().toISOString(),
          last_check_ok: true,
        },
        { onConflict: "source_url" },
      )
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    product = inserted;
  }

  // --- Fit assessment against the calling user's own mortgage ---
  const homeId = typeof body.homeId === "string" ? body.homeId : null;
  const { data: homeRows } = homeId
    ? await supabase.from("homes").select("id, property_value, estimated_value_mid").eq("id", homeId).limit(1)
    : { data: null };
  const home = homeRows?.[0];

  const { data: dealRows } = home
    ? await supabase.from("home_mortgage_deals").select("*").eq("home_id", home.id).is("end_date", null).limit(1)
    : { data: null };
  const deal = dealRows?.[0];

  let fit: Record<string, any> = { assessed: false, reason: "No active mortgage on file to compare against." };
  if (deal && product?.rate_percent) {
    const estimatedValue = home?.estimated_value_mid ?? home?.property_value ?? null;
    const currentLtv = estimatedValue ? Math.round((Number(deal.balance) / estimatedValue) * 1000) / 10 : null;
    const meetsLtv = product.ltv_max_percent === null || currentLtv === null || currentLtv <= product.ltv_max_percent;

    const currentPayment = deal.monthly_payment_override
      ? Number(deal.monthly_payment_override)
      : calculateMonthlyMortgagePayment({ balance: Number(deal.balance), annualInterestRate: Number(deal.interest_rate), termYears: Number(deal.term_years ?? 25) });
    const newPayment = calculateMonthlyMortgagePayment({
      balance: Number(deal.balance),
      annualInterestRate: Number(product.rate_percent),
      termYears: Number(product.initial_term_months ? product.initial_term_months / 12 : deal.term_years ?? 25),
    });

    fit = {
      assessed: true,
      current_ltv_percent: currentLtv,
      meets_ltv_requirement: meetsLtv,
      current_monthly_payment: Math.round(currentPayment),
      estimated_new_monthly_payment: Math.round(newPayment),
      monthly_delta: Math.round(newPayment - currentPayment),
      note: meetsLtv
        ? undefined
        : `This product needs ${product.ltv_max_percent}% LTV or lower — your current LTV is ${currentLtv}%, so you likely wouldn't qualify without a larger deposit or lower balance.`,
    };
  }

  return NextResponse.json({ product, fit });
}
