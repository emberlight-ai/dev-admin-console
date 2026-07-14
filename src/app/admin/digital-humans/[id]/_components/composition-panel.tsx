"use client"

import * as React from "react"
import { toast } from "sonner"

import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"

type StrategyOpt = { key: string; name: string; description: string | null; sort_order: number }
type SkillOpt = { key: string; name: string; description: string | null; sort_order: number }

const AUTO = "__auto__"

/**
 * The character sheet: effort tier (strategy) + skills — two of the three
 * composition decisions ops makes per digital human. Persona and storyline
 * (with its ✨ generator) live on the profile card above.
 */
export function CompositionPanel({ userid }: { userid: string }) {
  const [strategies, setStrategies] = React.useState<StrategyOpt[]>([])
  const [strategyKey, setStrategyKey] = React.useState<string>(AUTO)
  const [savingStrategy, setSavingStrategy] = React.useState(false)

  const [skillCatalog, setSkillCatalog] = React.useState<SkillOpt[]>([])
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const [savedSelection, setSavedSelection] = React.useState<Set<string>>(new Set())
  const [savingSkills, setSavingSkills] = React.useState(false)

  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [sRes, bRes, kRes] = await Promise.all([
          fetch("/api/admin/strategies"),
          fetch("/api/admin/strategies/board"),
          fetch(`/api/admin/digital-humans/${encodeURIComponent(userid)}/skills`),
        ])
        const sJson = await sRes.json()
        const bJson = await bRes.json()
        const kJson = await kRes.json()
        if (cancelled) return
        if (sRes.ok) setStrategies(sJson.data ?? [])
        if (bRes.ok) {
          const me = (bJson.dhs ?? []).find((d: { userid: string }) => d.userid === userid)
          setStrategyKey(me?.strategy_key ?? AUTO)
        }
        if (kRes.ok) {
          setSkillCatalog(kJson.all ?? [])
          const sel = new Set<string>(kJson.selected ?? [])
          setSelected(sel)
          setSavedSelection(new Set(sel))
        }
      } catch {
        if (!cancelled) toast.error("Failed to load composition")
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [userid])

  const changeStrategy = async (value: string) => {
    const prev = strategyKey
    setStrategyKey(value)
    setSavingStrategy(true)
    try {
      const res = await fetch("/api/admin/strategies/board", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userid, strategy_key: value === AUTO ? null : value }),
      })
      if (!res.ok) throw new Error((await res.json()).error || "Failed to save effort")
      toast.success("Effort updated")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save effort")
      setStrategyKey(prev)
    } finally {
      setSavingStrategy(false)
    }
  }

  const skillsDirty = React.useMemo(() => {
    if (selected.size !== savedSelection.size) return true
    for (const k of selected) if (!savedSelection.has(k)) return true
    return false
  }, [selected, savedSelection])

  const saveSkills = async () => {
    setSavingSkills(true)
    try {
      const res = await fetch(`/api/admin/digital-humans/${encodeURIComponent(userid)}/skills`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keys: [...selected] }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "Failed to save skills")
      const sel = new Set<string>(json.selected ?? [])
      setSelected(sel)
      setSavedSelection(new Set(sel))
      toast.success("Skills saved")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save skills")
    } finally {
      setSavingSkills(false)
    }
  }

  return (
    <Card className="space-y-4 p-4">
      <div>
        <div className="text-sm font-semibold">Character</div>
        <div className="text-xs text-muted-foreground">
          Effort and skills — how hard she pursues, and what she can do.
        </div>
      </div>

      {loading ? (
        <div className="text-xs text-muted-foreground">Loading…</div>
      ) : (
        <>
          {/* Effort */}
          <div className="space-y-1">
            <Label className="text-xs">Effort</Label>
            <select
              value={strategyKey}
              disabled={savingStrategy}
              onChange={(e) => void changeStrategy(e.target.value)}
              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
            >
              <option value={AUTO}>Auto — persona default</option>
              {strategies.map((s) => (
                <option key={s.key} value={s.key}>{s.name}</option>
              ))}
            </select>
            <p className="text-[11px] text-muted-foreground/60">
              {strategies.find((s) => s.key === strategyKey)?.description ??
                "Follows the persona's default tier. Manage tiers on the Strategies board."}
            </p>
          </div>

          {/* Skills */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Skills</Label>
              <Button size="sm" variant="outline" onClick={() => void saveSkills()} disabled={!skillsDirty || savingSkills}>
                {savingSkills ? "Saving…" : "Save skills"}
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {skillCatalog.map((skill) => {
                const active = selected.has(skill.key)
                return (
                  <button
                    key={skill.key}
                    type="button"
                    title={skill.description ?? undefined}
                    onClick={() =>
                      setSelected((prev) => {
                        const next = new Set(prev)
                        if (next.has(skill.key)) next.delete(skill.key)
                        else next.add(skill.key)
                        return next
                      })
                    }
                    className={
                      "rounded-full border px-3 py-1 text-xs font-medium transition-colors " +
                      (active
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-background text-muted-foreground hover:border-primary/60")
                    }
                  >
                    {skill.name}
                  </button>
                )
              })}
              {skillCatalog.length === 0 && (
                <span className="text-xs text-muted-foreground/60">No skills defined yet — create them on the Skills page.</span>
              )}
            </div>
          </div>
        </>
      )}
    </Card>
  )
}
