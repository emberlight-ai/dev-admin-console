"use client"

import * as React from "react"
import { AnimatePresence, motion } from "framer-motion"
import { DotLottieReact } from "@lottiefiles/dotlottie-react"
import { ArrowRight, Check, Globe, Link2, Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

import { BUILD_STEPS, SKILLS, TOOLS } from "./demo-data"

/**
 * Step 2 — point it at the expert's public work and watch the harness build.
 *
 * The sequence is choreographed rather than driven by a real crawl: each log
 * line resolves on a timer, and the tools fly in along the bottom while
 * "Building tools" is running. ~5 seconds end to end so it fits in a demo take.
 */
export function StepIngest({
  name,
  onDone,
}: {
  name: string
  onDone: () => void
}) {
  const [url, setUrl] = React.useState("")
  const [running, setRunning] = React.useState(false)
  const [stepIndex, setStepIndex] = React.useState(-1)
  const [spawnTools, setSpawnTools] = React.useState(false)
  const [finished, setFinished] = React.useState(false)

  const start = () => {
    if (!url.trim()) return
    setRunning(true)
    setStepIndex(0)
  }

  // Walk the log one line at a time.
  React.useEffect(() => {
    if (!running || stepIndex < 0 || stepIndex >= BUILD_STEPS.length) return
    const step = BUILD_STEPS[stepIndex]
    if (step.spawnsTools) setSpawnTools(true)
    const t = setTimeout(() => {
      if (stepIndex === BUILD_STEPS.length - 1) {
        setFinished(true)
        setTimeout(onDone, 1100)
      } else {
        setStepIndex((i) => i + 1)
      }
    }, step.ms)
    return () => clearTimeout(t)
  }, [running, stepIndex, onDone])

  if (!running) {
    return (
      <div className="mx-auto max-w-2xl space-y-8">
        <div className="space-y-3">
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Step 2 — Learn
          </p>
          <h1 className="text-[40px] font-semibold leading-[1.1] tracking-tight">
            Where does {name.split(" ")[0] || "your expert"}
            <br />
            publish their work?
          </h1>
          <p className="text-[17px] leading-relaxed text-muted-foreground">
            A website, blog or podcast archive. We read everything they&apos;ve
            published and turn the method into skills and working tools.
          </p>
        </div>

        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-2xl border-2 px-5 py-4 transition-colors focus-within:border-primary">
            <Link2 className="h-5 w-5 shrink-0 text-muted-foreground" />
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && start()}
              placeholder="https://"
              autoFocus
              className="w-full bg-transparent text-[17px] outline-none placeholder:text-muted-foreground/40"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            {["https://www.hubermanlab.com/topics"].map((suggestion) => (
              <button
                key={suggestion}
                onClick={() => setUrl(suggestion)}
                className="flex items-center gap-2 rounded-full border bg-muted/40 px-3.5 py-1.5 text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
              >
                <Globe className="h-3.5 w-3.5" />
                {suggestion.replace("https://www.", "")}
              </button>
            ))}
          </div>
        </div>

        <Button
          size="lg"
          disabled={!url.trim()}
          onClick={start}
          className="h-12 rounded-full px-7 text-[15px]"
        >
          Build {name.split(" ")[0] || "the expert"}
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    )
  }

  return (
    <div className="relative flex min-h-[640px] flex-col items-center justify-start pt-6 pb-[132px]">
      {/* Lottie + headline */}
      <div className="flex flex-col items-center">
        <div className="h-40 w-40">
          <DotLottieReact src="/loading.lottie" loop autoplay />
        </div>
        <motion.h2
          key={finished ? "done" : "building"}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-2 text-[26px] font-semibold tracking-tight"
        >
          {finished ? `${name.split(" ")[0]} is ready` : `Building ${name.split(" ")[0]}…`}
        </motion.h2>
        <p className="mt-1 text-[15px] text-muted-foreground">
          {finished ? "6 skills · 8 tools · 1 daily protocol" : url.replace("https://", "")}
        </p>
      </div>

      {/* The log — Claude-Code style, one line at a time */}
      <div className="mt-9 w-full max-w-lg space-y-1.5">
        {BUILD_STEPS.map((step, i) => {
          const state = i < stepIndex || finished ? "done" : i === stepIndex ? "active" : "pending"
          if (state === "pending") return null
          return (
            <motion.div
              key={step.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ type: "spring", stiffness: 320, damping: 28 }}
              className="flex items-center gap-3 rounded-lg px-3 py-2 font-mono text-[13px]"
            >
              <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                {state === "done" ? (
                  <motion.span
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 500, damping: 20 }}
                  >
                    <Check className="h-3.5 w-3.5 text-emerald-500" />
                  </motion.span>
                ) : (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                )}
              </span>
              <span className={cn(state === "done" ? "text-muted-foreground" : "text-foreground")}>
                {step.label}
              </span>
              <span className="ml-auto text-muted-foreground/60">{step.detail}</span>
            </motion.div>
          )
        })}
      </div>

      {/* Skills surfacing as they're built */}
      <div className="mt-5 flex min-h-[34px] max-w-2xl flex-wrap justify-center gap-2">
        <AnimatePresence>
          {stepIndex >= 5 &&
            SKILLS.map((skill, i) => (
              <motion.div
                key={skill.id}
                initial={{ opacity: 0, scale: 0.85, y: 6 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{
                  type: "spring",
                  stiffness: 380,
                  damping: 24,
                  delay: i * 0.06,
                }}
                className="flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-[13px] font-medium shadow-sm"
              >
                <skill.icon className="h-3.5 w-3.5 text-primary" />
                {skill.name}
              </motion.div>
            ))}
        </AnimatePresence>
      </div>

      {/* Tools flying in along the bottom, left → right */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 overflow-hidden pb-4">
        <div className="flex gap-3 px-2">
          <AnimatePresence>
            {spawnTools &&
              TOOLS.map((tool, i) => (
                <motion.div
                  key={tool.id}
                  initial={{ opacity: 0, x: -80, y: 40, scale: 0.8, rotate: -6 }}
                  animate={{ opacity: 1, x: 0, y: 0, scale: 1, rotate: 0 }}
                  transition={{
                    type: "spring",
                    stiffness: 220,
                    damping: 22,
                    delay: i * 0.11,
                  }}
                  className="flex shrink-0 items-center gap-2.5 rounded-2xl border bg-card px-3.5 py-2.5 shadow-[0_12px_28px_-14px_rgba(0,0,0,0.35)]"
                >
                  <span className={cn("flex h-9 w-9 items-center justify-center rounded-xl", tool.well)}>
                    <tool.icon className={cn("h-4.5 w-4.5", tool.tint)} />
                  </span>
                  <span className="whitespace-nowrap">
                    <span className="block text-[13px] font-semibold leading-tight">{tool.name}</span>
                    <span className="block text-[11px] text-muted-foreground">{tool.subtitle}</span>
                  </span>
                </motion.div>
              ))}
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}
