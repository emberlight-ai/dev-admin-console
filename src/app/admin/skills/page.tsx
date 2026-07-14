"use client"

import * as React from "react"
import { Eye, EyeOff, MessageSquareQuote, Pencil, Plus, Trash2, Wand2, Wrench, X } from "lucide-react"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
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

type Skill = {
  key: string
  name: string
  description: string | null
  prompt_block: string
  opener_prompt: string | null
  sort_order: number
  active: boolean
  tool_ids: string[]
  dh_count: number
}

type Tool = { id: string; name: string; description: string; is_core: boolean; enabled: boolean }

const EMPTY_DRAFT = { key: "", name: "", description: "", prompt_block: "", opener_prompt: "" }

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
      const res = editing
        ? await fetch(`/api/admin/skills/${encodeURIComponent(editing)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: draft.name,
              description: draft.description,
              prompt_block: draft.prompt_block,
              opener_prompt: draft.opener_prompt,
            }),
          })
        : await fetch("/api/admin/skills", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(draft),
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
            </div>
          ))}
        </div>
      )}

      {/* Skill editor */}
      <Dialog open={dialog.open} onOpenChange={(v) => setDialog((s) => ({ ...s, open: v }))}>
        <DialogContent className="sm:max-w-xl">
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
