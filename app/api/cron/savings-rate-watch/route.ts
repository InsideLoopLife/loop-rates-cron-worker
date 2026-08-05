import { NextRequest, NextResponse } from "next/server";
import { createWorkerDatabaseClient } from "@/platform/database/worker-client";
import { verifyCronRequest } from "@/lib/security/cron";
import { refreshSavingsCatalogueFromSources } from "@/lib/wealth/savings-catalogue";
import { ensureDefaultSourceUniverse } from "@/lib/wealth/default-source-catalogue";
import { expireStaleSavingsDeals, runSavingsRateWatch } from "@/lib/wealth/savings-rate-watch";
import { acquireRatesWorkerLock, releaseRatesWorkerLock, runRatesWorkerPreflight } from "@/lib/wealth/rates-worker-runtime";

function runKey(date = new Date()) {
  return `savings-rate-watch:${date.toISOString().slice(0, 10)}`;
}

export async function GET(request: NextRequest) {
  const guard = verifyCronRequest(request);
  if (!guard.ok) return guard.response;

  let lockToken: string | null = null;
  try {
    const enforceLocalHour = request.nextUrl.searchParams.get("enforce_local_hour") === "1";
    const londonParts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
    const londonHour = Number(londonParts.find((part) => part.type === "hour")?.value || -1);
    if (enforceLocalHour && londonHour !== 8) {
      return NextResponse.json({ ok: true, skipped: true, reason: "Not 08:00 Europe/London", londonHour });
    }

    const supabase = createWorkerDatabaseClient("rates");
    const preflight = await runRatesWorkerPreflight(supabase);
    const lock = await acquireRatesWorkerLock(supabase);
    if (!lock.acquired) {
      return NextResponse.json({ ok: true, skipped: true, reason: "Another savings/mortgage catalogue run is still active.", preflight });
    }
    lockToken = lock.token;
    const mode = request.nextUrl.searchParams.get("mode") || "full";
    const freshnessHours = Number(request.nextUrl.searchParams.get("freshness_hours") || 12);
    const refreshLimit = Number(request.nextUrl.searchParams.get("refresh_limit") || 40);
    const watchLimit = Number(request.nextUrl.searchParams.get("limit") || 500);
    const triggeredBy = `cron:${guard.mode}`;

    const seed = mode === "watch_only" ? null : await ensureDefaultSourceUniverse(supabase);
    const refresh = mode === "watch_only" ? null : await refreshSavingsCatalogueFromSources(supabase, {
      runKey: `savings-catalogue:cron:${Date.now()}`,
      limit: refreshLimit,
      freshnessHours,
      publishConfidenceThreshold: Number(request.nextUrl.searchParams.get("publish_confidence") || 88),
      triggeredBy,
    });

    const catalogueHealthy = mode === "watch_only" || Boolean(refresh?.health?.recommendations_safe);
    const watch = catalogueHealthy
      ? await runSavingsRateWatch(supabase, {
          runKey: request.nextUrl.searchParams.get("run_key") || runKey(),
          runKind: request.nextUrl.searchParams.get("run_kind") || (mode === "watch_only" ? "daily_8am" : "catalogue_then_daily_watch"),
          limit: watchLimit,
          triggeredBy,
          respectTier: false,
        })
      : null;

    const withdrawalsSafe = mode !== "watch_only" && Boolean(refresh?.health?.withdrawals_safe);
    const expire = withdrawalsSafe ? await expireStaleSavingsDeals(supabase, Number(request.nextUrl.searchParams.get("stale_days") || 7), triggeredBy) : null;
    return NextResponse.json({ ok: true, preflight, seed, refresh, watch, watch_skipped: catalogueHealthy ? null : "Catalogue health gate did not pass; existing recommendations were left unchanged.", expire, expiry_skipped: mode !== "watch_only" && !withdrawalsSafe ? "Catalogue health gate did not pass; no products were expired." : null });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Savings rate watch failed" }, { status: 500 });
  } finally {
    if (lockToken) {
      try {
        const supabase = createWorkerDatabaseClient("rates");
        await releaseRatesWorkerLock(supabase, lockToken);
      } catch (error) {
        console.error("[rates-worker] failed to release catalogue lock", error);
      }
    }
  }
}
