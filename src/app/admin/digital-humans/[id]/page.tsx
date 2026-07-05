'use client'

import * as React from "react"
import Link from "next/link"
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { toast } from "sonner"

import { Card } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { composeSystemPromptFromTemplate } from "@/lib/botProfile"

import { ImageZoomDialog } from "./_components/image-zoom-dialog"
import { ProfileCard } from "./_components/profile-card"
import { ChatHistory } from "@/components/matching/chat-history"
import { SendMatchRequestPanel } from "@/components/matching/send-match-request-panel"
import { PostsPanel } from "./_components/posts-panel"
import { ChatImagesPanel } from "./_components/chat-images-panel"
import type { DbUser } from "./_components/types"

export default function DigitalHumanDetail() {
  const { id } = useParams();
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  // URL-driven tabs so other pages can deep-link (e.g. "Take over" → ?tab=history).
  const currentTab = searchParams.get("tab") || "posts"
  const handleTabChange = (value: string) => {
    const newParams = new URLSearchParams(searchParams.toString())
    newParams.set("tab", value)
    router.replace(`${pathname}?${newParams.toString()}`, { scroll: false })
  }

  const [user, setUser] = React.useState<DbUser | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [computedSystemPrompt, setComputedSystemPrompt] = React.useState<string | null>(null)
  const [effectiveSystemPrompt, setEffectiveSystemPrompt] = React.useState<string | null>(null)
  const [systemPromptMeta, setSystemPromptMeta] = React.useState<{
    immediate_match_enabled: boolean
    follow_up_message_enabled: boolean
    active_greeting_enabled: boolean
    follow_up_delay: number
    max_follow_ups: number
    created_at: string | null
    gender: string
    personality: string
  } | null>(null)
  const [zoomSrc, setZoomSrc] = React.useState<string | null>(null)
  const [whitelistBusy, setWhitelistBusy] = React.useState(false)

  const toggleWhitelist = async () => {
    if (!user) return
    const next = !user.whitelisted
    setWhitelistBusy(true)
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(user.userid)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ whitelisted: next }),
      })
      if (!res.ok) throw new Error("Failed to update whitelist")
      setUser((prev) => (prev ? { ...prev, whitelisted: next } : prev))
      toast.success(next ? "Added to match-deck whitelist" : "Removed from whitelist")
    } catch (err) {
      console.error(err)
      toast.error("Failed to update whitelist")
    } finally {
      setWhitelistBusy(false)
    }
  }

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

  const refreshSystemPromptInfo = React.useCallback(async () => {
    if (!user) return
    const g = (user.gender ?? "").trim()
    const p = ((user.personality ?? "").trim() || "General").trim()
    if (!g) {
      setComputedSystemPrompt(null)
      setSystemPromptMeta(null)
      return
    }

    try {
      const res = await fetch(`/api/system-prompts/latest?gender=${encodeURIComponent(g)}&personality=${encodeURIComponent(p)}`)
      const json = (await res.json()) as {
        data?: {
          system_prompt: string
          created_at: string
          immediate_match_enabled?: boolean
          follow_up_message_enabled?: boolean
          follow_up_message_prompt?: string
          follow_up_delay?: number
          max_follow_ups?: number
          active_greeting_enabled?: boolean
          active_greeting_prompt?: string
        } | null
        error?: string
      }
      if (!res.ok) throw new Error(json.error || "Failed to load system prompt template")

      setSystemPromptMeta({
        immediate_match_enabled: json.data?.immediate_match_enabled ?? false,
        follow_up_message_enabled: json.data?.follow_up_message_enabled ?? false,
        active_greeting_enabled: json.data?.active_greeting_enabled ?? false,
        follow_up_delay: json.data?.follow_up_delay ?? 86400,
        max_follow_ups: json.data?.max_follow_ups ?? 3,
        created_at: json.data?.created_at ?? null,
        gender: g,
        personality: p,
      })

      const tpl = json.data?.system_prompt ?? ""
      if (!tpl.trim()) {
        setComputedSystemPrompt(null)
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
      setComputedSystemPrompt(composed)
    } catch (err: unknown) {
      console.error(err)
      setComputedSystemPrompt(null)
      setSystemPromptMeta(null)
    }
  }, [user])

  React.useEffect(() => {
    if (!user) {
      setComputedSystemPrompt(null)
      setEffectiveSystemPrompt(null)
      setSystemPromptMeta(null)
      return
    }
    void refreshSystemPromptInfo()
  }, [user, refreshSystemPromptInfo])

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
            onZoomAvatar={() => setZoomSrc(avatarSrc)}
            systemPromptMeta={systemPromptMeta}
            onPromptSaved={() => void refreshSystemPromptInfo()}
            onToggleWhitelist={toggleWhitelist}
            whitelistBusy={whitelistBusy}
            onSaved={(updates) => setUser((prev) => (prev ? { ...prev, ...updates } : prev))}
          />
        </div>

        {/* Right Column: Tabs (Chat & Posts) */}
        <div className="lg:col-span-2">
          <Card className="p-6">
            <Tabs value={currentTab} onValueChange={handleTabChange} className="w-full">
              <TabsList>
                <TabsTrigger value="posts">Post History</TabsTrigger>
                <TabsTrigger value="chat-images">Chat Images</TabsTrigger>
                <TabsTrigger value="history">Chat History</TabsTrigger>
                <TabsTrigger value="invite">Send Invitation</TabsTrigger>
              </TabsList>


              <TabsContent value="history">
                <ChatHistory currentUserId={user.userid} currentUserIsDigitalHuman />
              </TabsContent>

              <TabsContent value="invite" className="mt-4">
                <SendMatchRequestPanel fromUserId={user.userid} />
              </TabsContent>

              <TabsContent value="posts" className="mt-4">
                <PostsPanel userid={user.userid} onZoom={(src) => setZoomSrc(src)} />
              </TabsContent>

              <TabsContent value="chat-images" className="mt-4">
                <ChatImagesPanel userid={user.userid} onZoom={(src) => setZoomSrc(src)} />
              </TabsContent>
            </Tabs>
          </Card>
        </div>
      </div>

      <ImageZoomDialog src={zoomSrc} onClose={() => setZoomSrc(null)} />
    </div>
  );
}
