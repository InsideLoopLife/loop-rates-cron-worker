import type React from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Banknote, Bot, RefreshCw, Settings, ShieldCheck, Trash2 } from "lucide-react";
import { AdminTabs } from "@/components/admin/AdminTabs";
import { createBestAdminClient, getAdminAccess } from "@/lib/admin/access";
import { createWorkerDatabaseClient } from "@/platform/database/worker-client";
import { checkSavingsSource, expireStaleDealsNow, runSavingsWatchNow } from "../wealth-watch/actions";
import { runSavingsCatalogueAndWatchNow, runSavingsCatalogueRefreshNow, seedDefaultSavingsAndMortgageSourcesNow } from "./actions";

async function safe<T>(promise: PromiseLike<{ data: T | null; error?: any }>, fallback: T): Promise<T> {
  try {
    const result = await promise;
    return result.error ? fallback : (result.data || fallback);
  } catch {
    return fallback;
  }
}

export default async function AdminSavingsPage() {
  const access = await getAdminAccess();
  if (!access.user) redirect(`/login?next=${encodeURIComponent("/admin/savings")}`);
  if (!access.isAdmin) redirect("/admin");
  const supabase = createBestAdminClient();
  const ratesSupabase = createWorkerDatabaseClient("rates");
  const [deals, recs, runs, sources] = supabase ? await Promise.all([
    safe<any[]>(ratesSupabase.from("savings_rate_deals").select("id,status,last_checked_at,provider_name,product_name,gross_aer,access_type,withdrawal_rules,notice_period_days,term_length_months,source_url,confidence").order("gross_aer", { ascending: false, nullsFirst: false }).limit(5000), []),
    safe<any[]>(ratesSupabase.from("savings_rate_recommendations").select("id,status,started_at,finished_at,recommendations_created,accounts_checked,error").in("status", ["new", "seen", "watching"]).limit(5000), []),
    safe<any[]>(ratesSupabase.from("savings_rate_watch_runs").select("id,status,started_at,finished_at,recommendations_created,accounts_checked,error").order("started_at", { ascending: false }).limit(10), []),
    safe<any[]>(ratesSupabase.from("savings_rate_sources").select("id,status,provider_name,product_hint,source_url,last_checked_at,last_error").order("last_checked_at", { ascending: false, nullsFirst: false }).limit(5000), []),
  ]) : [[], [], [], []];
  const active = deals.filter((deal) => deal.status === "active").length;
  const review = deals.filter((deal) => deal.status === "needs_review").length;
  const lastRun = runs[0];
  const topDeals = deals.filter((deal) => deal.status === "active").slice(0, 8);
  const recentSources = sources.slice(0, 8);

  return (
    <main className="mx-auto max-w-[2000px] space-y-6 px-4 py-8 md:px-6">
      <AdminTabs />
      <section className="rounded-[2rem] bg-slate-950 p-6 text-white">
        <p className="text-xs font-black uppercase tracking-[0.25em] text-emerald-300">Admin · Savings</p>
        <h1 className="mt-2 text-4xl font-black">Savings admin</h1>
        <p className="mt-3 max-w-4xl text-sm font-bold text-white/70">Savings deal catalogue, source checks, surplus optimiser and daily savings-rate watch are grouped here. Right now use the one-click run to seed/refresh/check recommendations; cron can call the same route once this is stable.</p>
      </section>
      <section className="grid gap-4 md:grid-cols-5"><Stat label="Active deals" value={active} /><Stat label="Needs review" value={review} /><Stat label="Source pages" value={sources.length} /><Stat label="Open recommendations" value={recs.length} /><Stat label="Recent runs" value={runs.length} /></section>
      <section className="rounded-[2rem] border border-orange-200 bg-orange-50 p-5 shadow-sm">
        <div className="grid gap-5 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-orange-700">One click for now</p>
            <h2 className="mt-1 text-2xl font-black text-slate-950">Run full savings optimiser</h2>
            <p className="mt-1 text-sm font-bold leading-6 text-slate-600">This seeds missing UK savings sources, refreshes stale public pages, extracts rate/access/withdrawal fields into deal rows, compares the deals to user accounts and writes recommendations. Later the cron should call this same pipeline.</p>
            {lastRun ? <p className="mt-2 text-xs font-black text-slate-500">Last watch run: {lastRun.status || "unknown"} · {lastRun.started_at || "not dated"}</p> : null}
          </div>
          <form action={runSavingsCatalogueAndWatchNow} className="flex flex-wrap gap-2">
            <input type="hidden" name="limit" value="40" />
            <input type="hidden" name="freshness_hours" value="12" />
            <input type="hidden" name="stale_days" value="7" />
            <button className="rounded-2xl bg-orange-600 px-6 py-4 text-sm font-black text-white shadow-lg shadow-orange-500/20">Run source check + user recommendations</button>
          </form>
        </div>
      </section>
      <section className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <div className="rounded-[2rem] border border-blue-200 bg-blue-50 p-5 shadow-sm">
          <div className="flex items-start gap-3"><Bot className="mt-1 h-6 w-6 text-blue-700" /><div><h2 className="text-2xl font-black text-slate-950">AI savings source check</h2><p className="mt-1 text-sm font-bold leading-6 text-slate-600">Paste a public savings-rate source. LOOP extracts the rate/product into a reviewable row. Once active, the savings watch compares it against user accounts and eligibility.</p></div></div>
          <form action={checkSavingsSource} className="mt-5 grid gap-3 md:grid-cols-2">
            <label><span className="text-xs font-black uppercase text-slate-600">Provider</span><input name="provider_name" placeholder="e.g. Nationwide, Revolut, Coventry" className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold outline-none ring-orange-500 focus:ring-2" /></label>
            <label><span className="text-xs font-black uppercase text-slate-600">Product hint</span><input name="product_name" placeholder="Easy access, regular saver, Cash ISA" className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold outline-none ring-orange-500 focus:ring-2" /></label>
            <label className="md:col-span-2"><span className="text-xs font-black uppercase text-slate-600">Source URL</span><input name="source_url" type="url" placeholder="https://www.provider.co.uk/savings/..." className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold outline-none ring-orange-500 focus:ring-2" /></label>
            <button className="rounded-2xl bg-blue-600 px-5 py-3 text-sm font-black text-white md:col-span-2">Check source + stage deal</button>
          </form>
        </div>
        <div className="rounded-[2rem] border border-emerald-200 bg-emerald-50 p-5 shadow-sm">
          <div className="flex items-start gap-3"><RefreshCw className="mt-1 h-6 w-6 text-emerald-700" /><div><h2 className="text-2xl font-black text-slate-950">Automated savings jobs</h2><p className="mt-1 text-sm font-bold leading-6 text-slate-600">Seed a broad UK source universe, refresh due pages only when stale, then run recommendations. User optimise actions can trigger this same pipeline when the cache is older than 12 hours.</p></div></div>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            <form action={seedDefaultSavingsAndMortgageSourcesNow} className="rounded-3xl bg-white p-4 shadow-sm"><h3 className="font-black text-slate-950">Seed UK sources</h3><p className="mt-1 text-xs font-bold text-slate-500">Adds an extensive set of UK savings and mortgage source pages so admin does not enter them one by one.</p><button className="mt-3 rounded-2xl bg-blue-600 px-5 py-3 text-sm font-black text-white">Seed source universe</button></form>
            <form action={runSavingsCatalogueRefreshNow} className="rounded-3xl bg-white p-4 shadow-sm"><input type="hidden" name="limit" value="30" /><input type="hidden" name="freshness_hours" value="12" /><h3 className="font-black text-slate-950">Refresh source catalogue</h3><p className="mt-1 text-xs font-bold text-slate-500">Checks due public source pages and stages or publishes high-confidence rows.</p><button className="mt-3 rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-black text-white">Refresh due sources</button></form>
            <form action={runSavingsCatalogueAndWatchNow} className="rounded-3xl bg-white p-4 shadow-sm"><input type="hidden" name="limit" value="30" /><input type="hidden" name="freshness_hours" value="12" /><h3 className="font-black text-slate-950">Optimise pipeline</h3><p className="mt-1 text-xs font-bold text-slate-500">Refreshes stale catalogue rows, runs recommendations, then expires stale deals.</p><button className="mt-3 rounded-2xl bg-emerald-700 px-5 py-3 text-sm font-black text-white">Run optimise pipeline</button></form>
            <form action={expireStaleDealsNow} className="rounded-3xl bg-white p-4 shadow-sm"><input type="hidden" name="kind" value="savings" /><input type="hidden" name="savings_stale_days" value="7" /><h3 className="font-black text-slate-950">Expire stale rows</h3><p className="mt-1 text-xs font-bold text-slate-500">Marks savings products stale/expired when they are no longer seen by source jobs.</p><button className="mt-3 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-black text-white"><Trash2 className="mr-2 inline h-4 w-4" />Expire stale</button></form>
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <div className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-2xl font-black text-slate-950">Top active savings rates shown to users</h2>
          <p className="mt-1 text-sm font-bold text-slate-500">These are the live rows users will see in Better-rate watch, including access/withdrawal fields where the source extraction found them.</p>
          <div className="mt-4 space-y-3">
            {topDeals.map((deal) => (
              <article key={deal.id} className="rounded-3xl border border-slate-100 bg-slate-50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-black uppercase tracking-wide text-emerald-700">{deal.provider_name || "Provider"}</p>
                    <h3 className="text-lg font-black text-slate-950">{deal.product_name || "Savings product"}</h3>
                  </div>
                  <span className="rounded-full bg-white px-3 py-1 text-sm font-black text-slate-950">{deal.gross_aer != null ? `${Number(deal.gross_aer).toFixed(2)}%` : "TBC"}</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-xs font-black text-slate-600">
                  <span className="rounded-full bg-white px-3 py-1">{String(deal.access_type || "access unknown").replaceAll("_", " ")}</span>
                  {deal.notice_period_days ? <span className="rounded-full bg-white px-3 py-1">{deal.notice_period_days} days notice</span> : null}
                  {deal.term_length_months ? <span className="rounded-full bg-white px-3 py-1">{deal.term_length_months} months</span> : null}
                  {deal.confidence ? <span className="rounded-full bg-white px-3 py-1">{deal.confidence}% confidence</span> : null}
                </div>
                {deal.withdrawal_rules ? <p className="mt-3 text-xs font-bold text-slate-500">{deal.withdrawal_rules}</p> : null}
              </article>
            ))}
            {topDeals.length === 0 ? <p className="rounded-3xl border border-dashed border-slate-300 p-5 text-sm font-bold text-slate-500">No active savings rows yet. Run the one-click pipeline or paste a specific source URL above.</p> : null}
          </div>
        </div>
        <div className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-2xl font-black text-slate-950">Recent source checks</h2>
          <p className="mt-1 text-sm font-bold text-slate-500">Use this to see whether a provider page has been checked, failed, or is waiting for refresh.</p>
          <div className="mt-4 space-y-3">
            {recentSources.map((source) => (
              <article key={source.id} className="rounded-3xl border border-slate-100 bg-slate-50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-black uppercase tracking-wide text-slate-500">{source.status || "source"}</p>
                    <h3 className="text-lg font-black text-slate-950">{source.provider_name || "Provider"}</h3>
                    <p className="text-sm font-bold text-slate-500">{source.product_hint || "General savings page"}</p>
                  </div>
                  <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-slate-600">{source.last_checked_at ? "checked" : "pending"}</span>
                </div>
                {source.last_error ? <p className="mt-3 rounded-2xl bg-red-50 p-3 text-xs font-bold text-red-700">{source.last_error}</p> : null}
              </article>
            ))}
          </div>
        </div>
      </section>
      <section className="grid gap-6 md:grid-cols-3">
        <AdminCard href="/admin/wealth-watch" icon={<RefreshCw className="h-6 w-6" />} title="Full wealth watch" body="Advanced savings/mortgage settings and manual deal library." />
        <AdminCard href="/admin/tiers" icon={<ShieldCheck className="h-6 w-6" />} title="Tier gates" body="Control who can see savings watch and surplus optimiser features." />
        <AdminCard href="/accounts" icon={<Banknote className="h-6 w-6" />} title="User savings page" body="Review the user-facing savings/account logic." />
        <AdminCard href="/admin/future-integrations" icon={<Settings className="h-6 w-6" />} title="Future setup" body="Provider setup, premium features and launch checklists." />
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-xs font-black uppercase tracking-wide text-slate-500">{label}</p><p className="mt-2 text-3xl font-black text-slate-950">{value}</p></div>;
}

function AdminCard({ href, icon, title, body }: { href: string; icon: React.ReactNode; title: string; body: string }) {
  return <Link href={href} className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg"><span className="text-slate-600">{icon}</span><h2 className="mt-4 text-2xl font-black text-slate-950">{title}</h2><p className="mt-2 text-sm font-bold leading-6 text-slate-500">{body}</p></Link>;
}
