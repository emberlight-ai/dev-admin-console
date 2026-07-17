"use client"

import * as React from "react"
import { Check, EyeOff, Plus, Search, Tag as TagIcon, X } from "lucide-react"

import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"

/**
 * Tag taxonomy on this page (Carl's model):
 *   INTEREST tags — public: active AND not admin_only. Users see them
 *     (profile picker, card chips, match boost). GREEN.
 *   ADMIN tags — internal: hidden (active=false) or ops-control
 *     (admin_only, e.g. Whitelist/Featured). Curation vocabulary only. YELLOW.
 * Creating in the Interest section mints a PUBLIC tag; creating in the Admin
 * section mints a HIDDEN one (goes public via the eye toggle on Categories).
 */
export type TagRow = { key: string; name: string; active: boolean; admin_only?: boolean }

export const isAdminTag = (t: Pick<TagRow, "active" | "admin_only">) =>
  !t.active || t.admin_only === true

/** Green = public interest tag · yellow = admin/hidden tag. Shared with the
 *  image-card chips and the upload dialog so the meaning reads everywhere. */
export const tagChipClass = (admin: boolean) =>
  admin
    ? "border-amber-500/50 bg-amber-500/10 text-amber-600"
    : "border-emerald-500/50 bg-emerald-500/10 text-emerald-600"

export function TagPane({
  tags,
  onCreate,
  onDragTagStart,
  onDragTagEnd,
  dragging,
}: {
  tags: TagRow[]
  /** hidden=true → mint as admin tag (active:false). */
  onCreate: (name: string, hidden: boolean) => Promise<boolean>
  onDragTagStart: (key: string) => void
  onDragTagEnd: () => void
  dragging: boolean
}) {
  const [filter, setFilter] = React.useState("")
  const [creating, setCreating] = React.useState<null | "interest" | "admin">(null)
  const [newName, setNewName] = React.useState("")
  const [saving, setSaving] = React.useState(false)

  const filtered = React.useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return tags
    return tags.filter(
      (t) => t.name.toLowerCase().includes(q) || t.key.toLowerCase().includes(q)
    )
  }, [tags, filter])

  const interestTags = filtered.filter((t) => !isAdminTag(t))
  const adminTags = filtered.filter((t) => isAdminTag(t))

  const submitNew = async () => {
    const name = newName.trim()
    if (!name || saving || !creating) return
    setSaving(true)
    const ok = await onCreate(name, creating === "admin")
    setSaving(false)
    if (ok) {
      setNewName("")
      setCreating(null)
    }
  }

  const pill = (t: TagRow) => (
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
        isAdminTag(t)
          ? `${t.name} — admin tag (${t.active ? "ops-control" : "hidden"}); users never see it. Drag onto an image to tag it.`
          : `${t.name} — public interest tag. Drag onto an image to tag it.`
      }
      className={cn(
        "inline-flex cursor-grab items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors hover:border-primary/60 active:cursor-grabbing",
        tagChipClass(isAdminTag(t)),
        dragging && "opacity-90"
      )}
    >
      {!t.active && <EyeOff className="h-3 w-3" />}
      {t.name}
    </button>
  )

  const createRow = (section: "interest" | "admin") =>
    creating === section ? (
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
              setCreating(null)
              setNewName("")
            }
          }}
          placeholder={section === "admin" ? "New admin tag (hidden)…" : "New interest tag (public)…"}
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
            setCreating(null)
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
        onClick={() => {
          setCreating(section)
          setNewName("")
        }}
        title={section === "admin" ? "Create an admin tag (hidden from users)" : "Create a public interest tag"}
        className="flex items-center gap-1 rounded-full border border-dashed px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground"
      >
        <Plus className="h-3.5 w-3.5" /> New tag
      </button>
    )

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
          Drag a tag onto an image to tag it.
        </p>
      </div>

      <div className="max-h-[60vh] space-y-4 overflow-y-auto p-3">
        <section>
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-muted-foreground">
            <span className="h-2 w-2 rounded-full bg-emerald-500" /> INTEREST TAGS · public
          </div>
          <div className="flex flex-wrap gap-1.5">
            {interestTags.map(pill)}
            {interestTags.length === 0 && (
              <p className="w-full py-1 text-xs text-muted-foreground/60">No interest tags match.</p>
            )}
            {createRow("interest")}
          </div>
        </section>

        <section>
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-muted-foreground">
            <span className="h-2 w-2 rounded-full bg-amber-500" /> ADMIN TAGS · hidden from users
          </div>
          <div className="flex flex-wrap gap-1.5">
            {adminTags.map(pill)}
            {adminTags.length === 0 && (
              <p className="w-full py-1 text-xs text-muted-foreground/60">No admin tags match.</p>
            )}
            {createRow("admin")}
          </div>
          <p className="pt-1.5 text-[11px] leading-snug text-muted-foreground/60">
            New admin tags go public via the eye toggle on Categories.
          </p>
        </section>
      </div>
    </div>
  )
}
