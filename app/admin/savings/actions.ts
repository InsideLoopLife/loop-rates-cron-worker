"use server";

import { revalidatePath } from "next/cache";
import { requireAdminAccess, createBestAdminClient } from "@/lib/admin/access";
import { writeAdminAuditEvent } from "@/lib/admin/audit";
import { describeSupabaseAdminKey } from "@/lib/supabase/admin";
import { ensureDefaultSourceUniverse } from "@/lib/wealth/default-source-catalogue";
import { refreshSavingsCatalogueFromSources } from "@/lib/wealth/savings-catalogue";
import { expireStaleSavingsDeals, runSavingsRateWatch } from "@/lib/wealth/savings-rate-watch";

function adminClient() {
  const supabase = createBestAdminClient();
  if (!supabase) {
    const status = describeSupabaseAdminKey();
    throw new Error(`${status.reason} Savings admin jobs need SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY set server-side.`);
  }
  return supabase;
}

function numberOr(value: FormDataEntryValue | null, fallback: number) {
  const n = Number(String(value || "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : fallback;
}

export async function seedDefaultSavingsAndMortgageSourcesNow() {
  const access = await requireAdminAccess();
  const supabase = adminClient();
  const result = await ensureDefaultSourceUniverse(supabase);
  await writeAdminAuditEvent({ actionKey: "wealth_default_source_universe_seeded", entityKind: "wealth_watch_sources", afterPayload: result });
  revalidatePath("/admin/savings");
  revalidatePath("/admin/houses");
}

export async function runSavingsCatalogueRefreshNow(formData: FormData) {
  const access = await requireAdminAccess();
  const supabase = adminClient();
  const result = await refreshSavingsCatalogueFromSources(supabase, {
    runKey: `savings-catalogue:admin:${Date.now()}`,
    limit: numberOr(formData.get("limit"), 30),
    publishConfidenceThreshold: numberOr(formData.get("publish_confidence"), 92),
    freshnessHours: numberOr(formData.get("freshness_hours"), 12),
    force: String(formData.get("force") || "") === "true",
    triggeredBy: access.user.email || access.user.id,
  });
  await writeAdminAuditEvent({ actionKey: "savings_catalogue_refresh", entityKind: "savings_rate_deals", afterPayload: result });
  revalidatePath("/admin/savings");
  revalidatePath("/accounts");
}

export async function runSavingsCatalogueAndWatchNow(formData: FormData) {
  const access = await requireAdminAccess();
  const supabase = adminClient();
  const seed = await ensureDefaultSourceUniverse(supabase);
  const refresh = await refreshSavingsCatalogueFromSources(supabase, {
    runKey: `savings-catalogue:optimise:${Date.now()}`,
    limit: numberOr(formData.get("limit"), 40),
    publishConfidenceThreshold: numberOr(formData.get("publish_confidence"), 88),
    freshnessHours: numberOr(formData.get("freshness_hours"), 12),
    triggeredBy: access.user.email || access.user.id,
  });
  const watch = await runSavingsRateWatch(supabase, {
    runKey: `savings-rate-watch:after-catalogue:${Date.now()}`,
    runKind: "admin_refresh_then_watch",
    limit: numberOr(formData.get("account_limit"), 500),
    triggeredBy: access.user.email || access.user.id,
    respectTier: false,
  });
  const expire = await expireStaleSavingsDeals(supabase, numberOr(formData.get("stale_days"), 7), access.user.email || access.user.id);
  const result = { seed, refresh, watch, expire };
  await writeAdminAuditEvent({ actionKey: "savings_catalogue_watch_pipeline", entityKind: "savings_rate_deals", afterPayload: result });
  revalidatePath("/admin/savings");
  revalidatePath("/accounts");
}
