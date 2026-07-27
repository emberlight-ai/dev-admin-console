"use client"

import * as React from "react"
import { Coffee, Flag, Loader2, Send, Sun, UtensilsCrossed, Wand2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

import { CoachComponentMessage, type CoachComponentPayload } from "./coach-components"

// ═══════════════════════════════════════════════════════════════════════════
// Coach message actions for the admin composer.
//
// A digital human carrying a coach skill can normally only emit component
// cards through the model. This lets ops send one by hand — same envelope,
// same validation as the edge function — with a live preview of exactly what
// will land in the user's chat.
// ═══════════════════════════════════════════════════════════════════════════

type ComponentKey =
  | "caffeine_window"
  | "lux_meter"
  | "nutrition_scan"
  | "nutrition_result"
  | "coach_plan"

type FieldKind = "text" | "time" | "number" | "lines"

type Field = {
  key: string
  label: string
  kind: FieldKind
  placeholder?: string
  required?: boolean
}

type Spec = {
  key: ComponentKey
  label: string
  icon: React.ReactNode
  /** Chat-list preview + old-client fallback. */
  defaultText: string
  fields: Field[]
  defaults: Record<string, string>
}

const SPECS: Spec[] = [
  {
    key: "caffeine_window",
    label: "Caffeine window",
    icon: <Coffee className="h-3.5 w-3.5" />,
    defaultText: "☕️ Your caffeine window",
    fields: [
      { key: "wake", label: "Wake", kind: "time", required: true },
      { key: "sleep", label: "Sleep", kind: "time", required: true },
      { key: "window_start", label: "Window opens", kind: "time", required: true },
      { key: "window_end", label: "Window closes", kind: "time", required: true },
      { key: "in_body_mg", label: "In body (mg)", kind: "number" },
      { key: "consumed_mg", label: "Consumed today (mg)", kind: "number" },
      {
        key: "meal_schedule",
        label: "Fuel rhythm (one per line)",
        kind: "lines",
        placeholder: "Breakfast · 08:30\nLunch · 12:30\nDinner · 18:30",
      },
    ],
    defaults: {
      wake: "08:00",
      sleep: "23:00",
      window_start: "09:30",
      window_end: "13:00",
      in_body_mg: "0",
      consumed_mg: "0",
      meal_schedule: "",
    },
  },
  {
    key: "lux_meter",
    label: "Lux meter",
    icon: <Sun className="h-3.5 w-3.5" />,
    defaultText: "☀️ Time for morning light",
    fields: [
      { key: "title", label: "Title", kind: "text", placeholder: "Lux Meter" },
      {
        key: "subtitle",
        label: "Subtitle",
        kind: "text",
        placeholder: "Find your ideal light exposure length",
      },
    ],
    defaults: { title: "", subtitle: "" },
  },
  {
    key: "nutrition_scan",
    label: "Nutrition scanner",
    icon: <UtensilsCrossed className="h-3.5 w-3.5" />,
    defaultText: "🍽️ Scan your next meal",
    fields: [
      { key: "calories_target", label: "Calorie target", kind: "number" },
      { key: "protein_target_g", label: "Protein target (g)", kind: "number" },
      { key: "calories_today", label: "Calories so far", kind: "number" },
      { key: "protein_today_g", label: "Protein so far (g)", kind: "number" },
    ],
    defaults: {
      calories_target: "2200",
      protein_target_g: "140",
      calories_today: "0",
      protein_today_g: "0",
    },
  },
  {
    key: "nutrition_result",
    label: "Meal result",
    icon: <UtensilsCrossed className="h-3.5 w-3.5" />,
    defaultText: "🍽️ Here's your meal breakdown",
    fields: [
      { key: "meal", label: "Meal", kind: "text", required: true, placeholder: "Chicken teriyaki bowl" },
      { key: "calories", label: "Calories", kind: "number", required: true },
      { key: "protein_g", label: "Protein (g)", kind: "number", required: true },
      { key: "carbs_g", label: "Carbs (g)", kind: "number" },
      { key: "fat_g", label: "Fat (g)", kind: "number" },
      { key: "note", label: "Coaching note", kind: "text", placeholder: "Solid protein hit 💪" },
    ],
    defaults: {
      meal: "",
      calories: "600",
      protein_g: "40",
      carbs_g: "60",
      fat_g: "20",
      note: "",
    },
  },
  {
    key: "coach_plan",
    label: "Plan",
    icon: <Flag className="h-3.5 w-3.5" />,
    defaultText: "📋 Your starter plan",
    fields: [
      { key: "title", label: "Title", kind: "text", placeholder: "Your starter plan" },
      { key: "goal", label: "Goal", kind: "text", required: true, placeholder: "Build lean muscle" },
      {
        key: "focus",
        label: "Focus items (one per line)",
        kind: "lines",
        required: true,
        placeholder: "High-protein nutrition\nMorning sunlight\n4 sessions/week",
      },
      { key: "cadence", label: "Cadence", kind: "text", placeholder: "4 sessions/week" },
    ],
    defaults: { title: "", goal: "", focus: "", cadence: "" },
  },
]

/** Turn the string-keyed form state into the API's typed props. */
function buildProps(spec: Spec, values: Record<string, string>): Record<string, unknown> {
  const props: Record<string, unknown> = {}
  for (const field of spec.fields) {
    const raw = (values[field.key] ?? "").trim()
    if (!raw) continue
    if (field.kind === "number") {
      const n = Number(raw)
      if (Number.isFinite(n)) props[field.key] = Math.max(0, Math.round(n))
    } else if (field.kind === "lines") {
      const list = raw
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
      if (list.length) props[field.key] = list
    } else {
      props[field.key] = raw
    }
  }
  return props
}

export function CoachComposerActions({
  matchId,
  disabled,
  onSent,
}: {
  matchId: string
  disabled?: boolean
  onSent?: () => void
}) {
  const [openKey, setOpenKey] = React.useState<ComponentKey | null>(null)
  const [values, setValues] = React.useState<Record<string, string>>({})
  const [text, setText] = React.useState("")
  const [sending, setSending] = React.useState(false)

  const spec = SPECS.find((s) => s.key === openKey) ?? null

  const open = (s: Spec) => {
    setValues({ ...s.defaults })
    setText(s.defaultText)
    setOpenKey(s.key)
  }

  const missing = React.useMemo(() => {
    if (!spec) return []
    return spec.fields
      .filter((f) => f.required && !(values[f.key] ?? "").trim())
      .map((f) => f.label)
  }, [spec, values])

  // What the user will see — the same renderer the history pane uses.
  const preview = React.useMemo<CoachComponentPayload | null>(() => {
    if (!spec || missing.length > 0) return null
    try {
      return {
        component: spec.key,
        text,
        props: buildProps(spec, values),
      } as CoachComponentPayload
    } catch {
      return null
    }
  }, [spec, values, text, missing])

  const send = async () => {
    if (!spec) return
    setSending(true)
    try {
      const res = await fetch("/api/admin/chat/component", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          match_id: matchId,
          component: spec.key,
          text,
          props: buildProps(spec, values),
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "Failed to send")
      toast.success(`Sent ${spec.label.toLowerCase()}`)
      setOpenKey(null)
      onSent?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send")
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      <div className="flex w-full flex-wrap items-center gap-1.5">
        <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          <Wand2 className="h-3 w-3" /> Coach cards
        </span>
        {SPECS.map((s) => (
          <button
            key={s.key}
            type="button"
            disabled={disabled}
            onClick={() => open(s)}
            title={`Send a ${s.label.toLowerCase()} card as the digital human`}
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
              disabled
                ? "cursor-not-allowed opacity-50"
                : "hover:border-primary/50 hover:bg-primary/5"
            )}
          >
            {s.icon}
            {s.label}
          </button>
        ))}
      </div>

      <Dialog open={openKey !== null} onOpenChange={(v) => !v && setOpenKey(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Send {spec?.label.toLowerCase()}</DialogTitle>
            <DialogDescription>
              Sent as the digital human, exactly like the ones she generates herself.
            </DialogDescription>
          </DialogHeader>

          {spec && (
            <div className="grid gap-4 p-4 pt-0 sm:grid-cols-[1fr_340px]">
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label>Chat-list preview text</Label>
                  <Input value={text} onChange={(e) => setText(e.target.value)} />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {spec.fields.map((field) => (
                    <div
                      key={field.key}
                      className={cn("space-y-1", field.kind === "lines" && "sm:col-span-2")}
                    >
                      <Label>
                        {field.label}
                        {field.required && <span className="ml-0.5 text-destructive">*</span>}
                      </Label>
                      {field.kind === "lines" ? (
                        <Textarea
                          rows={3}
                          placeholder={field.placeholder}
                          value={values[field.key] ?? ""}
                          onChange={(e) =>
                            setValues((v) => ({ ...v, [field.key]: e.target.value }))
                          }
                        />
                      ) : (
                        <Input
                          type={field.kind === "number" ? "number" : field.kind === "time" ? "time" : "text"}
                          placeholder={field.placeholder}
                          value={values[field.key] ?? ""}
                          onChange={(e) =>
                            setValues((v) => ({ ...v, [field.key]: e.target.value }))
                          }
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-muted-foreground">Preview</Label>
                {preview ? (
                  <CoachComponentMessage payload={preview} />
                ) : (
                  <div className="rounded-xl border border-dashed p-4 text-xs text-muted-foreground">
                    Fill in {missing.join(", ") || "the required fields"} to preview.
                  </div>
                )}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenKey(null)}>
              Cancel
            </Button>
            <Button onClick={() => void send()} disabled={sending || missing.length > 0}>
              {sending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Send className="mr-2 h-4 w-4" />
              )}
              Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
