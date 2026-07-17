"use client"

import * as React from "react"
import Link from "next/link"
import { use } from "react"
import { ArrowLeft, Plus, Trash2, X } from "lucide-react"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { UploadDialog } from "./upload-dialog"
import { TagPane, type TagRow } from "./tag-pane"

type SharedImage = {
  id: string
  public_url: string
  tier: string
  description: string | null
  post_content: string | null
  interests: string[]
  time_of_day: string | null
  location_name: string | null
  active: boolean
  created_at: string
}

const PAGE = 30

/** Mirror the server's interest-key slugify so we can validate + de-dupe client-side. */
function slugifyKey(name: string) {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")
}

export default function SharedImagesTierPage({ params }: { params: Promise<{ tier: string }> }) {
  const { tier } = use(params)

  const [images, setImages] = React.useState<SharedImage[]>([])
  const [cursor, setCursor] = React.useState<string | null>(null)
  const [hasMore, setHasMore] = React.useState(true)
  const [loading, setLoading] = React.useState(false)
  const [uploadOpen, setUploadOpen] = React.useState(false)
  const sentinelRef = React.useRef<HTMLDivElement | null>(null)

  // Tag catalog (interests) for the side pane + key→name lookup on the chips.
  const [catalog, setCatalog] = React.useState<TagRow[]>([])
  // Which tag key is currently being dragged from the pane (null = no drag),
  // and which image card it's hovering — drives the drop-target highlight.
  const [draggingTag, setDraggingTag] = React.useState<string | null>(null)
  const [dropTargetId, setDropTargetId] = React.useState<string | null>(null)

  // Latest images (read by tag mutations so they never compute from a stale
  // render closure) and a per-image write sequence so out-of-order PATCH
  // responses can't clobber a newer edit.
  const imagesRef = React.useRef<SharedImage[]>([])
  React.useEffect(() => {
    imagesRef.current = images
  }, [images])
  const seqRef = React.useRef<Map<string, number>>(new Map())

  const nameByKey = React.useMemo(() => {
    const m = new Map<string, string>()
    for (const t of catalog) m.set(t.key, t.name)
    return m
  }, [catalog])

  const loadMore = React.useCallback(async () => {
    if (loading || !hasMore) return
    setLoading(true)
    try {
      const qs = new URLSearchParams({ tier, limit: String(PAGE) })
      if (cursor) qs.set("cursor", cursor)
      const res = await fetch(`/api/admin/shared-images?${qs.toString()}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "Failed to load")
      setImages((prev) => [...prev, ...(json.images ?? [])])
      setCursor(json.nextCursor)
      setHasMore(json.hasMore)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load images")
      setHasMore(false)
    } finally {
      setLoading(false)
    }
  }, [tier, cursor, hasMore, loading])

  // Initial load.
  React.useEffect(() => {
    void loadMore()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Load the tag catalog once — ALL tags, hidden included: ops keeps tagging
  // images with a new tag while it's still hidden from users. The pane renders
  // hidden ones muted; they go live via the eye toggle on /admin/categories.
  React.useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/admin/interests")
        if (!res.ok) return
        const rows = ((await res.json()).data ?? []) as Array<TagRow & { active?: boolean }>
        setCatalog(rows.map((i) => ({ key: i.key, name: i.name, active: i.active !== false })))
      } catch {
        /* tags optional */
      }
    })()
  }, [])

  // Infinite scroll: observe a sentinel below the grid.
  React.useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void loadMore()
      },
      { rootMargin: "600px" }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [loadMore])

  const refresh = () => {
    setImages([])
    setCursor(null)
    setHasMore(true)
    // loadMore reads state; defer so the resets apply first.
    setTimeout(() => void loadMore(), 0)
  }

  const remove = async (id: string) => {
    if (!confirm("Delete this image permanently?")) return
    try {
      const res = await fetch(`/api/admin/shared-images/${id}`, { method: "DELETE" })
      if (!res.ok) throw new Error((await res.json()).error || "Delete failed")
      setImages((prev) => prev.filter((im) => im.id !== id))
      toast.success("Deleted")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed")
    }
  }

  /**
   * Persist a new interests array for one image (optimistic). The PATCH route
   * validates keys against the catalog and returns the canonical list, which we
   * sync back; on failure we revert to the prior array.
   */
  const setImageInterests = async (id: string, next: string[]) => {
    const prevInterests = imagesRef.current.find((im) => im.id === id)?.interests
    if (!prevInterests) return
    // Sequence guard: tag this write and only let the newest one for this image
    // commit its result, so out-of-order responses can't undo a later edit.
    const seq = (seqRef.current.get(id) ?? 0) + 1
    seqRef.current.set(id, seq)
    // Apply optimistically to both state and the ref (so a rapid follow-up edit
    // computes from this result, not the pre-drop array).
    imagesRef.current = imagesRef.current.map((im) => (im.id === id ? { ...im, interests: next } : im))
    setImages((prev) => prev.map((im) => (im.id === id ? { ...im, interests: next } : im)))
    try {
      const res = await fetch(`/api/admin/shared-images/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interests: next }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "Failed to save tags")
      if (seqRef.current.get(id) !== seq) return // a newer write superseded this one
      const saved = (json.data?.interests ?? next) as string[]
      imagesRef.current = imagesRef.current.map((im) => (im.id === id ? { ...im, interests: saved } : im))
      setImages((prev) => prev.map((im) => (im.id === id ? { ...im, interests: saved } : im)))
    } catch (err) {
      // Only revert if no newer write has since taken over this image.
      if (seqRef.current.get(id) === seq) {
        imagesRef.current = imagesRef.current.map((im) => (im.id === id ? { ...im, interests: prevInterests } : im))
        setImages((prev) => prev.map((im) => (im.id === id ? { ...im, interests: prevInterests } : im)))
      }
      toast.error(err instanceof Error ? err.message : "Failed to save tags")
    }
  }

  const addTagToImage = (id: string, key: string) => {
    if (!key) return
    const img = imagesRef.current.find((im) => im.id === id)
    if (!img || img.interests.includes(key)) return
    void setImageInterests(id, [...img.interests, key])
  }

  const removeTagFromImage = (id: string, key: string) => {
    const img = imagesRef.current.find((im) => im.id === id)
    if (!img) return
    void setImageInterests(id, img.interests.filter((k) => k !== key))
  }

  /** Create a new interest via the pane's "+" and add it to the catalog. */
  const createTag = async (name: string): Promise<boolean> => {
    // The interest key must slugify to something; a name with no [a-z0-9]
    // (e.g. "旅行", "🎉") would 400 server-side with a cryptic "key is required".
    const slug = slugifyKey(name)
    if (!slug) {
      toast.error("Tag name needs at least one letter or number")
      return false
    }
    try {
      const res = await fetch("/api/admin/interests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Born HIDDEN: tags minted here are image-curation vocabulary first.
        // They reach users (profile picker, card chips, matching boost) only
        // after being enabled on /admin/categories.
        body: JSON.stringify({ key: slug, name, active: false }),
      })
      const json = await res.json()

      // 409 = the slug already exists — possibly as a HIDDEN interest that the
      // active-only catalog fetch dropped. Recover it from the full list so it
      // becomes draggable instead of a silent dead-end.
      if (res.status === 409) {
        const existing = await fetchInterest(slug)
        if (existing) {
          setCatalog((prev) => (prev.some((t) => t.key === existing.key) ? prev : [...prev, existing]))
          toast.info(`Tag "${existing.name}" already existed — added to the list`)
          return true
        }
      }

      if (!res.ok) throw new Error(json.error || "Failed to create tag")
      const row = json.data as TagRow
      setCatalog((prev) =>
        prev.some((t) => t.key === row.key) ? prev : [...prev, { key: row.key, name: row.name, active: false }]
      )
      toast.success(`Tag "${row.name}" created (hidden) — enable it on Categories when it's ready for users`)
      return true
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create tag")
      return false
    }
  }

  /** Look up a single interest (incl. hidden ones) by its slug key. */
  const fetchInterest = async (key: string): Promise<TagRow | null> => {
    try {
      const res = await fetch("/api/admin/interests")
      if (!res.ok) return null
      const rows = ((await res.json()).data ?? []) as Array<TagRow & { active?: boolean }>
      const found = rows.find((r) => r.key === key)
      return found ? { key: found.key, name: found.name, active: found.active !== false } : null
    } catch {
      return null
    }
  }

  return (
    <div className="space-y-4">
      <Link
        href="/admin/shared-images"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> All folders
      </Link>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold capitalize">{tier}</h1>
          <p className="text-sm text-muted-foreground">Shared photos in this folder.</p>
        </div>
        <Button onClick={() => setUploadOpen(true)}>
          <Plus className="mr-1 h-4 w-4" /> Add Images
        </Button>
      </div>

      <div className="flex flex-col items-stretch gap-6 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1 space-y-4">
          {images.length === 0 && !loading ? (
            <Card className="p-10 text-center text-sm text-muted-foreground">
              No images yet. Click <span className="font-medium">Add Images</span> to upload.
            </Card>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
              {images.map((im) => {
                const isDropTarget = draggingTag != null && dropTargetId === im.id
                const alreadyHas = draggingTag != null && im.interests.includes(draggingTag)
                return (
                  <Card
                    key={im.id}
                    className={cn(
                      "group overflow-hidden transition-shadow",
                      draggingTag != null && "ring-1 ring-border",
                      isDropTarget && (alreadyHas ? "ring-2 ring-muted-foreground/40" : "ring-2 ring-primary")
                    )}
                    onDragOver={(e) => {
                      if (draggingTag == null) return
                      e.preventDefault()
                      e.dataTransfer.dropEffect = "copy"
                      if (dropTargetId !== im.id) setDropTargetId(im.id)
                    }}
                    onDragLeave={(e) => {
                      // Ignore leaves into child elements; only clear when the
                      // pointer actually exits the card.
                      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
                      setDropTargetId((cur) => (cur === im.id ? null : cur))
                    }}
                    onDrop={(e) => {
                      e.preventDefault()
                      const key = e.dataTransfer.getData("text/plain") || draggingTag
                      if (key) addTagToImage(im.id, key)
                      setDropTargetId(null)
                    }}
                  >
                    <div className="relative aspect-[3/4] bg-muted">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={im.public_url}
                        alt={im.description ?? ""}
                        className="h-full w-full object-cover"
                        draggable={false}
                      />
                      {!im.active && (
                        <span className="absolute left-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-semibold text-white">
                          Hidden
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => void remove(im.id)}
                        className="absolute right-2 top-2 rounded-full bg-black/60 p-1.5 text-white opacity-0 transition-opacity hover:bg-red-600 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100 [@media(hover:none)]:opacity-100"
                        aria-label="Delete"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="space-y-1.5 p-3">
                      <p className="line-clamp-2 text-xs text-foreground">
                        {im.description || <span className="text-muted-foreground">No description</span>}
                      </p>
                      {im.interests.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {im.interests.map((k) => (
                            <span
                              key={k}
                              className="group/tag inline-flex items-center gap-0.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium"
                            >
                              {nameByKey.get(k) ?? k}
                              <button
                                type="button"
                                onClick={() => removeTagFromImage(im.id, k)}
                                className="rounded-full text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring group-hover/tag:opacity-100 [@media(hover:none)]:opacity-100"
                                aria-label={`Remove tag ${nameByKey.get(k) ?? k}`}
                              >
                                <X className="h-2.5 w-2.5" />
                              </button>
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p className="text-[10px] text-muted-foreground/60">
                          {draggingTag != null ? "Drop to tag" : "No tags"}
                        </p>
                      )}
                      {(im.time_of_day || im.location_name) && (
                        <p className="text-[11px] capitalize text-muted-foreground">
                          {[im.time_of_day, im.location_name].filter(Boolean).join(" · ")}
                        </p>
                      )}
                    </div>
                  </Card>
                )
              })}
            </div>
          )}

          <div ref={sentinelRef} className="h-8" />
          {loading && <p className="py-4 text-center text-sm text-muted-foreground">Loading…</p>}
          {!hasMore && images.length > 0 && (
            <p className="py-4 text-center text-xs text-muted-foreground">End of folder</p>
          )}
        </div>

        {/* Tag rail — a sticky right rail on desktop; on narrower widths it
            stacks below the grid (still drag-reachable) rather than vanishing. */}
        <aside className="w-full shrink-0 lg:sticky lg:top-6 lg:w-64">
          <TagPane
            tags={catalog}
            onCreate={createTag}
            onDragTagStart={setDraggingTag}
            onDragTagEnd={() => {
              setDraggingTag(null)
              setDropTargetId(null)
            }}
            dragging={draggingTag != null}
          />
        </aside>
      </div>

      <UploadDialog tier={tier} open={uploadOpen} onOpenChange={setUploadOpen} onUploaded={refresh} />
    </div>
  )
}
