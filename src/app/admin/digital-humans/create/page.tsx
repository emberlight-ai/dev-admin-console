'use client'

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft, Upload } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { FileDropzone } from "@/components/file-dropzone"
import { LocationAutocomplete } from "@/components/location-autocomplete"

type Gender = "Male" | "Female" | "Non-binary" | "Other"

const MAX_FILE_BYTES = 5 * 1024 * 1024
const ACCEPTED_MIME = new Set(["image/jpeg", "image/png"])
const ACCEPT_ATTR = "image/jpeg,image/png"

function avatarExtFor(file: File) {
  if (file.type === "image/png") return "png"
  return "jpg"
}

type DraftFile = { file: File; url: string }
type DraftPost = {
  key: string
  description: string
  datetimeLocal: string
  locationName: string
  longitude: number | null
  latitude: number | null
  files: DraftFile[]
}

function nowDatetimeLocal() {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function datetimeLocalToIso(v: string) {
  if (!v) return null
  const d = new Date(v)
  return Number.isFinite(d.getTime()) ? d.toISOString() : null
}

export default function CreateDigitalHuman() {
  const router = useRouter()
  const [loading, setLoading] = React.useState(false)

  const [username, setUsername] = React.useState("")
  const [profession, setProfession] = React.useState("")
  const [age, setAge] = React.useState<string>("")
  const [gender, setGender] = React.useState<Gender>("Female")
  const [availablePersonalities, setAvailablePersonalities] = React.useState<string[]>([])
  const [personality, setPersonality] = React.useState("")
  const [bio, setBio] = React.useState("")

  const [avatarFile, setAvatarFile] = React.useState<File | null>(null)
  const [draftPosts, setDraftPosts] = React.useState<DraftPost[]>(() => [
    {
      key: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now()),
      description: "",
      datetimeLocal: nowDatetimeLocal(),
      locationName: "",
      longitude: null,
      latitude: null,
      files: [],
    },
  ])

  React.useEffect(() => {
    return () => {
      // cleanup any object URLs
      draftPosts.forEach((p) => p.files.forEach((f) => URL.revokeObjectURL(f.url)))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  React.useEffect(() => {
    const g = gender === "Male" || gender === "Female" ? gender : null
    if (!g) {
      setAvailablePersonalities([])
      setPersonality("")
      return
    }

    let cancelled = false
    const run = async () => {
      try {
        const res = await fetch(`/api/system-prompts/personalities?gender=${encodeURIComponent(g)}`)
        const json = (await res.json()) as { data?: string[]; error?: string }
        if (!res.ok) throw new Error(json.error || "Failed to load personalities")
        if (cancelled) return
        const list = (json.data ?? []).filter(Boolean)
        setAvailablePersonalities(list)
        // Default to a random personality if any exist; otherwise blank.
        setPersonality((prev) => {
          if (prev.trim()) return prev
          if (!list.length) return ""
          return list[Math.floor(Math.random() * list.length)]
        })
      } catch (err: unknown) {
        console.error(err)
        if (cancelled) return
        setAvailablePersonalities([])
        setPersonality("")
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [gender])

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

  // (FileDropzone extracted to src/components/file-dropzone.tsx)

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      // Validate draft posts before creating anything:
      // - Post time + location are optional.
      // - If a post is "touched" (has location/description/photos), it must have description OR photos.
      for (let i = 0; i < draftPosts.length; i++) {
        const p = draftPosts[i]
        const hasPhotos = p.files.length > 0
        const hasDescription = Boolean(p.description.trim())
        const hasLocation = Boolean(p.locationName.trim()) || (p.longitude != null && p.latitude != null)
        const touched = hasPhotos || hasDescription || hasLocation
        if (touched && !hasPhotos && !hasDescription) {
          toast.error(`Post ${i + 1}: add a description or at least one photo (location/time are optional)`)
          return
        }
      }

      if (!bio.trim()) {
        toast.error("Bio is required")
        return
      }
      if (!avatarFile) {
        toast.error("Avatar is required")
        return
      }
      const createRes = await fetch("/api/admin/digital-humans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          profession,
          age: age ? Number(age) : null,
          gender,
          personality: personality.trim() || null,
          bio: bio.trim(),
        }),
      })
      const createJson = (await createRes.json()) as { data?: { userid?: string }; error?: string }
      if (!createRes.ok) throw new Error(createJson.error || "Failed to create digital human")
      const userId = createJson.data?.userid
      if (!userId) throw new Error("Missing userid from create response")

      // Avatar upload
      if (!ACCEPTED_MIME.has(avatarFile.type) || avatarFile.size > MAX_FILE_BYTES) {
        toast.error("Avatar must be a JPG or PNG under 5MB")
        return
      }
      const fd = new FormData()
      fd.set("file", avatarFile)
      const avatarRes = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/avatar`, {
        method: "POST",
        body: fd,
      })
      const avatarJson = (await avatarRes.json()) as { avatar?: string; error?: string }
      if (!avatarRes.ok) throw new Error(avatarJson.error || "Failed to upload avatar")

      // Posts (optional): create rows to get ids, then upload into /post_<postId>/<n>.jpg
      const postsToCreate = draftPosts.filter((p) => {
        if (p.files.length > 0) return true
        if (p.description.trim()) return true
        if (p.locationName.trim()) return true
        if (p.longitude != null && p.latitude != null) return true
        return false
      })

      for (const p of postsToCreate) {
        const pickedFiles = p.files.map((x) => x.file)
        const { valid, errors } = validateFiles(pickedFiles.slice(0, 9))
        if (errors.length) {
          toast.error(errors[0])
          return
        }
        if (pickedFiles.length > 9) toast.error("Max 9 images per post")

        const postRes = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/posts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            description: p.description.trim() || null,
            occurred_at: datetimeLocalToIso(p.datetimeLocal) ?? new Date().toISOString(),
            location_name: p.locationName.trim() || null,
            longitude: p.longitude,
            latitude: p.latitude,
          }),
        })
        const postJson = (await postRes.json()) as { data?: { id?: string }; error?: string }
        if (!postRes.ok) throw new Error(postJson.error || "Failed to create post")
        const postId = postJson.data?.id
        if (!postId) throw new Error("Missing post id")

        if (valid.length) {
          const upFd = new FormData()
          upFd.set("userid", userId)
          for (const f of valid) upFd.append("files", f)
          const upRes = await fetch(`/api/admin/posts/${encodeURIComponent(postId)}/photos`, {
            method: "POST",
            body: upFd,
          })
          const upJson = (await upRes.json()) as { photos?: string[]; error?: string }
          if (!upRes.ok) throw new Error(upJson.error || "Failed to upload post photos")
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
                <div className="text-xs text-muted-foreground">{avatarFile ? avatarFile.name : "No avatar selected"}</div>
              </div>
            }
          />

            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={username} onChange={(e) => setUsername(e.target.value)} required />
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
            <div className="space-y-2">
              <Label>Profession</Label>
              <Input value={profession} onChange={(e) => setProfession(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>Personality (optional)</Label>
              <select
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                value={personality}
                onChange={(e) => setPersonality(e.target.value)}
                disabled={availablePersonalities.length === 0}
              >
                {availablePersonalities.length === 0 ? (
                  <option value="">No personalities available</option>
                ) : (
                  <>
                    <option value="">None</option>
                    {availablePersonalities.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </>
                )}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Age</Label>
              <Input type="number" min={18} max={100} value={age} onChange={(e) => setAge(e.target.value)} required />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Bio</Label>
            <Textarea rows={3} value={bio} onChange={(e) => setBio(e.target.value)} required />
          </div>

          <div className="space-y-4">
            <div className="rounded-lg border bg-muted/10 p-4">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">Posts</div>
                  <div className="text-xs text-muted-foreground">
                    Optional: seed multiple posts. Each post supports time, location, description, and up to 9 images.
                  </div>
                </div>

                <Button
                  type="button"
                  variant="outline"
                  className="shrink-0"
                  onClick={() => {
                    setDraftPosts((prev) => [
                      ...prev,
                      {
                        key:
                          typeof crypto !== "undefined" && "randomUUID" in crypto
                            ? crypto.randomUUID()
                            : String(Date.now()),
                        description: "",
                        datetimeLocal: nowDatetimeLocal(),
                        locationName: "",
                        longitude: null,
                        latitude: null,
                        files: [],
                      },
                    ])
                  }}
                >
                  Add post
                </Button>
              </div>

              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 xl:gap-6">
                  {draftPosts.map((p, idx) => (
                    <div key={p.key} className="w-full max-w-[520px] justify-self-center rounded-md border bg-background p-4">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <div className="text-sm font-medium">Post {idx + 1}</div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setDraftPosts((prev) => {
                            const target = prev.find((x) => x.key === p.key)
                            if (target) target.files.forEach((f) => URL.revokeObjectURL(f.url))
                            return prev.filter((x) => x.key !== p.key)
                          })
                        }}
                        disabled={draftPosts.length <= 1}
                      >
                        Remove
                      </Button>
                    </div>

                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label>Post time</Label>
                        <Input
                          type="datetime-local"
                          value={p.datetimeLocal}
                          onChange={(e) => {
                            const v = e.target.value
                            setDraftPosts((prev) => prev.map((x) => (x.key === p.key ? { ...x, datetimeLocal: v } : x)))
                          }}
                        />
                      </div>

                      <LocationAutocomplete
                        label="Location"
                        value={p.locationName}
                        onValueChange={(v) => {
                          setDraftPosts((prev) =>
                            prev.map((x) =>
                              x.key === p.key ? { ...x, locationName: v, longitude: null, latitude: null } : x
                            )
                          )
                        }}
                        onSelect={(sel) => {
                          setDraftPosts((prev) =>
                            prev.map((x) =>
                              x.key === p.key
                                ? { ...x, locationName: sel.name, longitude: sel.longitude, latitude: sel.latitude }
                                : x
                            )
                          )
                        }}
                        onClear={() => {
                          setDraftPosts((prev) =>
                            prev.map((x) => (x.key === p.key ? { ...x, locationName: "", longitude: null, latitude: null } : x))
                          )
                        }}
                        placeholder="Search location (e.g. Prague, Czech Republic)"
                      />

                      {p.longitude != null && p.latitude != null ? (
                        <div className="text-xs text-muted-foreground">
                          Selected: lon {p.longitude.toFixed(4)} · lat {p.latitude.toFixed(4)}
                        </div>
                      ) : null}

                      <div className="space-y-2">
                        <Label>Description</Label>
                        <Textarea
                          rows={3}
                          value={p.description}
                          onChange={(e) => {
                            const v = e.target.value
                            setDraftPosts((prev) => prev.map((x) => (x.key === p.key ? { ...x, description: v } : x)))
                          }}
                          placeholder="Write the post..."
                        />
                      </div>

                      <FileDropzone
                        label="Photos"
                        helper="JPG/PNG only, max 5MB each, up to 9 images."
                        accept={ACCEPT_ATTR}
                        multiple
                        filesCount={p.files.length}
                        onPickFiles={(files) => {
                          if (p.files.length + files.length > 9) toast.error("Max 9 images per post")
                          const { valid, errors } = validateFiles(files.slice(0, Math.max(0, 9 - p.files.length)))
                          if (errors.length) toast.error(errors[0])
                          const next = valid.map((f) => ({ file: f, url: URL.createObjectURL(f) }))
                          setDraftPosts((prev) => prev.map((x) => (x.key === p.key ? { ...x, files: [...x.files, ...next] } : x)))
                        }}
                        onClear={
                          p.files.length
                            ? () => {
                                setDraftPosts((prev) => {
                                  const target = prev.find((x) => x.key === p.key)
                                  if (target) target.files.forEach((f) => URL.revokeObjectURL(f.url))
                                  return prev.map((x) => (x.key === p.key ? { ...x, files: [] } : x))
                                })
                              }
                            : undefined
                        }
                        preview={
                          p.files.length ? (
                            <div className="grid grid-cols-3 gap-2">
                              {p.files.slice(0, 9).map((f) => (
                                <div key={f.url} className="aspect-square overflow-hidden rounded-md border bg-muted">
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img src={f.url} alt={f.file.name} className="h-full w-full object-cover" />
                                </div>
                              ))}
                            </div>
                          ) : null
                        }
                      />
                    </div>
                  </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

        </form>
      </Card>
    </div>
  )
}
