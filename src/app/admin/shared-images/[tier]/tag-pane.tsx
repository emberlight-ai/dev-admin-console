"use client"

import * as React from "react"
import { Check, EyeOff, Plus, Search, Tag as TagIcon, X } from "lucide-react"

import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"

/** active=false → HIDDEN: usable for image curation here, invisible to users
 *  (picker, card chips, matching) until enabled on /admin/categories. */
export type TagRow = { key: string; name: string; active: boolean }

/**
 * Right-hand tag rail for the shared-images folder. Each pill is a native
 * drag source (dataTransfer = interest key); the image cards on the page are
 * the drop targets. The trailing "+" pill creates a new interest inline via
 * POST /api/admin/interests — the parent owns catalog state and reports back
 * whether the create succeeded so we only reset the field on success.
 */
export function TagPane({
  tags,
  onCreate,
  onDragTagStart,
  onDragTagEnd,
  dragging,
}: {
  tags: TagRow[]
  onCreate: (name: string) => Promise<boolean>
  onDragTagStart: (key: string) => void
  onDragTagEnd: () => void
  dragging: boolean
}) {
  const [filter, setFilter] = React.useState("")
  const [creating, setCreating] = React.useState(false)
  const [newName, setNewName] = React.useState("")
  const [saving, setSaving] = React.useState(false)

  const filtered = React.useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return tags
    return tags.filter(
      (t) => t.name.toLowerCase().includes(q) || t.key.toLowerCase().includes(q)
    )
  }, [tags, filter])

  const submitNew = async () => {
    const name = newName.trim()
    if (!name || saving) return
    setSaving(true)
    const ok = await onCreate(name)
    setSaving(false)
    if (ok) {
      setNewName("")
      setCreating(false)
    }
  }

  return (
    <div className="rounded-xl border bg-card">
      <div className="flex items-center gap-2 border-b px-3 py-2.5">
        <TagIcon className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Tags</h2>
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">{tags.length}</span>
      </div>

      <div className="px-3 pt-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter tags…"
            className="h-8 pl-8 text-xs"
          />
        </div>
        <p className="pt-2 text-[11px] leading-snug text-muted-foreground">
          Drag a tag onto an image to tag it. New tags are born{" "}
          <EyeOff className="inline h-3 w-3 -translate-y-px" /> hidden — enable them on
          Categories when they&apos;re ready for users.
        </p>
      </div>

      <div className="flex max-h-[60vh] flex-wrap gap-1.5 overflow-y-auto p-3">
        {filtered.map((t) => (
          <button
            key={t.key}
            type="button"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData("text/plain", t.key)
              e.dataTransfer.effectAllowed = "copy"
              onDragTagStart(t.key)
            }}
            onDragEnd={onDragTagEnd}
            title={
              t.active
                ? `${t.name} — drag onto an image to tag it`
                : `${t.name} — HIDDEN from users (enable on Categories). Still taggable here.`
            }
            className={cn(
              "inline-flex cursor-grab items-center gap-1 rounded-full border bg-background px-2.5 py-1 text-xs font-medium transition-colors hover:border-primary/60 active:cursor-grabbing",
              t.active ? "text-foreground" : "border-dashed text-muted-foreground",
              dragging && "opacity-90"
            )}
          >
            {!t.active && <EyeOff className="h-3 w-3" />}
            {t.name}
          </button>
        ))}

        {filtered.length === 0 && (
          <p className="w-full py-2 text-center text-xs text-muted-foreground/60">No tags match.</p>
        )}

        {/* Create-new affordance — the "+" that sits after all tags. */}
        {creating ? (
          <div className="flex w-full items-center gap-1.5 pt-1">
            <Input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  void submitNew()
                } else if (e.key === "Escape") {
                  setCreating(false)
                  setNewName("")
                }
              }}
              placeholder="New tag name…"
              className="h-8 flex-1 text-xs"
              disabled={saving}
            />
            <button
              type="button"
              onClick={() => void submitNew()}
              disabled={saving || !newName.trim()}
              title="Create tag"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border text-primary transition-colors hover:bg-accent disabled:opacity-40"
            >
              <Check className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                setCreating(false)
                setNewName("")
              }}
              disabled={saving}
              title="Cancel"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:bg-accent"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setCreating(true)}
            title="Create a new tag"
            className="flex items-center gap-1 rounded-full border border-dashed px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground"
          >
            <Plus className="h-3.5 w-3.5" /> New tag
          </button>
        )}
      </div>
    </div>
  )
}
