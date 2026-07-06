'use client'

import * as React from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { toast } from "sonner"
import { ArrowLeft, ChevronDown, ChevronRight, ImageOff, MapPin } from "lucide-react"

import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"

type AuditRecord = {
  deleted_at: string
  provider: string | null
  profile_snapshot: {
    username?: string | null
    avatar?: string | null
    gender?: string | null
    age?: number | null
    bio?: string | null
    profession?: string | null
    location_name?: string | null
    created_at?: string | null
  } | null
  usage_snapshot: Record<string, unknown> | null
}

type ArchivedPost = {
  id: string
  photos: string[]
  description: string | null
  location_name: string | null
  occurred_at: string | null
  created_at: string | null
}

type ArchivedMessage = {
  id: string
  sender_id: string
  content: string | null
  media_url: string | null
  image_desc: string | null
  created_at: string
}

type ArchivedMatch = {
  id: string
  other_user_id: string | null
  other_username: string | null
  other_avatar: string | null
  created_at: string | null
}

type Conversation = { match: ArchivedMatch; messages: ArchivedMessage[] }

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export default function DeletedUserArchivePage() {
  const { userid } = useParams<{ userid: string }>()
  const [audit, setAudit] = React.useState<AuditRecord | null>(null)
  const [posts, setPosts] = React.useState<ArchivedPost[]>([])
  const [conversations, setConversations] = React.useState<Conversation[]>([])
  const [loading, setLoading] = React.useState(true)
  const [openMatchId, setOpenMatchId] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!userid) return
    ;(async () => {
      setLoading(true)
      try {
        const [auditRes, archiveRes] = await Promise.all([
          fetch(`/api/admin/deleted-users/${encodeURIComponent(userid)}`),
          fetch(`/api/admin/deleted-users/${encodeURIComponent(userid)}/archive`),
        ])
        const auditJson = (await auditRes.json()) as { data?: AuditRecord | null; error?: string }
        const archiveJson = (await archiveRes.json()) as {
          data?: { posts: ArchivedPost[]; conversations: Conversation[] }
          error?: string
        }
        if (!auditRes.ok) throw new Error(auditJson.error || "Failed to load audit record")
        if (!archiveRes.ok) throw new Error(archiveJson.error || "Failed to load archive")
        setAudit(auditJson.data ?? null)
        setPosts(archiveJson.data?.posts ?? [])
        setConversations(archiveJson.data?.conversations ?? [])
      } catch (err) {
        console.error(err)
        toast.error(err instanceof Error ? err.message : "Failed to load deleted user")
      } finally {
        setLoading(false)
      }
    })()
  }, [userid])

  const profile = audit?.profile_snapshot ?? null

  if (loading) {
    return <div className="text-sm text-muted-foreground">Loading archive…</div>
  }

  return (
    <div className="max-w-4xl space-y-6">
      <Link
        href="/admin/deleted-users"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Deleted Users
      </Link>

      <Card className="p-6">
        <div className="flex items-start gap-4">
          <Avatar className="h-16 w-16">
            <AvatarImage src={profile?.avatar ?? undefined} alt={profile?.username ?? "Deleted user"} />
            <AvatarFallback>{initials(profile?.username || "?")}</AvatarFallback>
          </Avatar>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold">{profile?.username || "Unknown user"}</h1>
              <Badge variant="destructive">Deleted</Badge>
            </div>
            <div className="text-sm text-muted-foreground">
              {[profile?.gender, profile?.age ? `${profile.age}` : null].filter(Boolean).join(" · ") || "—"}
            </div>
            {profile?.location_name ? (
              <div className="flex items-center gap-1 text-sm text-muted-foreground">
                <MapPin className="h-3.5 w-3.5" />
                {profile.location_name}
              </div>
            ) : null}
            {profile?.bio ? <p className="max-w-lg text-sm text-muted-foreground">{profile.bio}</p> : null}
          </div>
          <div className="ml-auto text-right text-xs text-muted-foreground">
            <div>Deleted {audit ? new Date(audit.deleted_at).toLocaleString() : "—"}</div>
            {audit?.provider ? <div>via {audit.provider}</div> : null}
            {profile?.created_at ? (
              <div>Joined {new Date(profile.created_at).toLocaleDateString()}</div>
            ) : null}
          </div>
        </div>
      </Card>

      <Card className="p-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">Archived posts</div>
            <div className="text-xs text-muted-foreground">
              {posts.length} {posts.length === 1 ? "post" : "posts"} preserved with original photos
            </div>
          </div>
        </div>
        {posts.length === 0 ? (
          <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            No posts.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
            {posts.map((post) => (
              <div key={post.id} className="space-y-1.5">
                <div className="grid grid-cols-2 gap-1 overflow-hidden rounded-md border bg-muted/30">
                  {post.photos.length === 0 ? (
                    <div className="col-span-2 flex aspect-square items-center justify-center text-muted-foreground">
                      <ImageOff className="h-6 w-6" />
                    </div>
                  ) : (
                    post.photos.slice(0, 4).map((url, i) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={i} src={url} alt="" className="aspect-square w-full object-cover" />
                    ))
                  )}
                </div>
                {post.description ? (
                  <p className="line-clamp-2 text-xs text-muted-foreground">{post.description}</p>
                ) : null}
                {post.occurred_at ? (
                  <p className="text-[11px] text-muted-foreground">
                    {new Date(post.occurred_at).toLocaleDateString()}
                    {post.location_name ? ` · ${post.location_name}` : ""}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-6">
        <div className="mb-4">
          <div className="text-sm font-medium">Archived conversations</div>
          <div className="text-xs text-muted-foreground">
            {conversations.length} {conversations.length === 1 ? "conversation" : "conversations"} — full
            transcripts preserved
          </div>
        </div>
        {conversations.length === 0 ? (
          <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            No conversations.
          </div>
        ) : (
          <div className="space-y-2">
            {conversations.map(({ match, messages }) => {
              const isOpen = openMatchId === match.id
              return (
                <div key={match.id} className="rounded-md border">
                  <button
                    type="button"
                    onClick={() => setOpenMatchId(isOpen ? null : match.id)}
                    className="flex w-full items-center gap-3 p-3 text-left"
                  >
                    {isOpen ? (
                      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <Avatar className="h-8 w-8 shrink-0">
                      <AvatarImage src={match.other_avatar ?? undefined} alt={match.other_username ?? ""} />
                      <AvatarFallback className="text-xs">
                        {initials(match.other_username || "?")}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">
                        {match.other_username || "Unknown user"}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {messages.length} {messages.length === 1 ? "message" : "messages"}
                        {match.created_at ? ` · matched ${new Date(match.created_at).toLocaleDateString()}` : ""}
                      </div>
                    </div>
                  </button>
                  {isOpen ? (
                    <>
                      <Separator />
                      <div className="max-h-96 space-y-2 overflow-y-auto p-3">
                        {messages.length === 0 ? (
                          <div className="text-center text-sm text-muted-foreground">No messages.</div>
                        ) : (
                          messages.map((msg) => (
                            <div
                              key={msg.id}
                              className={cn(
                                "max-w-[75%] rounded-lg px-3 py-2 text-sm",
                                msg.sender_id === match.other_user_id
                                  ? "bg-muted"
                                  : "ml-auto bg-primary text-primary-foreground"
                              )}
                            >
                              {msg.content ? <p>{msg.content}</p> : null}
                              {msg.media_url ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={msg.media_url}
                                  alt={msg.image_desc ?? ""}
                                  className="mt-1 max-h-48 rounded-md object-cover"
                                />
                              ) : null}
                              <div
                                className={cn(
                                  "mt-1 text-[10px]",
                                  msg.sender_id === match.other_user_id
                                    ? "text-muted-foreground"
                                    : "text-primary-foreground/70"
                                )}
                              >
                                {new Date(msg.created_at).toLocaleString()}
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}
      </Card>
    </div>
  )
}
