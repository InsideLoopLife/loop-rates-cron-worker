import { SourceFetchError } from "@/lib/wealth/source-ingestion";

export type RateSourceHealthRow = {
  check_frequency_hours?: number | null;
  consecutive_failures?: number | null;
  last_product_count?: number | null;
  content_hash?: string | null;
};

export function isMaterialProductCollapse(previousCount: number | null | undefined, currentCount: number) {
  const previous = Number(previousCount || 0);
  return previous >= 4 && currentCount < Math.ceil(previous * 0.7);
}

export function sourceSuccessPatch(args: {
  source: RateSourceHealthRow;
  now: string;
  fetched: { url: string; httpStatus: number; contentHash: string | null; etag: string | null; lastModified: string | null };
  productCount: number;
  parseSucceeded: boolean;
  contentChanged: boolean;
  resultPayload?: Record<string, unknown>;
}) {
  const nextCheck = new Date(Date.parse(args.now) + Math.max(1, Number(args.source.check_frequency_hours || 12)) * 60 * 60 * 1000).toISOString();
  return {
    last_checked_at: args.now,
    last_success_at: args.now,
    last_parse_success_at: args.parseSucceeded ? args.now : null,
    last_error: null,
    last_http_status: args.fetched.httpStatus,
    last_failure_class: null,
    resolved_url: args.fetched.url,
    content_hash: args.fetched.contentHash || args.source.content_hash || null,
    source_etag: args.fetched.etag,
    source_last_modified: args.fetched.lastModified,
    last_content_changed_at: args.contentChanged ? args.now : undefined,
    last_product_count: args.productCount,
    consecutive_failures: 0,
    next_check_at: nextCheck,
    updated_at: args.now,
    ...(args.resultPayload ? { last_result_payload: args.resultPayload } : {}),
  };
}

export function sourceFailurePatch(source: RateSourceHealthRow, error: unknown, now: string) {
  const failureCount = Math.max(0, Number(source.consecutive_failures || 0)) + 1;
  const sourceError = error instanceof SourceFetchError ? error : null;
  const failureClass = sourceError?.failureClass || "parse_failure";
  const retryHours = sourceError?.retryable === false
    ? Math.min(168, 24 * Math.max(1, failureCount))
    : Math.min(48, [1, 3, 6, 12, 24, 48][Math.min(failureCount - 1, 5)]);
  return {
    last_checked_at: now,
    last_error: error instanceof Error ? error.message : "Source refresh failed",
    last_http_status: sourceError?.httpStatus ?? null,
    last_failure_class: failureClass,
    consecutive_failures: failureCount,
    next_check_at: new Date(Date.parse(now) + retryHours * 60 * 60 * 1000).toISOString(),
    updated_at: now,
  };
}

export function sourceWasUnchanged(source: RateSourceHealthRow, fetched: { notModified: boolean; contentHash: string | null }) {
  return fetched.notModified || Boolean(fetched.contentHash && source.content_hash && fetched.contentHash === source.content_hash);
}
