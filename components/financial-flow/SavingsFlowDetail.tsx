"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CalendarDays, ChevronRight, CirclePlus, PiggyBank, Target, TrendingUp, WalletCards, X } from "lucide-react";
import { CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatMoney } from "@/lib/format/money";
import { FinancialInstitutionLogo } from "@/components/savings/FinancialInstitutionLogo";
import { PiggyPotVisual } from "@/components/savings/PiggyPotVisual";

export type SavingsFlowAccountRow = {
  id: string;
  name: string;
  provider: string;
  balance: number;
  savedThisMonth: number;
  interestRate: number;
  maximisedScore: number;
  annualOpportunity: number;
  endDate: string | null;
  providerSlug?: string | null;
};

export type SavingsFlowPotRow = {
  id: string;
  name: string;
  allocated: number;
  target: number;
  progress: number;
  thisMonthAmount: number;
  thisMonthProgress: number;
  score: number;
};

export type SavingsFlowTrendPoint = {
  label: string;
  balance: number;
  kind: "recorded" | "projected";
};

export type SavingsFlowYearMonth = {
  key: string;
  savedIn: number;
  withdrawn: number;
  interestConfirmed: number;
  interestEstimated: number;
  closingBalance: number;
};

type Props = {
  monthKey: string;
  scopeSavingsPercent: number;
  scopeSavingsLabel: string;
  blendedRate: number;
  providerConfirmedInterest: number;
  accruedThroughYesterday: number;
  estimatedInterest: number;
  unassignedEquity: number;
  totalSavings: number;
  earmarkedToPots: number;
  accounts: SavingsFlowAccountRow[];
  pots: SavingsFlowPotRow[];
  trend: SavingsFlowTrendPoint[];
  yearMonths: SavingsFlowYearMonth[];
  healthScore: number;
  marketStatus: "healthy" | "partial" | "unavailable";
  annualOpportunity: number;
};

function clamp(value: number, max = 100) {
  return Math.max(0, Math.min(max, Number.isFinite(value) ? value : 0));
}

function scoreClass(score: number) {
  if (score >= 80) return "bg-emerald-100 text-emerald-800";
  if (score >= 55) return "bg-amber-100 text-amber-800";
  return "bg-red-100 text-red-700";
}

function shortMonth(key: string) {
  const [year, month] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { month: "short" }).format(new Date(year, month - 1, 1));
}

function longMonth(key: string) {
  const [year, month] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" }).format(new Date(year, month - 1, 1));
}

function CalendarBars({ row, active = false }: { row: SavingsFlowYearMonth; active?: boolean }) {
  const interest = row.interestConfirmed + row.interestEstimated;
  const max = Math.max(1, row.savedIn, row.withdrawn, interest);
  return (
    <div className={`rounded-2xl border p-3 ${active ? "border-orange-300 bg-orange-50" : "border-slate-100 bg-white"}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-black text-slate-950">{shortMonth(row.key)}</p>
        <p className="text-[10px] font-black text-slate-500">{formatMoney(row.closingBalance)}</p>
      </div>
      <div className="mt-3 grid gap-1" title={`${formatMoney(row.savedIn)} saved · ${formatMoney(row.withdrawn)} withdrawn · ${formatMoney(interest)} interest`}>
        <div className="h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-400" style={{ width: `${clamp(row.savedIn / max * 100)}%` }} /></div>
        <div className="h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-orange-400" style={{ width: `${clamp(row.withdrawn / max * 100)}%` }} /></div>
        <div className="h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-sky-400" style={{ width: `${clamp(interest / max * 100)}%` }} /></div>
      </div>
    </div>
  );
}

export function SavingsFlowDetail({
  monthKey,
  scopeSavingsPercent,
  scopeSavingsLabel,
  blendedRate,
  providerConfirmedInterest,
  accruedThroughYesterday,
  estimatedInterest,
  unassignedEquity,
  totalSavings,
  earmarkedToPots,
  accounts,
  pots,
  trend,
  yearMonths,
  healthScore,
  marketStatus,
  annualOpportunity,
}: Props) {
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const currentMonth = yearMonths.find((row) => row.key === monthKey) || yearMonths[0];
  const unallocated = Math.max(0, totalSavings - earmarkedToPots);
  const chartData = useMemo(() => {
    let lastRecorded: number | null = null;
    return trend.map((point, index) => {
      if (point.kind === "recorded") lastRecorded = point.balance;
      const previous = index > 0 ? trend[index - 1] : null;
      return {
        ...point,
        recorded: point.kind === "recorded" ? point.balance : null,
        projected: point.kind === "projected" ? point.balance : previous?.kind === "recorded" ? lastRecorded : null,
      };
    });
  }, [trend]);
  const allocationData = useMemo(() => [
    { name: "Earmarked to pots", value: Math.min(totalSavings, earmarkedToPots), colour: "#8b5cf6" },
    { name: "Unassigned savings", value: unallocated, colour: "#10b981" },
  ].filter((row) => row.value > 0.005), [earmarkedToPots, totalSavings, unallocated]);
  const totalInterest = providerConfirmedInterest + accruedThroughYesterday + estimatedInterest;

  return (
    <div className="space-y-6">
      <section className={`flex flex-wrap items-center justify-between gap-5 rounded-[2rem] border p-5 shadow-sm ${marketStatus === "healthy" ? "border-emerald-200 bg-gradient-to-r from-emerald-50 to-white" : "border-amber-200 bg-gradient-to-r from-amber-50 to-white"}`}>
        <div className="flex items-center gap-4">
          <div className="grid h-20 w-20 shrink-0 place-items-center rounded-full bg-slate-950 text-white"><span className="text-2xl font-black">{healthScore}</span><span className="-mt-5 text-[10px] font-black text-white/50">/100</span></div>
          <div><p className="text-xs font-black uppercase tracking-[0.16em] text-emerald-700">Savings Health Score</p><h2 className="mt-1 text-2xl font-black text-slate-950">{marketStatus === "healthy" ? `${formatMoney(annualOpportunity)}/yr estimated rate opportunity` : "Market comparison is incomplete"}</h2><p className="mt-1 text-sm font-semibold text-slate-600">{marketStatus === "healthy" ? "Based on rates, access fit, tax efficiency, protection spread, goals and data quality." : "LOOP will not show £0 as no opportunity until enough fresh, reviewed savings products are available."}</p></div>
        </div>
        <Link href="/accounts?tab=ai" className="rounded-full bg-slate-950 px-5 py-3 text-sm font-black text-white">See score and actions</Link>
      </section>
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1fr_1fr_1.2fr_1fr_1.25fr_auto]">
        <article className="rounded-[2rem] border border-white/70 bg-white/90 p-5 shadow-sm">
          <p className="text-sm font-bold text-slate-500">Savings % of {scopeSavingsLabel}</p>
          <div className="mt-2 flex items-center justify-between"><p className="text-3xl font-black text-slate-950">{Math.round(scopeSavingsPercent)}%</p><span className="grid h-11 w-11 place-items-center rounded-2xl bg-emerald-50 text-emerald-700"><Target className="h-5 w-5" /></span></div>
          <p className={`mt-1 text-sm font-black ${scopeSavingsPercent >= 20 ? "text-emerald-700" : "text-amber-700"}`}>{scopeSavingsPercent >= 20 ? "Above 20% target" : "Below 20% target"}</p>
        </article>
        <article className="rounded-[2rem] border border-white/70 bg-white/90 p-5 shadow-sm"><p className="text-sm font-bold text-slate-500">Blended savings rate</p><div className="mt-2 flex items-center justify-between"><p className="text-3xl font-black text-slate-950">{blendedRate.toFixed(2)}%</p><span className="grid h-11 w-11 place-items-center rounded-2xl bg-violet-50 text-violet-700"><TrendingUp className="h-5 w-5" /></span></div><p className="mt-1 text-sm font-medium text-slate-500">Balance-weighted across selected savers</p></article>
        <article className="rounded-[2rem] border border-white/70 bg-white/90 p-5 shadow-sm"><p className="text-sm font-bold text-slate-500">Savings interest this month</p><div className="mt-2 flex items-center justify-between"><p className="text-3xl font-black text-slate-950">{formatMoney(totalInterest)}</p><span className="grid h-11 w-11 place-items-center rounded-2xl bg-sky-50 text-sky-700"><TrendingUp className="h-5 w-5" /></span></div><p className="mt-1 text-[11px] font-black text-blue-700">Paid {formatMoney(providerConfirmedInterest)} · accrued through yesterday {formatMoney(accruedThroughYesterday)} · today est. {formatMoney(estimatedInterest)}</p></article>
        <article className="rounded-[2rem] border border-white/70 bg-white/90 p-5 shadow-sm"><p className="text-sm font-bold text-slate-500">Unassigned equity</p><div className="mt-2 flex items-center justify-between"><p className="text-3xl font-black text-slate-950">{formatMoney(unassignedEquity)}</p><span className="grid h-11 w-11 place-items-center rounded-2xl bg-cyan-50 text-cyan-700"><WalletCards className="h-5 w-5" /></span></div><p className="mt-1 text-sm font-medium text-slate-500">Available after this month&apos;s commitments</p></article>
        <button type="button" onClick={() => setCalendarOpen(true)} className="rounded-[2rem] border border-white/70 bg-white/90 p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
          <div className="flex items-center justify-between gap-2"><p className="text-sm font-black text-slate-700">Savings year calendar</p><CalendarDays className="h-5 w-5 text-orange-500" /></div>
          <div className="mt-3 grid grid-cols-12 gap-1">{yearMonths.map((row) => <span key={row.key} title={`${longMonth(row.key)}: ${formatMoney(row.savedIn)} saved, ${formatMoney(row.withdrawn)} withdrawn, ${formatMoney(row.interestConfirmed + row.interestEstimated)} interest`} className={`h-10 rounded-full ${row.key === monthKey ? "bg-orange-400 ring-2 ring-orange-200" : "bg-gradient-to-t from-sky-200 via-emerald-100 to-orange-100"}`} />)}</div>
          <p className="mt-2 text-xs font-bold text-slate-400">Click to inspect savings activity</p>
        </button>
        <button type="button" onClick={() => setContextOpen(true)} className="inline-flex min-h-24 items-center justify-center gap-2 rounded-[2rem] border border-dashed border-emerald-300 bg-emerald-50 px-5 text-sm font-black text-emerald-800 shadow-sm"><CirclePlus className="h-5 w-5" /> More context</button>
      </section>

      <section className="grid gap-5 xl:grid-cols-[0.75fr_1.05fr_1.45fr]">
        <article className="rounded-[2rem] border border-white/70 bg-white/90 p-5 shadow-sm">
          <h2 className="text-xl font-black text-slate-950">Savings allocation</h2>
          <p className="mt-1 text-sm font-semibold text-slate-500">What is earmarked to goals versus still unassigned.</p>
          <div className="mt-3 h-56"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={allocationData} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="82%" paddingAngle={3}>{allocationData.map((entry) => <Cell key={entry.name} fill={entry.colour} />)}</Pie><Tooltip formatter={(value) => formatMoney(Number(value))} /><Legend /></PieChart></ResponsiveContainer></div>
          <p className="text-center text-2xl font-black text-slate-950">{formatMoney(totalSavings)}</p><p className="text-center text-xs font-bold text-slate-400">Total tracked savings</p>
        </article>

        <article className="rounded-[2rem] border border-white/70 bg-white/90 p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3"><div><h2 className="text-xl font-black text-slate-950">Savings trend</h2><p className="mt-1 text-sm font-semibold text-slate-500">Recorded deposits, withdrawals and interest followed by projection.</p></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600">24m</span></div>
          <div className="mt-4 h-64"><ResponsiveContainer width="100%" height="100%"><LineChart data={chartData}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" /><YAxis tickFormatter={(value) => `£${Math.round(Number(value) / 1000)}k`} tick={{ fontSize: 10 }} width={52} /><Tooltip formatter={(value) => value == null ? "—" : formatMoney(Number(value))} /><Legend /><Line type="monotone" dataKey="recorded" name="Recorded" stroke="#0f172a" strokeWidth={2.5} dot={{ r: 2 }} connectNulls={false} /><Line type="monotone" dataKey="projected" name="Projected" stroke="#10b981" strokeDasharray="7 5" strokeWidth={2.5} dot={false} connectNulls /></LineChart></ResponsiveContainer></div>
        </article>

        <article className="rounded-[2rem] border border-white/70 bg-white/90 p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3"><div><h2 className="text-xl font-black text-slate-950">Lines in this month</h2><p className="mt-1 text-sm font-semibold text-slate-500">This month / total balance, rate, maximised score and end date.</p></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-500">{monthKey}</span></div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[700px] text-left text-sm">
              <thead><tr className="border-b border-slate-100 text-[10px] font-black uppercase tracking-wide text-slate-400"><th className="pb-3">Account</th><th className="pb-3">This month / total</th><th className="pb-3">Interest rate</th><th className="pb-3">Max score</th><th className="pb-3">End date</th></tr></thead>
              <tbody>{accounts.map((account) => <tr key={account.id} className="border-b border-slate-50"><td className="py-3"><div className="flex items-center gap-3"><FinancialInstitutionLogo provider={account.providerSlug || account.provider} className="h-9 w-9 rounded-xl" /><div><p className="font-black text-slate-950">{account.name}</p><p className="text-xs font-bold text-slate-400">{account.provider}</p></div></div></td><td className="py-3 font-black text-slate-950">{formatMoney(account.savedThisMonth)} / {formatMoney(account.balance)}</td><td className="py-3 font-black text-slate-950">{account.interestRate.toFixed(2)}% AER</td><td className="py-3"><span title="100 means the rate is at or above the best broadly compatible eligible rate currently logged." className={`rounded-full px-3 py-1 text-xs font-black ${scoreClass(account.maximisedScore)}`}>{account.maximisedScore}</span></td><td className="py-3 font-bold text-slate-500">{account.endDate || "—"}</td></tr>)}</tbody>
            </table>
          </div>
          {!accounts.length ? <p className="mt-4 rounded-2xl border border-dashed border-slate-200 p-5 text-center text-sm font-bold text-slate-400">No tracked savings accounts in this scope.</p> : null}
        </article>
      </section>

      <section className="rounded-[2rem] border border-white/70 bg-white/90 p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-xl font-black text-slate-950">Pot coverage</h2><p className="mt-1 text-sm font-semibold text-slate-500">Green is already filled, orange is this month, and the remainder stays transparent.</p></div><Link href="/accounts?tab=pots" className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-4 py-2 text-sm font-black text-slate-700">View all pots <ChevronRight className="h-4 w-4" /></Link></div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {pots.map((pot) => <article key={pot.id} className="rounded-3xl border border-slate-100 bg-white p-4 shadow-sm"><div className="flex items-start justify-between gap-2"><div><p className="font-black text-slate-950">{pot.name}</p><p className="text-xs font-bold text-slate-400">{formatMoney(pot.allocated)} of {formatMoney(pot.target)}</p></div><span className={`rounded-full px-2 py-1 text-[10px] font-black ${scoreClass(pot.score)}`}>{pot.score}</span></div><PiggyPotVisual progress={pot.progress} thisMonthProgress={pot.thisMonthProgress} score={null} compact /><p className="text-center text-xs font-black text-orange-600">{formatMoney(pot.thisMonthAmount)} this month</p></article>)}
          <Link href="/accounts?tab=pots" className="grid min-h-60 place-items-center rounded-3xl border border-dashed border-slate-200 bg-slate-50 text-center"><div><span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-white text-2xl shadow-sm"><PiggyBank className="h-5 w-5" /></span><p className="mt-3 text-sm font-black text-slate-700">Add new pot</p></div></Link>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1fr_0.55fr]">
        <article className="rounded-[2rem] border border-white/70 bg-white/90 p-5 shadow-sm"><div className="flex items-center justify-between"><div><h2 className="text-xl font-black text-slate-950">Savings year calendar preview</h2><p className="mt-1 text-sm font-semibold text-slate-500">Saved, withdrawn and interest by month.</p></div><button type="button" onClick={() => setCalendarOpen(true)} className="rounded-full bg-slate-950 px-4 py-2 text-xs font-black text-white">Open full year</button></div><div className="mt-5 grid grid-cols-3 gap-2 sm:grid-cols-6 xl:grid-cols-12">{yearMonths.map((row) => <CalendarBars key={row.key} row={row} active={row.key === monthKey} />)}</div></article>
        <article className="rounded-[2rem] border border-blue-100 bg-gradient-to-br from-blue-50 via-white to-emerald-50 p-5 shadow-sm"><p className="text-xs font-black uppercase tracking-[0.16em] text-blue-700">Current month</p><h2 className="mt-2 text-2xl font-black text-slate-950">{currentMonth ? longMonth(currentMonth.key) : longMonth(monthKey)}</h2><div className="mt-4 space-y-3 text-sm font-bold"><div className="flex justify-between"><span className="text-slate-500">Saved in</span><span className="text-emerald-700">{formatMoney(currentMonth?.savedIn || 0)}</span></div><div className="flex justify-between"><span className="text-slate-500">Withdrawn</span><span className="text-orange-700">{formatMoney(currentMonth?.withdrawn || 0)}</span></div><div className="flex justify-between"><span className="text-slate-500">Interest</span><span className="text-sky-700">{formatMoney((currentMonth?.interestConfirmed || 0) + (currentMonth?.interestEstimated || 0))}</span></div><div className="flex justify-between border-t border-slate-200 pt-3"><span className="text-slate-500">Closing balance</span><span>{formatMoney(currentMonth?.closingBalance || 0)}</span></div></div></article>
      </section>

      {calendarOpen ? <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 p-4 backdrop-blur-sm"><section role="dialog" aria-modal="true" aria-label="Savings year calendar" className="w-full max-w-5xl rounded-[2rem] bg-white p-6 shadow-2xl"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">Financial Flow · Savings</p><h2 className="mt-1 text-2xl font-black text-slate-950">Savings year calendar</h2></div><button type="button" onClick={() => setCalendarOpen(false)} className="grid h-10 w-10 place-items-center rounded-full bg-slate-100 text-slate-700"><X className="h-5 w-5" /></button></div><div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{yearMonths.map((row) => <CalendarBars key={row.key} row={row} active={row.key === monthKey} />)}</div><div className="mt-5 flex flex-wrap gap-4 text-xs font-black text-slate-500"><span className="inline-flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-full bg-emerald-400" />Saved in</span><span className="inline-flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-full bg-orange-400" />Withdrawn</span><span className="inline-flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-full bg-sky-400" />Interest</span></div></section></div> : null}

      {contextOpen ? <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 p-4 backdrop-blur-sm"><section role="dialog" aria-modal="true" aria-label="Add more savings context" className="w-full max-w-2xl rounded-[2rem] bg-white p-6 shadow-2xl"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[0.16em] text-emerald-700">More context</p><h2 className="mt-1 text-2xl font-black text-slate-950">Make this savings view smarter</h2><p className="mt-2 text-sm font-semibold text-slate-500">Add the missing account, movement, goal or bank relationship behind the numbers.</p></div><button type="button" onClick={() => setContextOpen(false)} className="grid h-10 w-10 place-items-center rounded-full bg-slate-100 text-slate-700"><X className="h-5 w-5" /></button></div><div className="mt-5 grid gap-3 sm:grid-cols-2"><Link href="/accounts?tab=add" className="rounded-3xl border border-slate-200 p-5 font-black text-slate-950 hover:bg-slate-50">Add a savings account<p className="mt-1 text-xs font-semibold text-slate-500">Track balance, rate and ownership.</p></Link><Link href="/accounts?tab=accounts" className="rounded-3xl border border-slate-200 p-5 font-black text-slate-950 hover:bg-slate-50">Log a deposit or withdrawal<p className="mt-1 text-xs font-semibold text-slate-500">Add a dated ledger movement.</p></Link><Link href="/accounts?tab=pots" className="rounded-3xl border border-slate-200 p-5 font-black text-slate-950 hover:bg-slate-50">Create or fund a pot<p className="mt-1 text-xs font-semibold text-slate-500">Turn spare cash into a goal.</p></Link><Link href="/account?section=wealth" className="rounded-3xl border border-slate-200 p-5 font-black text-slate-950 hover:bg-slate-50">Add a bank relationship<p className="mt-1 text-xs font-semibold text-slate-500">Improve existing-customer eligibility checks.</p></Link></div></section></div> : null}
    </div>
  );
}
