"use client"

import * as React from "react"
import { AnimatePresence, motion } from "framer-motion"
import { ArrowRight, GripVertical, Sparkles, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

import { ROUTINE, TOOLS, type RoutineSlot } from "./demo-data"

/**
 * Step 3 — compose the day.
 *
 * The left rail is the expert's protocol; the right is the tool shelf built in
 * step 2. Dragging a tool onto a moment is the whole point of the demo: this is
 * where a prompt becomes a product with behavior attached to a time of day.
 */
export function StepRoutine({ name, onNext }: { name: string; onNext: () => void }) {
  const [slots, setSlots] = React.useState<RoutineSlot[]>(() =>
    ROUTINE.map((s) => ({ ...s, toolIds: [] }))
  )
  const [draggingTool, setDraggingTool] = React.useState<string | null>(null)
  const [hoverSlot, setHoverSlot] = React.useState<string | null>(null)
  const [pulse, setPulse] = React.useState<string | null>(null)

  const placedCount = slots.reduce((n, s) => n + s.toolIds.length, 0)

  const drop = (slotId: string) => {
    const toolId = draggingTool
    setDraggingTool(null)
    setHoverSlot(null)
    if (!toolId) return
    setSlots((prev) =>
      prev.map((s) =>
        s.id === slotId && !s.toolIds.includes(toolId)
          ? { ...s, toolIds: [...s.toolIds, toolId] }
          : s
      )
    )
    setPulse(slotId)
    setTimeout(() => setPulse(null), 700)
  }

  const remove = (slotId: string, toolId: string) => {
    setSlots((prev) =>
      prev.map((s) => (s.id === slotId ? { ...s, toolIds: s.toolIds.filter((t) => t !== toolId) } : s))
    )
  }

  /** One-tap "do it for me" — the parser's own suggestions. */
  const autoFill = () => {
    setSlots((prev) =>
      prev.map((s) => (s.suggested && !s.toolIds.length ? { ...s, toolIds: [s.suggested] } : s))
    )
  }

  const toolById = (id: string) => TOOLS.find((t) => t.id === id)!

  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2.5">
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Step 3 — Compose the day
          </p>
          <h1 className="text-[36px] font-semibold leading-[1.1] tracking-tight">
            Attach {name.split(" ")[0]}&apos;s tools
            <br />
            to moments that matter.
          </h1>
          <p className="max-w-xl text-[16px] leading-relaxed text-muted-foreground">
            Drag a tool onto a moment. That&apos;s when it shows up in the
            conversation — not because someone asked, but because it&apos;s time.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={autoFill} className="h-11 rounded-full px-5">
            <Sparkles className="mr-2 h-4 w-4" />
            Use suggestions
          </Button>
          <Button onClick={onNext} className="h-11 rounded-full px-6">
            Publish
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px] lg:items-start">
        {/* The day */}
        <div className="relative rounded-3xl border bg-card p-2">
          {/* Spine */}
          <div className="absolute bottom-8 left-[86px] top-8 w-px bg-border" />
          <div className="space-y-1">
            {slots.map((slot) => {
              const isHover = hoverSlot === slot.id
              const isPulsing = pulse === slot.id
              return (
                <div
                  key={slot.id}
                  onDragOver={(e) => {
                    e.preventDefault()
                    setHoverSlot(slot.id)
                  }}
                  onDragLeave={() => setHoverSlot((h) => (h === slot.id ? null : h))}
                  onDrop={(e) => {
                    e.preventDefault()
                    drop(slot.id)
                  }}
                  className={cn(
                    "relative flex gap-4 rounded-2xl p-3 transition-all duration-200",
                    isHover && "bg-primary/5 ring-2 ring-primary/30",
                    isPulsing && "bg-emerald-500/5"
                  )}
                >
                  <div className="w-[58px] shrink-0 pt-1 text-right">
                    <span className="font-mono text-[13px] font-semibold tabular-nums text-muted-foreground">
                      {slot.time}
                    </span>
                  </div>

                  <div className="relative z-10 shrink-0">
                    <motion.span
                      animate={isPulsing ? { scale: [1, 1.18, 1] } : {}}
                      transition={{ duration: 0.45 }}
                      className={cn(
                        "flex h-9 w-9 items-center justify-center rounded-full border-2 bg-card transition-colors",
                        isHover ? "border-primary" : "border-border"
                      )}
                    >
                      <slot.icon className="h-4 w-4 text-muted-foreground" />
                    </motion.span>
                  </div>

                  <div className="min-w-0 flex-1 pt-0.5">
                    <p className="text-[15px] font-semibold leading-tight">{slot.label}</p>
                    <p className="text-[13px] text-muted-foreground">{slot.hint}</p>

                    <div className="mt-2 flex flex-wrap gap-2">
                      <AnimatePresence>
                        {slot.toolIds.map((id) => {
                          const tool = toolById(id)
                          return (
                            <motion.span
                              key={id}
                              layout
                              initial={{ opacity: 0, scale: 0.7, y: -6 }}
                              animate={{ opacity: 1, scale: 1, y: 0 }}
                              exit={{ opacity: 0, scale: 0.7 }}
                              transition={{ type: "spring", stiffness: 420, damping: 26 }}
                              className="group flex items-center gap-1.5 rounded-full border bg-background py-1 pl-2 pr-1 text-[12.5px] font-medium shadow-sm"
                            >
                              <tool.icon className={cn("h-3.5 w-3.5", tool.tint)} />
                              {tool.name}
                              <button
                                onClick={() => remove(slot.id, id)}
                                className="ml-0.5 flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground/50 transition-colors hover:bg-destructive/10 hover:text-destructive"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </motion.span>
                          )
                        })}
                      </AnimatePresence>

                      {slot.toolIds.length === 0 && (
                        <span
                          className={cn(
                            "rounded-full border border-dashed px-2.5 py-1 text-[12px] transition-colors",
                            isHover
                              ? "border-primary text-primary"
                              : "border-border text-muted-foreground/50"
                          )}
                        >
                          {isHover ? "Drop to attach" : "Drag a tool here"}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Tool shelf */}
        <div className="space-y-3 lg:sticky lg:top-8">
          <div className="flex items-baseline justify-between">
            <p className="text-sm font-semibold">Tools built for {name.split(" ")[0]}</p>
            <span className="text-xs tabular-nums text-muted-foreground">{placedCount} placed</span>
          </div>
          <div className="grid gap-2">
            {TOOLS.map((tool) => (
              <motion.div
                key={tool.id}
                layout
                draggable
                onDragStart={() => setDraggingTool(tool.id)}
                onDragEnd={() => {
                  setDraggingTool(null)
                  setHoverSlot(null)
                }}
                whileHover={{ y: -1 }}
                className={cn(
                  "flex cursor-grab items-center gap-3 rounded-2xl border bg-card p-2.5 shadow-sm transition-shadow active:cursor-grabbing",
                  draggingTool === tool.id
                    ? "opacity-40 shadow-none"
                    : "hover:shadow-[0_8px_20px_-10px_rgba(0,0,0,0.3)]"
                )}
              >
                <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground/30" />
                <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", tool.well)}>
                  <tool.icon className={cn("h-4 w-4", tool.tint)} />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[13.5px] font-semibold leading-tight">
                    {tool.name}
                  </span>
                  <span className="block truncate text-[11.5px] text-muted-foreground">
                    {tool.subtitle}
                  </span>
                </span>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
