"use client"

import * as React from "react"
import { AnimatePresence, motion } from "framer-motion"
import { Check, Loader2, Rocket } from "lucide-react"

import { Button } from "@/components/ui/button"
import { CoachComponentMessage } from "@/components/matching/coach-components"
import { cn } from "@/lib/utils"

import { SKILLS, TOOLS } from "./demo-data"

/**
 * Step 4 — the payoff.
 *
 * The point of the whole flow: an expert walked in with a website and walks
 * out with a running product. The phone renders the SAME component cards the
 * live app uses, so what the creator sees here is literally what ships.
 */
export function StepPublish({
  name,
  tagline,
  photo,
}: {
  name: string
  tagline: string
  photo: string | null
}) {
  const [state, setState] = React.useState<"idle" | "publishing" | "live">("idle")
  const first = name.split(" ")[0] || "Your expert"

  const publish = () => {
    setState("publishing")
    setTimeout(() => setState("live"), 1600)
  }

  return (
    <div className="grid gap-12 lg:grid-cols-[1fr_360px] lg:items-start">
      <div className="space-y-8">
        <div className="space-y-3">
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Step 4 — Publish
          </p>
          <h1 className="text-[40px] font-semibold leading-[1.1] tracking-tight">
            {state === "live" ? (
              <>
                {first} is live.
                <br />
                <span className="text-muted-foreground">Anyone can subscribe.</span>
              </>
            ) : (
              <>
                That&apos;s a product,
                <br />
                not a chatbot.
              </>
            )}
          </h1>
          <p className="max-w-md text-[17px] leading-relaxed text-muted-foreground">
            {state === "live"
              ? `${first} now runs on their own — remembering context, checking in on schedule, and using the tools you attached.`
              : `Everything ${first} needs to run without you: a voice, a method, working tools, and a daily protocol.`}
          </p>
        </div>

        {/* What got built */}
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            { n: SKILLS.length, label: "Skills", sub: "from 196 transcripts" },
            { n: TOOLS.length, label: "Tools", sub: "interactive, native" },
            { n: 8, label: "Daily moments", sub: "scheduled check-ins" },
          ].map((stat, i) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.07, type: "spring", stiffness: 300, damping: 26 }}
              className="rounded-2xl border bg-card p-4"
            >
              <p className="text-[30px] font-semibold leading-none tabular-nums">{stat.n}</p>
              <p className="mt-1.5 text-[14px] font-medium">{stat.label}</p>
              <p className="text-[12.5px] text-muted-foreground">{stat.sub}</p>
            </motion.div>
          ))}
        </div>

        <div className="space-y-3">
          <p className="text-sm font-semibold">Skills learned</p>
          <div className="flex flex-wrap gap-2">
            {SKILLS.map((s) => (
              <span
                key={s.id}
                className="flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-[13px] font-medium"
              >
                <s.icon className="h-3.5 w-3.5 text-primary" />
                {s.name}
                <span className="text-muted-foreground/60">{s.sources}</span>
              </span>
            ))}
          </div>
        </div>

        <AnimatePresence mode="wait">
          {state === "live" ? (
            <motion.div
              key="live"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: "spring", stiffness: 300, damping: 22 }}
              className="flex items-center gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 px-5 py-4"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-500">
                <Check className="h-5 w-5 text-white" />
              </span>
              <div>
                <p className="font-semibold">Published to Amber</p>
                <p className="text-[13.5px] text-muted-foreground">
                  Live in Discover · $19/mo subscription
                </p>
              </div>
            </motion.div>
          ) : (
            <motion.div key="cta" exit={{ opacity: 0 }}>
              <Button
                size="lg"
                onClick={publish}
                disabled={state === "publishing"}
                className="h-12 rounded-full px-7 text-[15px]"
              >
                {state === "publishing" ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Publishing…
                  </>
                ) : (
                  <>
                    <Rocket className="mr-2 h-4 w-4" />
                    Publish {first}
                  </>
                )}
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Phone — the real components, rendered exactly as they ship */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 240, damping: 26, delay: 0.15 }}
        className="lg:sticky lg:top-8"
      >
        <div className="mx-auto w-[340px] rounded-[44px] border-[10px] border-neutral-900 bg-neutral-900 shadow-[0_40px_80px_-30px_rgba(0,0,0,0.55)]">
          <div className="relative overflow-hidden rounded-[34px] bg-background">
            {/* status bar / notch */}
            <div className="flex h-9 items-center justify-center bg-card">
              <div className="h-5 w-24 rounded-full bg-neutral-900" />
            </div>

            {/* chat header */}
            <div className="flex items-center gap-2.5 border-b bg-card px-4 py-2.5">
              <div className="h-9 w-9 overflow-hidden rounded-full bg-muted">
                {photo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={photo} alt="" className="h-full w-full object-cover" />
                ) : null}
              </div>
              <div className="min-w-0">
                <p className="truncate text-[14px] font-semibold leading-tight">{name || "Your expert"}</p>
                <p className="truncate text-[11.5px] text-muted-foreground">
                  {tagline.split(".")[0] || "Coach"}
                </p>
              </div>
            </div>

            {/* conversation */}
            <div className="space-y-2.5 bg-background p-3 pb-6">
              <Bubble>Morning. Get outside in the next 20 minutes — that&apos;s your whole day&apos;s energy.</Bubble>

              <div className="scale-[0.86] origin-left">
                <CoachComponentMessage
                  payload={{ component: "lux_meter", props: {} }}
                />
              </div>

              <Bubble>And hold the coffee until 8. I&apos;ll tell you when.</Bubble>

              <div className="scale-[0.86] origin-left">
                <CoachComponentMessage
                  payload={{
                    component: "caffeine_window",
                    props: {
                      wake: "06:30",
                      sleep: "22:30",
                      window_start: "08:00",
                      window_end: "12:30",
                      in_body_mg: 0,
                      consumed_mg: 0,
                      meal_schedule: ["Breakfast · 08:30", "Lunch · 12:30"],
                    },
                  }}
                />
              </div>
            </div>
          </div>
        </div>
        <p className="mt-4 text-center text-[13px] text-muted-foreground">
          Live preview — these are the real components
        </p>
      </motion.div>
    </div>
  )
}

function Bubble({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "max-w-[85%] rounded-2xl bg-primary px-3 py-2 text-[13px] leading-snug text-primary-foreground"
      )}
    >
      {children}
    </div>
  )
}
