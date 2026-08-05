import { randomUUID } from "node:crypto";

export const RATES_WORKER_SCHEMA_VERSION = 3;
export const RATES_WORKER_LOCK_KEY = "rates-catalogue";

const requiredSelections = [
  ["savings_rate_sources", "id,consecutive_failures,next_check_at,last_http_status,resolved_url,content_hash,source_etag,source_last_modified,last_product_count,last_parse_success_at"],
  ["mortgage_lender_sources", "id,consecutive_failures,next_check_at,last_http_status,resolved_url,content_hash,source_etag,source_last_modified,last_product_count,last_parse_success_at"],
  ["savings_rate_deals", "id,publishable,review_reasons,raw_payload_hash,missing_observation_count"],
  ["mortgage_rate_deals", "id,external_product_key,missing_observation_count,catalogue_status"],
  ["wealth_watch_source_jobs", "id,status,result_payload"],
] as const;

export async function runRatesWorkerPreflight(supabase: any) {
  const { data: control, error: controlError } = await supabase
    .from("rate_worker_control")
    .select("worker_key,schema_version")
    .eq("worker_key", RATES_WORKER_LOCK_KEY)
    .maybeSingle();
  if (controlError) throw new Error(`Rates worker database migration required: ${controlError.message}`);
  const actualVersion = Number(control?.schema_version || 0);
  if (actualVersion !== RATES_WORKER_SCHEMA_VERSION) {
    throw new Error(`Rates worker schema mismatch: expected ${RATES_WORKER_SCHEMA_VERSION}, found ${actualVersion || "none"}. Apply the rates worker resilience migration before running.`);
  }

  for (const [table, columns] of requiredSelections) {
    const { error } = await supabase.from(table).select(columns).limit(0);
    if (error) throw new Error(`Rates worker schema preflight failed for ${table}: ${error.message}`);
  }
  return { ok: true, schemaVersion: actualVersion, checkedTables: requiredSelections.map(([table]) => table) };
}

export async function acquireRatesWorkerLock(supabase: any, ttlSeconds = 20 * 60) {
  const token = randomUUID();
  const { data, error } = await supabase.rpc("try_acquire_rate_worker_lock", {
    p_worker_key: RATES_WORKER_LOCK_KEY,
    p_lock_token: token,
    p_ttl_seconds: Math.max(60, Math.min(ttlSeconds, 60 * 60)),
  });
  if (error) throw new Error(`Rates worker lock failed: ${error.message}`);
  return { acquired: data === true, token };
}

export async function releaseRatesWorkerLock(supabase: any, token: string) {
  const { error } = await supabase.rpc("release_rate_worker_lock", {
    p_worker_key: RATES_WORKER_LOCK_KEY,
    p_lock_token: token,
  });
  if (error) throw new Error(`Rates worker lock release failed: ${error.message}`);
}

export function catalogueHealth(input: {
  checked: number;
  failed: number;
  parseSuccesses: number;
  accepted: number;
  unchanged: number;
  collapseSources: number;
}) {
  const fetchSuccesses = Math.max(0, input.checked - input.failed);
  const failureRate = input.checked ? input.failed / input.checked : 1;
  const catalogueUsable = input.accepted + input.unchanged > 0;
  const healthy = input.checked > 0 && fetchSuccesses > 0 && failureRate <= 0.7 && input.collapseSources === 0;
  return {
    status: healthy && catalogueUsable ? "healthy" : fetchSuccesses > 0 ? "degraded" : "unhealthy",
    failure_rate_percent: Math.round(failureRate * 100),
    catalogue_usable: catalogueUsable,
    withdrawals_safe: healthy,
    recommendations_safe: healthy && catalogueUsable,
  };
}
