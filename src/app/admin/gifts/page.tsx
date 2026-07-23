'use client'

import * as React from "react"
import { toast } from "sonner"
import {
  ArrowDown,
  ArrowUp,
  Coins,
  Eye,
  EyeOff,
  Gift as GiftIcon,
  ImageIcon,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

// ── Types ─────────────────────────────────────────────────────────────────────

type GiftRow = {
  key: string
  name: string
  asset: string
  cost_tokens: number
  sort_order: number
  active: boolean
  image_url: string | null
  created_at: string
}

type DialogState =
  | { mode: "create" }
  | { mode: "edit"; gift: GiftRow }
  | null

const slugify = (s: string) =>
  s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")

// ── Page ──────────────────────────────────────────────────────────────────────

export default function GiftsAdminPage() {
  const [gifts, setGifts] = React.useState<GiftRow[]>([])
  const [bundledAssets, setBundledAssets] = React.useState<string[]>([])
  const [loading, setLoading] = React.useState(true)
  const [dialog, setDialog] = React.useState<DialogState>(null)
  const [deleting, setDeleting] = React.useState<GiftRow | null>(null)
  const [reordering, setReordering] = React.useState(false)

  const load = React.useCallback(async () => {
    try {
      const res = await fetch("/api/admin/gifts")
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? "Failed to load gifts")
      setGifts(body.data ?? [])
      setBundledAssets(body.bundledAssets ?? [])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load gifts")
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  // ── Actions ────────────────────────────────────────────────────────────────

  const toggleActive = async (gift: GiftRow) => {
    const next = !gift.active
    setGifts((gs) => gs.map((g) => (g.key === gift.key ? { ...g, active: next } : g)))
    try {
      const res = await fetch(`/api/admin/gifts/${gift.key}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: next }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? "Failed to update gift")
      }
      toast.success(next ? `"${gift.name}" is visible in the app` : `"${gift.name}" is hidden`)
    } catch (e) {
      // Functional revert of just this row — never a whole-list snapshot.
      setGifts((gs) => gs.map((g) => (g.key === gift.key ? { ...g, active: gift.active } : g)))
      toast.error(e instanceof Error ? e.message : "Failed to update gift")
    }
  }

  /** Swap with the neighbor, renumber 1..n, persist only the changed rows.
   *  One move at a time (`reordering` gate): the batch PATCH is per-row, so a
   *  failure can be HALF-applied server-side — the only safe recovery is a
   *  re-fetch, never a client-side snapshot restore. */
  const move = async (gift: GiftRow, dir: -1 | 1) => {
    if (reordering) return
    const idx = gifts.findIndex((g) => g.key === gift.key)
    const swapWith = idx + dir
    if (idx === -1 || swapWith < 0 || swapWith >= gifts.length) return

    const next = [...gifts]
    ;[next[idx], next[swapWith]] = [next[swapWith], next[idx]]
    const renumbered = next.map((g, i) => ({ ...g, sort_order: i + 1 }))
    const changed = renumbered.filter(
      (g) => gifts.find((o) => o.key === g.key)?.sort_order !== g.sort_order
    )
    setGifts(renumbered)
    setReordering(true)

    try {
      const res = await fetch("/api/admin/gifts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          updates: changed.map(({ key, sort_order }) => ({ key, sort_order })),
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? "Failed to reorder")
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to reorder")
      await load() // server may hold a partial reorder — resync, don't guess
    } finally {
      setReordering(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleting) return
    const gift = deleting
    setDeleting(null)
    try {
      const res = await fetch(`/api/admin/gifts/${gift.key}`, { method: "DELETE" })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? "Failed to delete gift")
      setGifts((gs) => gs.filter((g) => g.key !== gift.key))
      toast.success(`Deleted "${gift.name}"`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete gift")
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <GiftIcon className="h-6 w-6" /> Gifts
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            The in-chat gift catalog: price, order and visibility are live — the app
            picks up changes on its next launch. Prices are charged server-side, so a
            price change applies immediately to every send.
          </p>
        </div>
        <Button onClick={() => setDialog({ mode: "create" })}>
          <Plus className="mr-1 h-4 w-4" /> New Gift
        </Button>
      </div>

      {loading ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">Loading…</Card>
      ) : gifts.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          No gifts yet — create the first one.
        </Card>
      ) : (
        <div className="space-y-2">
          {gifts.map((gift, i) => (
            <Card key={gift.key} className="flex-row items-center gap-4 p-3">
              <div className="flex flex-col">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  disabled={i === 0 || reordering}
                  onClick={() => void move(gift, -1)}
                  aria-label="Move up"
                >
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  disabled={i === gifts.length - 1 || reordering}
                  onClick={() => void move(gift, 1)}
                  aria-label="Move down"
                >
                  <ArrowDown className="h-4 w-4" />
                </Button>
              </div>

              {/* eslint-disable-next-line @next/next/no-img-element */}
              {gift.image_url ? (
                <img
                  src={gift.image_url}
                  alt={gift.name}
                  className="h-14 w-14 rounded-lg object-contain bg-muted p-1"
                />
              ) : (
                <div
                  className="flex h-14 w-14 items-center justify-center rounded-lg bg-muted"
                  title={`Bundled iOS asset: ${gift.asset}`}
                >
                  <ImageIcon className="h-5 w-5 text-muted-foreground" />
                </div>
              )}

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-semibold">{gift.name}</span>
                  <Badge variant="outline" className="font-mono text-[10px]">
                    {gift.key}
                  </Badge>
                  {!gift.active && <Badge variant="secondary">Hidden</Badge>}
                </div>
                <div className="mt-0.5 flex items-center gap-1 text-sm text-muted-foreground">
                  <Coins className="h-3.5 w-3.5" />
                  {gift.cost_tokens.toLocaleString()} tokens
                  {!gift.image_url && (
                    <span className="ml-2 text-xs">· bundled art ({gift.asset})</span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => void toggleActive(gift)}
                  title={gift.active ? "Hide from the app" : "Show in the app"}
                >
                  {gift.active ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setDialog({ mode: "edit", gift })}
                  title="Edit"
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setDeleting(gift)}
                  title="Delete (only if never sent)"
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {dialog && (
        <GiftDialog
          state={dialog}
          bundledAssets={bundledAssets}
          onClose={() => setDialog(null)}
          onSaved={(row, mode) => {
            setDialog(null)
            setGifts((gs) =>
              mode === "create"
                ? [...gs, row].sort((a, b) => a.sort_order - b.sort_order)
                : gs.map((g) => (g.key === row.key ? row : g))
            )
            toast.success(mode === "create" ? `Created "${row.name}"` : `Saved "${row.name}"`)
          }}
        />
      )}

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleting?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Only gifts that were never sent can be deleted — anything with history
              should be hidden instead so old chat bubbles and the token ledger keep
              working. This also removes the uploaded art.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmDelete()}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ── Create / Edit dialog ──────────────────────────────────────────────────────

function GiftDialog({
  state,
  bundledAssets,
  onClose,
  onSaved,
}: {
  state: NonNullable<DialogState>
  bundledAssets: string[]
  onClose: () => void
  onSaved: (row: GiftRow, mode: "create" | "edit") => void
}) {
  const editing = state.mode === "edit" ? state.gift : null

  const [name, setName] = React.useState(editing?.name ?? "")
  const [cost, setCost] = React.useState(editing ? String(editing.cost_tokens) : "")
  const [asset, setAsset] = React.useState(editing?.asset ?? "gift-roses")
  const [file, setFile] = React.useState<File | null>(null)
  const [removeImage, setRemoveImage] = React.useState(false)
  const [saving, setSaving] = React.useState(false)

  const preview = React.useMemo(
    () => (file ? URL.createObjectURL(file) : null),
    [file]
  )
  React.useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview)
    }
  }, [preview])

  const currentImage = removeImage ? null : preview ?? editing?.image_url ?? null

  const submit = async () => {
    const costNum = Number(cost)
    if (!name.trim()) return toast.error("Name is required")
    if (!Number.isInteger(costNum) || costNum <= 0)
      return toast.error("Price must be a positive whole number of tokens")

    setSaving(true)
    try {
      const form = new FormData()
      form.set("name", name.trim())
      form.set("cost_tokens", String(costNum))
      form.set("asset", asset)
      if (file) form.set("image", file)

      let res: Response
      if (editing) {
        if (removeImage && !file) form.set("remove_image", "true")
        res = await fetch(`/api/admin/gifts/${editing.key}`, { method: "PATCH", body: form })
      } else {
        res = await fetch("/api/admin/gifts", { method: "POST", body: form })
      }
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? "Save failed")
      onSaved(body.data as GiftRow, editing ? "edit" : "create")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${editing.name}` : "New Gift"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Price and visibility apply immediately; art changes show on the app's next catalog load."
              : "New gifts appear in the app without a release — upload art below."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="gift-name">Name</Label>
            <Input
              id="gift-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Sports Car"
            />
            {!editing && name.trim() && (
              <p className="text-xs text-muted-foreground">
                Key: <span className="font-mono">{slugify(name)}</span>
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="gift-cost">Price (tokens)</Label>
            <Input
              id="gift-cost"
              type="number"
              min={1}
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              placeholder="500"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Art</Label>
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {currentImage ? (
                <img
                  src={currentImage}
                  alt="Gift art"
                  className="h-16 w-16 rounded-lg object-contain bg-muted p-1"
                />
              ) : (
                <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-muted">
                  <ImageIcon className="h-5 w-5 text-muted-foreground" />
                </div>
              )}
              <div className="flex-1 space-y-1">
                <Input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(e) => {
                    setFile(e.target.files?.[0] ?? null)
                    setRemoveImage(false)
                  }}
                />
                {editing?.image_url && !file && !removeImage && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs text-destructive"
                    onClick={() => setRemoveImage(true)}
                  >
                    Remove uploaded art
                  </Button>
                )}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              PNG with transparency looks best. ≤ 8MB.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>Fallback art (older app versions)</Label>
            <Select value={asset} onValueChange={setAsset}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {bundledAssets.map((a) => (
                  <SelectItem key={a} value={a} className="font-mono text-xs">
                    {a}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              App builds that predate the uploaded image show this bundled imageset.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={saving}>
            {saving ? "Saving…" : editing ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
