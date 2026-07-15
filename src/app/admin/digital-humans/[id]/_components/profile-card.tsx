'use client'

import * as React from "react"
import { toast } from "sonner"
import { Copy, Pencil, Settings2, CheckCircle2, CircleMinus, Sparkles, Star, X } from "lucide-react"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import { FileDropzone } from "@/components/file-dropzone"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogXCloseButton,
} from "@/components/ui/dialog"

import type { DbUser } from "./types"
import { SystemPromptForm } from "@/app/admin/personas/manage/_components/system-prompt-form"

const MAX_FILE_BYTES = 5 * 1024 * 1024
const ACCEPTED_MIME = new Set(["image/jpeg", "image/png"])
const ACCEPT_ATTR = "image/jpeg,image/png"

export function ProfileCard({
  user,
  avatarSrc,
  onZoomAvatar,
  systemPromptMeta,
  onPromptSaved,
  onToggleWhitelist,
  whitelistBusy,
  onSaved,
}: {
  user: DbUser
  avatarSrc?: string
  onZoomAvatar: () => void
  systemPromptMeta?: {
    immediate_match_enabled: boolean
    active_greeting_enabled: boolean
    created_at: string | null
    gender: string
    personality: string
  } | null
  onPromptSaved?: () => void
  onToggleWhitelist?: () => void
  whitelistBusy?: boolean
  onSaved?: (updates: Partial<DbUser>) => void
}) {
  const [configOpen, setConfigOpen] = React.useState(false)
  const [editing, setEditing] = React.useState(false)
  const [saving, setSaving] = React.useState(false)

  // Edit fields
  const [username, setUsername] = React.useState("")
  const [profession, setProfession] = React.useState("")
  const [age, setAge] = React.useState("")
  const [gender, setGender] = React.useState("")
  const [personality, setPersonality] = React.useState("")
  const [availablePersonalities, setAvailablePersonalities] = React.useState<string[]>([])
  const [zipcode, setZipcode] = React.useState("")
  const [bio, setBio] = React.useState("")
  const [storyline, setStoryline] = React.useState("")
  const [generatingStoryline, setGeneratingStoryline] = React.useState(false)

  // First-person draft from persona + profile + interests (composition plan).
  const generateStoryline = async () => {
    setGeneratingStoryline(true)
    try {
      const res = await fetch(`/api/admin/digital-humans/${encodeURIComponent(user.userid)}/storyline`, { method: "POST" })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "Generation failed")
      setStoryline(json.draft ?? "")
      toast.success("Draft generated — review, edit, then save")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Generation failed")
    } finally {
      setGeneratingStoryline(false)
    }
  }
  const [avatarFile, setAvatarFile] = React.useState<File | null>(null)
  const avatarFileRef = React.useRef<File | null>(null)

  const startEdit = () => {
    setUsername(user.username ?? "")
    setProfession(user.profession ?? "")
    setAge(user.age != null ? String(user.age) : "")
    setGender(user.gender ?? "")
    setPersonality(user.personality ?? "")
    setZipcode(user.zipcode ?? "")
    setBio(user.bio ?? "")
    setStoryline(user.storyline ?? "")
    setAvatarFile(null)
    avatarFileRef.current = null
    setAvailablePersonalities([])
    setEditing(true)
  }

  // Load selectable personalities for the chosen gender (mirrors the old sheet).
  React.useEffect(() => {
    if (!editing) return
    const g = gender.trim()
    if (g !== "Male" && g !== "Female") {
      setAvailablePersonalities([])
      return
    }
    let cancelled = false
    fetch(`/api/system-prompts/personalities?gender=${encodeURIComponent(g)}`)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return
        setAvailablePersonalities(Array.isArray(j.data) ? (j.data as string[]).filter(Boolean) : [])
      })
      .catch(() => !cancelled && setAvailablePersonalities([]))
    return () => {
      cancelled = true
    }
  }, [editing, gender])

  const avatarPreviewUrl = React.useMemo(() => (avatarFile ? URL.createObjectURL(avatarFile) : null), [avatarFile])
  React.useEffect(() => {
    return () => {
      if (avatarPreviewUrl) URL.revokeObjectURL(avatarPreviewUrl)
    }
  }, [avatarPreviewUrl])

  const save = async () => {
    if (!username.trim()) {
      toast.error("Username is required")
      return
    }
    setSaving(true)
    try {
      const file = avatarFileRef.current ?? avatarFile
      const updates: Partial<DbUser> & { updated_at?: string | null } = {
        username: username.trim(),
        profession: profession.trim() || null,
        age: age ? Number(age) : null,
        gender: gender.trim() || null,
        personality: personality.trim() || null,
        zipcode: zipcode.trim() || null,
        bio: bio.trim() || null,
        storyline: storyline.trim() || null,
        updated_at: new Date().toISOString(),
      }

      if (file) {
        if (!ACCEPTED_MIME.has(file.type) || file.size > MAX_FILE_BYTES) {
          toast.error("Avatar must be a JPG or PNG under 5MB")
          setSaving(false)
          return
        }
        const fd = new FormData()
        fd.set("file", file)
        const res = await fetch(`/api/admin/users/${encodeURIComponent(user.userid)}/avatar`, { method: "POST", body: fd })
        const json = (await res.json()) as { avatar?: string; error?: string }
        if (!res.ok) throw new Error(json.error || "Failed to upload avatar")
        if (json.avatar) updates.avatar = json.avatar
      }

      const res = await fetch(`/api/admin/users/${encodeURIComponent(user.userid)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      })
      const json = (await res.json()) as { data?: DbUser | null; error?: string }
      if (!res.ok) throw new Error(json.error || "Failed to update profile")

      toast.success("Profile updated")
      onSaved?.(updates)
      setEditing(false)
    } catch (err: unknown) {
      console.error(err)
      toast.error(err instanceof Error ? err.message : "Failed to update profile")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <div className="flex items-start justify-between">
          <div className="text-sm font-medium">Profile</div>
          <div className="flex items-center gap-2">
            <Button
              variant={user.whitelisted ? "default" : "outline"}
              size="sm"
              className="gap-2"
              onClick={onToggleWhitelist}
              disabled={whitelistBusy || editing}
              title={user.whitelisted ? "Featured in the match deck — click to remove" : "Feature this DH at the top of the match deck"}
            >
              <Star className={`h-4 w-4 ${user.whitelisted ? "fill-current" : ""}`} />
              {user.whitelisted ? "Whitelisted" : "Whitelist"}
            </Button>
            {editing ? (
              <>
                <Button variant="ghost" size="sm" className="gap-2" onClick={() => setEditing(false)} disabled={saving}>
                  <X className="h-4 w-4" />
                  Cancel
                </Button>
                <Button size="sm" onClick={() => void save()} disabled={saving || !username.trim()}>
                  {saving ? "Saving..." : "Save"}
                </Button>
              </>
            ) : (
              <Button variant="outline" size="sm" className="gap-2" onClick={startEdit}>
                <Pencil className="h-4 w-4" />
                Edit
              </Button>
            )}
          </div>
        </div>

        {editing ? (
          /* ── Inline edit form ─────────────────────────────────────────── */
          <div className="mt-4 space-y-4">
            <FileDropzone
              label="Avatar"
              helper="JPG/PNG only, max 5MB."
              accept={ACCEPT_ATTR}
              filesCount={avatarFile ? 1 : 0}
              onPickFiles={(files) => {
                const f = files[0] ?? null
                if (f && (!ACCEPTED_MIME.has(f.type) || f.size > MAX_FILE_BYTES)) {
                  toast.error("Avatar must be a JPG or PNG under 5MB")
                  return
                }
                avatarFileRef.current = f
                setAvatarFile(f)
              }}
              onClear={avatarFile ? () => { avatarFileRef.current = null; setAvatarFile(null) } : undefined}
              preview={
                <div className="flex items-center gap-3">
                  <div className="h-16 w-16 overflow-hidden rounded-full border bg-muted">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={avatarPreviewUrl ?? avatarSrc ?? ""} alt="avatar preview" className="h-full w-full object-cover" />
                  </div>
                  <div className="text-xs text-muted-foreground">{avatarFile ? avatarFile.name : "Current avatar"}</div>
                </div>
              }
            />
            <div className="space-y-2">
              <Label>Username</Label>
              <Input value={username} onChange={(e) => setUsername(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Profession</Label>
              <Input value={profession} onChange={(e) => setProfession(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Age</Label>
                <Input type="number" min={0} value={age} onChange={(e) => setAge(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Gender</Label>
                <Input value={gender} onChange={(e) => setGender(e.target.value)} placeholder="e.g. Female" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Personality</Label>
              <select
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                value={personality}
                onChange={(e) => setPersonality(e.target.value)}
                disabled={availablePersonalities.length === 0 && !personality.trim()}
              >
                <option value="">None</option>
                {personality.trim() && !availablePersonalities.includes(personality) ? (
                  <option value={personality}>{personality}</option>
                ) : null}
                {availablePersonalities.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Zipcode</Label>
              <Input value={zipcode} onChange={(e) => setZipcode(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Bio</Label>
              <Textarea rows={3} value={bio} onChange={(e) => setBio(e.target.value)} />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Storyline</Label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={generatingStoryline}
                  onClick={() => void generateStoryline()}
                >
                  <Sparkles className="mr-1 h-3.5 w-3.5" />
                  {generatingStoryline ? "Generating…" : "Generate"}
                </Button>
              </div>
              <Textarea
                rows={8}
                value={storyline}
                onChange={(e) => setStoryline(e.target.value)}
                placeholder="Her backstory + current beat, first person (&quot;I grew up in…&quot;). Generate a draft from her persona, profile and interests, then edit. Injected into chats as <bot_storyline>."
              />
              <p className="text-xs text-muted-foreground">
                Used by auto-replies and follow-ups to keep conversations consistent and give the DH things to talk about.
              </p>
            </div>
          </div>
        ) : (
          /* ── Read view ────────────────────────────────────────────────── */
          <>
            <div className="flex flex-col items-center text-center">
              <button type="button" className="group rounded-full" onClick={onZoomAvatar} aria-label="View avatar">
                <Avatar className="h-28 w-28 overflow-hidden">
                  <AvatarImage src={avatarSrc} alt={user.username} className="transition-transform duration-200 group-hover:scale-[1.06]" />
                  <AvatarFallback>{user.username.slice(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
              </button>
              <div className="mt-4">
                <div className="text-xl font-semibold">{user.username}</div>
                <div className="text-sm text-muted-foreground">{user.profession ?? "—"}</div>
              </div>
              <div className="mt-3">
                <Badge>Digital Human</Badge>
              </div>
            </div>

            <Separator className="my-0" />
            <dl className="space-y-3 text-sm">
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">Age</dt>
                <dd>{user.age ?? "—"}</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">Gender</dt>
                <dd>{user.gender ?? "—"}</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">Location</dt>
                <dd>{user.zipcode ?? "—"}</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">User ID</dt>
                <dd>
                  <Button variant="ghost" size="sm" onClick={() => {
                    navigator.clipboard.writeText(user.userid)
                    toast.success("User ID copied to clipboard")
                  }}>
                    <Copy className="h-4 w-4" />
                    Copy
                  </Button>
                </dd>
              </div>
              <div className="space-y-1">
                <dt className="text-muted-foreground">Bio</dt>
                <dd className="text-sm">{user.bio ?? "—"}</dd>
              </div>
              <div className="space-y-1">
                <dt className="text-muted-foreground">Storyline</dt>
                <dd className="text-sm whitespace-pre-wrap">{user.storyline?.trim() ? user.storyline : "—"}</dd>
              </div>
            </dl>
          </>
        )}
      </Card>

      <Card className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-2 min-w-0">
            <div className="text-sm font-medium whitespace-nowrap">Personality</div>
            {user.personality ? (
              <span className="inline-flex items-center rounded-full border bg-muted/40 px-3 py-1 text-sm font-medium text-foreground truncate max-w-[260px] leading-none">
                {user.personality}
              </span>
            ) : (
              <span className="text-sm text-muted-foreground">—</span>
            )}
          </div>
          <Button
            variant="outline"
            size="icon"
            aria-label="Configure automation settings"
            title="Configure automation settings"
            onClick={() => setConfigOpen(true)}
          >
            <Settings2 className="h-4 w-4" />
          </Button>
        </div>
        <Separator className="my-0" />
        <dl className="space-y-3 text-sm">
          <div className="flex items-center justify-between gap-4">
            <dt className="text-muted-foreground">Immediate Match</dt>
            <dd>
              {systemPromptMeta?.immediate_match_enabled ? (
                <CheckCircle2 className="h-4 w-4 text-green-600" />
              ) : (
                <CircleMinus className="h-4 w-4 text-gray-400" />
              )}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-muted-foreground">Greeting</dt>
            <dd>
              {systemPromptMeta?.active_greeting_enabled ? (
                <CheckCircle2 className="h-4 w-4 text-green-600" />
              ) : (
                <CircleMinus className="h-4 w-4 text-gray-400" />
              )}
            </dd>
          </div>
        </dl>
      </Card>

      <Dialog open={configOpen} onOpenChange={setConfigOpen}>
        <DialogContent className="sm:max-w-4xl max-h-[85vh] overflow-y-auto p-6">
          <DialogXCloseButton />
          <DialogHeader>
            <DialogTitle>System Prompt Configuration</DialogTitle>
          </DialogHeader>
          <SystemPromptForm
            initialGender={(systemPromptMeta?.gender || user.gender || "Female") as string}
            initialPersonality={(systemPromptMeta?.personality || user.personality || "General") as string}
            disableKeyEdit={true}
            variant="dialog"
            onCancel={() => setConfigOpen(false)}
            onSaved={() => {
              setConfigOpen(false)
              onPromptSaved?.()
              toast.success("Prompt updated")
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  )
}
