import crypto from "node:crypto";

export function parseSavingsDeals({ providerName, providerSlug, productHint, sourceUrl, text }) {
  const candidates = rateWindows(text, /\b(?:AER|gross|savings?|saver|cash isa|fixed rate|notice|bond|regular saver|monthly saver)\b/i);
  const results = new Map();
  for (const { rate, window } of candidates) {
    const lower = window.toLowerCase();
    const accountType = /\bcash isa\b|\bisa\b/i.test(window) ? "cash_isa"
      : /regular saver|monthly saver/i.test(window) ? "regular_saver"
      : /notice/i.test(window) ? "notice_saver"
      : /fixed|bond/i.test(window) ? "fixed_saver" : "easy_access";
    const productName = inferSavingsName(window, productHint, accountType);
    const minimumBalance = money(window, [/(?:minimum|min)\s+(?:opening\s+)?(?:deposit|balance|investment)[^£\d]{0,25}£?\s*([\d,]+(?:\.\d{1,2})?)/i]);
    const maximumBalance = money(window, [/(?:maximum|max)\s+(?:deposit|balance|investment|you can save)[^£\d]{0,25}£?\s*([\d,]+(?:\.\d{1,2})?)/i]);
    const monthlyMaxDeposit = money(window, [
      /(?:up to|maximum|max)[^£\d]{0,15}£\s*([\d,]+(?:\.\d{1,2})?)[^.;]{0,25}(?:per|a|each|every)\s*month/i,
      /(?:save|deposit|pay in|contribute)[^£\d]{0,30}(?:up to|maximum|max)?[^£\d]{0,15}£\s*([\d,]+(?:\.\d{1,2})?)[^.;]{0,25}(?:per|a|each|every)\s*month/i,
      /(?:monthly|per month)[^£\d]{0,30}(?:maximum|max|limit)?[^£\d]{0,15}£\s*([\d,]+(?:\.\d{1,2})?)/i,
    ]);
    const monthlyMinDeposit = money(window, [
      /(?:save|deposit|pay in|contribute)[^£\d]{0,30}(?:at least|minimum|min)[^£\d]{0,15}£\s*([\d,]+(?:\.\d{1,2})?)[^.;]{0,25}(?:per|a|each|every)\s*month/i,
      /(?:monthly|per month)[^£\d]{0,30}(?:minimum|min)[^£\d]{0,15}£\s*([\d,]+(?:\.\d{1,2})?)/i,
    ]);
    const termLengthMonths = termMonths(window);
    const noticePeriodDays = number(window, /(\d{1,4})\s*days?\s+notice/i);
    const requiresExistingCustomer = /existing customer|current account customer|members only|member exclusive/i.test(window);
    const regularSaver = accountType === "regular_saver";
    const required = regularSaver
      ? { rate: true, name: specificName(productName), monthlyMaximum: monthlyMaxDeposit !== null, term: termLengthMonths !== null }
      : accountType === "fixed_saver"
        ? { rate: true, name: specificName(productName), term: termLengthMonths !== null, minimum: minimumBalance !== null }
        : { rate: true, name: specificName(productName), minimum: minimumBalance !== null, access: /access|withdraw/i.test(window) };
    const completeness = Object.values(required).filter(Boolean).length / Object.keys(required).length;
    const reviewReasons = [];
    if (!specificName(productName)) reviewReasons.push("Product name is generic.");
    if (regularSaver && monthlyMaxDeposit === null) reviewReasons.push("Monthly maximum deposit is missing.");
    if (regularSaver && termLengthMonths === null) reviewReasons.push("Regular-saver term is missing.");
    if (accountType === "fixed_saver" && termLengthMonths === null) reviewReasons.push("Fixed term is missing.");
    if (minimumBalance === null) reviewReasons.push("Minimum opening balance is missing.");
    const confidence = Math.min(99, Math.round(55 + completeness * 35 + (/AER/i.test(window) ? 6 : 0) + (monthlyMinDeposit !== null ? 2 : 0)));
    const sourceProductId = `${slug(providerSlug || providerName)}:${slug(productName)}:${accountType}:${termLengthMonths || "open"}`;
    const deal = {
      provider_slug: slug(providerSlug || providerName),
      provider_name: providerName,
      product_name: productName,
      account_type: accountType,
      gross_aer: rate,
      bonus_rate: percentage(window, /bonus(?: rate)?[^%\d]{0,20}(\d{1,2}(?:\.\d{1,3})?)\s*%/i),
      minimum_balance: minimumBalance,
      maximum_balance: maximumBalance,
      monthly_min_deposit: monthlyMinDeposit,
      monthly_max_deposit: monthlyMaxDeposit,
      access_type: accountType === "fixed_saver" ? "fixed_term" : accountType === "notice_saver" ? "notice" : accountType === "regular_saver" ? "regular_saver" : "easy_access",
      withdrawal_rules: withdrawalRules(window),
      notice_period_days: noticePeriodDays,
      term_length_months: termLengthMonths,
      rate_type: /fixed/i.test(window) ? "fixed" : "variable",
      requires_existing_customer: requiresExistingCustomer,
      eligible_provider_slug: requiresExistingCustomer ? slug(providerSlug || providerName) : null,
      eligibility_note: requiresExistingCustomer ? "Existing-customer eligibility detected; confirm on source." : null,
      source_url: sourceUrl,
      confidence,
      publishable: completeness === 1 && confidence >= 90,
      review_reasons: reviewReasons,
      source_product_id: sourceProductId,
      evidence: { excerpt: window.slice(0, 1600), monthly_min_deposit: monthlyMinDeposit },
      validation: { required, completeness },
      ai_summary: `${providerName} ${productName}: ${rate.toFixed(2)}% AER. ${reviewReasons.length ? `Review: ${reviewReasons.join(" ")}` : "Required product fields detected; verify against the source before applying."}`,
    };
    const prior = results.get(sourceProductId);
    if (!prior || deal.confidence > prior.confidence) results.set(sourceProductId, deal);
  }
  return [...results.values()].slice(0, 50);
}

export function parseMortgageDeals({ lenderName, lenderSlug, sourceUrl, text, market = {} }) {
  const candidates = rateWindows(text, /\b(?:mortgage|fixed|tracker|variable|LTV|product fee|arrangement fee|remortgage|purchase)\b/i);
  const results = new Map();
  for (const { rate, window } of candidates) {
    const rateType = /tracker/i.test(window) ? "tracker" : /variable|SVR/i.test(window) ? "variable" : "fixed";
    const term = termMonths(window);
    const ltvMax = maxNumber(window, /(\d{2,3})\s*%\s*LTV/gi, 100);
    const ltvMin = number(window, /(?:minimum|min|from)\s+(\d{1,3})\s*%\s*LTV/i);
    const productFee = money(window, [
      /(?:product|arrangement|booking|mortgage)\s*fee[^£\d]{0,35}£\s*([\d,]+(?:\.\d{1,2})?)/i,
      /£\s*([\d,]+(?:\.\d{1,2})?)\s*(?:product|arrangement|booking|mortgage)\s*fee/i,
    ]);
    const noFee = /no (?:product |arrangement |booking )?fee|fee[- ]free|£\s*0\s*(?:product )?fee/i.test(window);
    const fee = productFee ?? (noFee ? 0 : null);
    const existingOnly = /existing customer|product transfer|current borrower|existing mortgage customer/i.test(window);
    const newCustomer = !existingOnly || /new customer|remortgage|purchase|moving home/i.test(window);
    const required = { rate: true, term: rateType === "variable" || term !== null, ltv: ltvMax !== null, fee: fee !== null };
    const completeness = Object.values(required).filter(Boolean).length / Object.keys(required).length;
    const anomaly = market.sampleSize >= 5 && ((market.lowerBound && rate < market.lowerBound) || (market.upperBound && rate > market.upperBound));
    const reviewReasons = [];
    if (term === null && rateType !== "variable") reviewReasons.push("Initial deal term is missing.");
    if (ltvMax === null) reviewReasons.push("Maximum LTV is missing.");
    if (fee === null) reviewReasons.push("Product fee is missing.");
    if (anomaly) reviewReasons.push(`Rate is significantly outside the recent market range around ${Number(market.median).toFixed(2)}%.`);
    const confidence = Math.min(99, Math.round(50 + completeness * 42 + (/mortgage/i.test(window) ? 4 : 0) - (anomaly ? 25 : 0)));
    const productName = `${lenderName} ${term ? `${Math.round(term / 12)} year ` : ""}${rateType}${ltvMax ? ` · ${ltvMax}% LTV` : ""} · ${rate.toFixed(2)}%`;
    const externalKey = crypto.createHash("sha256").update([slug(lenderSlug || lenderName), rateType, term, ltvMax, fee, existingOnly, sourceUrl].join("|")).digest("hex");
    const deal = {
      lender_slug: slug(lenderSlug || lenderName),
      lender_name: lenderName,
      product_name: productName,
      rate_type: rateType,
      initial_term_months: term,
      ltv_max: ltvMax,
      ltv_min: ltvMin,
      rate_percent: rate,
      product_fee: fee,
      existing_customer_only: existingOnly,
      new_customer_available: newCustomer,
      external_product_key: externalKey,
      confidence,
      anomaly,
      publishable: completeness === 1 && !anomaly && confidence >= 95,
      review_reasons: reviewReasons,
      evidence: { excerpt: window.slice(0, 1800) },
      validation: { required, completeness, anomaly },
      summary: `${rate.toFixed(2)}% ${rateType} mortgage${term ? ` for ${term} months` : ""}${ltvMax ? ` up to ${ltvMax}% LTV` : ""}${fee !== null ? ` with a £${fee} product fee` : ""}.`,
    };
    const prior = results.get(externalKey);
    if (!prior || deal.confidence > prior.confidence) results.set(externalKey, deal);
  }
  return [...results.values()].slice(0, 60);
}

function rateWindows(text, contextPattern) {
  const compact = String(text || "").replace(/\s+/g, " ").trim();
  const matches = [...compact.matchAll(/(\d{1,2}(?:\.\d{1,3})?)\s*%\s*(?:AER|gross|variable|fixed|APR|APRC|initial rate)?/gi)]
    .map((match) => ({ rate: Number(match[1]), index: match.index || 0 }))
    .filter(({ rate }) => rate > 0.1 && rate < 25);
  return matches.slice(0, 120).map(({ rate, index }) => ({
    rate,
    window: compact.slice(Math.max(0, index - 650), Math.min(compact.length, index + 1450)),
  })).filter(({ window }) => contextPattern.test(window));
}

function inferSavingsName(window, hint, type) {
  if (hint && !/all|products|rates|savings/i.test(hint)) return hint.trim().slice(0, 180);
  const patterns = [
    /([A-Z][A-Za-z0-9&'’.+/ -]{3,90}(?:Cash ISA|Regular Saver|Monthly Saver|Easy Access Saver|Instant Access Saver|Notice Account|Fixed Rate Bond|Fixed Saver|Savings Account))/,
    /((?:Cash ISA|Regular Saver|Monthly Saver|Easy Access Saver|Notice Saver|Fixed Rate Bond|Fixed Saver)[A-Za-z0-9&'’.+/ -]{0,70})/i,
  ];
  for (const pattern of patterns) {
    const found = window.match(pattern)?.[1]?.replace(/\s+/g, " ").trim();
    if (found) return found.slice(0, 180);
  }
  return ({ cash_isa: "Cash ISA", regular_saver: "Regular Saver", notice_saver: "Notice Savings", fixed_saver: "Fixed Savings", easy_access: "Easy Access Savings" })[type];
}
function specificName(name) { return Boolean(name && !/^(cash isa|regular saver|notice savings|fixed savings|easy access savings|savings product)$/i.test(name.trim())); }
function money(text, patterns) { for (const pattern of patterns) { const match = text.match(pattern); if (match?.[1]) return Number(match[1].replace(/,/g, "")); } return null; }
function number(text, pattern) { const match = text.match(pattern); return match?.[1] ? Number(match[1]) : null; }
function maxNumber(text, pattern, max) { const values = [...text.matchAll(pattern)].map((m) => Number(m[1])).filter((n) => n > 0 && n <= max); return values.length ? Math.max(...values) : null; }
function percentage(text, pattern) { const n = number(text, pattern); return Number.isFinite(n) ? n : null; }
function termMonths(text) { const month = text.match(/\b(\d{1,3})\s*months?\b/i); if (month) return Number(month[1]); const year = text.match(/\b(\d{1,2})\s*(?:year|yr)s?\b/i); return year ? Number(year[1]) * 12 : null; }
function withdrawalRules(text) { const m = text.match(/(?:withdrawal|withdraw|access|notice|penalt|closure|maturity)[^.]{0,240}/i); return m ? m[0].trim() : null; }
function slug(value) { return String(value || "provider").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100); }
