"use client"

import * as React from "react"
import { Leaf, ShieldCheck } from "lucide-react"
import { toast } from "sonner"

import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

type InterestRow = { key: string; name: string; sort_order: number; admin_only?: boolean }

/**
 * Tag assignment for a digital human: toggle chips backed by
 * /api/admin/digital-humans/[id]/interests (many-to-many, replace-all save).
 * Regular tags drive which Explore pages this DH appears on in the iOS app;
 * internal tags drive matching controls (Whitelist = home swipe deck,
 * Green Mode = served while Green Mode is enabled on /admin/categories).
 */
export function InterestsPanel({ userid }: { userid: string }) {
  const [catalog, setCatalog] = React.useState<InterestRow[]>([])
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const [savedSelection, setSavedSelection] = React.useState<Set<string>>(new Set())
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/digital-humans/${encodeURIComponent(userid)}/interests`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "Failed to load interests")
      setCatalog(json.all ?? [])
      const sel = new Set<string>(json.selected ?? [])
      setSelected(sel)
      setSavedSelection(new Set(sel))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load interests")
    } finally {
      setLoading(false)
    }
  }, [userid])

  React.useEffect(() => {
    void load()
  }, [load])

  const dirty = React.useMemo(() => {
    if (selected.size !== savedSelection.size) return true
    for (const k of selected) if (!savedSelection.has(k)) return true
    return false
  }, [selected, savedSelection])

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const save = async () => {
    setSaving(true)
    try {
      const res = await fetch(`/api/admin/digital-humans/${encodeURIComponent(userid)}/interests`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keys: [...selected] }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "Failed to save interests")
      const sel = new Set<string>(json.selected ?? [])
      setSelected(sel)
      setSavedSelection(new Set(sel))
      toast.success("Interests saved")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save interests")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold">Tags</div>
          <div className="text-xs text-muted-foreground">
            Tags on this digital human. Regular tags set which Explore pages they
            appear on. Chips with <ShieldCheck className="inline h-3 w-3 -translate-y-px" /> are
            internal-only (Whitelist adds them to the home swipe deck);{" "}
            <Leaf className="inline h-3 w-3 -translate-y-px text-emerald-600" /> Green
            Mode keeps them visible while Green Mode is enabled.
          </div>
        </div>
        <Button size="sm" onClick={() => void save()} disabled={!dirty || saving || loading}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>

      {loading ? (
        <div className="text-xs text-muted-foreground">Loading…</div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {catalog.map((interest) => {
            const active = selected.has(interest.key)
            const isGreenMode = interest.key === "green_mode"
            return (
              <button
                key={interest.key}
                type="button"
                onClick={() => toggle(interest.key)}
                className={
                  "inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-colors " +
                  (isGreenMode
                    ? active
                      ? "border-emerald-500 bg-emerald-500 text-white"
                      : "border-emerald-400/60 bg-emerald-500/10 text-emerald-700 hover:border-emerald-500"
                    : active
                      ? "border-primary bg-primary text-primary-foreground"
                      : interest.admin_only
                        ? "border-amber-400/60 bg-amber-500/10 text-amber-700 hover:border-amber-500"
                        : "border-border bg-background text-muted-foreground hover:border-primary/60")
                }
              >
                {isGreenMode ? <Leaf className="h-3 w-3" /> : interest.admin_only && <ShieldCheck className="h-3 w-3" />}
                {interest.name}
              </button>
            )
          })}
        </div>
      )}
    </Card>
  )
}
