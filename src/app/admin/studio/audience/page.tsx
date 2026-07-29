"use client"

import { motion } from "framer-motion"
import { MessageSquare, Repeat, Sparkles, Users } from "lucide-react"

import { StudioHeader } from "../_components/studio-shell"

// Demo surface — authored numbers, no queries. See earnings/page.tsx.

const RETENTION = [
  { day: "D1", pct: 100 },
  { day: "D2", pct: 68 },
  { day: "D7", pct: 51 },
  { day: "D14", pct: 43 },
  { day: "D30", pct: 38 },
]

const TOP_TOOLS = [
  { name: "Caffeine window", runs: 18420, share: 1 },
  { name: "Lux meter", runs: 14105, share: 0.77 },
  { name: "Meal scan", runs: 9860, share: 0.54 },
  { name: "Sleep debt", runs: 6240, share: 0.34 },
  { name: "Focus timer", runs: 4180, share: 0.23 },
]

const QUOTES = [
  {
    text: "The caffeine window thing alone was worth it. I stopped crashing at 2pm in the first week.",
    who: "Marcus · 34 · subscriber since April",
  },
  {
    text: "It actually checks in. I've bought courses before that just sat in my inbox.",
    who: "Priya · 28 · subscriber since May",
  },
]

export default function StudioAudiencePage() {
  return (
    <>
      <StudioHeader title="Audience" subtitle="Who is running your protocol right now" />

      <div className="mx-auto max-w-6xl space-y-6 px-8 py-8">
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Metric icon={Users} label="Active this week" value="2,847" hint="+312 vs last week" />
          <Metric icon={MessageSquare} label="Messages / user / day" value="7.4" hint="Median 5.1" />
          <Metric icon={Repeat} label="D30 retention" value="38%" hint="Cohort: June signups" />
          <Metric icon={Sparkles} label="Protocol adherence" value="71%" hint="Check-ins completed" />
        </section>

        <div className="grid gap-6 lg:grid-cols-2">
          <section className="rounded-2xl border bg-card p-6">
            <h2 className="text-[15px] font-semibold">Retention curve</h2>
            <p className="mb-6 text-[13px] text-muted-foreground">June cohort · 1,204 users</p>
            <div className="flex h-40 items-end gap-3">
              {RETENTION.map((r, i) => (
                <div key={r.day} className="flex flex-1 flex-col items-center gap-2">
                  <motion.div
                    className="w-full rounded-t-lg bg-gradient-to-t from-emerald-500/40 to-emerald-500"
                    initial={{ height: 0 }}
                    animate={{ height: `${r.pct}%` }}
                    transition={{ duration: 0.6, delay: i * 0.07, ease: [0.16, 1, 0.3, 1] }}
                  />
                  <span className="text-[11.5px] font-medium text-muted-foreground">{r.day}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border bg-card p-6">
            <h2 className="text-[15px] font-semibold">Most-run tools</h2>
            <p className="mb-6 text-[13px] text-muted-foreground">Last 30 days</p>
            <ul className="space-y-4">
              {TOP_TOOLS.map((t, i) => (
                <li key={t.name}>
                  <div className="mb-1.5 flex items-baseline justify-between text-[13.5px]">
                    <span className="font-medium">{t.name}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {t.runs.toLocaleString()}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <motion.div
                      className="h-full rounded-full bg-foreground/70"
                      initial={{ width: 0 }}
                      animate={{ width: `${t.share * 100}%` }}
                      transition={{ duration: 0.6, delay: i * 0.06, ease: [0.16, 1, 0.3, 1] }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <section className="grid gap-4 sm:grid-cols-2">
          {QUOTES.map((q) => (
            <blockquote key={q.who} className="rounded-2xl border bg-card p-6">
              <p className="text-[14.5px] leading-relaxed">“{q.text}”</p>
              <footer className="mt-3 text-[12.5px] text-muted-foreground">{q.who}</footer>
            </blockquote>
          ))}
        </section>
      </div>
    </>
  )
}

function Metric({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  hint: string
}) {
  return (
    <div className="rounded-2xl border bg-card p-5">
      <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="mt-1.5 text-[26px] font-semibold leading-none tracking-tight tabular-nums">
        {value}
      </div>
      <div className="mt-2 text-[12.5px] text-muted-foreground">{hint}</div>
    </div>
  )
}
