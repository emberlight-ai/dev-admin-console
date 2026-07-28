"use client"

import * as React from "react"
import { motion } from "framer-motion"
import { ArrowRight, Camera, Sparkles } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * Step 1 — who is this expert.
 *
 * The photo is read locally with an object URL; nothing uploads. The live
 * card on the right updates as you type, so the expert exists on screen
 * before a single API is involved.
 */
export function StepIdentity({
  name,
  setName,
  tagline,
  setTagline,
  photo,
  setPhoto,
  onNext,
}: {
  name: string
  setName: (v: string) => void
  tagline: string
  setTagline: (v: string) => void
  photo: string | null
  setPhoto: (v: string | null) => void
  onNext: () => void
}) {
  const fileRef = React.useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = React.useState(false)

  const accept = (file?: File | null) => {
    if (!file || !file.type.startsWith("image/")) return
    setPhoto(URL.createObjectURL(file))
  }

  const ready = name.trim().length > 1

  return (
    <div className="grid gap-12 lg:grid-cols-[1fr_380px] lg:items-start">
      <div className="space-y-8">
        <div className="space-y-3">
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Step 1 — Identity
          </p>
          <h1 className="text-[40px] font-semibold leading-[1.1] tracking-tight">
            Who are we bringing
            <br />
            to life?
          </h1>
          <p className="max-w-md text-[17px] leading-relaxed text-muted-foreground">
            A photo, a name, and one line about what they&apos;re known for. Everything
            else gets learned in the next step.
          </p>
        </div>

        <div className="space-y-6">
          {/* Photo */}
          <div
            onDragOver={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragging(false)
              accept(e.dataTransfer.files?.[0])
            }}
            onClick={() => fileRef.current?.click()}
            className={cn(
              "group flex cursor-pointer items-center gap-5 rounded-2xl border-2 border-dashed p-5 transition-all",
              dragging
                ? "border-primary bg-primary/5 scale-[1.01]"
                : "border-border hover:border-primary/40 hover:bg-muted/40"
            )}
          >
            <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-2xl bg-muted">
              {photo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photo} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <Camera className="h-7 w-7 text-muted-foreground/50" />
                </div>
              )}
            </div>
            <div className="min-w-0">
              <p className="font-medium">
                {photo ? "Looking good — click to replace" : "Add a portrait"}
              </p>
              <p className="text-sm text-muted-foreground">
                Drag an image here, or click to browse
              </p>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => accept(e.target.files?.[0])}
            />
          </div>

          {/* Name */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Andrew Huberman"
              autoFocus
              className="w-full border-0 border-b-2 border-border bg-transparent pb-2 text-[28px] font-semibold tracking-tight outline-none transition-colors placeholder:text-muted-foreground/30 focus:border-primary"
            />
          </div>

          {/* Tagline */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Known for</label>
            <input
              value={tagline}
              onChange={(e) => setTagline(e.target.value)}
              placeholder="Neuroscientist. Protocols for sleep, focus and performance."
              className="w-full border-0 border-b-2 border-border bg-transparent pb-2 text-[17px] outline-none transition-colors placeholder:text-muted-foreground/30 focus:border-primary"
            />
          </div>
        </div>

        <Button
          size="lg"
          disabled={!ready}
          onClick={onNext}
          className="h-12 rounded-full px-7 text-[15px]"
        >
          Continue
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>

      {/* Live preview — the expert exists before any API does */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 260, damping: 26, delay: 0.1 }}
        className="lg:sticky lg:top-8"
      >
        <div className="overflow-hidden rounded-[28px] border bg-card shadow-[0_24px_60px_-24px_rgba(0,0,0,0.28)]">
          <div className="relative h-64 bg-gradient-to-br from-muted to-muted/40">
            {photo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photo} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full items-center justify-center">
                <Camera className="h-10 w-10 text-muted-foreground/25" />
              </div>
            )}
            <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/70 to-transparent" />
            <div className="absolute inset-x-5 bottom-4">
              <p className="text-[22px] font-semibold leading-tight text-white drop-shadow">
                {name.trim() || "Your expert"}
              </p>
            </div>
          </div>
          <div className="space-y-3 p-5">
            <p className="min-h-[40px] text-[15px] leading-snug text-muted-foreground">
              {tagline.trim() || "One line about what they're known for."}
            </p>
            <div className="flex items-center gap-2 border-t pt-3 text-xs text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              Skills and tools arrive in the next step
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  )
}
