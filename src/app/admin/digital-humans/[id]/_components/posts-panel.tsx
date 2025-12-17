'use client'

import * as React from "react"
import { Pencil, Plus, Trash2, X } from "lucide-react"
import { toast } from "sonner"

import { supabase } from "@/lib/supabase"
import { FileDropzone } from "@/components/file-dropzone"
import { LocationAutocomplete } from "@/components/location-autocomplete"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"

import type { DbPost } from "./types"

const MAX_FILE_BYTES = 5 * 1024 * 1024
const ACCEPTED_MIME = new Set(["image/jpeg", "image/png"])
const ACCEPT_ATTR = "image/jpeg,image/png"

function toDatetimeLocal(iso: string | null | undefined) {
  if (!iso) return ""
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return ""
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function datetimeLocalToIso(v: string) {
  if (!v) return null
  const d = new Date(v)
  return Number.isFinite(d.getTime()) ? d.toISOString() : null
}

export function PostsPanel({
  userid,
  onZoom,
}: {
  userid: string
  onZoom: (src: string) => void
}) {
  const [posts, setPosts] = React.useState<DbPost[]>([])
  const [loading, setLoading] = React.useState(true)

  // Post edit sheet
  const [postOpen, setPostOpen] = React.useState(false)
  const [postSaving, setPostSaving] = React.useState(false)
  const [editPost, setEditPost] = React.useState<DbPost | null>(null)
  const [editPostDescription, setEditPostDescription] = React.useState("")
  const [editPostDatetimeLocal, setEditPostDatetimeLocal] = React.useState("")
  const [editPostLocationName, setEditPostLocationName] = React.useState("")
  const [editPostLongitude, setEditPostLongitude] = React.useState<number | null>(null)
  const [editPostLatitude, setEditPostLatitude] = React.useState<number | null>(null)
  const [editPostFiles, setEditPostFiles] = React.useState<File[]>([])
  const [editPostPhotos, setEditPostPhotos] = React.useState<string[]>([])

  // Add post sheet
  const [addPostOpen, setAddPostOpen] = React.useState(false)
  const [addPostSaving, setAddPostSaving] = React.useState(false)
  const [newPostDescription, setNewPostDescription] = React.useState("")
  const [newPostDatetimeLocal, setNewPostDatetimeLocal] = React.useState(() => toDatetimeLocal(new Date().toISOString()))
  const [newPostLocationName, setNewPostLocationName] = React.useState("")
  const [newPostLongitude, setNewPostLongitude] = React.useState<number | null>(null)
  const [newPostLatitude, setNewPostLatitude] = React.useState<number | null>(null)
  const [newPostFiles, setNewPostFiles] = React.useState<File[]>([])

  const validateFiles = React.useCallback((files: File[]) => {
    const valid: File[] = []
    const errors: string[] = []
    for (const f of files) {
      if (!ACCEPTED_MIME.has(f.type)) {
        errors.push(`${f.name}: only JPG/PNG supported`)
        continue
      }
      if (f.size > MAX_FILE_BYTES) {
        errors.push(`${f.name}: file must be under 5MB`)
        continue
      }
      valid.push(f)
    }
    return { valid, errors }
  }, [])

  const editPostPreviewUrls = React.useMemo(
    () => editPostFiles.map((f) => ({ file: f, url: URL.createObjectURL(f) })),
    [editPostFiles]
  )

  React.useEffect(() => {
    return () => {
      editPostPreviewUrls.forEach((p) => URL.revokeObjectURL(p.url))
    }
  }, [editPostPreviewUrls])

  const newPostPreviewUrls = React.useMemo(
    () => newPostFiles.map((f) => ({ file: f, url: URL.createObjectURL(f) })),
    [newPostFiles]
  )

  React.useEffect(() => {
    return () => {
      newPostPreviewUrls.forEach((p) => URL.revokeObjectURL(p.url))
    }
  }, [newPostPreviewUrls])

  const fetchPosts = React.useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from("user_posts")
      .select("*")
      .eq("userid", userid)
      .order("occurred_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
    if (error) {
      console.error(error)
      toast.error("Failed to fetch posts")
    } else {
      setPosts((data as DbPost[]) ?? [])
    }
    setLoading(false)
  }, [userid])

  React.useEffect(() => {
    void fetchPosts()
  }, [fetchPosts])

  const openPostEditor = (p: DbPost) => {
    setEditPost(p)
    setEditPostDescription(p.description ?? "")
    setEditPostDatetimeLocal(toDatetimeLocal(p.occurred_at ?? p.created_at))
    setEditPostLocationName(p.location_name ?? "")
    setEditPostLongitude(p.longitude ?? null)
    setEditPostLatitude(p.latitude ?? null)
    setEditPostFiles([])
    setEditPostPhotos(p.photos ?? [])
    setPostOpen(true)
  }

  const savePost = async () => {
    if (!editPost) return
    setPostSaving(true)
    try {
      let photos = editPostPhotos ?? []

      if (editPostFiles.length > 0) {
        const remainingSlots = Math.max(0, 9 - photos.length)
        if (remainingSlots === 0) {
          toast.error("Max 9 images per post")
          return
        }

        if (editPostFiles.length > remainingSlots) toast.error("Max 9 images per post")
        const { valid, errors } = validateFiles(editPostFiles.slice(0, remainingSlots))
        if (errors.length) {
          toast.error(errors[0])
          return
        }

        const existingNumbers = (photos ?? [])
          .map((u) => {
            const m = u.match(new RegExp(`/post_${editPost.id}/(\\d+)\\.jpg`, "i"))
            return m ? Number(m[1]) : null
          })
          .filter((n): n is number => typeof n === "number" && Number.isFinite(n))
        const startIndex = (existingNumbers.length ? Math.max(...existingNumbers) : 0) + 1

        const urls: string[] = []
        for (let i = 0; i < valid.length; i++) {
          const f = valid[i]
          const filePath = `${userid}/post_${editPost.id}/${startIndex + i}.jpg`
          const { error: uploadError } = await supabase.storage
            .from("images")
            .upload(filePath, f, { upsert: true, contentType: f.type })
          if (uploadError) throw uploadError
          const { data: pub } = supabase.storage.from("images").getPublicUrl(filePath)
          urls.push(pub.publicUrl)
        }
        photos = [...photos, ...urls]
      }

      const { error } = await supabase
        .from("user_posts")
        .update({
          description: editPostDescription.trim() || null,
          photos,
          occurred_at: datetimeLocalToIso(editPostDatetimeLocal) ?? editPost.occurred_at ?? editPost.created_at,
          location_name: editPostLocationName.trim() || null,
          longitude: editPostLongitude,
          latitude: editPostLatitude,
        })
        .eq("id", editPost.id)
      if (error) throw error

      toast.success("Post updated")
      setPostOpen(false)
      setEditPost(null)
      setEditPostPhotos([])
      void fetchPosts()
    } catch (err: unknown) {
      console.error(err)
      toast.error(err instanceof Error ? err.message : "Failed to update post")
    } finally {
      setPostSaving(false)
    }
  }

  const deletePost = async () => {
    if (!editPost) return
    setPostSaving(true)
    try {
      const { error } = await supabase.from("user_posts").delete().eq("id", editPost.id)
      if (error) throw error
      toast.success("Post deleted")
      setPostOpen(false)
      setEditPost(null)
      setEditPostDescription("")
      setEditPostFiles([])
      setEditPostPhotos([])
      void fetchPosts()
    } catch (err: unknown) {
      console.error(err)
      toast.error(err instanceof Error ? err.message : "Failed to delete post")
    } finally {
      setPostSaving(false)
    }
  }

  const createPost = async () => {
    setAddPostSaving(true)
    try {
      const { data: created, error: createError } = await supabase
        .from("user_posts")
        .insert({
          userid,
          photos: [],
          description: newPostDescription.trim() || null,
          occurred_at: datetimeLocalToIso(newPostDatetimeLocal) ?? new Date().toISOString(),
          location_name: newPostLocationName.trim() || null,
          longitude: newPostLongitude,
          latitude: newPostLatitude,
        })
        .select("id")
        .single()
      if (createError) throw createError

      const urls: string[] = []
      if (newPostFiles.length > 0) {
        const { valid, errors } = validateFiles(newPostFiles.slice(0, 9))
        if (errors.length) {
          toast.error(errors[0])
          return
        }
        if (newPostFiles.length > 9) toast.error("Max 9 images per post")
        for (let i = 0; i < valid.length; i++) {
          const f = valid[i]
          const filePath = `${userid}/post_${created.id}/${i + 1}.jpg`
          const { error: uploadError } = await supabase.storage
            .from("images")
            .upload(filePath, f, { upsert: true, contentType: f.type })
          if (uploadError) throw uploadError
          const { data: pub } = supabase.storage.from("images").getPublicUrl(filePath)
          urls.push(pub.publicUrl)
        }
      }

      if (urls.length > 0) {
        const { error: updErr } = await supabase.from("user_posts").update({ photos: urls }).eq("id", created.id)
        if (updErr) throw updErr
      }

      toast.success("Post created")
      setAddPostOpen(false)
      setNewPostDescription("")
      setNewPostDatetimeLocal(toDatetimeLocal(new Date().toISOString()))
      setNewPostLocationName("")
      setNewPostLongitude(null)
      setNewPostLatitude(null)
      setNewPostFiles([])
      void fetchPosts()
    } catch (err: unknown) {
      console.error(err)
      toast.error(err instanceof Error ? err.message : "Failed to create post")
    } finally {
      setAddPostSaving(false)
    }
  }

  return (
    <>
      <div className="rounded-lg border">
        <div className="flex items-center justify-between gap-3 p-4">
          <div className="text-sm text-muted-foreground">
            {loading ? "Loading..." : posts.length === 0 ? "No posts yet." : `${posts.length} posts`}
          </div>
          <Button variant="outline" size="sm" className="gap-2" onClick={() => setAddPostOpen(true)}>
            <Plus className="h-4 w-4" />
            Add post
          </Button>
        </div>
        <Separator />
        <div className="divide-y">
          {!loading
            ? posts.map((p) => (
                <div key={p.id} className="p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs text-muted-foreground">
                      {new Date(p.occurred_at ?? p.created_at).toLocaleDateString("en-US", {
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                      })}
                    </div>
                    <Button variant="outline" size="sm" className="gap-2" onClick={() => openPostEditor(p)}>
                      <Pencil className="h-4 w-4" />
                      Edit
                    </Button>
                  </div>
                  {p.location_name || (p.longitude != null && p.latitude != null) ? (
                    <div className="mt-1 text-xs text-muted-foreground">
                      {p.location_name
                        ? p.location_name
                        : `lon ${Number(p.longitude).toFixed(4)} · lat ${Number(p.latitude).toFixed(4)}`}
                    </div>
                  ) : null}
                  <div className="mt-2 text-sm">{p.description ?? "—"}</div>
                  {p.photos?.length ? (
                    <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3">
                      {p.photos.slice(0, 6).map((url) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          key={url}
                          src={url}
                          alt="post"
                          className="h-28 w-full cursor-zoom-in rounded-md object-cover transition-transform duration-200 hover:scale-[1.03]"
                          onClick={() => onZoom(url)}
                        />
                      ))}
                    </div>
                  ) : null}
                </div>
              ))
            : null}
        </div>
      </div>

      {/* Post Edit Sheet */}
      <Sheet open={postOpen} onOpenChange={setPostOpen}>
        <SheetContent className="sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>Edit post</SheetTitle>
            <SheetDescription>Edit time, location, description and photos.</SheetDescription>
          </SheetHeader>

          <div className="space-y-4 px-4">
            <div className="space-y-2">
              <Label>Post time</Label>
              <Input
                type="datetime-local"
                value={editPostDatetimeLocal}
                onChange={(e) => setEditPostDatetimeLocal(e.target.value)}
              />
            </div>

            <LocationAutocomplete
              value={editPostLocationName}
              onValueChange={(v) => {
                setEditPostLocationName(v)
                setEditPostLongitude(null)
                setEditPostLatitude(null)
              }}
              onSelect={(sel) => {
                setEditPostLocationName(sel.name)
                setEditPostLongitude(sel.longitude)
                setEditPostLatitude(sel.latitude)
              }}
              onClear={() => {
                setEditPostLocationName("")
                setEditPostLongitude(null)
                setEditPostLatitude(null)
              }}
              placeholder="Search location (e.g. Prague, Czech Republic)"
            />

            {editPostLongitude != null && editPostLatitude != null ? (
              <div className="text-xs text-muted-foreground">
                Selected: lon {editPostLongitude.toFixed(4)} · lat {editPostLatitude.toFixed(4)}
              </div>
            ) : null}

            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea rows={4} value={editPostDescription} onChange={(e) => setEditPostDescription(e.target.value)} />
            </div>

            <FileDropzone
              label="Add photos"
              helper="JPG/PNG only, max 5MB each, up to 9 images total. Adds to this post (does not replace existing)."
              accept={ACCEPT_ATTR}
              multiple
              filesCount={editPostFiles.length}
              onPickFiles={(files) => {
                const remaining = Math.max(0, 9 - editPostPhotos.length - editPostFiles.length)
                if (remaining === 0) {
                  toast.error("Max 9 images per post")
                  return
                }
                if (files.length > remaining) toast.error("Max 9 images per post")
                const { valid, errors } = validateFiles(files.slice(0, remaining))
                if (errors.length) toast.error(errors[0])
                setEditPostFiles((prev) => [...prev, ...valid])
              }}
              onClear={editPostFiles.length ? () => setEditPostFiles([]) : undefined}
              preview={
                editPostPhotos.length || editPostFiles.length ? (
                  <div className="grid grid-cols-3 gap-2">
                    {editPostPhotos.slice(0, 9).map((url) => (
                      <div key={url} className="relative aspect-square overflow-hidden rounded-md border bg-muted">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={url}
                          alt="existing"
                          className="h-full w-full cursor-zoom-in object-cover transition-transform duration-200 hover:scale-[1.03]"
                          onClick={() => onZoom(url)}
                        />
                        <Button
                          type="button"
                          size="icon"
                          variant="secondary"
                          className="absolute right-1 top-1 h-7 w-7"
                          onClick={(e) => {
                            e.stopPropagation()
                            setEditPostPhotos((prev) => prev.filter((u) => u !== url))
                          }}
                          title="Remove image"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}

                    {editPostPreviewUrls
                      .slice(0, Math.max(0, 9 - editPostPhotos.length))
                      .map((p) => (
                        <div key={p.url} className="relative aspect-square overflow-hidden rounded-md border bg-muted">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={p.url}
                            alt={p.file.name}
                            className="h-full w-full cursor-zoom-in object-cover transition-transform duration-200 hover:scale-[1.03]"
                            onClick={() => onZoom(p.url)}
                          />
                          <Button
                            type="button"
                            size="icon"
                            variant="secondary"
                            className="absolute right-1 top-1 h-7 w-7"
                            onClick={(e) => {
                              e.stopPropagation()
                              setEditPostFiles((prev) => prev.filter((f) => f !== p.file))
                            }}
                            title="Remove pending upload"
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                  </div>
                ) : null
              }
            />
          </div>

          <SheetFooter>
            <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" disabled={postSaving || !editPost} className="gap-2">
                    <Trash2 className="h-4 w-4" />
                    Delete post
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete this post?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will permanently delete the post row. (Images in storage are not removed automatically.)
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => void deletePost()}>Delete</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>

              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button variant="outline" onClick={() => setPostOpen(false)} disabled={postSaving}>
                  Cancel
                </Button>
                <Button onClick={savePost} disabled={postSaving || !editPost}>
                  {postSaving ? "Saving..." : "Save post"}
                </Button>
              </div>
            </div>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Add Post Sheet */}
      <Sheet open={addPostOpen} onOpenChange={setAddPostOpen}>
        <SheetContent className="sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>Add post</SheetTitle>
            <SheetDescription>Create a new post with time, location, and photos.</SheetDescription>
          </SheetHeader>

          <div className="space-y-4 px-4">
            <div className="space-y-2">
              <Label>Post time</Label>
              <Input
                type="datetime-local"
                value={newPostDatetimeLocal}
                onChange={(e) => setNewPostDatetimeLocal(e.target.value)}
              />
            </div>

            <LocationAutocomplete
              value={newPostLocationName}
              onValueChange={(v) => {
                setNewPostLocationName(v)
                setNewPostLongitude(null)
                setNewPostLatitude(null)
              }}
              onSelect={(sel) => {
                setNewPostLocationName(sel.name)
                setNewPostLongitude(sel.longitude)
                setNewPostLatitude(sel.latitude)
              }}
              onClear={() => {
                setNewPostLocationName("")
                setNewPostLongitude(null)
                setNewPostLatitude(null)
              }}
              placeholder="Search location (e.g. Prague, Czech Republic)"
            />

            {newPostLongitude != null && newPostLatitude != null ? (
              <div className="text-xs text-muted-foreground">
                Selected: lon {newPostLongitude.toFixed(4)} · lat {newPostLatitude.toFixed(4)}
              </div>
            ) : null}

            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                rows={4}
                value={newPostDescription}
                onChange={(e) => setNewPostDescription(e.target.value)}
                placeholder="Write something..."
              />
            </div>

            <FileDropzone
              label="Photos"
              helper="JPG/PNG only, max 5MB each, up to 9 images."
              accept={ACCEPT_ATTR}
              multiple
              filesCount={newPostFiles.length}
              onPickFiles={(files) => {
                if (files.length > 9) toast.error("Max 9 images per post")
                const { valid, errors } = validateFiles(files.slice(0, 9))
                if (errors.length) toast.error(errors[0])
                setNewPostFiles(valid)
              }}
              onClear={newPostFiles.length ? () => setNewPostFiles([]) : undefined}
              preview={
                newPostFiles.length ? (
                  <div className="grid grid-cols-3 gap-2">
                    {newPostPreviewUrls.slice(0, 9).map((p) => (
                      <div key={p.url} className="aspect-square overflow-hidden rounded-md border bg-muted">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={p.url}
                          alt={p.file.name}
                          className="h-full w-full cursor-zoom-in object-cover transition-transform duration-200 hover:scale-[1.03]"
                          onClick={() => onZoom(p.url)}
                        />
                      </div>
                    ))}
                  </div>
                ) : null
              }
            />
          </div>

          <SheetFooter>
            <Button variant="outline" onClick={() => setAddPostOpen(false)} disabled={addPostSaving}>
              Cancel
            </Button>
            <Button onClick={createPost} disabled={addPostSaving}>
              {addPostSaving ? "Creating..." : "Create post"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  )
}


