"use client"

import * as React from "react"
import { AlarmClock, Eye, EyeOff, LineChart, MessageSquareQuote, Pencil, Plus, Trash2, Wand2, Wrench, X } from "lucide-react"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ToolsPanel } from "./_components/tools-panel"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

type Tracker = {
  key: string
  title: string
  value_schema: Record<string, string>
  cadence: string
  aggregate: string
  value_path: string | null
}

type Skill = {
  key: string
  name: string
  description: string | null
  prompt_block: string
  opener_prompt: string | null
  sort_order: number
  active: boolean
  check_in_slots: string[]
  check_in_prompt: string | null
  tool_ids: string[]
  dh_count: number
  trackers: Tracker[]
}

type Tool = { id: string; name: string; description: string; is_core: boolean; enabled: boolean }

// Dialog-side tracker shape: fields as an ordered list so ops can edit rows.
type TrackerDraft = {
  key: string
  title: string
  fields: { name: string; desc: string }[]
  cadence: string
  aggregate: string
  value_path: string
}

const AGGREGATES: { value: string; label: string; hint: string }[] = [
  { value: "latest", label: "Latest", hint: "she remembers the most recent one" },
  { value: "latest_per_subject", label: "Per thing", hint: "current state of each named thing (ideas, goals…)" },
  { value: "sum_today", label: "Daily total", hint: "adds up a number field across today" },
  { value: "count_7d", label: "Weekly count", hint: "how many were logged in the last 7 days" },
  { value: "none", label: "Log only", hint: "recorded for analytics, never shown to her" },
]

const SLOTS: { value: string; label: string }[] = [
  { value: "morning", label: "Morning 9–10am" },
  { value: "lunch", label: "Lunch 12–1pm" },
  { value: "evening", label: "Evening 7–9pm" },
]

const EMPTY_DRAFT = {
  key: "",
  name: "",
  description: "",
  prompt_block: "",
  opener_prompt: "",
  check_in_slots: [] as string[],
  check_in_prompt: "",
  trackers: [] as TrackerDraft[],
}

function toTrackerDraft(t: Tracker): TrackerDraft {
  return {
    key: t.key,
    title: t.title,
    fields: Object.entries(t.value_schema).map(([name, desc]) => ({ name, desc })),
    cadence: t.cadence,
    aggregate: t.aggregate,
    value_path: t.value_path ?? "",
  }
}

function fromTrackerDraft(t: TrackerDraft) {
  return {
    key: t.key,
    title: t.title,
    value_schema: Object.fromEntries(
      t.fields.filter((f) => f.name.trim()).map((f) => [f.name.trim(), f.desc.trim()])
    ),
    cadence: t.cadence,
    aggregate: t.aggregate,
    value_path: t.aggregate === "sum_today" ? t.value_path : null,
  }
}

export default function SkillsPage() {
  const [skills, setSkills] = React.useState<Skill[]>([])
  const [tools, setTools] = React.useState<Tool[]>([])
  const [loading, setLoading] = React.useState(true)

  const [dragToolId, setDragToolId] = React.useState<string | null>(null)
  const [dropSkill, setDropSkill] = React.useState<string | null>(null)

  const [dialog, setDialog] = React.useState<{ open: boolean; editing: string | null }>({ open: false, editing: null })
  const [draft, setDraft] = React.useState(EMPTY_DRAFT)
  const [saving, setSaving] = React.useState(false)

  const toolById = React.useMemo(() => new Map(tools.map((t) => [t.id, t])), [tools])

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/admin/skills")
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "Failed to load skills")
      setSkills(json.data ?? [])
      setTools(json.tools ?? [])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load")
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => { void load() }, [load])

  const patchSkill = async (key: string, patch: Record<string, unknown>, optimistic?: (s: Skill) => Skill) => {
    if (optimistic) setSkills((cur) => cur.map((s) => (s.key === key ? optimistic(s) : s)))
    try {
      const res = await fetch(`/api/admin/skills/${encodeURIComponent(key)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      })
      if (!res.ok) throw new Error((await res.json()).error || "Failed to save")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save")
      void load()
    }
  }

  const attachTool = (skill: Skill, toolId: string) => {
    if (skill.tool_ids.includes(toolId)) return
    const next = [...skill.tool_ids, toolId]
    void patchSkill(skill.key, { tool_ids: next }, (s) => ({ ...s, tool_ids: next }))
  }

  const detachTool = (skill: Skill, toolId: string) => {
    const next = skill.tool_ids.filter((t) => t !== toolId)
    void patchSkill(skill.key, { tool_ids: next }, (s) => ({ ...s, tool_ids: next }))
  }

  const saveDialog = async () => {
    setSaving(true)
    try {
      const editing = dialog.editing
      const payload = {
        name: draft.name,
        description: draft.description,
        prompt_block: draft.prompt_block,
        opener_prompt: draft.opener_prompt,
        check_in_slots: draft.check_in_slots,
        check_in_prompt: draft.check_in_prompt,
        trackers: draft.trackers.map(fromTrackerDraft),
      }
      const res = editing
        ? await fetch(`/api/admin/skills/${encodeURIComponent(editing)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch("/api/admin/skills", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...payload, key: draft.key }),
          })
      if (!res.ok) throw new Error((await res.json()).error || "Failed to save")
      toast.success(editing ? "Skill updated" : "Skill created")
      setDialog({ open: false, editing: null })
      void load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save")
    } finally {
      setSaving(false)
    }
  }

  const removeSkill = async (skill: Skill) => {
    if (!confirm(`Delete "${skill.name}"? It will be removed from ${skill.dh_count} digital human(s).`)) return
    try {
      const res = await fetch(`/api/admin/skills/${encodeURIComponent(skill.key)}`, { method: "DELETE" })
      if (!res.ok) throw new Error((await res.json()).error || "Failed to delete")
      toast.success("Skill deleted")
      void load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete")
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold"><Wand2 className="h-5 w-5" /> Skills</h1>
          <p className="text-sm text-muted-foreground">
            A skill decorates a digital human: a prompt block for how she behaves, an optional
            opener (how she starts a match), and the tools it authorizes. Drag a tool from the
            library onto a skill to grant it. Assign skills to a digital human on her detail page.
          </p>
        </div>
        <Button className="shrink-0" onClick={() => { setDraft(EMPTY_DRAFT); setDialog({ open: true, editing: null }) }}>
          <Plus className="mr-2 h-4 w-4" /> New skill
        </Button>
      </div>

      <Tabs defaultValue="skills">
        <TabsList>
          <TabsTrigger value="skills">Skills</TabsTrigger>
          <TabsTrigger value="tools">Tool registry</TabsTrigger>
        </TabsList>

        <TabsContent value="tools" className="mt-4">
          <ToolsPanel />
        </TabsContent>

        <TabsContent value="skills" className="mt-4 space-y-4">

      {/* Tool library tray */}
      <div className="rounded-xl border bg-muted/40 p-3">
        <div className="mb-2 flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground">
          <Wrench className="h-3.5 w-3.5" /> TOOL LIBRARY — drag onto a skill to authorize it
        </div>
        <div className="flex flex-wrap gap-1.5">
          {tools.map((t) => (
            <span
              key={t.id}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData("text/plain", t.id)
                e.dataTransfer.effectAllowed = "copy"
                setDragToolId(t.id)
              }}
              onDragEnd={() => { setDragToolId(null); setDropSkill(null) }}
              title={t.description}
              className={cn(
                "inline-flex cursor-grab items-center gap-1 rounded-full border bg-card px-2.5 py-1 font-mono text-xs active:cursor-grabbing",
                !t.enabled && "opacity-50 line-through",
                dragToolId === t.id && "border-dashed opacity-40"
              )}
            >
              {t.name}
              {t.is_core && <Badge variant="outline" className="ml-1 px-1 py-0 text-[9px]">core</Badge>}
            </span>
          ))}
          {tools.length === 0 && <span className="text-xs text-muted-foreground/60">No tools in the registry.</span>}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground/60">
          <span className="font-medium">core</span> tools are offered to every digital human on grounding
          turns automatically — attach a tool to a skill only when it should be exclusive to it.
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="grid grid-cols-1 items-start gap-3 md:grid-cols-2">
          {skills.map((skill) => (
            <div
              key={skill.key}
              className={cn(
                "rounded-xl border bg-card p-4",
                !skill.active && "opacity-60",
                dropSkill === skill.key && dragToolId && "ring-1 ring-ring"
              )}
              onDragOver={(e) => {
                if (!dragToolId) return
                e.preventDefault()
                if (dropSkill !== skill.key) setDropSkill(skill.key)
              }}
              onDragLeave={() => { if (dropSkill === skill.key) setDropSkill(null) }}
              onDrop={(e) => {
                e.preventDefault()
                if (dragToolId) attachTool(skill, dragToolId)
                setDragToolId(null)
                setDropSkill(null)
              }}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-semibold">{skill.name}</span>
                    {skill.opener_prompt && (
                      <span title="Has an opener — can start the match" className="text-muted-foreground">
                        <MessageSquareQuote className="h-3.5 w-3.5" />
                      </span>
                    )}
                    {!skill.active && (
                      <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">Hidden</span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {skill.description || "—"} · <span className="tabular-nums">{skill.dh_count}</span> digital human{skill.dh_count === 1 ? "" : "s"}
                  </p>
                </div>
                <div className="flex shrink-0 items-center">
                  <Button variant="ghost" size="icon" className="h-7 w-7" title="Edit"
                    onClick={() => {
                      setDraft({
                        key: skill.key,
                        name: skill.name,
                        description: skill.description ?? "",
                        prompt_block: skill.prompt_block,
                        opener_prompt: skill.opener_prompt ?? "",
                        check_in_slots: skill.check_in_slots ?? [],
                        check_in_prompt: skill.check_in_prompt ?? "",
                        trackers: (skill.trackers ?? []).map(toTrackerDraft),
                      })
                      setDialog({ open: true, editing: skill.key })
                    }}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7" title={skill.active ? "Hide" : "Show"}
                    onClick={() => void patchSkill(skill.key, { active: !skill.active }, (s) => ({ ...s, active: !s.active }))}>
                    {skill.active ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7" title="Delete" onClick={() => void removeSkill(skill)}>
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              </div>

              <p className="mt-2 line-clamp-3 whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-muted-foreground">
                {skill.prompt_block}
              </p>

              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                {skill.tool_ids.length === 0 ? (
                  <span className={cn(
                    "rounded-full border border-dashed px-2.5 py-1 text-[11px] text-muted-foreground/60",
                    dropSkill === skill.key && dragToolId && "border-primary text-primary"
                  )}>
                    No tools — drop one here
                  </span>
                ) : (
                  skill.tool_ids.map((tid) => {
                    const t = toolById.get(tid)
                    return (
                      <span key={tid} className="inline-flex items-center gap-1 rounded-full border bg-background px-2 py-0.5 font-mono text-[11px]">
                        {t?.name ?? tid.slice(0, 8)}
                        <button className="text-muted-foreground hover:text-destructive" title="Remove tool" onClick={() => detachTool(skill, tid)}>
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    )
                  })
                )}
              </div>

              {((skill.trackers?.length ?? 0) > 0 || (skill.check_in_slots?.length ?? 0) > 0) && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {(skill.trackers ?? []).map((t) => (
                    <span
                      key={t.key}
                      title={`Fields: ${Object.keys(t.value_schema).join(", ")}`}
                      className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-700 dark:text-emerald-400"
                    >
                      <LineChart className="h-3 w-3" />
                      {t.title}
                      <span className="opacity-60">· {AGGREGATES.find((a) => a.value === t.aggregate)?.label ?? t.aggregate}</span>
                    </span>
                  ))}
                  {(skill.check_in_slots?.length ?? 0) > 0 && (
                    <span
                      title={skill.check_in_prompt ?? undefined}
                      className="inline-flex items-center gap-1 rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[11px] text-sky-700 dark:text-sky-400"
                    >
                      <AlarmClock className="h-3 w-3" />
                      {skill.check_in_slots.join(" · ")}
                    </span>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
        </TabsContent>
      </Tabs>

      {/* Skill editor */}
      <Dialog open={dialog.open} onOpenChange={(v) => setDialog((s) => ({ ...s, open: v }))}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{dialog.editing ? "Edit skill" : "New skill"}</DialogTitle>
            <DialogDescription>
              The prompt block is appended to the persona for every digital human carrying this skill.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] space-y-3 overflow-y-auto p-4 pt-0">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Name</Label>
                <Input value={draft.name} placeholder="Fortune telling" onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
              </div>
              {!dialog.editing && (
                <div className="space-y-1">
                  <Label>Key (optional — derived from name)</Label>
                  <Input value={draft.key} placeholder="fortune_telling" onChange={(e) => setDraft((d) => ({ ...d, key: e.target.value }))} />
                </div>
              )}
            </div>
            <div className="space-y-1">
              <Label>Description (for ops)</Label>
              <Input value={draft.description} placeholder="What this adds to a digital human" onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Prompt block</Label>
              <Textarea
                value={draft.prompt_block}
                onChange={(e) => setDraft((d) => ({ ...d, prompt_block: e.target.value }))}
                placeholder={"### SKILL: …\nHow she behaves with this skill…"}
                className="min-h-40 font-mono text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label>Opener (optional)</Label>
              <Textarea
                value={draft.opener_prompt}
                onChange={(e) => setDraft((d) => ({ ...d, opener_prompt: e.target.value }))}
                placeholder="How she opens a brand-new match with this skill (leave empty for none)."
                className="min-h-20 font-mono text-xs"
              />
              <p className="text-[11px] text-muted-foreground/60">
                If a digital human has several opener skills, the one with the lowest sort order wins.
              </p>
            </div>

            {/* Datapoints — what this skill keeps track of */}
            <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-1.5"><LineChart className="h-3.5 w-3.5" /> Datapoints she keeps track of</Label>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() =>
                    setDraft((d) => ({
                      ...d,
                      trackers: [
                        ...d.trackers,
                        { key: "", title: "", fields: [{ name: "", desc: "" }], cadence: "free", aggregate: "latest", value_path: "" },
                      ],
                    }))
                  }
                >
                  <Plus className="mr-1 h-3 w-3" /> Add datapoint
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground/60">
                A silent recorder watches every exchange and logs anything matching a datapoint —
                calories from a food photo, a tarot reading she gave, a project idea he mentioned.
                She then sees the computed summary in her head and never has to do the math.
              </p>
              {draft.trackers.length === 0 && (
                <p className="text-xs text-muted-foreground/60">Nothing tracked — this skill only changes how she talks.</p>
              )}
              {draft.trackers.map((t, ti) => {
                const patchTracker = (patch: Partial<TrackerDraft>) =>
                  setDraft((d) => ({
                    ...d,
                    trackers: d.trackers.map((x, i) => (i === ti ? { ...x, ...patch } : x)),
                  }))
                const agg = AGGREGATES.find((a) => a.value === t.aggregate)
                return (
                  <div key={ti} className="space-y-2 rounded-md border bg-card p-2.5">
                    <div className="flex items-center gap-2">
                      <Input
                        value={t.title}
                        placeholder="Meals"
                        className="h-8 text-sm"
                        onChange={(e) => patchTracker({ title: e.target.value })}
                      />
                      {t.key && <span className="shrink-0 font-mono text-[10px] text-muted-foreground/60">{t.key}</span>}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0"
                        title="Remove datapoint (history is kept)"
                        onClick={() => setDraft((d) => ({ ...d, trackers: d.trackers.filter((_, i) => i !== ti) }))}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                    <div className="space-y-1.5">
                      {t.fields.map((f, fi) => (
                        <div key={fi} className="flex items-center gap-1.5">
                          <Input
                            value={f.name}
                            placeholder="calories"
                            className="h-7 w-32 shrink-0 font-mono text-xs"
                            onChange={(e) =>
                              patchTracker({ fields: t.fields.map((x, i) => (i === fi ? { ...x, name: e.target.value } : x)) })
                            }
                          />
                          <Input
                            value={f.desc}
                            placeholder="what the recorder should put here, e.g. rough estimate, integer"
                            className="h-7 text-xs"
                            onChange={(e) =>
                              patchTracker({ fields: t.fields.map((x, i) => (i === fi ? { ...x, desc: e.target.value } : x)) })
                            }
                          />
                          <button
                            className="text-muted-foreground hover:text-destructive disabled:opacity-30"
                            disabled={t.fields.length <= 1}
                            title="Remove field"
                            onClick={() => patchTracker({ fields: t.fields.filter((_, i) => i !== fi) })}
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-1.5 text-[11px] text-muted-foreground"
                        onClick={() => patchTracker({ fields: [...t.fields, { name: "", desc: "" }] })}
                      >
                        <Plus className="mr-1 h-3 w-3" /> Field
                      </Button>
                    </div>
                    <div className="flex items-center gap-2">
                      <select
                        value={t.aggregate}
                        className="h-7 rounded-md border bg-background px-2 text-xs"
                        onChange={(e) => patchTracker({ aggregate: e.target.value })}
                      >
                        {AGGREGATES.map((a) => (
                          <option key={a.value} value={a.value}>{a.label}</option>
                        ))}
                      </select>
                      {t.aggregate === "sum_today" && (
                        <select
                          value={t.value_path}
                          className="h-7 rounded-md border bg-background px-2 text-xs"
                          onChange={(e) => patchTracker({ value_path: e.target.value })}
                        >
                          <option value="">field to add up…</option>
                          {t.fields.filter((f) => f.name.trim()).map((f) => (
                            <option key={f.name} value={f.name.trim()}>{f.name.trim()}</option>
                          ))}
                        </select>
                      )}
                      {agg && <span className="text-[11px] text-muted-foreground/60">{agg.hint}</span>}
                    </div>
                    {t.aggregate === "latest_per_subject" && (
                      <p className="text-[11px] text-muted-foreground/60">
                        Tell the recorder which field names the thing — mention it in that field&apos;s
                        description, e.g. &quot;short idea name (use as subject)&quot;.
                      </p>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Check-ins — skill-owned proactive slots */}
            <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
              <Label className="flex items-center gap-1.5"><AlarmClock className="h-3.5 w-3.5" /> Check-ins</Label>
              <p className="text-[11px] text-muted-foreground/60">
                Pick the times of day (his local time) this skill should reach out — Health Coach pings
                at mealtimes. These unlock regardless of the digital human&apos;s effort tier; the chat
                still has to be warm and idle.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {SLOTS.map((s) => {
                  const on = draft.check_in_slots.includes(s.value)
                  return (
                    <button
                      key={s.value}
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-xs",
                        on ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground"
                      )}
                      onClick={() =>
                        setDraft((d) => ({
                          ...d,
                          check_in_slots: on
                            ? d.check_in_slots.filter((x) => x !== s.value)
                            : [...d.check_in_slots, s.value],
                        }))
                      }
                    >
                      {s.label}
                    </button>
                  )
                })}
              </div>
              {draft.check_in_slots.length > 0 && (
                <Textarea
                  value={draft.check_in_prompt}
                  onChange={(e) => setDraft((d) => ({ ...d, check_in_prompt: e.target.value }))}
                  placeholder="What she should do at those times, e.g. Ask what he ate this meal and get him to send a photo of it."
                  className="min-h-16 font-mono text-xs"
                />
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog({ open: false, editing: null })}>Cancel</Button>
            <Button onClick={() => void saveDialog()} disabled={saving || !draft.name.trim() || !draft.prompt_block.trim()}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
