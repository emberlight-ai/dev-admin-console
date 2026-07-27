"use client"

import * as React from "react"
import {
  Calendar,
  Camera,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  Coffee,
  Flag,
  Moon,
  Sun,
  UtensilsCrossed,
} from "lucide-react"

import { cn } from "@/lib/utils"

// ═══════════════════════════════════════════════════════════════════════════
// Coach + concierge component messages, rendered the way the iOS app renders
// them (docs/coach-programs.md). `messages.type = 'component'` carries a JSON
// envelope in `content`:
//
//   {"component":"caffeine_window","v":1,"text":"preview","props":{…}}
//
// Ops needs to SEE what the user saw, so these mirror the native cards —
// same layout, same semantics — scaled to the admin chat column and themed
// with the admin's own tokens so they work in light and dark.
// ═══════════════════════════════════════════════════════════════════════════

// ── Payload types (mirror Amber/Core/Chat/CoachComponents/CoachComponentModels.swift)

type CaffeineWindowProps = {
  title?: string
  wake: string
  sleep: string
  window_start: string
  window_end: string
  in_body_mg?: number
  consumed_mg?: number
  meal_schedule?: string[]
}
type LuxMeterProps = { title?: string; subtitle?: string }
type NutritionScanProps = {
  title?: string
  calories_target?: number
  protein_target_g?: number
  calories_today?: number
  protein_today_g?: number
}
type NutritionResultProps = {
  meal: string
  calories: number
  protein_g: number
  carbs_g?: number
  fat_g?: number
  note?: string
  /** The scanned plate — written by /api/ios/coach/scan-meal. */
  photo_url?: string
}
type CoachPlanProps = { title?: string; goal: string; focus: string[]; cadence?: string }
type MatchCardItem = {
  user_id: string
  username: string
  age?: number | null
  avatar?: string | null
  profession?: string | null
}
type MatchCardsProps = { category: string; title?: string; cards?: MatchCardItem[] }

export type CoachComponentPayload =
  | { component: "caffeine_window"; text?: string; props: CaffeineWindowProps }
  | { component: "lux_meter"; text?: string; props: LuxMeterProps }
  | { component: "nutrition_scan"; text?: string; props: NutritionScanProps }
  | { component: "nutrition_result"; text?: string; props: NutritionResultProps }
  | { component: "coach_plan"; text?: string; props: CoachPlanProps }
  | { component: "match_cards"; text?: string; props: MatchCardsProps }

const KNOWN = new Set([
  "caffeine_window",
  "lux_meter",
  "nutrition_scan",
  "nutrition_result",
  "coach_plan",
  "match_cards",
])

/**
 * Decode a component message. Mirrors the iOS gate: trust `type` when it says
 * so, otherwise shape-sniff the JSON (chat-meta previews arrive with no type).
 * Returns null for ordinary text so callers can fall through.
 */
export function parseCoachComponent(
  content: string | null | undefined,
  type?: string | null
): CoachComponentPayload | null {
  if (type && type !== "component") return null
  if (!content || !content.trimStart().startsWith("{")) return null
  if (!content.includes('"component"')) return null
  try {
    const parsed = JSON.parse(content)
    if (!parsed || typeof parsed.component !== "string" || !KNOWN.has(parsed.component)) return null
    if (!parsed.props || typeof parsed.props !== "object") return null
    return parsed as CoachComponentPayload
  } catch {
    return null
  }
}

/** `{"gift":…,"name":…,"cost":…}` — gift messages store JSON in content too. */
export function parseGift(
  content: string | null | undefined,
  type?: string | null
): { gift: string; name: string; cost: number } | null {
  if (type && type !== "gift") return null
  if (!content || !content.trimStart().startsWith("{") || !content.includes('"gift"')) return null
  try {
    const g = JSON.parse(content)
    return typeof g?.name === "string" ? g : null
  } catch {
    return null
  }
}

// ── Time helpers (mirror CoachTime) ──────────────────────────────────────────

function minutesOf(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return h * 60 + min
}

function displayMinutes(total: number): string {
  const wrapped = ((total % 1440) + 1440) % 1440
  const h24 = Math.floor(wrapped / 60)
  const m = wrapped % 60
  const suffix = h24 < 12 ? "AM" : "PM"
  const h = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h}:${String(m).padStart(2, "0")} ${suffix}`
}

function displayTime(hhmm: string): string {
  const m = minutesOf(hhmm)
  return m === null ? hhmm : displayMinutes(m)
}

// ── Shared chrome ────────────────────────────────────────────────────────────

function CoachCard({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "w-full max-w-[340px] overflow-hidden rounded-2xl border bg-card p-4 text-card-foreground shadow-sm",
        className
      )}
    >
      {children}
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
      {children}
    </div>
  )
}

function CardTitle({
  icon,
  children,
  chevron,
}: {
  icon?: React.ReactNode
  children: React.ReactNode
  chevron?: boolean
}) {
  return (
    <div className="flex items-center gap-2">
      {icon}
      <span className="text-[15px] font-semibold">{children}</span>
      <span className="flex-1" />
      {chevron && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
    </div>
  )
}

/** A labelled progress meter (calories, protein, macros). */
function Meter({
  label,
  value,
  fraction,
  barClass,
}: {
  label: React.ReactNode
  value: string
  fraction: number
  barClass: string
}) {
  const pct = Math.min(Math.max(fraction, 0), 1) * 100
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <SectionLabel>{label}</SectionLabel>
        <span className="font-mono text-xs font-semibold tabular-nums">{value}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full", barClass)} style={{ width: `${Math.max(pct, 2)}%` }} />
      </div>
    </div>
  )
}

// ── Caffeine window ──────────────────────────────────────────────────────────

function CaffeineWindowCard({ props }: { props: CaffeineWindowProps }) {
  const wake = minutesOf(props.wake)
  let sleep = minutesOf(props.sleep)
  let start = minutesOf(props.window_start)
  let end = minutesOf(props.window_end)

  // Times before wake belong to the next day (a 1:45 AM bedtime).
  if (wake !== null && sleep !== null && sleep <= wake) sleep += 24 * 60
  if (wake !== null && start !== null && start < wake) start += 24 * 60
  if (start !== null && end !== null && end < start) end += 24 * 60

  const span = wake !== null && sleep !== null ? sleep - wake : null
  const pct = (m: number | null) =>
    span && span > 0 && wake !== null && m !== null
      ? Math.min(Math.max(((m - wake) / span) * 100, 0), 100)
      : null
  const startPct = pct(start)
  const endPct = pct(end)

  return (
    <CoachCard>
      <CardTitle icon={<Coffee className="h-4 w-4 text-amber-500" />} chevron>
        {props.title ?? "Caffeine Window"}
      </CardTitle>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-muted/60 p-2">
          <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            <Coffee className="h-3 w-3" /> Start
          </div>
          <div className="mt-0.5 font-mono text-sm font-semibold">{displayTime(props.window_start)}</div>
        </div>
        <div className="rounded-lg bg-muted/60 p-2">
          <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            <Moon className="h-3 w-3" /> Stop
          </div>
          <div className="mt-0.5 font-mono text-sm font-semibold">{displayTime(props.window_end)}</div>
        </div>
      </div>

      {/* Wake → sleep track: ramp-up, the green window, then the cutoff. */}
      <div className="relative mt-3 h-2 w-full overflow-hidden rounded-full bg-gradient-to-r from-amber-400 via-emerald-500 to-rose-500">
        {startPct !== null && (
          <span
            className="absolute top-1/2 h-3 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground/80 ring-1 ring-background"
            style={{ left: `${startPct}%` }}
          />
        )}
        {endPct !== null && (
          <span
            className="absolute top-1/2 h-3 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground/80 ring-1 ring-background"
            style={{ left: `${endPct}%` }}
          />
        )}
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1 whitespace-nowrap">
          <Sun className="h-3 w-3 shrink-0" /> Wake {displayTime(props.wake)}
        </span>
        <span className="flex items-center gap-1 whitespace-nowrap">
          <Moon className="h-3 w-3 shrink-0" /> Sleep {displayTime(props.sleep)}
        </span>
      </div>

      {props.meal_schedule && props.meal_schedule.length > 0 && (
        <div className="mt-3 space-y-1.5">
          <SectionLabel>Fuel rhythm</SectionLabel>
          {props.meal_schedule.slice(0, 4).map((meal, i) => (
            <div key={i} className="flex items-center gap-2 text-[13px]">
              <Clock className="h-3 w-3 shrink-0 text-emerald-500" />
              <span className="truncate">{meal}</span>
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2 border-t pt-2.5">
        <div>
          <SectionLabel>In body</SectionLabel>
          <div className="text-lg font-semibold tabular-nums">{props.in_body_mg ?? 0}mg</div>
        </div>
        <div>
          <SectionLabel>Today</SectionLabel>
          <div className="text-lg font-semibold tabular-nums">{props.consumed_mg ?? 0}mg</div>
        </div>
      </div>
    </CoachCard>
  )
}

// ── Lux meter ────────────────────────────────────────────────────────────────

function LuxMeterCard({ props }: { props: LuxMeterProps }) {
  return (
    <CoachCard className="border-amber-300/50 bg-gradient-to-br from-amber-50 to-orange-50 dark:border-amber-500/20 dark:from-amber-950/40 dark:to-neutral-900">
      <CardTitle icon={<Sun className="h-4 w-4 text-amber-500" />} chevron>
        {props.title ?? "Lux Meter"}
      </CardTitle>
      <div className="mt-3 flex items-center gap-2 rounded-xl bg-background/50 px-3 py-2.5">
        <span className="text-[10px] font-bold tracking-widest text-amber-600 dark:text-amber-400">LIVE</span>
        <div className="flex flex-1 items-center gap-[3px]">
          {Array.from({ length: 26 }).map((_, i) => (
            <span
              key={i}
              className={cn(
                "w-[2px] rounded-full",
                i % 4 === 1 ? "h-4" : "h-2.5",
                i < 9 ? "bg-amber-400" : "bg-muted-foreground/25"
              )}
            />
          ))}
        </div>
      </div>
      <div className="mt-2.5 text-[13px] text-muted-foreground">
        {props.subtitle ?? "Find your ideal light exposure length"}
      </div>
    </CoachCard>
  )
}

// ── Nutrition ────────────────────────────────────────────────────────────────

function NutritionScanCard({ props }: { props: NutritionScanProps }) {
  const calNow = props.calories_today ?? 0
  const calTarget = Math.max(props.calories_target ?? 2200, 1)
  const proNow = props.protein_today_g ?? 0
  const proTarget = Math.max(props.protein_target_g ?? 140, 1)
  return (
    <CoachCard>
      <CardTitle icon={<UtensilsCrossed className="h-4 w-4 text-emerald-500" />}>
        {props.title ?? "Nutrition Scanner"}
      </CardTitle>
      <div className="mt-3 space-y-2.5">
        <Meter
          label="Calories"
          value={`${calNow.toLocaleString()} / ${calTarget.toLocaleString()} kcal`}
          fraction={calNow / calTarget}
          barClass="bg-amber-500"
        />
        <Meter
          label="Protein"
          value={`${proNow} / ${proTarget}g`}
          fraction={proNow / proTarget}
          barClass="bg-emerald-500"
        />
      </div>
      <div className="mt-3 flex items-center justify-center gap-2 rounded-full bg-foreground py-2 text-[13px] font-semibold text-background">
        <Camera className="h-3.5 w-3.5" /> Scan a meal
      </div>
    </CoachCard>
  )
}

function NutritionResultCard({ props }: { props: NutritionResultProps }) {
  return (
    <CoachCard>
      {props.photo_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={props.photo_url}
          alt={props.meal}
          className="mb-3 h-32 w-full rounded-xl border object-cover"
        />
      )}
      <CardTitle icon={<CheckCircle2 className="h-4 w-4 text-emerald-500" />}>{props.meal}</CardTitle>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span className="text-3xl font-bold tabular-nums">{props.calories.toLocaleString()}</span>
        <span className="text-sm font-semibold text-muted-foreground">kcal</span>
      </div>
      <div className="mt-3 space-y-2">
        <MacroBar name="Protein" grams={props.protein_g} max={80} barClass="bg-emerald-500" />
        {typeof props.carbs_g === "number" && (
          <MacroBar name="Carbs" grams={props.carbs_g} max={120} barClass="bg-amber-500" />
        )}
        {typeof props.fat_g === "number" && (
          <MacroBar name="Fat" grams={props.fat_g} max={60} barClass="bg-rose-400" />
        )}
      </div>
      {props.note && <p className="mt-3 text-[13px] text-muted-foreground">{props.note}</p>}
    </CoachCard>
  )
}

function MacroBar({
  name,
  grams,
  max,
  barClass,
}: {
  name: string
  grams: number
  max: number
  barClass: string
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="w-14 font-mono text-[11px] text-muted-foreground">{name}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full", barClass)}
          style={{ width: `${Math.min((grams / max) * 100, 100)}%` }}
        />
      </div>
      <span className="w-9 text-right font-mono text-[11px] font-semibold tabular-nums">{grams}g</span>
    </div>
  )
}

// ── Coach plan ───────────────────────────────────────────────────────────────

function CoachPlanCard({ props }: { props: CoachPlanProps }) {
  return (
    <CoachCard>
      <CardTitle icon={<Flag className="h-4 w-4 text-emerald-500" />}>
        {props.title ?? "Your starter plan"}
      </CardTitle>
      <div className="mt-3 space-y-1">
        <SectionLabel>Goal</SectionLabel>
        <div className="text-[15px] font-semibold">{props.goal}</div>
      </div>
      {props.focus?.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {props.focus.map((item, i) => (
            <div key={i} className="flex items-start gap-2 text-[13px]">
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
              <span>{item}</span>
            </div>
          ))}
        </div>
      )}
      {props.cadence && (
        <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-[12px] font-semibold">
          <Calendar className="h-3 w-3" /> {props.cadence}
        </div>
      )}
    </CoachCard>
  )
}

// ── Concierge match cards ────────────────────────────────────────────────────

function MatchCardsRow({ props }: { props: MatchCardsProps }) {
  const cards = props.cards ?? []
  return (
    <div className="w-full max-w-[340px] space-y-2">
      <div className="space-y-0.5">
        <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-primary">Curated for you</div>
        {props.title && <div className="text-sm font-bold">{props.title}</div>}
        <div className="text-[11px] text-muted-foreground">
          category: <span className="font-mono">{props.category}</span> · {cards.length} card
          {cards.length === 1 ? "" : "s"}
        </div>
      </div>
      {cards.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {cards.map((card) => (
            <div
              key={card.user_id}
              className="relative h-32 w-24 shrink-0 overflow-hidden rounded-xl border bg-muted"
            >
              {card.avatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={card.avatar} alt={card.username} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                  no photo
                </div>
              )}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent p-1.5">
                <div className="truncate text-[11px] font-bold text-white">
                  {card.username}
                  {card.age ? `, ${card.age}` : ""}
                </div>
                {card.profession && (
                  <div className="truncate text-[9px] text-white/80">{card.profession}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Dispatcher ───────────────────────────────────────────────────────────────

/** Renders a decoded component payload as its card. */
export function CoachComponentMessage({ payload }: { payload: CoachComponentPayload }) {
  switch (payload.component) {
    case "caffeine_window":
      return <CaffeineWindowCard props={payload.props} />
    case "lux_meter":
      return <LuxMeterCard props={payload.props} />
    case "nutrition_scan":
      return <NutritionScanCard props={payload.props} />
    case "nutrition_result":
      return <NutritionResultCard props={payload.props} />
    case "coach_plan":
      return <CoachPlanCard props={payload.props} />
    case "match_cards":
      return <MatchCardsRow props={payload.props} />
    default:
      return null
  }
}
