"use client"

import * as React from "react"
import Link from "next/link"
import { motion } from "framer-motion"
import { ArrowLeft, Check } from "lucide-react"

import { cn } from "@/lib/utils"

import { StepIdentity } from "./_components/step-identity"
import { StepIngest } from "./_components/step-ingest"
import { StepRoutine } from "./_components/step-routine"
import { StepPublish } from "./_components/step-publish"

// ═══════════════════════════════════════════════════════════════════════════
// Creator Editor v2 — the demo flow.
//
// An expert walks in with a photo and a URL and walks out with a running
// product: skills, tools, a daily protocol, published. Entirely client-side
// and choreographed — no API calls — so it runs the same way on every take.
// ═══════════════════════════════════════════════════════════════════════════

const STEPS = ["Identity", "Learn", "Compose", "Publish"] as const

export default function CreateExpertV2Page() {
  // `?step=2` jumps straight to a stage — handy when rehearsing the demo, or
  // recovering mid-pitch without replaying the whole flow.
  const [step, setStep] = React.useState(0)
  const [name, setName] = React.useState("")
  const [tagline, setTagline] = React.useState("")
  const [photo, setPhoto] = React.useState<string | null>(null)

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const jump = Number(params.get("step"))
    if (Number.isFinite(jump) && jump >= 0 && jump < STEPS.length) setStep(jump)
    const seed = params.get("name")
    if (seed) setName(seed)
    const seedTag = params.get("tagline")
    if (seedTag) setTagline(seedTag)
  }, [])

  // Object URLs are created for the local preview; release them on unmount.
  React.useEffect(() => {
    return () => {
      if (photo?.startsWith("blob:")) URL.revokeObjectURL(photo)
    }
  }, [photo])

  return (
    <div className="min-h-screen bg-background">
      {/* Chrome */}
      <header className="sticky top-0 z-20 border-b bg-background/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-3.5">
          <Link
            href="/admin/digital-humans"
            className="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Experts
          </Link>

          <div className="flex flex-1 items-center justify-center gap-1.5">
            {STEPS.map((label, i) => {
              const done = i < step
              const active = i === step
              return (
                <React.Fragment key={label}>
                  <button
                    onClick={() => i < step && setStep(i)}
                    disabled={i >= step}
                    className={cn(
                      "flex items-center gap-2 rounded-full px-3 py-1.5 text-[13px] font-medium transition-all",
                      active && "bg-foreground text-background",
                      done && "text-foreground hover:bg-muted",
                      !active && !done && "text-muted-foreground/40"
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-4.5 w-4.5 items-center justify-center rounded-full text-[10px] font-bold",
                        active && "bg-background/20",
                        done && "bg-emerald-500 text-white",
                        !active && !done && "border border-current"
                      )}
                      style={{ height: 18, width: 18 }}
                    >
                      {done ? <Check className="h-3 w-3" /> : i + 1}
                    </span>
                    {label}
                  </button>
                  {i < STEPS.length - 1 && (
                    <span
                      className={cn(
                        "h-px w-5 transition-colors",
                        i < step ? "bg-emerald-500" : "bg-border"
                      )}
                    />
                  )}
                </React.Fragment>
              )
            })}
          </div>

          <span className="hidden text-xs text-muted-foreground sm:block">Creator Editor</span>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-12">
        {/* No AnimatePresence `mode="wait"` here on purpose: that gates mounting
            the next step on the previous one's EXIT animation completing. If
            animation is ever paused (backgrounded tab, a stalled frame), the
            view sticks on the old step while the rail has already advanced —
            an unacceptable failure mode mid-demo. Keying the incoming content
            means a step change always mounts immediately; the entrance is
            purely cosmetic. */}
        <div>
          <motion.div
            key={step}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
          >
            {step === 0 && (
              <StepIdentity
                name={name}
                setName={setName}
                tagline={tagline}
                setTagline={setTagline}
                photo={photo}
                setPhoto={setPhoto}
                onNext={() => setStep(1)}
              />
            )}
            {step === 1 && <StepIngest name={name} onDone={() => setStep(2)} />}
            {step === 2 && <StepRoutine name={name} onNext={() => setStep(3)} />}
            {step === 3 && <StepPublish name={name} tagline={tagline} photo={photo} />}
          </motion.div>
        </div>
      </main>
    </div>
  )
}
