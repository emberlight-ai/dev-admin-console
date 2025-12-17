'use client'

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft, Upload } from "lucide-react"
import { toast } from "sonner"

import { supabase } from "@/lib/supabase"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { FileDropzone } from "@/components/file-dropzone"
import { buildSystemPrompt } from "@/lib/botProfile"

type Gender = "Male" | "Female" | "Non-binary" | "Other"

const MAX_FILE_BYTES = 5 * 1024 * 1024
const ACCEPTED_MIME = new Set(["image/jpeg", "image/png"])
const ACCEPT_ATTR = "image/jpeg,image/png"

function avatarExtFor(file: File) {
  if (file.type === "image/png") return "png"
  return "jpg"
}

export default function CreateDigitalHuman() {
  const router = useRouter()
  const [loading, setLoading] = React.useState(false)

  const [username, setUsername] = React.useState("")
  const [profession, setProfession] = React.useState("")
  const [age, setAge] = React.useState<string>("")
  const [gender, setGender] = React.useState<Gender>("Female")
  const [zipcode, setZipcode] = React.useState("")
  const [bio, setBio] = React.useState("")

  const [avatarFile, setAvatarFile] = React.useState<File | null>(null)
  const [postFiles, setPostFiles] = React.useState<File[]>([])
  const [initialPostDescription, setInitialPostDescription] = React.useState("")

  const canSubmit = React.useMemo(() => {
    if (loading) return false
    if (!username.trim()) return false
    if (!profession.trim()) return false
    if (!age.trim()) return false
    const n = Number(age)
    if (!Number.isFinite(n) || n < 18 || n > 100) return false
    if (!bio.trim()) return false
    if (!avatarFile) return false
    if (!ACCEPTED_MIME.has(avatarFile.type)) return false
    if (avatarFile.size > MAX_FILE_BYTES) return false
    return true
  }, [loading, username, profession, age, bio, avatarFile])

  const validateFiles = React.useCallback(
    (files: File[]) => {
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
    },
    []
  )

  const avatarPreviewUrl = React.useMemo(() => {
    if (!avatarFile) return null
    return URL.createObjectURL(avatarFile)
  }, [avatarFile])

  React.useEffect(() => {
    return () => {
      if (avatarPreviewUrl) URL.revokeObjectURL(avatarPreviewUrl)
    }
  }, [avatarPreviewUrl])

  const postPreviewUrls = React.useMemo(
    () => postFiles.map((f) => ({ file: f, url: URL.createObjectURL(f) })),
    [postFiles]
  )

  React.useEffect(() => {
    return () => {
      postPreviewUrls.forEach((p) => URL.revokeObjectURL(p.url))
    }
  }, [postPreviewUrls])

  // (FileDropzone extracted to src/components/file-dropzone.tsx)

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      if (!bio.trim()) {
        toast.error("Bio is required")
        return
      }
      if (!avatarFile) {
        toast.error("Avatar is required")
        return
      }
      const { data: userData, error: userError } = await supabase
        .from("users")
        .insert({
          username,
          profession,
          age: age ? Number(age) : null,
          gender,
          zipcode,
          bio: bio.trim(),
          is_digital_human: true,
          system_prompt: buildSystemPrompt({
            name: username,
            age: age ? Number(age) : null,
            archetype: profession,
            bio: bio.trim(),
          }),
        })
        .select()
        .single()

      if (userError || !userData) throw userError
      const userId = userData.userid as string

      // Avatar upload (force avatar.jpg)
      if (!ACCEPTED_MIME.has(avatarFile.type) || avatarFile.size > MAX_FILE_BYTES) {
        toast.error("Avatar must be a JPG or PNG under 5MB")
        return
      }
      const idPart =
        typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now())
      const filePath = `${userId}/avatar_${idPart}.${avatarExtFor(avatarFile)}`
      const { error: uploadError } = await supabase.storage
        .from("images")
        .upload(filePath, avatarFile, { upsert: true, contentType: avatarFile.type })
      if (uploadError) throw uploadError

      const { data: pub } = supabase.storage.from("images").getPublicUrl(filePath)
      await supabase
        .from("users")
        .update({ avatar: pub.publicUrl, updated_at: new Date().toISOString() })
        .eq("userid", userId)

      // Initial post (optional): create row to get id, then upload into /post_<postId>/<n>.jpg
      if (postFiles.length > 0 || initialPostDescription.trim()) {
        const { valid, errors } = validateFiles(postFiles.slice(0, 9))
        if (errors.length) {
          toast.error(errors[0])
          return
        }
        if (postFiles.length > 9) toast.error("Max 9 images per post")

        const { data: createdPost, error: postErr } = await supabase
          .from("user_posts")
          .insert({
            userid: userId,
            photos: [],
            description: initialPostDescription.trim() || null,
          })
          .select("id")
          .single()
        if (postErr) throw postErr

        const urls: string[] = []
        for (let i = 0; i < valid.length; i++) {
          const f = valid[i]
          const filePath = `${userId}/post_${createdPost.id}/${i + 1}.jpg`
          const { error } = await supabase.storage
            .from("images")
            .upload(filePath, f, { upsert: true, contentType: f.type })
          if (error) throw error
          const { data: pub } = supabase.storage.from("images").getPublicUrl(filePath)
          urls.push(pub.publicUrl)
        }
        if (urls.length) {
          const { error: updErr } = await supabase
            .from("user_posts")
            .update({ photos: urls })
            .eq("id", createdPost.id)
          if (updErr) throw updErr
        }
      }

      toast.success("Digital Human created")
      router.push("/admin/digital-humans")
    } catch (err: unknown) {
      console.error(err)
      const message =
        err instanceof Error
          ? err.message
          : err && typeof err === "object" && "message" in err
            ? String((err as { message: unknown }).message)
            : null
      toast.error(message ?? "Failed to create digital human")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="space-y-2">
          <Link
            href="/admin/digital-humans"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to list
          </Link>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Create Digital Human</h1>
            <p className="text-sm text-muted-foreground">Define a persona, upload an avatar, and seed initial posts.</p>
          </div>
        </div>

        <Button type="submit" form="create-dh-form" disabled={!canSubmit} className="gap-2">
          <Upload className="h-4 w-4" />
          {loading ? "Creating..." : "Create Digital Human"}
        </Button>
      </div>

      <Card className="w-full p-6">
        <form id="create-dh-form" className="space-y-6" onSubmit={onSubmit}>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={username} onChange={(e) => setUsername(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>Profession</Label>
              <Input value={profession} onChange={(e) => setProfession(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>Age</Label>
              <Input type="number" min={18} max={100} value={age} onChange={(e) => setAge(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>Gender</Label>
              <select
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                value={gender}
                onChange={(e) => setGender(e.target.value as Gender)}
              >
                <option>Male</option>
                <option>Female</option>
                <option>Non-binary</option>
                <option>Other</option>
              </select>
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Zipcode</Label>
              <Input value={zipcode} onChange={(e) => setZipcode(e.target.value)} />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Bio</Label>
            <Textarea rows={3} value={bio} onChange={(e) => setBio(e.target.value)} required />
          </div>

          <div className="space-y-4">
            <FileDropzone
              label="Avatar"
              helper="JPG/PNG only, max 5MB. Saved as avatar.jpg."
              accept={ACCEPT_ATTR}
              filesCount={avatarFile ? 1 : 0}
              onPickFiles={(files) => {
                const { valid, errors } = validateFiles(files)
                if (errors.length) toast.error(errors[0])
                setAvatarFile(valid[0] ?? null)
              }}
              onClear={avatarFile ? () => setAvatarFile(null) : undefined}
              preview={
                <div className="flex items-center gap-3">
                  <div className="h-16 w-16 overflow-hidden rounded-full border bg-muted">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={avatarPreviewUrl ?? "/default-avatar.svg"}
                      alt="avatar preview"
                      className="h-full w-full object-cover"
                    />
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {avatarFile ? avatarFile.name : "No avatar selected"}
                  </div>
                </div>
              }
            />

            <div className="rounded-lg border bg-muted/10 p-4">
              <div className="mb-3">
                <div className="text-sm font-medium">Initial post</div>
                <div className="text-xs text-muted-foreground">Optional: seed one post with up to 9 images.</div>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Description</Label>
                  <Textarea
                    rows={3}
                    value={initialPostDescription}
                    onChange={(e) => setInitialPostDescription(e.target.value)}
                    placeholder="Write the first post..."
                  />
                </div>

                <FileDropzone
                  label="Photos"
                  helper="JPG/PNG only, max 5MB each, up to 9 images."
                  accept={ACCEPT_ATTR}
                  multiple
                  filesCount={postFiles.length}
                  onPickFiles={(files) => {
                    if (files.length > 9) toast.error("Max 9 images per post")
                    const { valid, errors } = validateFiles(files.slice(0, 9))
                    if (errors.length) toast.error(errors[0])
                    setPostFiles(valid)
                  }}
                  onClear={postFiles.length ? () => setPostFiles([]) : undefined}
                  preview={
                    postFiles.length ? (
                      <div className="grid grid-cols-3 gap-2">
                        {postPreviewUrls.slice(0, 9).map((p) => (
                          <div key={p.url} className="aspect-square overflow-hidden rounded-md border bg-muted">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={p.url} alt={p.file.name} className="h-full w-full object-cover" />
                          </div>
                        ))}
                      </div>
                    ) : null
                  }
                />
              </div>
            </div>
          </div>

        </form>
      </Card>
    </div>
  )
}
