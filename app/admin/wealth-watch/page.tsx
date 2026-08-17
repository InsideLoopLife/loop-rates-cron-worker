import type React from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, Banknote, Bot, Clock3, PlayCircle, RefreshCw, Search, ShieldCheck, Trash2 } from "lucide-react";
import { AdminTabs } from "@/components/admin/AdminTabs";
import { createBestAdminClient, getAdminAccess } from "@/lib/admin/access";
import { createWorkerDatabaseClient } from "@/platform/database/worker-client";
import { describeSupabaseAdminKey } from "@/lib/supabase/admin";
import { cronSecretConfigured } from "@/lib/security/cron";
import { defaultWealthWatchSettings, loadWealthWatchSettings } from "@/lib/wealth/watch-settings";
import { checkMortgageSource, checkSavingsSource, expireStaleDealsNow, runMortgageWatchNow, runSavingsWatchNow, saveMortgageRateDeal, saveSavingsRateDeal, saveWealthWatchSettings } from "./actions";

async function safe<T>(promise: PromiseLike<{ data: T | null; error?: any }>, fallback: T): Promise<T> {
  try {
    const result = await promise;
    return result.error ? fallback : (result.data || fallback);
  } catch {
    return fallback;
  }
}

function inputClass() {
  return "w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-950 placeholder:text-slate-400 outline-none ring-orange-500 focus:border-orange-400 focus:ring-2";
}

function smallCard(title: string, value: string | number, tone = "slate") {
  const tones: Record<string, string> = {
    slate: "border-slate-200 bg-white text-slate-950",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-950",
    amber: "border-amber-200 bg-amber-50 text-amber-950",
    red: "border-red-200 bg-red-50 text-red-950",
  };
  return <div className={`rounded-3xl border p-4 ${tones[tone] || tones.slate}`}><p className="text-xs font-black uppercase opacity-60">{title}</p><p className="mt-2 text-3xl font-black">{value}</p></div>;
}

export default async function AdminWealthWatchPage() {
  const access = await getAdminAccess();
  if (!access.user) redirect(`/login?next=${encodeURIComponent("/admin/wealth-watch")}`);
  if (!access.isAdmin) redirect("/admin");

  const adminKeyStatus = describeSupabaseAdminKey();
  const supabase = createBestAdminClient();
  if (!supabase) {
    return (
      <main className="mx-auto max-w-[2000px] space-y-6 px-4 py-8 md:px-6">
        <AdminTabs />
        <section className="rounded-[2rem] border border-amber-300 bg-amber-50 p-8 text-amber-950">
          <h1 className="text-3xl font-black">Wealth Watch needs a server admin key for jobs</h1>
          <p className="mt-2 font-bold leading-6">{adminKeyStatus.reason} Add SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY server-side as a service_role JWT or Supabase <code className="rounded bg-white px-1 py-0.5">sb_secret_</code> key before running admin checks.</p>
        </section>
      </main>
    );
  }

  // savings_rate_deals, mortgage_rate_deals, mortgage_lender_sources and
  // wealth_watch_source_jobs now live in the separate rates-catalogue
  // Supabase project. Runs, recommendations and settings are genuine
  // main-app data and stay on the regular admin client.
  const ratesSupabase = createWorkerDatabaseClient("rates");

  const [settings, savingsRuns, mortgageRuns, savingsDeals, mortgageDeals, lenderSources, savingsRecs, mortgageRecs, sourceJobs] = await Promise.all([
    loadWealthWatchSettings(supabase).catch(() => defaultWealthWatchSettings),
    safe<any[]>(ratesSupabase.from("savings_rate_watch_runs").select("*").order("started_at", { ascending: false }).limit(5), []),
    safe<any[]>(supabase.from("mortgage_renewal_watch_runs").select("*").order("started_at", { ascending: false }).limit(5), []),
    safe<any[]>(ratesSupabase.from("savings_rate_deals").select("*").order("gross_aer", { ascending: false, nullsFirst: false }).limit(20), []),
    safe<any[]>(ratesSupabase.from("mortgage_rate_deals").select("*").order("rate_percent", { ascending: true, nullsFirst: false }).limit(20), []),
    safe<any[]>(ratesSupabase.from("mortgage_lender_sources").select("*").order("updated_at", { ascending: false }).limit(20), []),
    safe<any[]>(ratesSupabase.from("savings_rate_recommendations").select("id,status,created_at,estimated_annual_gain").in("status", ["new", "seen", "watching"]).limit(200), []),
    safe<any[]>(ratesSupabase.from("mortgage_renewal_recommendations").select("id,status,created_at,estimated_monthly_saving").in("status", ["new", "seen", "watching", "saved"]).limit(200), []),
    safe<any[]>(ratesSupabase.from("wealth_watch_source_jobs").select("*").order("created_at", { ascending: false }).limit(8), []),
  ]);

  const activeSavingsDeals = savingsDeals.filter((deal) => deal.status === "active").length;
  const activeMortgageDeals = mortgageDeals.filter((deal) => deal.status === "active").length;
  const cronOk = cronSecretConfigured();

  return (
    <main className="mx-auto max-w-[2000px] space-y-6 px-4 py-8 md:px-6">
      <AdminTabs />

      <section className="rounded-[2rem] bg-slate-950 p-6 text-white">
        <p className="text-xs font-black uppercase tracking-[0.25em] text-orange-300">Admin · Wealth Watch</p>
        <h1 className="mt-2 text-4xl font-black">Savings, mortgage and moving-source jobs</h1>
        <p className="mt-3 max-w-4xl text-sm font-bold text-white/70">Run beta wealth jobs manually, save sourced deals, expire stale rows and review source-ingestion output before users see recommendations.</p>
        <div className="mt-5 flex flex-wrap gap-3">
          <span className={`rounded-full px-4 py-2 text-xs font-black ${cronOk ? "bg-emerald-400 text-emerald-950" : "bg-red-400 text-red-950"}`}>{cronOk ? "CRON_SECRET configured" : "CRON_SECRET missing"}</span>
          <span className="rounded-full bg-white/10 px-4 py-2 text-xs font-black text-white">Savings 08:00 · Mortgage 08:10</span>
          <Link href="/admin/tiers" className="rounded-full bg-white px-4 py-2 text-xs font-black text-slate-950">Check tier gates</Link>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-4">
        {smallCard("Savings deals live", activeSavingsDeals, activeSavingsDeals ? "emerald" : "amber")}
        {smallCard("Mortgage deals live", activeMortgageDeals, activeMortgageDeals ? "emerald" : "amber")}
        {smallCard("Savings recommendations", savingsRecs.length, "slate")}
        {smallCard("Mortgage recommendations", mortgageRecs.length, "slate")}
      </section>

      <section className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <div className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start gap-3"><PlayCircle className="mt-1 h-6 w-6 text-emerald-600" /><div><h2 className="text-2xl font-black">Run jobs now</h2><p className="mt-1 text-sm font-bold text-slate-500">Manual admin runs still respect tier access. Free-tier users are skipped, not written recommendations.</p></div></div>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            <form action={runSavingsWatchNow} className="rounded-3xl bg-emerald-50 p-4">
              <h3 className="font-black text-emerald-950">Savings watch</h3>
              <input name="limit" defaultValue="500" className={`${inputClass()} mt-3`} />
              <button className="mt-3 rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-black text-white">Run savings job</button>
            </form>
            <form action={runMortgageWatchNow} className="rounded-3xl bg-blue-50 p-4">
              <h3 className="font-black text-blue-950">Mortgage watch</h3>
              <input name="limit" defaultValue="250" className={`${inputClass()} mt-3`} />
              <button className="mt-3 rounded-2xl bg-blue-700 px-4 py-3 text-sm font-black text-white">Run mortgage job</button>
            </form>
          </div>
        </div>

        <form action={saveWealthWatchSettings} className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start gap-3"><ShieldCheck className="mt-1 h-6 w-6 text-slate-700" /><div><h2 className="text-2xl font-black">Watch variables</h2><p className="mt-1 text-sm font-bold text-slate-500">These are the admin controls for the scheduled jobs.</p></div></div>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <label><span className="text-xs font-black text-slate-500">Savings min uplift %</span><input name="savings_minimum_rate_delta" defaultValue={settings.savingsMinimumRateDelta} className={inputClass()} /></label>
            <label><span className="text-xs font-black text-slate-500">Savings recs/account</span><input name="savings_max_recommendations_per_account" defaultValue={settings.savingsMaxRecommendationsPerAccount} className={inputClass()} /></label>
            <label><span className="text-xs font-black text-slate-500">Savings stale days</span><input name="savings_stale_days" defaultValue={settings.savingsStaleDays} className={inputClass()} /></label>
            <label><span className="text-xs font-black text-slate-500">Mortgage alert months</span><input name="mortgage_alert_months" defaultValue={settings.mortgageAlertMonths} className={inputClass()} /></label>
            <label><span className="text-xs font-black text-slate-500">Mortgage stale days</span><input name="mortgage_source_freshness_days" defaultValue={settings.mortgageSourceFreshnessDays} className={inputClass()} /></label>
            <label><span className="text-xs font-black text-slate-500">Mortgage recs/deal</span><input name="mortgage_max_recommendations_per_deal" defaultValue={settings.mortgageMaxRecommendationsPerDeal} className={inputClass()} /></label>
          </div>
          <button className="mt-4 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-black text-white">Save variables</button>
        </form>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <form action={checkSavingsSource} className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start gap-3"><Search className="mt-1 h-6 w-6 text-emerald-700" /><div><h2 className="text-2xl font-black">Check savings source</h2><p className="mt-1 text-sm font-bold text-slate-500">Fetch a source URL, extract a draft rate and save it for review.</p></div></div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <input name="provider_name" placeholder="Provider, e.g. Chase" className={inputClass()} />
            <input name="product_name" placeholder="Product name if known" className={inputClass()} />
            <input name="source_url" placeholder="Source URL" className={`${inputClass()} md:col-span-2`} />
          </div>
          <button className="mt-4 rounded-2xl bg-emerald-700 px-5 py-3 text-sm font-black text-white"><Bot className="mr-2 inline h-4 w-4" />Check and save draft</button>
        </form>

        <form action={checkMortgageSource} className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start gap-3"><Search className="mt-1 h-6 w-6 text-blue-700" /><div><h2 className="text-2xl font-black">Check mortgage source</h2><p className="mt-1 text-sm font-bold text-slate-500">Fetch a lender/source URL and save a reviewable mortgage product row.</p></div></div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <input name="lender_name" placeholder="Lender, e.g. NatWest" className={inputClass()} />
            <input name="source_url" placeholder="Source URL" className={inputClass()} />
          </div>
          <button className="mt-4 rounded-2xl bg-blue-700 px-5 py-3 text-sm font-black text-white"><Bot className="mr-2 inline h-4 w-4" />Check and save draft</button>
        </form>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <form action={saveSavingsRateDeal} className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-2xl font-black">Add / update savings deal</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <input name="provider_name" placeholder="Provider" className={inputClass()} />
            <input name="product_name" placeholder="Product" className={inputClass()} />
            <select name="account_type" className={inputClass()}><option value="easy_access">Easy access</option><option value="regular_saver">Regular saver</option><option value="fixed_saver">Fixed saver</option><option value="cash_isa">Cash ISA</option><option value="notice_account">Notice</option></select>
            <input name="gross_aer" placeholder="AER %" className={inputClass()} />
            <input name="monthly_max_deposit" placeholder="Max monthly £" className={inputClass()} />
            <select name="status" className={inputClass()}><option value="active">Active</option><option value="needs_review">Needs review</option><option value="draft">Draft</option><option value="expired">Expired</option></select>
            <label className="rounded-2xl bg-slate-50 p-3 text-sm font-bold"><input type="checkbox" name="requires_existing_customer" className="mr-2" /> Existing customer required</label>
            <input name="eligible_provider_slug" placeholder="Eligibility provider slug" className={inputClass()} />
            <input name="source_url" placeholder="Source URL" className={inputClass()} />
          </div>
          <textarea name="eligibility_note" placeholder="Eligibility notes" className={`${inputClass()} mt-3 min-h-20`} />
          <button className="mt-4 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-black text-white">Save savings deal</button>
        </form>

        <form action={saveMortgageRateDeal} className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-2xl font-black">Add / update mortgage deal</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <input name="lender_name" placeholder="Lender" className={inputClass()} />
            <input name="product_name" placeholder="Product" className={inputClass()} />
            <select name="rate_type" className={inputClass()}><option value="fixed">Fixed</option><option value="tracker">Tracker</option><option value="variable">Variable</option></select>
            <input name="rate_percent" placeholder="Rate %" className={inputClass()} />
            <input name="initial_term_months" placeholder="Initial months" className={inputClass()} />
            <input name="ltv_max" placeholder="Max LTV %" className={inputClass()} />
            <input name="product_fee" placeholder="Fee £" className={inputClass()} />
            <select name="status" className={inputClass()}><option value="active">Active</option><option value="needs_review">Needs review</option><option value="draft">Draft</option><option value="expired">Expired</option></select>
            <label className="rounded-2xl bg-slate-50 p-3 text-sm font-bold"><input type="checkbox" name="existing_customer_only" className="mr-2" /> Existing customer/product transfer</label>
            <input name="source_url" placeholder="Source URL" className={`${inputClass()} md:col-span-3`} />
          </div>
          <button className="mt-4 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-black text-white">Save mortgage deal</button>
        </form>
      </section>

      <form action={expireStaleDealsNow} className="rounded-[2rem] border border-amber-200 bg-amber-50 p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3"><Trash2 className="mt-1 h-6 w-6 text-amber-700" /><div><h2 className="text-2xl font-black text-amber-950">Remove stale live deals</h2><p className="mt-1 text-sm font-bold text-amber-800">This marks old deals as expired so they stop creating recommendations. It does not delete rows.</p></div></div>
          <div className="grid gap-3 md:grid-cols-4">
            <select name="kind" className={inputClass()}><option value="both">Savings + mortgages</option><option value="savings">Savings only</option><option value="mortgage">Mortgage only</option></select>
            <input name="savings_days" defaultValue={settings.savingsStaleDays} className={inputClass()} />
            <input name="mortgage_days" defaultValue={settings.mortgageSourceFreshnessDays} className={inputClass()} />
            <button className="rounded-2xl bg-amber-700 px-5 py-3 text-sm font-black text-white">Expire stale</button>
          </div>
        </div>
      </form>

      <section className="grid gap-6 xl:grid-cols-3">
        <div className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-xl font-black">Recent savings runs</h2>
          <div className="mt-4 space-y-3">{savingsRuns.map((run) => <RunRow key={run.id} run={run} />)}{!savingsRuns.length ? <Empty /> : null}</div>
        </div>
        <div className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-xl font-black">Recent mortgage runs</h2>
          <div className="mt-4 space-y-3">{mortgageRuns.map((run) => <RunRow key={run.id} run={run} mortgage />)}{!mortgageRuns.length ? <Empty /> : null}</div>
        </div>
        <div className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-xl font-black">Recent source jobs</h2>
          <div className="mt-4 space-y-3">{sourceJobs.map((job) => <article key={job.id} className="rounded-2xl bg-slate-50 p-3"><p className="font-black">{job.job_kind}</p><p className="mt-1 truncate text-xs font-bold text-slate-500">{job.source_url}</p><p className="mt-1 text-xs font-black text-slate-400">{job.status} · {job.created_at ? new Date(job.created_at).toLocaleString("en-GB") : ""}</p></article>)}{!sourceJobs.length ? <Empty /> : null}</div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <DealList title="Savings deal library" icon={<Banknote className="h-5 w-5" />} deals={savingsDeals} kind="savings" />
        <DealList title="Mortgage rate library" icon={<RefreshCw className="h-5 w-5" />} deals={mortgageDeals} kind="mortgage" />
      </section>

      <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-xl font-black">Lender/source mapping</h2>
        <p className="mt-1 text-sm font-bold text-slate-500">These rows tell the job where it can look when checking current lender/product-transfer and market sources.</p>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {lenderSources.map((source) => <article key={source.id} className="rounded-2xl bg-slate-50 p-4"><p className="font-black text-slate-950">{source.lender_name}</p><p className="mt-1 text-xs font-bold text-slate-500">{source.source_kind} · {source.status}</p><p className="mt-1 truncate text-xs font-semibold text-slate-400">{source.source_url}</p></article>)}
          {!lenderSources.length ? <p className="text-sm font-bold text-slate-500">No lender sources saved yet. Run a mortgage source check to seed this list.</p> : null}
        </div>
      </section>

      {!cronOk ? <section className="rounded-[2rem] border border-red-200 bg-red-50 p-5 text-red-900"><div className="flex gap-3"><AlertTriangle className="h-6 w-6" /><div><h2 className="text-xl font-black">Add CRON_SECRET before production</h2><p className="mt-1 text-sm font-bold">Set CRON_SECRET in Vercel/Render and keep it server-side. The cron routes will reject production requests without it.</p></div></div></section> : null}
    </main>
  );
}

function Empty() {
  return <p className="rounded-2xl bg-slate-50 p-4 text-sm font-bold text-slate-500">Nothing logged yet.</p>;
}

function RunRow({ run, mortgage = false }: { run: any; mortgage?: boolean }) {
  const count = mortgage ? run.mortgages_checked : run.accounts_checked;
  return <article className="rounded-2xl bg-slate-50 p-3"><div className="flex items-center justify-between gap-3"><p className="font-black text-slate-950">{run.status}</p><Clock3 className="h-4 w-4 text-slate-400" /></div><p className="mt-1 text-xs font-bold text-slate-500">{count || 0} checked · {run.recommendations_created || 0} recommendations</p><p className="mt-1 text-xs font-black text-slate-400">{run.started_at ? new Date(run.started_at).toLocaleString("en-GB") : ""}</p>{run.error ? <p className="mt-1 text-xs font-bold text-red-600">{run.error}</p> : null}</article>;
}

function DealList({ title, icon, deals, kind }: { title: string; icon: React.ReactNode; deals: any[]; kind: "savings" | "mortgage" }) {
  return <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center gap-2"><span className="text-slate-500">{icon}</span><h2 className="text-xl font-black">{title}</h2></div><div className="mt-4 space-y-3">{deals.map((deal) => <article key={deal.id} className="rounded-2xl border border-slate-100 bg-slate-50 p-4"><div className="flex items-start justify-between gap-4"><div><p className="font-black text-slate-950">{kind === "savings" ? deal.provider_name : deal.lender_name}</p><p className="mt-1 text-sm font-bold text-slate-600">{deal.product_name || "Unnamed product"}</p><p className="mt-1 truncate text-xs font-semibold text-slate-400">{deal.source_url || "No source URL"}</p></div><div className="text-right"><p className="rounded-full bg-white px-3 py-1 text-xs font-black text-slate-700 ring-1 ring-slate-200">{deal.status}</p><p className="mt-2 text-2xl font-black text-slate-950">{Number(kind === "savings" ? deal.gross_aer || 0 : deal.rate_percent || 0).toFixed(2)}%</p></div></div></article>)}{!deals.length ? <Empty /> : null}</div></section>;
}
