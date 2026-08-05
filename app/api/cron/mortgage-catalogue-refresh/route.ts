import { NextRequest, NextResponse } from "next/server";
import { createWorkerDatabaseClient } from "@/platform/database/worker-client";
import { verifyCronRequest } from "@/lib/security/cron";
import { refreshMortgageCatalogueFromSources } from "@/lib/wealth/mortgage-catalogue";
import { acquireRatesWorkerLock, releaseRatesWorkerLock, runRatesWorkerPreflight } from "@/lib/wealth/rates-worker-runtime";

export async function GET(request: NextRequest) {
  const guard = verifyCronRequest(request);
  if (!guard.ok) return guard.response;
  let lockToken: string | null = null;
  try {
    const supabase = createWorkerDatabaseClient("rates");
    const preflight = await runRatesWorkerPreflight(supabase);
    const lock = await acquireRatesWorkerLock(supabase);
    if (!lock.acquired) return NextResponse.json({ ok: true, skipped: true, reason: "Another savings/mortgage catalogue run is still active.", preflight });
    lockToken = lock.token;
    const result = await refreshMortgageCatalogueFromSources(supabase, {
      runKey: request.nextUrl.searchParams.get("run_key") || undefined,
      limit: Number(request.nextUrl.searchParams.get("limit") || 12),
      sourceId: request.nextUrl.searchParams.get("source_id"),
      triggeredBy: `cron:${guard.mode}`,
      publishConfidenceThreshold: Number(request.nextUrl.searchParams.get("publish_confidence") || 95),
      force: request.nextUrl.searchParams.get("force") === "1",
    });
    return NextResponse.json({ ...result, preflight });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Mortgage catalogue refresh failed" }, { status: 500 });
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
