"use client"

import * as React from "react"
import { Gauge, Pencil, Search } from "lucide-react"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

type Strategy = {
  key: string
  name: string
  description: string | null
  active_greeting_enabled: boolean
  follow_up_ladder: number[]
  check_ins_per_day: number
  reply_min_delay_seconds: number
  reply_max_delay_seconds: number
  reply_chars_per_second: number
  skip_reply_enabled: boolean
  skip_reply_base_chance: number
  skip_reply_intimacy_drop_chance: number
  skip_reply_intimacy_drop_delta: number
  skip_reply_max_consecutive: number
  outbound_enabled: boolean
  intimacy_warmup_rate: string
  sort_order: number
}

type DH = {
  userid: string
  username: string | null
  gender: string | null
  personality: string | null
  strategy_key: string | null
  updated_at: string | null
}

const AUTO = "__auto__"
const WARMUP_RATES = ["very_low", "low", "normal", "high", "very_high", "extreme"]

function fmtDelay(seconds: number): string {
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`
  return `${Math.round(seconds / 86400)}d`
}

// "10m, 30m, 45m, 12h, 3d" ⇄ seconds[]. Bare numbers read as minutes.
function ladderToText(ladder: number[]): string {
  return (ladder ?? []).map(fmtDelay).join(", ")
}
function textToLadder(text: string): number[] {
  return text
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
    .map((t) => {
      const m = t.match(/^(\d+(?:\.\d+)?)\s*(m|min|h|hr|d)?$/)
      if (!m) return NaN
      const v = Number(m[1])
      const unit = m[2] ?? "m"
      return unit.startsWith("h") ? v * 3600 : unit.startsWith("d") ? v * 86400 : v * 60
    })
    .filter((v) => Number.isFinite(v) && v >= 60)
    .map((v) => Math.round(v))
}

export default function StrategiesPage() {
  const [strategies, setStrategies] = React.useState<Strategy[]>([])
  const [dhs, setDhs] = React.useState<DH[]>([])
  const [personaDefaults, setPersonaDefaults] = React.useState<Record<string, string | null>>({})
  const [loading, setLoading] = React.useState(true)
  const [query, setQuery] = React.useState("")

  const [dragId, setDragId] = React.useState<string | null>(null)
  const [dropCol, setDropCol] = React.useState<string | null>(null)

  const [editing, setEditing] = React.useState<Strategy | null>(null)
  const [draft, setDraft] = React.useState<Strategy | null>(null)
  const [ladderText, setLadderText] = React.useState("")
  const [saving, setSaving] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const [sRes, bRes] = await Promise.all([
        fetch("/api/admin/strategies"),
        fetch("/api/admin/strategies/board"),
      ])
      const sJson = await sRes.json()
      const bJson = await bRes.json()
      if (!sRes.ok) throw new Error(sJson.error || "Failed to load strategies")
      if (!bRes.ok) throw new Error(bJson.error || "Failed to load board")
      setStrategies(sJson.data ?? [])
      setDhs(bJson.dhs ?? [])
      setPersonaDefaults(bJson.personaDefaults ?? {})
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load")
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => { void load() }, [load])

  const personaDefaultFor = React.useCallback(
    (dh: DH) => personaDefaults[`${(dh.gender || "").trim()}:${(dh.personality || "").trim()}`] ?? null,
    [personaDefaults]
  )

  const columns = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    const visible = q ? dhs.filter((d) => (d.username ?? "").toLowerCase().includes(q)) : dhs
    const byCol = new Map<string, DH[]>()
    byCol.set(AUTO, [])
    for (const s of strategies) byCol.set(s.key, [])
    for (const d of visible) {
      const col = d.strategy_key && byCol.has(d.strategy_key) ? d.strategy_key : AUTO
      byCol.get(col)!.push(d)
    }
    return byCol
  }, [dhs, strategies, query])

  const assign = async (dh: DH, strategyKey: string | null) => {
    const prev = dh.strategy_key
    if (prev === strategyKey) return
    setDhs((cur) => cur.map((d) => (d.userid === dh.userid ? { ...d, strategy_key: strategyKey } : d)))
    try {
      const res = await fetch("/api/admin/strategies/board", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: dh.userid, strategy_key: strategyKey }),
      })
      if (!res.ok) throw new Error((await res.json()).error || "Failed to assign")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to assign")
      setDhs((cur) => cur.map((d) => (d.userid === dh.userid ? { ...d, strategy_key: prev } : d)))
    }
  }

  const saveStrategy = async () => {
    if (!editing || !draft) return
    setSaving(true)
    try {
      const res = await fetch(`/api/admin/strategies/${encodeURIComponent(editing.key)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, follow_up_ladder: textToLadder(ladderText) }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "Failed to save")
      setStrategies((cur) => cur.map((s) => (s.key === editing.key ? json.data : s)))
      toast.success("Strategy updated")
      setEditing(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save")
    } finally {
      setSaving(false)
    }
  }

  const numField = (label: string, key: keyof Strategy, step = 1, hint?: string) => (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input
        type="number"
        step={step}
        value={draft ? String(draft[key] ?? "") : ""}
        onChange={(e) => setDraft((d) => (d ? { ...d, [key]: Number(e.target.value) } : d))}
      />
      {hint && <p className="text-[11px] text-muted-foreground/60">{hint}</p>}
    </div>
  )

  const boolField = (label: string, key: keyof Strategy) => (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={draft ? Boolean(draft[key]) : false}
        onChange={(e) => setDraft((d) => (d ? { ...d, [key]: e.target.checked } : d))}
      />
      {label}
    </label>
  )

  const renderColumn = (key: string, title: string, subtitle: string, list: DH[], strategy?: Strategy) => (
    <div
      key={key}
      className={cn(
        "flex w-64 shrink-0 flex-col rounded-xl border bg-muted/40",
        dropCol === key && dragId && "ring-1 ring-ring"
      )}
      onDragOver={(e) => { e.preventDefault(); if (dropCol !== key) setDropCol(key) }}
      onDrop={(e) => {
        e.preventDefault()
        const dh = dhs.find((d) => d.userid === dragId)
        if (dh) void assign(dh, key === AUTO ? null : key)
        setDragId(null)
        setDropCol(null)
      }}
    >
      <div className="px-3 py-2">
        <div className="flex items-center justify-between gap-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-sm font-semibold">{title}</span>
            <span className="text-xs text-muted-foreground tabular-nums">{list.length}</span>
          </div>
          {strategy && (
            <Button
              variant="ghost" size="icon" className="h-7 w-7" title="Edit preset"
              onClick={() => { setEditing(strategy); setDraft({ ...strategy }); setLadderText(ladderToText(strategy.follow_up_ladder)) }}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
        <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{subtitle}</p>
      </div>
      <div className="flex max-h-[60vh] flex-col gap-1 overflow-y-auto p-2 pt-0">
        {list.length === 0 ? (
          <p className="rounded-lg border border-dashed px-3 py-3 text-center text-xs text-muted-foreground/60">
            Drop digital humans here
          </p>
        ) : (
          list.map((dh) => {
            const autoTier = key === AUTO ? personaDefaultFor(dh) : null
            return (
              <div
                key={dh.userid}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData("text/plain", dh.userid)
                  e.dataTransfer.effectAllowed = "move"
                  setDragId(dh.userid)
                }}
                onDragEnd={() => { setDragId(null); setDropCol(null) }}
                className={cn(
                  "flex cursor-grab items-center gap-2 rounded-lg border bg-card px-2 py-1.5 active:cursor-grabbing",
                  dragId === dh.userid && "border-dashed opacity-40"
                )}
              >
                <Avatar className="h-6 w-6 shrink-0">
                  <AvatarImage src={`/api/avatar/${dh.userid}?v=${encodeURIComponent(dh.updated_at || "")}`} alt={dh.username ?? ""} />
                  <AvatarFallback className="text-[10px]">{(dh.username ?? "?").slice(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium">{dh.username ?? "Unknown"}</div>
                  <div className="truncate text-[10px] text-muted-foreground">
                    {dh.personality ?? "—"}
                    {autoTier ? ` → ${strategies.find((s) => s.key === autoTier)?.name ?? autoTier}` : ""}
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold"><Gauge className="h-5 w-5" /> Strategies</h1>
          <p className="text-sm text-muted-foreground">
            The effort dial: drag a digital human into a column to set how hard she pursues —
            reply speed, follow-ups, check-ins, outreach. &ldquo;Auto&rdquo; follows her persona&apos;s
            default tier (shown on the card). Edit a column to tune its preset.
          </p>
        </div>
        <div className="relative shrink-0">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name…" className="h-9 w-56 pl-8" />
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="flex items-start gap-3 overflow-x-auto pb-4">
          {renderColumn(AUTO, "Auto", "Follows the persona's default effort tier.", columns.get(AUTO) ?? [])}
          {strategies.map((s) =>
            renderColumn(s.key, s.name, s.description ?? "", columns.get(s.key) ?? [], s)
          )}
        </div>
      )}

      {/* Preset editor */}
      <Dialog open={!!editing} onOpenChange={(v) => { if (!v) setEditing(null) }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit preset · {editing?.name}</DialogTitle>
            <DialogDescription>
              Applies to every digital human on this tier (and personas defaulting to it).
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] space-y-4 overflow-y-auto p-4 pt-0">
            <div className="space-y-1">
              <Label className="text-xs">Description</Label>
              <Input
                value={draft?.description ?? ""}
                onChange={(e) => setDraft((d) => (d ? { ...d, description: e.target.value } : d))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              {numField("Reply min delay (s)", "reply_min_delay_seconds")}
              {numField("Reply max delay (s)", "reply_max_delay_seconds")}
              {numField("Typing chars/sec", "reply_chars_per_second")}
              {numField("Check-ins / day", "check_ins_per_day", 1, "Time-of-day pings on warm matches")}
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Follow-up ladder</Label>
              <Input
                value={ladderText}
                onChange={(e) => setLadderText(e.target.value)}
                placeholder="10m, 30m, 45m, 12h, 3d"
              />
              <p className="text-[11px] text-muted-foreground/60">
                Escalating gaps after no reply, measured from her last message — each entry is one
                nudge (m/h/d units; bare numbers = minutes). Empty = never follows up.
                Parsed: {textToLadder(ladderText).length ? textToLadder(ladderText).map(fmtDelay).join(" → ") : "—"}
              </p>
            </div>
            <div className="space-y-2 rounded-lg border p-3">
              {boolField("Speaks first after a match (greeting)", "active_greeting_enabled")}
              {boolField("Outbound reach (nearby invites)", "outbound_enabled")}
              {boolField("Skip-reply (human-like silence)", "skip_reply_enabled")}
              {draft?.skip_reply_enabled && (
                <div className="grid grid-cols-2 gap-3 pt-1">
                  {numField("Base skip chance (0-1)", "skip_reply_base_chance", 0.05)}
                  {numField("Max consecutive skips", "skip_reply_max_consecutive")}
                </div>
              )}
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Intimacy warm-up rate</Label>
              <select
                value={draft?.intimacy_warmup_rate ?? "normal"}
                onChange={(e) => setDraft((d) => (d ? { ...d, intimacy_warmup_rate: e.target.value } : d))}
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              >
                {WARMUP_RATES.map((r) => <option key={r} value={r}>{r.replace("_", " ")}</option>)}
              </select>
              <p className="text-[11px] text-muted-foreground/60">
                How fast closeness can grow per turn — this indirectly times photos and check-ins.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={() => void saveStrategy()} disabled={saving}>{saving ? "Saving…" : "Save changes"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
