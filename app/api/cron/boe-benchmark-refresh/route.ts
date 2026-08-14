// app/api/cron/boe-benchmark-refresh/route.ts
//
// Monthly refresh of Bank of England mortgage rate benchmarks (BoE publishes once
// a month, so daily/frequent runs would just re-fetch the same figures). Independent
// of the mortgage_rate_deals lender scraper — doesn't need the shared rates-worker
// lock since it touches a different table and a different, low-traffic source.

import { NextRequest, NextResponse } from "next/server";
import { createWorkerDatabaseClient } from "@/platform/database/worker-client";
import { verifyCronRequest } from "@/lib/security/cron";
import { refreshMortgageMarketBenchmarks } from "@/lib/wealth/boe-benchmark-ingestion";

export async function GET(request: NextRequest) {
  const guard = verifyCronRequest(request);
  if (!guard.ok) return guard.response;

  try {
    const supabase = createWorkerDatabaseClient("rates");
    const result = await refreshMortgageMarketBenchmarks(supabase);
    return NextResponse.json({ ok: true, ...result });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "BoE benchmark refresh failed" }, { status: 500 });
  }
}
