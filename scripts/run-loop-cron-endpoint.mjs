const baseUrl = String(process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");
const endpoint = String(process.env.LOOP_CRON_ENDPOINT || "").trim();
const secret = String(process.env.CRON_SECRET || process.env.LOOP_CRON_SECRET || "").trim();
if (!baseUrl) throw new Error("APP_BASE_URL is required");
if (!secret) throw new Error("CRON_SECRET is required");
const parsedBaseUrl = new URL(baseUrl);
if (parsedBaseUrl.protocol !== "https:" && parsedBaseUrl.hostname !== "localhost") throw new Error("APP_BASE_URL must use HTTPS in production");
if (!endpoint.startsWith("/api/cron/")) throw new Error("LOOP_CRON_ENDPOINT must start with /api/cron/");
const url = new URL(endpoint, baseUrl);
for (const [key, value] of Object.entries(process.env)) {
  if (key.startsWith("LOOP_CRON_QUERY_") && value) url.searchParams.set(key.slice(16).toLowerCase(), value);
}
const response = await fetch(url, {
  headers: { authorization: `Bearer ${secret}`, "x-loop-worker-schema": "3" },
  signal: AbortSignal.timeout(Number(process.env.LOOP_CRON_TIMEOUT_MS || 900000)),
});
const text = await response.text();
let body;
try { body = JSON.parse(text); } catch { body = { raw: text }; }
console.log(JSON.stringify({ ok: response.ok, status: response.status, endpoint, body }, null, 2));
if (!response.ok) process.exitCode = 1;
