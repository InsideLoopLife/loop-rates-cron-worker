const baseUrl = String(process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");
const secret = String(process.env.CRON_SECRET || process.env.LOOP_CRON_SECRET || "").trim();
if (!baseUrl) throw new Error("APP_BASE_URL is required for the rates worker.");
if (!secret) throw new Error("CRON_SECRET is required for the rates worker.");
const parsedBaseUrl = new URL(baseUrl);
if (parsedBaseUrl.protocol !== "https:" && parsedBaseUrl.hostname !== "localhost") throw new Error("APP_BASE_URL must use HTTPS in production.");
const mode = String(process.env.SAVINGS_WATCH_MODE || "full");
const url = new URL("/api/cron/savings-rate-watch", baseUrl);
url.searchParams.set("mode", mode);
url.searchParams.set("run_kind", process.env.SAVINGS_WATCH_RUN_KIND || "local_daily_8am");
url.searchParams.set("run_key", process.env.SAVINGS_WATCH_RUN_KEY || `savings-rate-watch:${new Intl.DateTimeFormat("en-CA", { timeZone: process.env.SAVINGS_WATCH_TIMEZONE || "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())}`);
if (String(process.env.SAVINGS_WATCH_ENFORCE_LOCAL_HOUR || "").toLowerCase() === "true") url.searchParams.set("enforce_local_hour", "1");

const headers = { authorization: `Bearer ${secret}`, "x-loop-worker-schema": "3" };

try {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(15 * 60 * 1000) });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  if (!response.ok) {
    console.error(JSON.stringify({ ok: false, status: response.status, url: url.toString(), body }, null, 2));
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify({ ok: true, status: response.status, url: url.toString(), body }, null, 2));
  }
} catch (error) {
  console.error(JSON.stringify({ ok: false, url: url.toString(), error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exitCode = 1;
}
