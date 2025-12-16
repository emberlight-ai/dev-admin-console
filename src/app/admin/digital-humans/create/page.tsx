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

type Gender = "Male" | "Female" | "Non-binary" | "Other"

export default function CreateDigitalHuman() {
  const router = useRouter()
  const [loading, setLoading] = React.useState(false)

  const [username, setUsername] = React.useState("")
  const [profession, setProfession] = React.useState("")
  const [age, setAge] = React.useState<string>("")
  const [gender, setGender] = React.useState<Gender>("Male")
  const [zipcode, setZipcode] = React.useState("")
  const [bio, setBio] = React.useState("")
  const [systemPrompt, setSystemPrompt] = React.useState("You are a helpful AI assistant.")

  const [avatarFile, setAvatarFile] = React.useState<File | null>(null)
  const [postFiles, setPostFiles] = React.useState<File[]>([])

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      const { data: userData, error: userError } = await supabase
        .from("users")
        .insert({
          username,
          profession,
          age: age ? Number(age) : null,
          gender,
          zipcode,
          bio,
          is_digital_human: true,
          system_prompt: systemPrompt,
        })
        .select()
        .single()

      if (userError || !userData) throw userError
      const userId = userData.userid as string

      // Avatar upload (force avatar.jpg)
      if (avatarFile) {
        const filePath = `${userId}/avatar.jpg`
        const { error: uploadError } = await supabase.storage
          .from("images")
          .upload(filePath, avatarFile, { upsert: true, contentType: avatarFile.type })
        if (uploadError) throw uploadError

        const { data: pub } = supabase.storage.from("images").getPublicUrl(filePath)
        await supabase.from("users").update({ avatar: pub.publicUrl }).eq("userid", userId)
      }

      // Posts upload post_1.jpg etc
      if (postFiles.length > 0) {
        const urls: string[] = []
        for (let i = 0; i < postFiles.length; i++) {
          const f = postFiles[i]
          const filePath = `${userId}/post_${i + 1}.jpg`
          const { error } = await supabase.storage
            .from("images")
            .upload(filePath, f, { upsert: true, contentType: f.type })
          if (error) continue
          const { data: pub } = supabase.storage.from("images").getPublicUrl(filePath)
          urls.push(pub.publicUrl)
        }
        if (urls.length) {
          await supabase.from("user_posts").insert({
            userid: userId,
            photos: urls,
            description: "Hello world! I am new here.",
          })
        }
      }

      toast.success("Digital Human created")
      router.push("/admin/digital-humans")
    } catch (err: any) {
      console.error(err)
      toast.error(err?.message ?? "Failed to create digital human")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <Link href="/admin/digital-humans" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" />
        Back to list
      </Link>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Create Digital Human</h1>
        <p className="text-sm text-muted-foreground">Define a persona, upload an avatar, and seed initial posts.</p>
      </div>

      <Card className="p-6">
        <form className="space-y-6" onSubmit={onSubmit}>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={username} onChange={(e) => setUsername(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>Profession</Label>
              <Input value={profession} onChange={(e) => setProfession(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Age</Label>
              <Input type="number" min={18} max={100} value={age} onChange={(e) => setAge(e.target.value)} />
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
            <Textarea rows={3} value={bio} onChange={(e) => setBio(e.target.value)} />
          </div>

          <div className="space-y-2">
            <Label>System Prompt</Label>
            <Textarea rows={6} value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} required />
            <p className="text-xs text-muted-foreground">Used as the system instruction for chat.</p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Avatar (saved as avatar.jpg)</Label>
              <Input
                type="file"
                accept="image/*"
                onChange={(e) => setAvatarFile(e.target.files?.[0] ?? null)}
              />
            </div>
            <div className="space-y-2">
              <Label>Initial Post Photos (saved as post_1.jpg, post_2.jpg...)</Label>
              <Input
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => setPostFiles(Array.from(e.target.files ?? []))}
              />
            </div>
          </div>

          <div className="flex items-center justify-end">
            <Button type="submit" disabled={loading} className="gap-2">
              <Upload className="h-4 w-4" />
              {loading ? "Creating..." : "Create Digital Human"}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  )
}
