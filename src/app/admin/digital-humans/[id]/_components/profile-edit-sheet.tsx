'use client'

import * as React from "react"
import { toast } from "sonner"

import { supabase } from "@/lib/supabase"
import { buildSystemPrompt } from "@/lib/botProfile"
import { FileDropzone } from "@/components/file-dropzone"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"

import type { DbUser } from "./types"

const MAX_FILE_BYTES = 5 * 1024 * 1024
const ACCEPTED_MIME = new Set(["image/jpeg", "image/png"])
const ACCEPT_ATTR = "image/jpeg,image/png"

function avatarExtFor(file: File) {
  if (file.type === "image/png") return "png"
  return "jpg"
}

export function ProfileEditSheet({
  open,
  onOpenChange,
  user,
  avatarSrc,
  onSaved,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  user: DbUser
  avatarSrc?: string
  onSaved: (updates: Partial<DbUser>) => void
}) {
  const [saving, setSaving] = React.useState(false)

  const [editUsername, setEditUsername] = React.useState("")
  const [editProfession, setEditProfession] = React.useState("")
  const [editAge, setEditAge] = React.useState<string>("")
  const [editGender, setEditGender] = React.useState("")
  const [editZipcode, setEditZipcode] = React.useState("")
  const [editBio, setEditBio] = React.useState("")

  const [editAvatarFile, setEditAvatarFile] = React.useState<File | null>(null)
  // Store latest picked file immediately to avoid race where user clicks Save before re-render.
  const editAvatarFileRef = React.useRef<File | null>(null)

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

  React.useEffect(() => {
    if (!open) return
    setEditUsername(user.username ?? "")
    setEditProfession(user.profession ?? "")
    setEditAge(user.age != null ? String(user.age) : "")
    setEditGender(user.gender ?? "")
    setEditZipcode(user.zipcode ?? "")
    setEditBio(user.bio ?? "")
    setEditAvatarFile(null)
    editAvatarFileRef.current = null
  }, [open, user])

  const avatarPreviewUrl = React.useMemo(() => {
    if (!editAvatarFile) return null
    return URL.createObjectURL(editAvatarFile)
  }, [editAvatarFile])

  React.useEffect(() => {
    return () => {
      if (avatarPreviewUrl) URL.revokeObjectURL(avatarPreviewUrl)
    }
  }, [avatarPreviewUrl])

  const saveProfile = async () => {
    setSaving(true)
    try {
      const avatarFile = editAvatarFileRef.current ?? editAvatarFile

      const updates: Partial<DbUser> & { updated_at?: string | null } = {
        username: editUsername.trim(),
        profession: editProfession.trim() || null,
        age: editAge ? Number(editAge) : null,
        gender: editGender.trim() || null,
        zipcode: editZipcode.trim() || null,
        bio: editBio.trim() || null,
        updated_at: new Date().toISOString(),
      }

      updates.system_prompt = buildSystemPrompt({
        name: updates.username ?? user.username,
        age: updates.age ?? user.age ?? null,
        archetype: updates.profession ?? user.profession ?? null,
        bio: updates.bio ?? user.bio ?? null,
      })

      if (avatarFile) {
        if (!ACCEPTED_MIME.has(avatarFile.type)) {
          toast.error("Avatar must be a JPG or PNG under 5MB")
          return
        }
        if (avatarFile.size > MAX_FILE_BYTES) {
          toast.error("Avatar must be under 5MB")
          return
        }
        const idPart =
          typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now())
        const filePath = `${user.userid}/avatar_${idPart}.${avatarExtFor(avatarFile)}`
        const { error: uploadError } = await supabase.storage
          .from("images")
          .upload(filePath, avatarFile, { upsert: false, contentType: avatarFile.type })
        if (uploadError) throw uploadError
        const { data: pub } = supabase.storage.from("images").getPublicUrl(filePath)
        updates.avatar = pub.publicUrl
      }

      const { error } = await supabase.from("users").update(updates).eq("userid", user.userid)
      if (error) throw error

      toast.success("Profile updated")
      onSaved(updates)
      onOpenChange(false)
    } catch (err: unknown) {
      console.error(err)
      toast.error(err instanceof Error ? err.message : "Failed to update profile")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Edit profile</SheetTitle>
          <SheetDescription>Update username, avatar, and details.</SheetDescription>
        </SheetHeader>

        <div className="space-y-4 px-4">
          <div className="space-y-2">
            <Label>Username</Label>
            <Input value={editUsername} onChange={(e) => setEditUsername(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Profession</Label>
            <Input value={editProfession} onChange={(e) => setEditProfession(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Age</Label>
              <Input type="number" min={0} value={editAge} onChange={(e) => setEditAge(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Gender</Label>
              <Input value={editGender} onChange={(e) => setEditGender(e.target.value)} placeholder="e.g. Male" />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Zipcode</Label>
            <Input value={editZipcode} onChange={(e) => setEditZipcode(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Bio</Label>
            <Textarea rows={4} value={editBio} onChange={(e) => setEditBio(e.target.value)} />
          </div>

          <FileDropzone
            label="Avatar"
            helper="JPG/PNG only, max 5MB. Saved as a new unique filename each upload."
            accept={ACCEPT_ATTR}
            filesCount={editAvatarFile ? 1 : 0}
            onPickFiles={(files) => {
              const { valid, errors } = validateFiles(files)
              if (errors.length) toast.error(errors[0])
              const f = valid[0] ?? null
              editAvatarFileRef.current = f
              setEditAvatarFile(f)
            }}
            onClear={
              editAvatarFile
                ? () => {
                    editAvatarFileRef.current = null
                    setEditAvatarFile(null)
                  }
                : undefined
            }
            preview={
              <div className="flex items-center gap-3">
                <div className="h-16 w-16 overflow-hidden rounded-full border bg-muted">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={avatarPreviewUrl ?? avatarSrc ?? ""}
                    alt="avatar preview"
                    className="h-full w-full object-cover"
                  />
                </div>
                <div className="text-xs text-muted-foreground">
                  {editAvatarFile ? editAvatarFile.name : "Current avatar"}
                </div>
              </div>
            }
          />
        </div>

        <SheetFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={saveProfile} disabled={saving || !editUsername.trim()}>
            {saving ? "Saving..." : "Save changes"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}


