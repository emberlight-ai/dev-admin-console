'use client'

import * as React from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { toast } from "sonner"

import { Card } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { composeSystemPromptFromTemplate } from "@/lib/botProfile"

import { ImageZoomDialog } from "./_components/image-zoom-dialog"
import { ProfileCard } from "./_components/profile-card"
import { ProfileEditSheet } from "./_components/profile-edit-sheet"
import { ChatHistory } from "@/components/matching/chat-history"
import { ChatPanel } from "./_components/chat-panel"
import { PostsPanel } from "./_components/posts-panel"
import type { DbUser } from "./_components/types"

export default function DigitalHumanDetail() {
  const { id } = useParams();
  const [user, setUser] = React.useState<DbUser | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [computedSystemPrompt, setComputedSystemPrompt] = React.useState<string | null>(null)
  const [effectiveSystemPrompt, setEffectiveSystemPrompt] = React.useState<string | null>(null)
  const [zoomSrc, setZoomSrc] = React.useState<string | null>(null)
  const [profileOpen, setProfileOpen] = React.useState(false)

  // (FileDropzone extracted to src/components/file-dropzone.tsx)

  React.useEffect(() => {
    if (!id) return;
    void fetchUser();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const fetchUser = async () => {
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(String(id))}`)
      const json = (await res.json()) as { data?: DbUser | null; error?: string }
      if (!res.ok) throw new Error(json.error || "Failed to fetch user details")
      if (!json.data) throw new Error("User not found")
      setUser(json.data)
    } catch (err: unknown) {
      console.error(err)
      toast.error(err instanceof Error ? err.message : "Failed to fetch user details")
      setUser(null)
    }
    setLoading(false);
  };

  React.useEffect(() => {
    if (!user) {
      setComputedSystemPrompt(null)
      setEffectiveSystemPrompt(null)
      return
    }

    const g = (user.gender ?? "").trim()
    const p = ((user.personality ?? "").trim() || "General").trim()
    if (!g) {
      setComputedSystemPrompt(null)
      return
    }

    let cancelled = false
    const run = async () => {
      try {
        const res = await fetch(
          `/api/system-prompts/latest?gender=${encodeURIComponent(g)}&personality=${encodeURIComponent(p)}`
        )
        const json = (await res.json()) as { data?: { system_prompt: string; created_at: string } | null; error?: string }
        if (!res.ok) throw new Error(json.error || "Failed to load system prompt template")

        const tpl = json.data?.system_prompt ?? ""
        if (!tpl.trim()) {
          if (!cancelled) setComputedSystemPrompt(null)
          return
        }

        const composed = composeSystemPromptFromTemplate(
          tpl,
          {
            name: user.username,
            age: user.age ?? null,
            archetype: user.profession ?? null,
            bio: user.bio ?? null,
            background: user.bio ?? null,
          },
          `${user.userid}:${p}`
        )
        if (!cancelled) setComputedSystemPrompt(composed)
      } catch (err: unknown) {
        console.error(err)
        if (!cancelled) setComputedSystemPrompt(null)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [user])

  if (loading) return <div className="text-sm text-muted-foreground">Loading...</div>
  if (!user) return <div className="text-sm text-muted-foreground">User not found</div>

  const avatarV = user.updated_at || user.created_at || ""
  const avatarSrc = `/api/avatar/${user.userid}${avatarV ? `?v=${encodeURIComponent(avatarV)}` : ""}`

  return (
    <div className="max-w-6xl space-y-4">
      <Link href="/admin/digital-humans" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to List
      </Link>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left Column: User Info */}
        <div>
          <ProfileCard
            user={user}
            avatarSrc={avatarSrc}
            onEdit={() => setProfileOpen(true)}
            onZoomAvatar={() => setZoomSrc(avatarSrc)}
            computedSystemPrompt={effectiveSystemPrompt ?? computedSystemPrompt}
          />
        </div>

        {/* Right Column: Tabs (Chat & Posts) */}
        <div className="lg:col-span-2">
          <Card className="p-6">
            <Tabs defaultValue="posts" className="w-full">
              <TabsList>
              <TabsTrigger value="posts">Post History</TabsTrigger>
                <TabsTrigger value="chat">Chat &amp; Tuning</TabsTrigger>
                <TabsTrigger value="history">Chat History</TabsTrigger>
              </TabsList>

              <TabsContent value="chat">
                <ChatPanel
                  systemPrompt={computedSystemPrompt}
                  onEffectiveSystemPromptChange={(p) => setEffectiveSystemPrompt(p || null)}
                />
              </TabsContent>

              <TabsContent value="history">
                 <ChatHistory currentUserId={user.userid} />
              </TabsContent>

              <TabsContent value="posts" className="mt-4">
                <PostsPanel userid={user.userid} onZoom={(src) => setZoomSrc(src)} />
              </TabsContent>
            </Tabs>
          </Card>
        </div>
      </div>

      <ProfileEditSheet
        open={profileOpen}
        onOpenChange={setProfileOpen}
        user={user}
        avatarSrc={avatarSrc}
        onSaved={(updates) => setUser((prev) => (prev ? { ...prev, ...updates } : prev))}
      />

      <ImageZoomDialog src={zoomSrc} onClose={() => setZoomSrc(null)} />
    </div>
  );
}
