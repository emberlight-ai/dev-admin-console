"use client"

import * as React from "react"
import Link from "next/link"
import { Eye, EyeOff, Pencil, Plus, Trash2, Users } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

type Interest = {
  key: string
  name: string
  asset: string
  sort_order: number
  active: boolean
  admin_only?: boolean
  member_count: number
}

type Draft = { key: string; name: string; asset: string }

export default function InterestsAdminPage() {
  const [rows, setRows] = React.useState<Interest[]>([])
  const [loading, setLoading] = React.useState(true)
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [editingKey, setEditingKey] = React.useState<string | null>(null)
  const [draft, setDraft] = React.useState<Draft>({ key: "", name: "", asset: "explore_gothic" })
  const [saving, setSaving] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/admin/interests")
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "Failed to load interests")
      setRows(json.data ?? [])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load interests")
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => { void load() }, [load])

  const openCreate = () => {
    setEditingKey(null)
    setDraft({ key: "", name: "", asset: "explore_gothic" })
    setDialogOpen(true)
  }

  const openEdit = (i: Interest) => {
    setEditingKey(i.key)
    setDraft({ key: i.key, name: i.name, asset: i.asset })
    setDialogOpen(true)
  }

  const save = async () => {
    setSaving(true)
    try {
      const res = editingKey
        ? await fetch(`/api/admin/interests/${encodeURIComponent(editingKey)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: draft.name, asset: draft.asset }),
          })
        : await fetch("/api/admin/interests", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(draft),
          })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "Failed to save")
      toast.success(editingKey ? "Interest updated" : "Interest created")
      setDialogOpen(false)
      void load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save")
    } finally {
      setSaving(false)
    }
  }

  const toggleHidden = async (i: Interest) => {
    try {
      const res = await fetch(`/api/admin/interests/${encodeURIComponent(i.key)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !i.active }),
      })
      if (!res.ok) throw new Error((await res.json()).error || "Failed")
      setRows((prev) => prev.map((r) => (r.key === i.key ? { ...r, active: !i.active } : r)))
      toast.success(i.active ? "Interest hidden" : "Interest shown")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed")
    }
  }

  const remove = async (i: Interest) => {
    if (!confirm(`Delete "${i.name}"? This removes it from ${i.member_count} member(s). Consider hiding instead.`)) return
    try {
      const res = await fetch(`/api/admin/interests/${encodeURIComponent(i.key)}`, { method: "DELETE" })
      if (!res.ok) throw new Error((await res.json()).error || "Failed")
      toast.success("Interest deleted")
      void load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed")
    }
  }

  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Interests</h1>
          <p className="text-sm text-muted-foreground">
            Explore categories. Hidden interests disappear from the app on next launch; the
            image field must match a bundled iOS asset name.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" /> New Interest
        </Button>
      </div>

      <Card className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Key</TableHead>
              <TableHead>Asset</TableHead>
              <TableHead className="text-right">Members</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Loading…</TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No interests yet.</TableCell></TableRow>
            ) : (
              rows.map((i) => (
                <TableRow key={i.key} className={i.active ? "" : "opacity-50"}>
                  <TableCell className="font-medium">
                    {i.name}
                    {i.admin_only && (
                      <span className="ml-2 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-600">
                        Admin only
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{i.key}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{i.asset}</TableCell>
                  <TableCell className="text-right tabular-nums">{i.member_count}</TableCell>
                  <TableCell>
                    <span className={i.active ? "text-green-600 text-xs" : "text-muted-foreground text-xs"}>
                      {i.active ? "Visible" : "Hidden"}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button asChild variant="ghost" size="icon" title="Manage members">
                        <Link href={`/admin/interests/${encodeURIComponent(i.key)}`}><Users className="h-4 w-4" /></Link>
                      </Button>
                      <Button variant="ghost" size="icon" title="Edit" onClick={() => openEdit(i)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" title={i.active ? "Hide" : "Show"} onClick={() => void toggleHidden(i)}>
                        {i.active ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                      <Button variant="ghost" size="icon" title="Delete" onClick={() => void remove(i)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingKey ? "Edit Interest" : "New Interest"}</DialogTitle>
            <DialogDescription>
              {editingKey
                ? "Update the display name or bundled asset."
                : "Key is auto-slugified and permanent. Asset must match a bundled iOS imageset."}
            </DialogDescription>
          </DialogHeader>

          {/* Body pads itself (DialogContent is a p-0 shell per design.md). */}
          <div className="space-y-3 p-4 pt-0">
            <div className="space-y-1">
              <Label>Name</Label>
              <Input
                value={draft.name}
                placeholder="Music Lover"
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              />
            </div>
            {!editingKey && (
              <div className="space-y-1">
                <Label>Key (optional — derived from name)</Label>
                <Input
                  value={draft.key}
                  placeholder="music_lover"
                  onChange={(e) => setDraft((d) => ({ ...d, key: e.target.value }))}
                />
              </div>
            )}
            <div className="space-y-1">
              <Label>iOS asset name</Label>
              <Input
                value={draft.asset}
                placeholder="explore_music_lover"
                onChange={(e) => setDraft((d) => ({ ...d, asset: e.target.value }))}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={() => void save()} disabled={saving || !draft.name.trim()}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
