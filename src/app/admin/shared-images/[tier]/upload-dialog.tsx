"use client"

import * as React from "react"
import Image from "next/image"
import { X } from "lucide-react"
import { toast } from "sonner"

import { FileDropzone } from "@/components/file-dropzone"
import { LocationAutocomplete, type LocationSelection } from "@/components/location-autocomplete"
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

// active=false → hidden from users but still valid image-curation vocabulary.
type InterestRow = { key: string; name: string; active: boolean }

type Selected = { file: File; url: string; description: string }

const ACCEPT = "image/jpeg,image/png,image/webp"

/**
 * Batch upload: multiple images share one set of tags/location/post-content;
 * each image gets its OWN description (it feeds the digital human's memory of
 * what she shared, so it must be per-photo).
 */
export function UploadDialog({
  tier,
  open,
  onOpenChange,
  onUploaded,
}: {
  tier: string
  open: boolean
  onOpenChange: (v: boolean) => void
  onUploaded: () => void
}) {
  const [items, setItems] = React.useState<Selected[]>([])
  const [postContent, setPostContent] = React.useState("")
  const [interests, setInterests] = React.useState<Set<string>>(new Set())
  const [catalog, setCatalog] = React.useState<InterestRow[]>([])
  const [timeOfDay, setTimeOfDay] = React.useState<string | null>(null)
  const [locationQuery, setLocationQuery] = React.useState("")
  const [location, setLocation] = React.useState<LocationSelection | null>(null)
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    void (async () => {
      try {
        const res = await fetch("/api/admin/interests")
        if (!res.ok) return
        // ALL rows, hidden included — new tags are born hidden and must still
        // be applicable to uploads (they go user-visible via Categories).
        const rows = ((await res.json()).data ?? []) as Array<InterestRow & { active?: boolean }>
        setCatalog(rows.map((i) => ({ key: i.key, name: i.name, active: i.active !== false })))
      } catch {
        /* tags optional */
      }
    })()
  }, [open])

  // Revoke object URLs when items change / dialog closes to avoid leaks.
  React.useEffect(() => {
    return () => items.forEach((it) => URL.revokeObjectURL(it.url))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const reset = () => {
    items.forEach((it) => URL.revokeObjectURL(it.url))
    setItems([])
    setPostContent("")
    setInterests(new Set())
    setTimeOfDay(null)
    setLocationQuery("")
    setLocation(null)
  }

  const addFiles = (files: File[]) => {
    const next = files.map((file) => ({ file, url: URL.createObjectURL(file), description: "" }))
    setItems((prev) => [...prev, ...next])
  }

  const removeAt = (i: number) => {
    setItems((prev) => {
      URL.revokeObjectURL(prev[i]?.url ?? "")
      return prev.filter((_, idx) => idx !== i)
    })
  }

  const setDescriptionAt = (i: number, value: string) => {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, description: value } : it)))
  }

  const toggleInterest = (key: string) => {
    setInterests((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const submit = async () => {
    if (items.length === 0) {
      toast.error("Add at least one image")
      return
    }
    setSaving(true)
    try {
      const fd = new FormData()
      for (const it of items) {
        fd.append("files", it.file)
        fd.append("descriptions", it.description)
      }
      fd.append("tier", tier)
      fd.append("post_content", postContent)
      fd.append("interests", JSON.stringify([...interests]))
      if (timeOfDay) fd.append("time_of_day", timeOfDay)
      if (location) {
        fd.append("location_name", location.name)
        fd.append("latitude", String(location.latitude))
        fd.append("longitude", String(location.longitude))
      }

      const res = await fetch("/api/admin/shared-images", { method: "POST", body: fd })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "Upload failed")

      if (json.errors?.length) toast.warning(`${json.count} uploaded, ${json.errors.length} failed`)
      else toast.success(`${json.count} image${json.count === 1 ? "" : "s"} uploaded`)

      reset()
      onOpenChange(false)
      onUploaded()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset()
        onOpenChange(v)
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add images to {tier}</DialogTitle>
          <DialogDescription>
            Tags, location and post content apply to all images. Description is per image (it&apos;s
            what the digital human &quot;remembers&quot; about the photo).
          </DialogDescription>
        </DialogHeader>

        {/* Body pads itself (p-4 pt-0) — DialogContent is a p-0 shell per the
            design.md padding contract; only the header/footer are pre-padded. */}
        <div className="space-y-5 p-4 pt-0">
          <FileDropzone
            label="Drop images or click to browse"
            helper="JPEG, PNG or WebP · up to 8MB each"
            accept={ACCEPT}
            multiple
            filesCount={items.length}
            onPickFiles={addFiles}
          />

          {items.length > 0 && (
            <div className="space-y-3">
              {items.map((it, i) => (
                <div key={it.url} className="flex gap-3 rounded-lg border p-3">
                  <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-md bg-muted">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={it.url} alt="" className="h-full w-full object-cover" />
                  </div>
                  <div className="flex-1">
                    <Textarea
                      value={it.description}
                      onChange={(e) => setDescriptionAt(i, e.target.value)}
                      placeholder="Describe this photo (what she's wearing / doing / where)…"
                      rows={2}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeAt(i)}
                    className="self-start rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                    aria-label="Remove"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-2">
            <Label>Post content (optional)</Label>
            <Textarea
              value={postContent}
              onChange={(e) => setPostContent(e.target.value)}
              placeholder="Optional caption she might send alongside the photo…"
              rows={2}
            />
          </div>

          <div className="space-y-2">
            <Label>Interest tags</Label>
            <div className="flex flex-wrap gap-2">
              {catalog.map((c) => {
                const active = interests.has(c.key)
                return (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => toggleInterest(c.key)}
                    title={c.active ? c.name : `${c.name} — hidden from users (enable on Categories)`}
                    className={
                      "rounded-full border px-3 py-1 text-xs font-medium transition-colors " +
                      (active
                        ? "border-primary bg-primary text-primary-foreground"
                        : c.active
                          ? "border-border bg-background text-muted-foreground hover:border-primary/60"
                          : "border-dashed bg-background text-muted-foreground/70 hover:border-primary/60")
                    }
                  >
                    {c.name}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Time of day (optional)</Label>
            <div className="flex flex-wrap gap-2">
              {["morning", "afternoon", "evening"].map((t) => {
                const active = timeOfDay === t
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTimeOfDay(active ? null : t)}
                    className={
                      "rounded-full border px-3 py-1 text-xs font-medium capitalize transition-colors " +
                      (active
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-background text-muted-foreground hover:border-primary/60")
                    }
                  >
                    {t}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Location (optional)</Label>
            <LocationAutocomplete
              value={locationQuery}
              onValueChange={(v) => {
                setLocationQuery(v)
                if (!v) setLocation(null)
              }}
              onSelect={(sel) => {
                setLocation(sel)
                setLocationQuery(sel.name)
              }}
              placeholder="Search for a place…"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={saving || items.length === 0}>
            {saving ? "Uploading…" : `Upload ${items.length || ""}`.trim()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
