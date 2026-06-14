'use client'

import * as React from "react"
import { Plus } from "lucide-react"
import { toast } from "sonner"

import { FileDropzone } from "@/components/file-dropzone"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogXCloseButton,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

const MAX_FILE_BYTES = 5 * 1024 * 1024
const ACCEPTED_MIME = new Set(["image/jpeg", "image/png"])
const ACCEPT_ATTR = "image/jpeg,image/png"

const IMAGE_TIERS = [
  {
    value: "unspecified",
    label: "Unspecified",
    shortLabel: "?",
    className: "border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-600 dark:bg-slate-900/60 dark:text-slate-200",
  },
  {
    value: "casual",
    label: "Casual",
    shortLabel: "C",
    className: "border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-200",
  },
  {
    value: "tease",
    label: "Tease",
    shortLabel: "T",
    className: "border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-700 dark:bg-amber-950/60 dark:text-amber-200",
  },
  {
    value: "reward",
    label: "Reward",
    shortLabel: "R",
    className: "border-rose-300 bg-rose-100 text-rose-800 dark:border-rose-700 dark:bg-rose-950/60 dark:text-rose-200",
  },
] as const

type ImageTier = (typeof IMAGE_TIERS)[number]["value"]
type ChatImageItem = { name: string; url: string; image_tier: ImageTier }

const TIER_OPTIONS = IMAGE_TIERS.map((tier) => tier.value)

function normalizeImageTier(value: unknown): ImageTier {
  return TIER_OPTIONS.includes(value as ImageTier) ? (value as ImageTier) : "unspecified"
}

function validateOneFile(files: File[]) {
  if (!files.length) return { file: null as File | null, error: "No file selected" }
  const f = files[0]
  if (!ACCEPTED_MIME.has(f.type)) return { file: null, error: "Only JPG/PNG supported" }
  if (f.size > MAX_FILE_BYTES) return { file: null, error: "File must be under 5MB" }
  return { file: f, error: null as string | null }
}

export function ChatImagesPanel({
  userid,
  onZoom,
}: {
  userid: string
  onZoom: (src: string) => void
}) {
  const [items, setItems] = React.useState<ChatImageItem[]>([])
  const [loading, setLoading] = React.useState(true)
  const [tierUpdating, setTierUpdating] = React.useState<Record<string, boolean>>({})
  const [draggingName, setDraggingName] = React.useState<string | null>(null)
  const [dragOverTier, setDragOverTier] = React.useState<ImageTier | null>(null)

  const [addOpen, setAddOpen] = React.useState(false)
  const [adding, setAdding] = React.useState(false)
  const [file, setFile] = React.useState<File | null>(null)

  const previewUrl = React.useMemo(() => (file ? URL.createObjectURL(file) : null), [file])
  React.useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  const fetchImages = React.useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(userid)}/chat-images`)
      const json = (await res.json()) as { data?: ChatImageItem[]; error?: string }
      if (!res.ok) throw new Error(json.error || "Failed to fetch chat images")
      setItems(
        (json.data ?? []).map((it) => ({
          ...it,
          image_tier: normalizeImageTier(it.image_tier),
        }))
      )
    } catch (err: unknown) {
      console.error(err)
      toast.error(err instanceof Error ? err.message : "Failed to fetch chat images")
      setItems([])
    }
    setLoading(false)
  }, [userid])

  const groupedItems = React.useMemo(() => {
    const groups = new Map<ImageTier, ChatImageItem[]>()
    for (const tier of TIER_OPTIONS) groups.set(tier, [])
    for (const item of items) {
      const tier = normalizeImageTier(item.image_tier)
      groups.get(tier)?.push(item)
    }
    return groups
  }, [items])

  React.useEffect(() => {
    void fetchImages()
  }, [fetchImages])

  const itemByName = React.useMemo(() => new Map(items.map((item) => [item.name, item])), [items])

  const updateTier = async (name: string, imageTier: ImageTier) => {
    const currentTier = itemByName.get(name)?.image_tier
    if (currentTier === imageTier) return

    const prev = items
    setItems((current) =>
      current.map((item) => (item.name === name ? { ...item, image_tier: imageTier } : item))
    )
    setTierUpdating((current) => ({ ...current, [name]: true }))

    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(userid)}/chat-images`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, image_tier: imageTier }),
      })
      const json = (await res.json()) as {
        data?: { image_tier?: ImageTier; tier_available?: boolean }
        error?: string
      }
      if (!res.ok) throw new Error(json.error || "Failed to update image tier")
      const savedTier = json.data?.tier_available === false
        ? "unspecified"
        : normalizeImageTier(json.data?.image_tier ?? imageTier)
      setItems((current) =>
        current.map((item) => (item.name === name ? { ...item, image_tier: savedTier } : item))
      )
      if (json.data?.tier_available === false) return
      toast.success("Image tier updated")
    } catch (err: unknown) {
      console.error(err)
      setItems(prev)
      toast.error(err instanceof Error ? err.message : "Failed to update image tier")
    } finally {
      setTierUpdating((current) => ({ ...current, [name]: false }))
    }
  }

  const beginDrag = (event: React.DragEvent<HTMLDivElement>, name: string) => {
    event.dataTransfer.effectAllowed = "move"
    event.dataTransfer.setData("text/plain", name)
    setDraggingName(name)
  }

  const dropOnTier = (event: React.DragEvent<HTMLDivElement>, imageTier: ImageTier) => {
    event.preventDefault()
    const name = event.dataTransfer.getData("text/plain") || draggingName
    setDragOverTier(null)
    setDraggingName(null)
    if (!name) return
    void updateTier(name, imageTier)
  }

  const upload = async () => {
    if (!file) {
      toast.error("Pick an image first")
      return
    }
    setAdding(true)
    try {
      const fd = new FormData()
      fd.set("file", file)
      const res = await fetch(`/api/admin/users/${encodeURIComponent(userid)}/chat-images`, {
        method: "POST",
        body: fd,
      })
      const json = (await res.json()) as { added?: ChatImageItem; error?: string }
      if (!res.ok) throw new Error(json.error || "Failed to upload image")
      toast.success("Picture uploaded")
      setAddOpen(false)
      setFile(null)
      void fetchImages()
    } catch (err: unknown) {
      console.error(err)
      toast.error(err instanceof Error ? err.message : "Failed to upload image")
    } finally {
      setAdding(false)
    }
  }

  return (
    <>
      <div className="rounded-lg border">
        <div className="flex items-center justify-between gap-3 p-4">
          <div className="text-sm text-muted-foreground">
            {loading ? "Loading..." : items.length === 0 ? "No chat images yet." : `${items.length} chat images`}
          </div>
          <Button variant="outline" size="sm" className="gap-2" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4" />
            Picture
          </Button>
        </div>
        <Separator />
        <div className="p-4">
          {!loading && items.length ? (
            <div className="space-y-3">
              {IMAGE_TIERS.map((tier) => {
                const tierItems = groupedItems.get(tier.value) ?? []
                return (
                  <div
                    key={tier.value}
                    className={cn(
                      "grid grid-cols-[104px_1fr] overflow-hidden rounded-md border transition-colors",
                      dragOverTier === tier.value && "border-primary bg-primary/5"
                    )}
                    onDragOver={(event) => {
                      event.preventDefault()
                      event.dataTransfer.dropEffect = "move"
                      setDragOverTier(tier.value)
                    }}
                    onDragLeave={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                        setDragOverTier(null)
                      }
                    }}
                    onDrop={(event) => dropOnTier(event, tier.value)}
                  >
                    <div className={cn("flex flex-col items-center justify-center gap-1 border-r p-2", tier.className)}>
                      <span className="text-base font-semibold leading-none">{tier.shortLabel}</span>
                      <span className="text-[11px] font-medium leading-none">{tier.label}</span>
                    </div>
                    <div className="min-h-28 bg-muted/20 p-3">
                      {tierItems.length ? (
                        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                          {tierItems.map((it) => (
                            <div
                              key={it.name}
                              draggable={!tierUpdating[it.name]}
                              className={cn(
                                "overflow-hidden rounded-md border bg-background transition-all",
                                tierUpdating[it.name] && "opacity-60",
                                draggingName === it.name && "scale-[0.98] opacity-50"
                              )}
                              onDragStart={(event) => beginDrag(event, it.name)}
                              onDragEnd={() => {
                                setDraggingName(null)
                                setDragOverTier(null)
                              }}
                            >
                              <button
                                type="button"
                                className="block aspect-square w-full overflow-hidden bg-muted"
                                onClick={() => onZoom(it.url)}
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={it.url}
                                  alt={it.name}
                                  className="h-full w-full cursor-zoom-in object-cover transition-transform duration-200 hover:scale-[1.03]"
                                />
                              </button>
                              <div className="p-2">
                                <div className="truncate text-xs text-muted-foreground" title={it.name}>
                                  {it.name}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="flex min-h-20 items-center text-sm text-muted-foreground">No images</div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : null}
        </div>
      </div>

      <Dialog open={addOpen} onOpenChange={(o) => (!adding ? setAddOpen(o) : null)}>
        <DialogContent>
          <DialogXCloseButton />
          <DialogHeader>
            <DialogTitle>Add picture</DialogTitle>
            <DialogDescription>Upload a single image. It will be saved as the next `pic_N` in storage.</DialogDescription>
          </DialogHeader>

          <div className="p-4 pt-0">
            <FileDropzone
              label="Picture"
              helper="JPG/PNG only, max 5MB. One image at a time."
              accept={ACCEPT_ATTR}
              multiple={false}
              filesCount={file ? 1 : 0}
              disabled={adding}
              onPickFiles={(files) => {
                if (files.length > 1) toast.error("Only 1 image at a time")
                const { file: f, error } = validateOneFile(files)
                if (error) {
                  toast.error(error)
                  return
                }
                setFile(f)
              }}
              onClear={file && !adding ? () => setFile(null) : undefined}
              preview={
                previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={previewUrl}
                    alt={file?.name ?? "preview"}
                    className="h-48 w-full rounded-md object-cover"
                    onClick={() => onZoom(previewUrl)}
                  />
                ) : null
              }
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)} disabled={adding}>
              Cancel
            </Button>
            <Button onClick={() => void upload()} disabled={adding || !file}>
              {adding ? "Uploading..." : "Upload"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
