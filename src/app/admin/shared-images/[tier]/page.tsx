"use client"

import * as React from "react"
import Link from "next/link"
import { use } from "react"
import { ArrowLeft, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { UploadDialog } from "./upload-dialog"

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

export default function SharedImagesTierPage({ params }: { params: Promise<{ tier: string }> }) {
  const { tier } = use(params)

  const [images, setImages] = React.useState<SharedImage[]>([])
  const [cursor, setCursor] = React.useState<string | null>(null)
  const [hasMore, setHasMore] = React.useState(true)
  const [loading, setLoading] = React.useState(false)
  const [uploadOpen, setUploadOpen] = React.useState(false)
  const sentinelRef = React.useRef<HTMLDivElement | null>(null)

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

  return (
    <div className="max-w-6xl space-y-4">
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

      {images.length === 0 && !loading ? (
        <Card className="p-10 text-center text-sm text-muted-foreground">
          No images yet. Click <span className="font-medium">Add Images</span> to upload.
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {images.map((im) => (
            <Card key={im.id} className="group overflow-hidden">
              <div className="relative aspect-[3/4] bg-muted">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={im.public_url} alt={im.description ?? ""} className="h-full w-full object-cover" />
                {!im.active && (
                  <span className="absolute left-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-semibold text-white">
                    Hidden
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => void remove(im.id)}
                  className="absolute right-2 top-2 rounded-full bg-black/60 p-1.5 text-white opacity-0 transition-opacity hover:bg-red-600 group-hover:opacity-100"
                  aria-label="Delete"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="space-y-1.5 p-3">
                <p className="line-clamp-2 text-xs text-foreground">
                  {im.description || <span className="text-muted-foreground">No description</span>}
                </p>
                {im.interests.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {im.interests.map((k) => (
                      <span key={k} className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium">
                        {k}
                      </span>
                    ))}
                  </div>
                )}
                {(im.time_of_day || im.location_name) && (
                  <p className="text-[11px] capitalize text-muted-foreground">
                    {[im.time_of_day, im.location_name].filter(Boolean).join(" · ")}
                  </p>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <div ref={sentinelRef} className="h-8" />
      {loading && <p className="py-4 text-center text-sm text-muted-foreground">Loading…</p>}
      {!hasMore && images.length > 0 && (
        <p className="py-4 text-center text-xs text-muted-foreground">End of folder</p>
      )}

      <UploadDialog tier={tier} open={uploadOpen} onOpenChange={setUploadOpen} onUploaded={refresh} />
    </div>
  )
}
