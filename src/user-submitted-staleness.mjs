// src/user-submitted-staleness.mjs
//
// Checks every active user-submitted mortgage product URL is still live and
// readable. 3 consecutive failures -> status='deleted' and every user who has
// it shortlisted (mortgage_deal_preferences, source_kind='user_submitted') gets
// notified via app_notifications that the deal is no longer available.
//
// Deliberately plain fetch, not headless — these are individual product pages
// a real user already successfully loaded once to submit the URL, and this is
// just a liveness check (is it still there, does it still look coherent), not
// trying to re-extract full detail. Keeps this cheap to run frequently.

const MAX_CONSECUTIVE_FAILURES = 3;

async function checkOneProduct(product, userAgent) {
  try {
    const res = await fetch(product.source_url, {
      headers: { "user-agent": userAgent },
      redirect: "follow",
    });
    if (!res.ok) {
      return { ok: false, reason: `HTTP ${res.status}` };
    }
    const text = await res.text();
    if (text.length < 500) {
      return { ok: false, reason: "Page returned almost no content" };
    }
    // Coherence check: if we know the rate we originally extracted, does that
    // figure (or something close to it) still appear anywhere on the page?
    // A page that 200s but no longer shows the rate is exactly the "quietly
    // withdrawn" case this whole feature exists to catch.
    if (product.rate_percent !== null && product.rate_percent !== undefined) {
      const rateStr = Number(product.rate_percent).toFixed(2);
      const rateStrLoose = String(product.rate_percent);
      if (!text.includes(rateStr) && !text.includes(rateStrLoose)) {
        return { ok: false, reason: `Rate ${rateStr}% no longer found on page` };
      }
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err?.message || "Fetch failed" };
  }
}

async function notifyWatchers(supabase, product, log) {
  const { data: preferences, error } = await supabase
    .from("mortgage_deal_preferences")
    .select("user_id, home_id")
    .eq("source_kind", "user_submitted")
    .eq("source_id", product.id);

  if (error) {
    log("user_submitted_notify_lookup_failed", { productId: product.id, error: error.message });
    return 0;
  }
  if (!preferences?.length) return 0;

  const rows = preferences.map((p) => ({
    user_id: p.user_id,
    notification_type: "mortgage_deal_expired",
    channel: "in_app",
    status: "unread",
    severity: "warning",
    title: "A mortgage deal you shortlisted is no longer available",
    body: `${product.lender_name || "The"} deal at ${product.rate_percent ?? "an unknown"}% (${product.source_url}) hasn't been reachable for ${MAX_CONSECUTIVE_FAILURES} checks in a row and has been removed. Worth shortlisting an alternative.`,
    cta_label: "Review mortgage deals",
    cta_href: "/mortgage",
    data: { productId: product.id, sourceUrl: product.source_url },
  }));

  const { error: insertError } = await supabase.from("app_notifications").insert(rows);
  if (insertError) {
    log("user_submitted_notify_insert_failed", { productId: product.id, error: insertError.message });
    return 0;
  }
  return rows.length;
}

export async function refreshUserSubmittedProducts(supabase, userAgent, log) {
  const { data: products, error } = await supabase
    .from("user_submitted_mortgage_products")
    .select("*")
    .eq("status", "active");

  if (error) {
    return { checked: 0, ok: 0, failed: 0, deleted: 0, notified: 0, detail: [{ ok: false, error: error.message }] };
  }
  if (!products?.length) {
    return { checked: 0, ok: 0, failed: 0, deleted: 0, notified: 0, detail: [] };
  }

  let okCount = 0;
  let failedCount = 0;
  let deletedCount = 0;
  let notifiedCount = 0;
  const detail = [];

  for (const product of products) {
    const result = await checkOneProduct(product, userAgent);

    if (result.ok) {
      okCount += 1;
      await supabase
        .from("user_submitted_mortgage_products")
        .update({ consecutive_failed_checks: 0, last_checked_at: new Date().toISOString(), last_check_ok: true, updated_at: new Date().toISOString() })
        .eq("id", product.id);
      detail.push({ id: product.id, url: product.source_url, ok: true });
      continue;
    }

    failedCount += 1;
    const newFailureCount = (product.consecutive_failed_checks || 0) + 1;
    const shouldDelete = newFailureCount >= MAX_CONSECUTIVE_FAILURES;

    await supabase
      .from("user_submitted_mortgage_products")
      .update({
        consecutive_failed_checks: newFailureCount,
        last_checked_at: new Date().toISOString(),
        last_check_ok: false,
        status: shouldDelete ? "deleted" : "active",
        updated_at: new Date().toISOString(),
      })
      .eq("id", product.id);

    if (shouldDelete) {
      deletedCount += 1;
      const notified = await notifyWatchers(supabase, product, log);
      notifiedCount += notified;
      detail.push({ id: product.id, url: product.source_url, ok: false, error: result.reason, deleted: true, notified });
    } else {
      detail.push({ id: product.id, url: product.source_url, ok: false, error: result.reason, consecutiveFailures: newFailureCount });
    }
  }

  return { checked: products.length, ok: okCount, failed: failedCount, deleted: deletedCount, notified: notifiedCount, detail };
}
