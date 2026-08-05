"use client";

import { useMemo, useState } from "react";
import { ArrowRight, BadgePoundSterling, CircleAlert, Info, PiggyBank, Sparkles } from "lucide-react";
import { formatMoney } from "@/lib/format/money";

type OptimiserRow = {
  accountId: string;
  accountName: string;
  providerName: string;
  balance: number;
  currentRate: number;
  bestRate: number | null;
  bestProvider: string | null;
  bestProduct: string | null;
  annualGain: number;
  accessSummary: string | null;
  sourceUrl: string | null;
};

type Props = {
  score: number;
  scoreParts: Record<string, number>;
  enabled: boolean;
  rows: OptimiserRow[];
  isaRoom: number;
  nonIsaInterest: number;
  savingsAllowance: number;
  taxableInterest: number;
  savingsTaxRate: number;
  estimatedSavingsTax: number;
  cashToShelter: number;
  monthlyFlow: number;
  monthlyTopUps: number;
  currentWeightedRate: number;
  catalogue: { status: "healthy" | "partial" | "unavailable"; activeDeals: number; completeDeals: number; freshDeals: number; confidence: "high" | "medium" | "low" };
};

const SCORE_MAX: Record<string, number> = {
  rate: 40,
  suitability: 20,
  tax: 15,
  protection: 10,
  goals: 10,
  data: 5,
};

const SCORE_LABEL: Record<string, string> = {
  rate: "Rate competitiveness",
  suitability: "Access & suitability",
  tax: "ISA & tax efficiency",
  protection: "Protection & spread",
  goals: "Goals & regular saving",
  data: "Data quality",
};

function compoundGain(amount: number, currentRate: number, betterRate: number, years: number) {
  const current = amount * Math.pow(1 + Math.max(0, currentRate) / 100, years);
  const better = amount * Math.pow(1 + Math.max(0, betterRate) / 100, years);
  return Math.max(0, better - current);
}

export function SavingsOptimiser({
  score,
  scoreParts,
  enabled,
  rows,
  isaRoom,
  nonIsaInterest,
  savingsAllowance,
  taxableInterest,
  savingsTaxRate,
  estimatedSavingsTax,
  cashToShelter,
  monthlyFlow,
  monthlyTopUps,
  currentWeightedRate,
  catalogue,
}: Props) {
  const actionableRows = rows.filter((row) => row.bestRate != null && row.annualGain > 0.01).sort((a, b) => b.annualGain - a.annualGain);
  const [selectedId, setSelectedId] = useState(actionableRows[0]?.accountId || rows[0]?.accountId || "");
  const selected = rows.find((row) => row.accountId === selectedId) || actionableRows[0] || rows[0] || null;
  const [amount, setAmount] = useState(selected?.balance || 0);
  const [horizon, setHorizon] = useState(1);

  const totalAnnualOpportunity = actionableRows.reduce((sum, row) => sum + row.annualGain, 0);
  const availableMonthlyCapacity = Math.max(0, monthlyFlow - monthlyTopUps);
  const selectedGain = useMemo(() => selected?.bestRate != null
    ? compoundGain(Math.min(amount, selected.balance), selected.currentRate, selected.bestRate, horizon)
    : 0, [amount, horizon, selected]);

  function chooseAccount(row: OptimiserRow) {
    setSelectedId(row.accountId);
    setAmount(row.balance);
  }

  const priorityActions = [
    taxableInterest > 0 ? {
      title: "Protect interest from tax",
      body: `${formatMoney(taxableInterest)}/yr is above the estimated allowance. Moving roughly ${formatMoney(cashToShelter)} into available ISA shelter would offset that excess at the current taxable blended rate.`,
      metric: `Save ~${formatMoney(estimatedSavingsTax)}/yr`,
    } : null,
    actionableRows[0] ? {
      title: `Review ${actionableRows[0].providerName} · ${actionableRows[0].accountName}`,
      body: `${actionableRows[0].currentRate.toFixed(2)}% to ${actionableRows[0].bestRate?.toFixed(2)}% could add about ${formatMoney(actionableRows[0].annualGain)}/yr before tax, subject to eligibility and access rules.`,
      metric: `+${formatMoney(actionableRows[0].annualGain)}/yr`,
    } : null,
    availableMonthlyCapacity > 0 ? {
      title: "Allocate unused monthly capacity",
      body: `Financial Flow suggests up to ${formatMoney(availableMonthlyCapacity)}/mo remains after current savings top-ups. Confirm it is genuinely spare before assigning it to a pot or ISA.`,
      metric: `${formatMoney(availableMonthlyCapacity)}/mo`,
    } : null,
  ].filter((row): row is { title: string; body: string; metric: string } => Boolean(row));

  return (
    <div className="grid gap-5 xl:grid-cols-[340px_1fr]">
      <aside className="rounded-[2rem] border border-slate-200 bg-slate-950 p-6 text-white shadow-xl">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-200">Savings Health Score</p>
        <p className="mt-4 text-6xl font-black">{score}<span className="text-2xl text-white/50">/100</span></p>
        <p className="mt-2 text-sm font-bold text-white/65">{catalogue.confidence[0].toUpperCase() + catalogue.confidence.slice(1)} confidence · {enabled ? "automation and alerts enabled" : "basic matching active; automation and alerts optional"}.</p>
        <div className="mt-5 space-y-2 text-sm font-bold">
          {Object.entries(scoreParts).map(([key, value]) => (
            <div key={key} className="rounded-2xl bg-white/10 px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <span>{SCORE_LABEL[key] || key}</span><span>{Math.round(Number(value))}/{SCORE_MAX[key] || 20}</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-emerald-300" style={{ width: `${Math.min(100, Number(value) / (SCORE_MAX[key] || 20) * 100)}%` }} /></div>
            </div>
          ))}
        </div>
        <p className="mt-5 inline-flex items-center gap-2 border-t border-white/10 pt-4 text-xs font-bold text-white/55"><Info className="h-4 w-4" />The score uses five evidence groups shown above. It is not a credit score or suitability decision.</p>
      </aside>

      <div className="space-y-5">
        <section className="overflow-hidden rounded-[2rem] border border-orange-200 bg-gradient-to-br from-orange-50 via-white to-emerald-50 p-6 shadow-sm">
          <div className="grid gap-5 lg:grid-cols-[1fr_320px] lg:items-center">
            <div>
              <p className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-[0.18em] text-orange-700"><Sparkles className="h-4 w-4" /> Opportunity cost</p>
              <h3 className="mt-2 text-3xl font-black text-slate-950">{catalogue.status === "healthy" ? `Potentially ${formatMoney(totalAnnualOpportunity)}/year not being maximised` : "Market check incomplete"}</h3>
              <p className="mt-2 max-w-3xl text-sm font-bold text-slate-600">{catalogue.status === "healthy" ? "Each account is compared only with reviewed products that broadly match its type, balance limits, access and known provider eligibility. The figure is an evidence-led comparison, not a recommendation to move." : `Only ${catalogue.activeDeals} active products are available, with ${catalogue.completeDeals} carrying enough access and limit evidence. LOOP will not present £0 as proof that no better option exists.`}</p>
            </div>
            <div className="rounded-3xl bg-white/80 px-5 py-4 ring-1 ring-white">
              <p className="text-xs font-black uppercase tracking-wide text-slate-400">Current blended rate</p>
              <p className="mt-1 text-3xl font-black text-slate-950">{currentWeightedRate.toFixed(2)}%</p>
              <p className="mt-2 text-xs font-bold leading-5 text-slate-500">This is the balance-weighted average across the whole tracked savings portfolio. It will differ from the selected account rate below whenever accounts have different balances or rates.</p>
            </div>
          </div>
        </section>

        <div className="grid gap-3 md:grid-cols-3">
          <article className={`rounded-3xl border p-4 ${taxableInterest > 0 ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50"}`}>
            <div className="flex items-center gap-2"><CircleAlert className="h-5 w-5" /><p className="text-xs font-black uppercase tracking-wide">Interest tax check</p></div>
            <div className="mt-3 space-y-1.5 text-sm font-bold text-slate-700">
              <div className="flex justify-between gap-3"><span>Personal Savings Allowance</span><span className="text-slate-950">{formatMoney(savingsAllowance)}/yr</span></div>
              <div className="flex justify-between gap-3"><span>Estimated non-ISA interest</span><span className="text-slate-950">{formatMoney(nonIsaInterest)}/yr</span></div>
              <div className="flex justify-between gap-3 border-t border-amber-200 pt-2"><span>Taxable excess</span><span className="font-black text-orange-700">{formatMoney(taxableInterest)}/yr</span></div>
            </div>
            {taxableInterest > 0 ? <p className="mt-3 rounded-2xl bg-white/70 p-3 text-xs font-black text-orange-800">Estimated tax: {formatMoney(taxableInterest)} × {savingsTaxRate}% = {formatMoney(estimatedSavingsTax)}/yr. Shelter roughly {formatMoney(cashToShelter)} in available ISA room at the current taxable rate to offset the excess.</p> : <p className="mt-3 text-xs font-bold text-emerald-800">Estimated interest remains within the allowance.</p>}
            <p className="mt-2 text-[11px] font-bold text-slate-500">Remaining ISA room: {formatMoney(isaRoom)}.</p>
          </article>
          <article className="rounded-3xl border border-blue-200 bg-blue-50 p-4">
            <div className="flex items-center gap-2"><PiggyBank className="h-5 w-5" /><p className="text-xs font-black uppercase tracking-wide">Financial Flow</p></div>
            <p className="mt-2 text-2xl font-black text-slate-950">{formatMoney(availableMonthlyCapacity)}/mo</p>
            <p className="mt-1 text-xs font-bold text-slate-600">Potential capacity after current savings top-ups. Flow before those top-ups is {formatMoney(monthlyFlow)}/mo; existing top-ups are {formatMoney(monthlyTopUps)}/mo.</p>
          </article>
          <article className="rounded-3xl border border-emerald-200 bg-emerald-50 p-4">
            <div className="flex items-center gap-2"><BadgePoundSterling className="h-5 w-5" /><p className="text-xs font-black uppercase tracking-wide">Rate actions</p></div>
            <p className="mt-2 text-2xl font-black text-slate-950">{actionableRows.length}</p>
            <p className="mt-1 text-xs font-bold text-slate-600">Tracked account{actionableRows.length === 1 ? "" : "s"} with a positive, compatible, reviewed rate opportunity in the current catalogue.</p>
          </article>
        </div>

        {selected ? (
          <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">Interactive gain modeller</p>
                <h3 className="mt-1 text-2xl font-black text-slate-950">What would improving one account change?</h3>
                <p className="mt-1 text-sm font-bold text-slate-500">Choose an account, set how much of its balance you are considering and select a time horizon. The slider never moves money.</p>
              </div>
              <select
                value={selected.accountId}
                onChange={(event) => {
                  const row = rows.find((item) => item.accountId === event.target.value);
                  if (row) chooseAccount(row);
                }}
                className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-950"
              >
                {rows.map((row) => <option key={row.accountId} value={row.accountId}>{row.providerName} · {row.accountName}</option>)}
              </select>
            </div>

            <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_0.75fr]">
              <div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-3xl bg-slate-50 p-4"><p className="text-xs font-black uppercase tracking-wide text-slate-400">Current rate · this account</p><p className="mt-1 text-xl font-black text-slate-950">{selected.currentRate.toFixed(2)}%</p></div>
                  <div className="rounded-3xl bg-emerald-50 p-4"><p className="text-xs font-black uppercase tracking-wide text-emerald-700">Best compatible eligible rate</p><p className="mt-1 text-xl font-black text-slate-950">{selected.bestRate != null ? `${selected.bestRate.toFixed(2)}%` : "No match"}</p></div>
                  <div className="rounded-3xl bg-orange-50 p-4"><p className="text-xs font-black uppercase tracking-wide text-orange-700">Modelled gain · {horizon}y</p><p className="mt-1 text-xl font-black text-slate-950">{formatMoney(selectedGain)}</p></div>
                </div>

                <label className="mt-5 block text-xs font-black uppercase tracking-wide text-slate-500">
                  Amount to compare: {formatMoney(Math.min(amount, selected.balance))}
                  <span className="mt-1 block normal-case tracking-normal text-slate-400">Move the control between £0 and this account&apos;s estimated balance of {formatMoney(selected.balance)}.</span>
                  <input type="range" min={0} max={Math.max(1, Math.round(selected.balance))} step={Math.max(1, Math.round(selected.balance / 100))} value={Math.min(amount, selected.balance)} onChange={(event) => setAmount(Number(event.target.value))} className="mt-3 w-full accent-blue-600" />
                </label>
                <div className="mt-4 flex flex-wrap gap-2">
                  {[1, 3, 5].map((years) => <button type="button" key={years} onClick={() => setHorizon(years)} className={`rounded-full px-4 py-2 text-xs font-black ${horizon === years ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-700"}`}>{years} year{years === 1 ? "" : "s"}</button>)}
                </div>
                <p className="mt-4 rounded-2xl bg-blue-50 p-3 text-xs font-bold text-blue-900">Portfolio blended rate: {currentWeightedRate.toFixed(2)}%. Selected account rate: {selected.currentRate.toFixed(2)}%. These answer different questions and should not be expected to match.</p>
              </div>

              <div className="rounded-3xl bg-slate-950 p-5 text-white">
                <p className="text-xs font-black uppercase tracking-wide text-white/50">Suggested focus</p>
                <p className="mt-2 text-xl font-black">{selected.bestProvider && selected.bestProduct ? `${selected.bestProvider} · ${selected.bestProduct}` : "No compatible eligible deal logged"}</p>
                <p className="mt-3 text-sm font-bold text-white/65">{selected.accessSummary || "No reviewed product currently passes the broad account-type, rate, balance and provider checks. Keep the rate watch running rather than forcing an unsuitable comparison."}</p>
                {selected.sourceUrl ? <a href={selected.sourceUrl} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-xs font-black text-slate-950">Review source <ArrowRight className="h-4 w-4" /></a> : null}
              </div>
            </div>
          </section>
        ) : (
          <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm font-bold text-slate-500">Add a tracked savings account and at least one reviewed savings deal to unlock account-level opportunity modelling.</div>
        )}

        <section>
          <div className="flex items-end justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">Priority order</p><h3 className="mt-1 text-xl font-black text-slate-950">What LOOP would focus on first</h3></div></div>
          <div className="mt-3 grid gap-3 lg:grid-cols-3">
            {priorityActions.slice(0, 3).map((action, index) => (
              <article key={action.title} className="rounded-3xl border border-emerald-100 bg-emerald-50/70 p-4">
                <div className="flex items-start gap-3"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-emerald-600 text-xs font-black text-white">{index + 1}</span><div><p className="text-sm font-black text-slate-950">{action.title}</p><p className="mt-1 text-xs font-bold leading-5 text-slate-600">{action.body}</p><p className="mt-2 text-xs font-black text-emerald-800">{action.metric}</p></div></div>
              </article>
            ))}
            {priorityActions.length === 0 ? <div className="rounded-3xl border border-dashed border-emerald-200 bg-emerald-50 p-5 text-sm font-bold text-emerald-900 lg:col-span-3">No positive rate gap, tax excess or unused flow capacity is currently evidenced by the data held in LOOP.</div> : null}
          </div>
        </section>
      </div>
    </div>
  );
}
