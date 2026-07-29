"use client"

import { motion } from "framer-motion"
import { Plus } from "lucide-react"

import { cn } from "@/lib/utils"
import { SKILLS, TOOLS } from "../../digital-humans/v2/create/_components/demo-data"
import { StudioHeader } from "../_components/studio-shell"

// Demo surface — reuses the creator flow's skill/tool catalog so the two
// screens agree on what this expert actually shipped.

/** Runs in the last 30 days, keyed by tool id. Authored, not queried. */
const RUNS: Record<string, number> = {
  lux: 14105,
  food: 9860,
  caffeine: 18420,
  "sleep-debt": 6240,
  nsdr: 4180,
}

export default function StudioToolsPage() {
  return (
    <>
      <StudioHeader
        title="Skills & Tools"
        subtitle="Everything your agent knows how to do"
        actions={
          <button className="flex items-center gap-1.5 rounded-full bg-foreground px-4 py-2 text-[13px] font-semibold text-background transition-opacity hover:opacity-90">
            <Plus className="h-3.5 w-3.5" />
            Add tool
          </button>
        }
      />

      <div className="mx-auto max-w-6xl space-y-8 px-8 py-8">
        <section>
          <h2 className="mb-1 text-[15px] font-semibold">Skills</h2>
          <p className="mb-4 text-[13px] text-muted-foreground">
            Extracted from 181 sources · retrained weekly
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {SKILLS.map((s, i) => (
              <motion.div
                key={s.id}
                className="rounded-2xl border bg-card p-5"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04, duration: 0.35 }}
              >
                <div className="mb-3 flex items-center gap-2.5">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
                    <s.icon className="h-4 w-4" />
                  </span>
                  <span className="text-[14px] font-semibold">{s.name}</span>
                </div>
                <p className="text-[13px] leading-relaxed text-muted-foreground">{s.summary}</p>
                <div className="mt-3 flex items-center gap-2 text-[12px] text-muted-foreground">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  Live · {s.sources} sources
                </div>
              </motion.div>
            ))}
          </div>
        </section>

        <section>
          <h2 className="mb-1 text-[15px] font-semibold">Tools</h2>
          <p className="mb-4 text-[13px] text-muted-foreground">
            Interactive components your agent can send mid-conversation
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {TOOLS.map((t, i) => (
              <motion.div
                key={t.id}
                className="flex items-center gap-3.5 rounded-2xl border bg-card p-4"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04, duration: 0.35 }}
              >
                <span
                  className={cn(
                    "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
                    t.well
                  )}
                >
                  <t.icon className={cn("h-5 w-5", t.tint)} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-semibold">{t.name}</div>
                  <div className="truncate text-[12.5px] text-muted-foreground">{t.subtitle}</div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-[14px] font-semibold tabular-nums">
                    {(RUNS[t.id] ?? 0).toLocaleString()}
                  </div>
                  <div className="text-[11.5px] text-muted-foreground">runs</div>
                </div>
              </motion.div>
            ))}
          </div>
        </section>
      </div>
    </>
  )
}
