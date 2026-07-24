"use client"

import * as React from "react"
import { Eye, EyeOff, FolderPlus, GripVertical, Leaf, Pencil, Plus, ShieldCheck, Trash2, Users } from "lucide-react"
import { toast } from "sonner"

import { AssignDigitalHumansDialog } from "./_components/assign-dhs-dialog"
import { cn } from "@/lib/utils"
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

type Category = {
  key: string
  name: string
  asset: string
  sort_order: number
  active: boolean
  admin_only?: boolean
  interest_count: number
}

type Interest = {
  key: string
  name: string
  asset: string
  sort_order: number
  active: boolean
  admin_only?: boolean
  category_key: string
  member_count: number
}

const UNSPECIFIED = "unspecified"

// Internal-control categories: not ordinary Explore tiles. Ops manage them by
// tagging DHs; they can't be hidden or deleted (Whitelist backs the home deck
// via users.whitelisted; Featured is the curated Explore spotlight; Green Mode
// gates every matching surface behind its tag while enabled).
const INTERNAL_DESCRIPTIONS: Record<string, string> = {
  whitelist:
    "Tag a digital human here to add them to the home swipe deck (the main Find-a-Mate cards). Internal control — not shown as an Explore tile.",
  featured:
    "The curated spotlight tile on the iOS Explore page. Tag digital humans here to feature them. Internal control — users can't self-select it.",
  green_mode:
    "Tag digital humans here to build the Green Mode pool. While enabled, every matching surface (swipe deck, Explore, invitations, boosts) only serves tagged DHs. Internal control — not shown as an Explore tile.",
}
const INTERNAL = new Set(Object.keys(INTERNAL_DESCRIPTIONS))

type DragState = { kind: "card"; key: string } | { kind: "column"; key: string } | null

export default function InterestsAdminPage() {
  const [categories, setCategories] = React.useState<Category[]>([])
  const [interests, setInterests] = React.useState<Interest[]>([])
  const [loading, setLoading] = React.useState(true)

  // Kanban drag state. cardDrop.index is the insertion slot inside the target
  // column; colDrop is the insertion slot among the real (non-unspecified)
  // columns, 0..realCount.
  const [drag, setDrag] = React.useState<DragState>(null)
  const [cardDrop, setCardDrop] = React.useState<{ category: string; index: number } | null>(null)
  const [colDrop, setColDrop] = React.useState<number | null>(null)

  const [catDialog, setCatDialog] = React.useState<{ open: boolean; editing: string | null }>({ open: false, editing: null })
  const [catDraft, setCatDraft] = React.useState({ key: "", name: "", asset: "explore_gothic" })
  const [intDialog, setIntDialog] = React.useState<{ open: boolean; editing: string | null }>({ open: false, editing: null })
  const [intDraft, setIntDraft] = React.useState({ key: "", name: "", asset: "explore_gothic", category_key: UNSPECIFIED })
  const [saving, setSaving] = React.useState(false)
  // Which interest's "assign digital humans" popup is open.
  const [assignTarget, setAssignTarget] = React.useState<{ key: string; name: string } | null>(null)
  // Green Mode switch (digital_human_config.green_mode_enabled). null = not loaded.
  const [greenModeEnabled, setGreenModeEnabled] = React.useState<boolean | null>(null)
  const [greenModeSaving, setGreenModeSaving] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const [catRes, intRes, gmRes] = await Promise.all([
        fetch("/api/admin/interest-categories"),
        fetch("/api/admin/interests"),
        fetch("/api/admin/matching/green-mode"),
      ])
      const catJson = await catRes.json()
      const intJson = await intRes.json()
      if (!catRes.ok) throw new Error(catJson.error || "Failed to load categories")
      if (!intRes.ok) throw new Error(intJson.error || "Failed to load interests")
      setCategories(catJson.data ?? [])
      setInterests(intJson.data ?? [])
      // The switch is auxiliary — a failure disables the toggle, not the board.
      const gmJson = gmRes.ok ? await gmRes.json() : null
      setGreenModeEnabled(typeof gmJson?.data?.enabled === "boolean" ? gmJson.data.enabled : null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load")
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => { void load() }, [load])

  const realCategories = React.useMemo(
    () => categories.filter((c) => c.key !== UNSPECIFIED).sort((a, b) => a.sort_order - b.sort_order),
    [categories]
  )
  const unspecCategory = React.useMemo(
    () => categories.find((c) => c.key === UNSPECIFIED) ?? null,
    [categories]
  )
  // Unspecified is always the last column — the permanent "drag out" target.
  const columnOrder = React.useMemo(
    () => (unspecCategory ? [...realCategories, unspecCategory] : realCategories),
    [realCategories, unspecCategory]
  )

  const cardsByCategory = React.useMemo(() => {
    const map = new Map<string, Interest[]>()
    const sorted = [...interests].sort((a, b) => a.sort_order - b.sort_order || a.key.localeCompare(b.key))
    for (const i of sorted) {
      const list = map.get(i.category_key) ?? []
      list.push(i)
      map.set(i.category_key, list)
    }
    return map
  }, [interests])

  const clearDrag = React.useCallback(() => {
    setDrag(null)
    setCardDrop(null)
    setColDrop(null)
  }, [])

  // ── Drag: persistence ─────────────────────────────────────────────────────

  const persistCards = async (changed: { key: string; category_key: string; sort_order: number }[]) => {
    try {
      const res = await fetch("/api/admin/interests", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates: changed }),
      })
      if (!res.ok) throw new Error((await res.json()).error || "Failed to save layout")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save layout")
      void load()
    }
  }

  const persistColumns = async (changed: { key: string; sort_order: number }[]) => {
    try {
      const results = await Promise.all(
        changed.map((c) =>
          fetch(`/api/admin/interest-categories/${encodeURIComponent(c.key)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sort_order: c.sort_order }),
          })
        )
      )
      if (results.some((r) => !r.ok)) throw new Error("Failed to save column order")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save column order")
      void load()
    }
  }

  // ── Drag: apply a drop ────────────────────────────────────────────────────

  /**
   * Move a card into `toCategory` at `toIndex`, then renumber sort_order
   * globally in board order (columns left→right, cards top→bottom). Board
   * order therefore IS the iOS picker order, grouped by category.
   */
  const applyCardDrop = (cardKey: string, toCategory: string, toIndex: number) => {
    const current = interests.find((i) => i.key === cardKey)
    if (!current) return

    const cols = new Map<string, Interest[]>()
    for (const c of columnOrder) cols.set(c.key, [...(cardsByCategory.get(c.key) ?? [])])

    const fromList = cols.get(current.category_key)
    const fromIndex = fromList?.findIndex((i) => i.key === cardKey) ?? -1
    if (fromList && fromIndex >= 0) fromList.splice(fromIndex, 1)

    let insertIndex = toIndex
    if (current.category_key === toCategory && fromIndex >= 0 && fromIndex < toIndex) insertIndex--
    const toList = cols.get(toCategory)
    if (!toList) return
    insertIndex = Math.max(0, Math.min(insertIndex, toList.length))
    toList.splice(insertIndex, 0, current)

    let n = 0
    const next: Interest[] = []
    const changed: { key: string; category_key: string; sort_order: number }[] = []
    const seen = new Set<string>()
    for (const c of columnOrder) {
      for (const card of cols.get(c.key) ?? []) {
        seen.add(card.key)
        if (card.category_key !== c.key || card.sort_order !== n) {
          next.push({ ...card, category_key: c.key, sort_order: n })
          changed.push({ key: card.key, category_key: c.key, sort_order: n })
        } else {
          next.push(card)
        }
        n++
      }
    }
    // Safety: never drop rows whose category isn't on the board.
    for (const i of interests) if (!seen.has(i.key)) next.push(i)

    if (changed.length === 0) return
    setInterests(next)
    void persistCards(changed)
  }

  /** Reorder the real columns; sort_order is the iOS Explore tile order. */
  const applyColumnDrop = (colKey: string, toIndex: number) => {
    const fromIndex = realCategories.findIndex((c) => c.key === colKey)
    if (fromIndex < 0) return
    const list = [...realCategories]
    const [moved] = list.splice(fromIndex, 1)
    let insertIndex = toIndex
    if (fromIndex < toIndex) insertIndex--
    insertIndex = Math.max(0, Math.min(insertIndex, list.length))
    list.splice(insertIndex, 0, moved)

    const changed: { key: string; sort_order: number }[] = []
    const next = list.map((c, i) => {
      if (c.sort_order !== i) changed.push({ key: c.key, sort_order: i })
      return { ...c, sort_order: i }
    })
    if (changed.length === 0) return
    setCategories(unspecCategory ? [...next, unspecCategory] : next)
    void persistColumns(changed)
  }

  const handleBoardDrop = (e: React.DragEvent) => {
    e.preventDefault()
    if (drag?.kind === "card" && cardDrop) applyCardDrop(drag.key, cardDrop.category, cardDrop.index)
    else if (drag?.kind === "column" && colDrop != null) applyColumnDrop(drag.key, colDrop)
    clearDrag()
  }

  // ── Drag: hover targeting ─────────────────────────────────────────────────

  const onCardDragOver = (e: React.DragEvent, categoryKey: string, cardIndex: number) => {
    if (drag?.kind !== "card") return
    e.preventDefault()
    e.stopPropagation()
    const rect = e.currentTarget.getBoundingClientRect()
    const index = cardIndex + (e.clientY > rect.top + rect.height / 2 ? 1 : 0)
    setCardDrop((prev) =>
      prev && prev.category === categoryKey && prev.index === index ? prev : { category: categoryKey, index }
    )
  }

  const onColumnDragOver = (e: React.DragEvent, category: Category, columnIndex: number, cardCount: number) => {
    e.preventDefault()
    if (drag?.kind === "card") {
      // Fallback when not over a specific card: drop at the end.
      setCardDrop((prev) =>
        prev && prev.category === category.key && prev.index === cardCount
          ? prev
          : { category: category.key, index: cardCount }
      )
    } else if (drag?.kind === "column") {
      if (category.key === UNSPECIFIED) {
        setColDrop(realCategories.length)
        return
      }
      const rect = e.currentTarget.getBoundingClientRect()
      setColDrop(columnIndex + (e.clientX > rect.left + rect.width / 2 ? 1 : 0))
    }
  }

  // ── Green Mode switch ──────────────────────────────────────────────────────

  const greenPoolCount = React.useMemo(
    () => interests.find((i) => i.key === "green_mode")?.member_count ?? 0,
    [interests]
  )

  const toggleGreenMode = async () => {
    if (greenModeEnabled == null || greenModeSaving) return
    const next = !greenModeEnabled
    setGreenModeSaving(true)
    try {
      const res = await fetch("/api/admin/matching/green-mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      })
      if (!res.ok) throw new Error((await res.json()).error || "Failed to save Green Mode")
      setGreenModeEnabled(next)
      toast.success(next ? "Green Mode enabled — only tagged DHs are served" : "Green Mode disabled — normal matching")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save Green Mode")
    } finally {
      setGreenModeSaving(false)
    }
  }

  // ── Category actions ───────────────────────────────────────────────────────

  const saveCategory = async () => {
    setSaving(true)
    try {
      const editing = catDialog.editing
      const res = editing
        ? await fetch(`/api/admin/interest-categories/${encodeURIComponent(editing)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: catDraft.name, asset: catDraft.asset }),
          })
        : await fetch("/api/admin/interest-categories", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(catDraft),
          })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "Failed to save category")
      toast.success(editing ? "Category updated" : "Category created")
      setCatDialog({ open: false, editing: null })
      void load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save category")
    } finally {
      setSaving(false)
    }
  }

  const toggleCategoryHidden = async (c: Category) => {
    try {
      const res = await fetch(`/api/admin/interest-categories/${encodeURIComponent(c.key)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !c.active }),
      })
      if (!res.ok) throw new Error((await res.json()).error || "Failed")
      setCategories((prev) => prev.map((x) => (x.key === c.key ? { ...x, active: !c.active } : x)))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed")
    }
  }

  const removeCategory = async (c: Category) => {
    const count = cardsByCategory.get(c.key)?.length ?? 0
    if (!confirm(`Delete category "${c.name}"? Its ${count} interest(s) move to Unspecified.`)) return
    try {
      const res = await fetch(`/api/admin/interest-categories/${encodeURIComponent(c.key)}`, { method: "DELETE" })
      if (!res.ok) throw new Error((await res.json()).error || "Failed")
      toast.success("Category deleted — interests moved to Unspecified")
      void load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed")
    }
  }

  // ── Interest actions ───────────────────────────────────────────────────────

  const saveInterest = async () => {
    setSaving(true)
    try {
      const editing = intDialog.editing
      const res = editing
        ? await fetch(`/api/admin/interests/${encodeURIComponent(editing)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: intDraft.name, asset: intDraft.asset, category_key: intDraft.category_key }),
          })
        : await fetch("/api/admin/interests", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(intDraft),
          })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "Failed to save interest")
      toast.success(editing ? "Interest updated" : "Interest created")
      setIntDialog({ open: false, editing: null })
      void load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save interest")
    } finally {
      setSaving(false)
    }
  }

  const toggleInterestHidden = async (i: Interest) => {
    try {
      const res = await fetch(`/api/admin/interests/${encodeURIComponent(i.key)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !i.active }),
      })
      if (!res.ok) throw new Error((await res.json()).error || "Failed")
      setInterests((prev) => prev.map((x) => (x.key === i.key ? { ...x, active: !i.active } : x)))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed")
    }
  }

  const removeInterest = async (i: Interest) => {
    if (!confirm(`Delete "${i.name}"? This removes it from ${i.member_count} member(s).`)) return
    try {
      const res = await fetch(`/api/admin/interests/${encodeURIComponent(i.key)}`, { method: "DELETE" })
      if (!res.ok) throw new Error((await res.json()).error || "Failed")
      toast.success("Interest deleted")
      void load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed")
    }
  }

  const openNewInterest = (categoryKey: string) => {
    setIntDraft({ key: "", name: "", asset: "explore_gothic", category_key: categoryKey })
    setIntDialog({ open: true, editing: null })
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const dropLine = (
    <div
      className="h-0.5 shrink-0 rounded-full bg-primary"
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation() }}
    />
  )

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Categories &amp; interests</h1>
          <p className="text-sm text-muted-foreground">
            Drag interests between columns to recategorize them, and drag column headers to reorder
            the Explore tiles. Board order is the iOS picker order. Deleting a category moves its
            interests to Unspecified; deleting an interest removes it from everyone who had it.
          </p>
        </div>
        <Button className="shrink-0" onClick={() => { setCatDraft({ key: "", name: "", asset: "explore_gothic" }); setCatDialog({ open: true, editing: null }) }}>
          <FolderPlus className="mr-2 h-4 w-4" /> New category
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div
          className="grid grid-cols-1 items-start gap-3 pb-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleBoardDrop}
        >
          {columnOrder.map((c, columnIndex) => {
            const cards = cardsByCategory.get(c.key) ?? []
            const isUnspec = c.key === UNSPECIFIED
            const isCardTarget = drag?.kind === "card" && cardDrop?.category === c.key
            // Column-drop insertion marker: a left bar before the target column,
            // or a right bar after the last real column (drop-at-end).
            const showLeftBar = drag?.kind === "column" && colDrop === columnIndex && !isUnspec
            const showRightBar =
              drag?.kind === "column" &&
              colDrop === realCategories.length &&
              columnIndex === realCategories.length - 1
            const isInternal = INTERNAL.has(c.key)
            const isGreenMode = c.key === "green_mode"
            const internalDescription = INTERNAL_DESCRIPTIONS[c.key]
            return (
              <div key={c.key} className="relative">
                {showLeftBar && <div className="absolute -left-2 bottom-0 top-0 w-1 rounded-full bg-primary" />}
                {showRightBar && <div className="absolute -right-2 bottom-0 top-0 w-1 rounded-full bg-primary" />}
                <div
                  className={cn(
                    "rounded-xl border bg-muted/40",
                    isInternal && !isGreenMode && "border-amber-400/40 bg-amber-500/5",
                    isGreenMode && "border-emerald-400/40 bg-emerald-500/5",
                    !c.active && !isInternal && "opacity-60",
                    isCardTarget && "ring-1 ring-ring",
                    drag?.kind === "column" && drag.key === c.key && "opacity-40"
                  )}
                  onDragOver={(e) => onColumnDragOver(e, c, columnIndex, cards.length)}
                >
                  <div
                    draggable={!isUnspec}
                    onDragStart={!isUnspec ? (e) => {
                      e.dataTransfer.setData("text/plain", c.key)
                      e.dataTransfer.effectAllowed = "move"
                      setDrag({ kind: "column", key: c.key })
                    } : undefined}
                    onDragEnd={clearDrag}
                    onDragOver={(e) => {
                      // Hovering a header drops the card at the top of its column.
                      if (drag?.kind !== "card") return
                      e.preventDefault()
                      e.stopPropagation()
                      setCardDrop((prev) =>
                        prev && prev.category === c.key && prev.index === 0 ? prev : { category: c.key, index: 0 }
                      )
                    }}
                    className={cn(
                      "flex items-center justify-between gap-1 px-3 py-2",
                      !isUnspec && "cursor-grab active:cursor-grabbing"
                    )}
                  >
                    <div className="flex min-w-0 items-center gap-1.5">
                      {!isUnspec && !isInternal && <GripVertical className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />}
                      {isInternal && (isGreenMode
                        ? <Leaf className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                        : <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-amber-600" />)}
                      <span className="truncate text-sm font-semibold">{c.name}</span>
                      {isGreenMode ? (
                        // The Green Mode switch: while on, every matching surface
                        // only serves DHs tagged in this column.
                        <button
                          type="button"
                          onClick={() => void toggleGreenMode()}
                          disabled={greenModeEnabled == null || greenModeSaving}
                          title={
                            greenModeEnabled
                              ? "Green Mode is on — only tagged DHs are served. Click to disable."
                              : "Green Mode is off — normal matching. Click to enable."
                          }
                          className={cn(
                            "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold transition-colors",
                            greenModeEnabled
                              ? "bg-emerald-500 text-white hover:bg-emerald-600"
                              : "bg-muted text-muted-foreground hover:bg-emerald-500/15 hover:text-emerald-600",
                            (greenModeEnabled == null || greenModeSaving) && "opacity-50"
                          )}
                        >
                          {greenModeEnabled == null ? "…" : greenModeEnabled ? "Enabled" : "Off"}
                        </button>
                      ) : isInternal ? (
                        <span className="shrink-0 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-600">Internal</span>
                      ) : (
                        <>
                          {c.admin_only && (
                            <span className="shrink-0 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-600">Admin only</span>
                          )}
                          {!c.active && (
                            <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">Hidden</span>
                          )}
                        </>
                      )}
                      <span className="text-xs text-muted-foreground tabular-nums">{cards.length}</span>
                    </div>
                    {!isUnspec && (
                      <div className="flex shrink-0 items-center">
                        {/* Internal categories can't gain sub-interests, be hidden, or deleted. */}
                        {!isInternal && (
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="Add interest" onClick={() => openNewInterest(c.key)}><Plus className="h-3.5 w-3.5" /></Button>
                        )}
                        <Button variant="ghost" size="icon" className="h-7 w-7" title="Edit category" onClick={() => { setCatDraft({ key: c.key, name: c.name, asset: c.asset }); setCatDialog({ open: true, editing: c.key }) }}><Pencil className="h-3.5 w-3.5" /></Button>
                        {!isInternal && (
                          <>
                            <Button variant="ghost" size="icon" className="h-7 w-7" title={c.active ? "Hide" : "Show"} onClick={() => void toggleCategoryHidden(c)}>{c.active ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}</Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7" title="Delete category" onClick={() => void removeCategory(c)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                          </>
                        )}
                      </div>
                    )}
                  </div>

                  {internalDescription && (
                    <p className="px-3 pb-2 text-xs leading-snug text-muted-foreground">{internalDescription}</p>
                  )}

                  {isGreenMode && greenModeEnabled === true && greenPoolCount === 0 && (
                    <p className="mx-3 mb-2 rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
                      Green Mode is enabled but no digital humans are tagged — every matching deck is empty.
                    </p>
                  )}

                  <div className="flex min-h-12 flex-col gap-1.5 p-2 pt-0">
                    {cards.map((i, cardIndex) => (
                      <React.Fragment key={i.key}>
                        {isCardTarget && cardDrop?.index === cardIndex && dropLine}
                        <div
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.setData("text/plain", i.key)
                            e.dataTransfer.effectAllowed = "move"
                            setDrag({ kind: "card", key: i.key })
                          }}
                          onDragEnd={clearDrag}
                          onDragOver={(e) => onCardDragOver(e, c.key, cardIndex)}
                          className={cn(
                            "group cursor-grab rounded-lg border bg-card px-3 py-2 active:cursor-grabbing",
                            !i.active && "opacity-50",
                            drag?.kind === "card" && drag.key === i.key && "border-dashed opacity-40"
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                {i.key === "green_mode" && <Leaf className="h-3 w-3 shrink-0 text-emerald-600" />}
                                <span className="truncate text-sm font-medium">{i.name}</span>
                                {i.admin_only && <span className="shrink-0 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-600">Admin</span>}
                                {!i.active && <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">Hidden</span>}
                              </div>
                              <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                                {i.member_count} member{i.member_count === 1 ? "" : "s"}
                              </p>
                            </div>
                            <div className="flex shrink-0 items-center opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                              <Button variant="ghost" size="icon" className="h-7 w-7" title="Assign digital humans" onClick={() => setAssignTarget({ key: i.key, name: i.name })}><Users className="h-3.5 w-3.5" /></Button>
                              <Button variant="ghost" size="icon" className="h-7 w-7" title="Edit" onClick={() => { setIntDraft({ key: i.key, name: i.name, asset: i.asset, category_key: i.category_key }); setIntDialog({ open: true, editing: i.key }) }}><Pencil className="h-3.5 w-3.5" /></Button>
                              {/* Internal interests (Whitelist/Featured) can't be hidden or deleted. */}
                              {!INTERNAL.has(i.key) && (
                                <>
                                  <Button variant="ghost" size="icon" className="h-7 w-7" title={i.active ? "Hide" : "Show"} onClick={() => void toggleInterestHidden(i)}>{i.active ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}</Button>
                                  <Button variant="ghost" size="icon" className="h-7 w-7" title="Delete" onClick={() => void removeInterest(i)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      </React.Fragment>
                    ))}
                    {isCardTarget && cardDrop?.index === cards.length && dropLine}
                    {cards.length === 0 && drag?.kind !== "card" && (
                      <p className="rounded-lg border border-dashed px-3 py-3 text-center text-xs text-muted-foreground/60">
                        {isUnspec ? (
                          "Drop here to unassign"
                        ) : (
                          <>Drop interests here or <button className="underline" onClick={() => openNewInterest(c.key)}>add one</button></>
                        )}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Category dialog */}
      <Dialog open={catDialog.open} onOpenChange={(v) => setCatDialog((s) => ({ ...s, open: v }))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{catDialog.editing ? "Edit category" : "New category"}</DialogTitle>
            <DialogDescription>Categories are the iOS Explore tiles. The asset must match a bundled iOS imageset.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 p-4 pt-0">
            <div className="space-y-1">
              <Label>Name</Label>
              <Input value={catDraft.name} placeholder="Adventure" onChange={(e) => setCatDraft((d) => ({ ...d, name: e.target.value }))} />
            </div>
            {!catDialog.editing && (
              <div className="space-y-1">
                <Label>Key (optional — derived from name)</Label>
                <Input value={catDraft.key} placeholder="adventure" onChange={(e) => setCatDraft((d) => ({ ...d, key: e.target.value }))} />
              </div>
            )}
            <div className="space-y-1">
              <Label>iOS asset name</Label>
              <Input value={catDraft.asset} placeholder="explore_adventure" onChange={(e) => setCatDraft((d) => ({ ...d, asset: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCatDialog({ open: false, editing: null })}>Cancel</Button>
            <Button onClick={() => void saveCategory()} disabled={saving || !catDraft.name.trim()}>{saving ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Interest dialog */}
      <Dialog open={intDialog.open} onOpenChange={(v) => setIntDialog((s) => ({ ...s, open: v }))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{intDialog.editing ? "Edit interest" : "New interest"}</DialogTitle>
            <DialogDescription>{intDialog.editing ? "Update the interest or move it to another category." : "The key is auto-slugified and permanent."}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 p-4 pt-0">
            <div className="space-y-1">
              <Label>Name</Label>
              <Input value={intDraft.name} placeholder="Rock climbing" onChange={(e) => setIntDraft((d) => ({ ...d, name: e.target.value }))} />
            </div>
            {!intDialog.editing && (
              <div className="space-y-1">
                <Label>Key (optional — derived from name)</Label>
                <Input value={intDraft.key} placeholder="rock_climbing" onChange={(e) => setIntDraft((d) => ({ ...d, key: e.target.value }))} />
              </div>
            )}
            <div className="space-y-1">
              <Label>Category</Label>
              <select
                value={intDraft.category_key}
                onChange={(e) => setIntDraft((d) => ({ ...d, category_key: e.target.value }))}
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              >
                {categories.map((cat) => (
                  <option key={cat.key} value={cat.key}>{cat.name}</option>
                ))}
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIntDialog({ open: false, editing: null })}>Cancel</Button>
            <Button onClick={() => void saveInterest()} disabled={saving || !intDraft.name.trim()}>{saving ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign-DHs popup — member management + per-category swipe performance. */}
      <AssignDigitalHumansDialog
        interestKey={assignTarget?.key ?? null}
        interestName={assignTarget?.name ?? ""}
        onOpenChange={(open) => { if (!open) setAssignTarget(null) }}
        onChanged={load}
      />
    </div>
  )
}
