"use client"

import * as React from "react"
import { motion } from "framer-motion"
import { ArrowUpRight, Banknote, Download, Info, TrendingUp } from "lucide-react"

import { cn } from "@/lib/utils"
import { StudioHeader } from "../_components/studio-shell"

// ═══════════════════════════════════════════════════════════════════════════
// Earnings — the "why an expert would ever sign up" page.
//
// Demo data only: this surface exists to show the business model (an expert
// deploys a skill, the skill earns while they sleep), not to report real
// numbers. Everything below is authored in `demo-data.ts`-style constants.
// ═══════════════════════════════════════════════════════════════════════════

const MRR = 48260
const MRR_DELTA = 0.184
const SUBSCRIBERS = 3184
const ARPU = 15.16
const NEXT_PAYOUT = 33782

/** 30 days of daily gross revenue, gently trending up. Hand-tuned, not random. */
const DAILY = [
  980, 1020, 940, 1105, 1180, 1240, 1160, 1210, 1290, 1340, 1280, 1410, 1380,
  1465, 1520, 1440, 1580, 1630, 1595, 1710, 1680, 1775, 1840, 1790, 1905, 1960,
  1880, 2040, 2115, 2180,
]

const SOURCES = [
  { label: "Subscriptions", amount: 34920, share: 0.724, tone: "bg-emerald-500" },
  { label: "Protocol unlocks", amount: 8410, share: 0.174, tone: "bg-teal-400" },
  { label: "1:1 deep dives", amount: 3260, share: 0.068, tone: "bg-sky-400" },
  { label: "Tips", amount: 1670, share: 0.034, tone: "bg-violet-400" },
]

const PAYOUTS = [
  { date: "Jul 1, 2026", amount: 28540, status: "Paid", method: "Chase ••4471" },
  { date: "Jun 1, 2026", amount: 24115, status: "Paid", method: "Chase ••4471" },
  { date: "May 1, 2026", amount: 19870, status: "Paid", method: "Chase ••4471" },
  { date: "Apr 1, 2026", amount: 12430, status: "Paid", method: "Chase ••4471" },
]

const usd = (n: number, cents = false) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  })

export default function StudioEarningsPage() {
  return (
    <>
      <StudioHeader
        title="Earnings"
        subtitle="Andrew Huberman · Sleep & Focus Protocol"
        actions={
          <button className="flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-[13px] font-medium transition-colors hover:bg-muted">
            <Download className="h-3.5 w-3.5" />
            Export
          </button>
        }
      />

      <div className="mx-auto max-w-6xl space-y-6 px-8 py-8">
        {/* Headline */}
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Monthly recurring"
            value={usd(MRR)}
            delta={MRR_DELTA}
            accent
          />
          <Stat label="Active subscribers" value={SUBSCRIBERS.toLocaleString()} delta={0.121} />
          <Stat label="Revenue per user" value={usd(ARPU, true)} delta={0.057} />
          <Stat label="Next payout" value={usd(NEXT_PAYOUT)} sub="Aug 1 · Chase ••4471" />
        </section>

        {/* Chart */}
        <section className="rounded-2xl border bg-card p-6">
          <div className="mb-6 flex items-baseline justify-between">
            <div>
              <h2 className="text-[15px] font-semibold">Gross revenue</h2>
              <p className="text-[13px] text-muted-foreground">Last 30 days</p>
            </div>
            <div className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[12px] font-semibold text-emerald-600 dark:text-emerald-400">
              <TrendingUp className="h-3.5 w-3.5" />
              +18.4%
            </div>
          </div>
          <RevenueChart data={DAILY} />
        </section>

        <div className="grid gap-6 lg:grid-cols-5">
          {/* Sources */}
          <section className="rounded-2xl border bg-card p-6 lg:col-span-3">
            <h2 className="text-[15px] font-semibold">Where it comes from</h2>
            <p className="mb-5 text-[13px] text-muted-foreground">
              This month, across every surface the skill runs on
            </p>

            <div className="mb-5 flex h-2.5 overflow-hidden rounded-full">
              {SOURCES.map((s) => (
                <motion.div
                  key={s.label}
                  className={s.tone}
                  initial={{ width: 0 }}
                  animate={{ width: `${s.share * 100}%` }}
                  transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
                />
              ))}
            </div>

            <ul className="space-y-3">
              {SOURCES.map((s) => (
                <li key={s.label} className="flex items-center gap-3">
                  <span className={cn("h-2 w-2 shrink-0 rounded-full", s.tone)} />
                  <span className="flex-1 text-[13.5px]">{s.label}</span>
                  <span className="text-[13px] tabular-nums text-muted-foreground">
                    {Math.round(s.share * 100)}%
                  </span>
                  <span className="w-20 text-right text-[13.5px] font-semibold tabular-nums">
                    {usd(s.amount)}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {/* Payout card */}
          <section className="space-y-4 lg:col-span-2">
            <div className="rounded-2xl border bg-gradient-to-br from-emerald-500/10 via-card to-card p-6">
              <div className="mb-4 flex items-center gap-2 text-[13px] font-medium text-muted-foreground">
                <Banknote className="h-4 w-4" />
                Next payout
              </div>
              <div className="text-[34px] font-semibold leading-none tracking-tight tabular-nums">
                {usd(NEXT_PAYOUT)}
              </div>
              <p className="mt-2 text-[13px] text-muted-foreground">
                Arrives Aug 1 · net of 30% platform fee
              </p>
              <button className="mt-5 w-full rounded-xl bg-foreground py-2.5 text-[13.5px] font-semibold text-background transition-opacity hover:opacity-90">
                Payout settings
              </button>
            </div>

            <div className="flex items-start gap-2.5 rounded-2xl border bg-muted/40 p-4 text-[12.5px] leading-relaxed text-muted-foreground">
              <Info className="mt-px h-4 w-4 shrink-0" />
              <span>
                You keep 70% of everything your skill earns. Compute, hosting, and
                payments are covered by the platform fee.
              </span>
            </div>
          </section>
        </div>

        {/* History */}
        <section className="overflow-hidden rounded-2xl border bg-card">
          <div className="flex items-center justify-between border-b px-6 py-4">
            <h2 className="text-[15px] font-semibold">Payout history</h2>
            <button className="flex items-center gap-1 text-[13px] text-muted-foreground transition-colors hover:text-foreground">
              View all
              <ArrowUpRight className="h-3.5 w-3.5" />
            </button>
          </div>
          <table className="w-full text-[13.5px]">
            <thead>
              <tr className="border-b text-left text-[12px] uppercase tracking-wide text-muted-foreground">
                <th className="px-6 py-2.5 font-medium">Date</th>
                <th className="px-6 py-2.5 font-medium">Method</th>
                <th className="px-6 py-2.5 font-medium">Status</th>
                <th className="px-6 py-2.5 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {PAYOUTS.map((p) => (
                <tr key={p.date} className="border-b last:border-0">
                  <td className="px-6 py-3.5">{p.date}</td>
                  <td className="px-6 py-3.5 text-muted-foreground">{p.method}</td>
                  <td className="px-6 py-3.5">
                    <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[12px] font-medium text-emerald-600 dark:text-emerald-400">
                      {p.status}
                    </span>
                  </td>
                  <td className="px-6 py-3.5 text-right font-semibold tabular-nums">
                    {usd(p.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </>
  )
}

function Stat({
  label,
  value,
  delta,
  sub,
  accent,
}: {
  label: string
  value: string
  delta?: number
  sub?: string
  accent?: boolean
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border p-5",
        accent ? "bg-gradient-to-br from-emerald-500/10 via-card to-card" : "bg-card"
      )}
    >
      <div className="text-[12.5px] font-medium text-muted-foreground">{label}</div>
      <div className="mt-1.5 text-[26px] font-semibold leading-none tracking-tight tabular-nums">
        {value}
      </div>
      {delta !== undefined && (
        <div className="mt-2 flex items-center gap-1 text-[12.5px] font-medium text-emerald-600 dark:text-emerald-400">
          <TrendingUp className="h-3.5 w-3.5" />
          {(delta * 100).toFixed(1)}%
          <span className="font-normal text-muted-foreground">vs last month</span>
        </div>
      )}
      {sub && <div className="mt-2 text-[12.5px] text-muted-foreground">{sub}</div>}
    </div>
  )
}

/**
 * Area chart drawn as an inline SVG — no chart dependency, and it animates the
 * stroke in on mount so the page has a moment of life when it lands on screen.
 */
function RevenueChart({ data }: { data: number[] }) {
  const W = 960
  const H = 200
  const max = Math.max(...data) * 1.08
  const min = Math.min(...data) * 0.82

  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * W
    const y = H - ((v - min) / (max - min)) * H
    return [x, y] as const
  })

  // Catmull-Rom-ish smoothing: midpoint quadratics keep the line organic
  // without overshooting on the flat stretches.
  const line = pts.reduce((d, [x, y], i) => {
    if (i === 0) return `M ${x} ${y}`
    const [px, py] = pts[i - 1]
    const cx = (px + x) / 2
    return `${d} Q ${px} ${py} ${cx} ${(py + y) / 2} T ${x} ${y}`
  }, "")

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-[200px] w-full" preserveAspectRatio="none">
        <defs>
          <linearGradient id="rev-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(16 185 129)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="rgb(16 185 129)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1={0}
            x2={W}
            y1={H * f}
            y2={H * f}
            stroke="currentColor"
            strokeWidth={1}
            className="text-border"
            vectorEffect="non-scaling-stroke"
          />
        ))}

        <motion.path
          d={`${line} L ${W} ${H} L 0 ${H} Z`}
          fill="url(#rev-fill)"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.25 }}
        />
        <motion.path
          d={line}
          fill="none"
          stroke="rgb(16 185 129)"
          strokeWidth={2.5}
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
        />
      </svg>

      <div className="mt-2 flex justify-between text-[11.5px] text-muted-foreground">
        <span>Jun 28</span>
        <span>Jul 12</span>
        <span>Jul 27</span>
      </div>
    </div>
  )
}
