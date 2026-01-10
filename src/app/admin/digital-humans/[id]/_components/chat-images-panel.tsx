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

const MAX_FILE_BYTES = 5 * 1024 * 1024
const ACCEPTED_MIME = new Set(["image/jpeg", "image/png"])
const ACCEPT_ATTR = "image/jpeg,image/png"

type ChatImageItem = { name: string; url: string }

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
      setItems((json.data ?? []) as ChatImageItem[])
    } catch (err: unknown) {
      console.error(err)
      toast.error(err instanceof Error ? err.message : "Failed to fetch chat images")
      setItems([])
    }
    setLoading(false)
  }, [userid])

  React.useEffect(() => {
    void fetchImages()
  }, [fetchImages])

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
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              {items.map((it) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={it.name}
                  src={it.url}
                  alt={it.name}
                  className="h-28 w-full cursor-zoom-in rounded-md object-cover transition-transform duration-200 hover:scale-[1.03]"
                  onClick={() => onZoom(it.url)}
                />
              ))}
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

