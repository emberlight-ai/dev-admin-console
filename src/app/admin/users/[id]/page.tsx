'use client'

import * as React from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { ArrowLeft, Copy, Pencil, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { formatDistanceToNow } from "date-fns"

import { Card } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
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

import { ImageZoomDialog } from "@/app/admin/digital-humans/[id]/_components/image-zoom-dialog"
import { ProfileEditSheet } from "@/app/admin/digital-humans/[id]/_components/profile-edit-sheet"
import { PostsPanel } from "@/app/admin/digital-humans/[id]/_components/posts-panel"
import { RelationshipGraph } from "@/components/matching/relationship-graph"
import { ChatHistory } from "@/components/matching/chat-history"
import type { DbUser } from "@/app/admin/digital-humans/[id]/_components/types"

type DeletionAudit = {
  deleted_user_id: string
  deleted_at: string
  provider?: string | null
  profile_snapshot?: Record<string, unknown> | null
  usage_snapshot?: Record<string, unknown> | null
  posts_snapshot?: Record<string, unknown>[] | null
  matches_snapshot?: Record<string, unknown>[] | null
  messages_snapshot?: Record<string, unknown>[] | null
}

export default function UserDetail() {
  const { id } = useParams()
  const [user, setUser] = React.useState<DbUser | null>(null)
  const [deletedAudit, setDeletedAudit] = React.useState<DeletionAudit | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [zoomSrc, setZoomSrc] = React.useState<string | null>(null)
  const [profileOpen, setProfileOpen] = React.useState(false)

  // Auth/Session Info
  const [authInfo, setAuthInfo] = React.useState<{
    last_sign_in_at?: string
    email?: string
    created_at?: string
    app_metadata?: { provider?: string }
  } | null>(null)
  const [authLoading, setAuthLoading] = React.useState(false)

  React.useEffect(() => {
    if (!id) return
    void fetchUser()
    void fetchAuthInfo()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const fetchAuthInfo = async () => {
    setAuthLoading(true)
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(String(id))}/auth`)
      const json = await res.json()
      if (json.data) {
        setAuthInfo(json.data)
      }
    } catch (err) {
      console.error(err)
    }
    setAuthLoading(false)
  }

  const fetchUser = async () => {
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(String(id))}`)
      const json = (await res.json()) as { data?: DbUser | null; error?: string }
      if (!res.ok || !json.data) {
        // Fallback: user might have been hard-deleted; try archived deletion audit.
        const dres = await fetch(`/api/admin/deleted-users/${encodeURIComponent(String(id))}`)
        const djson = (await dres.json()) as { data?: DeletionAudit | null; error?: string }
        if (!dres.ok) throw new Error(djson.error || "Failed to fetch deleted user details")
        if (!djson.data) throw new Error("User not found")
        setUser(null)
        setDeletedAudit(djson.data)
        setLoading(false)
        return
      }
      setDeletedAudit(null)
      setUser(json.data)
    } catch (err: unknown) {
      console.error(err)
      toast.error(err instanceof Error ? err.message : "Failed to fetch user details")
      setUser(null)
      setDeletedAudit(null)
    }
    setLoading(false)
  }

  const hardDeleteUser = async () => {
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(String(id))}/hard-delete`, {
        method: "POST",
      })
      if (!res.ok) throw new Error("Failed to delete user")
      toast.success("User deleted")
      // Optionally redirect or refresh
      void fetchUser()
    } catch (err) {
      toast.error("Error deleting user")
      console.error(err)
    }
  }

  if (loading) return <div className="text-sm text-muted-foreground">Loading...</div>
  if (!user && !deletedAudit) return <div className="text-sm text-muted-foreground">User not found</div>

  const isDeleted = !!deletedAudit && !user
  const profileSnapshot = (deletedAudit?.profile_snapshot ?? {}) as Record<string, unknown>
  const deletedUsername = (profileSnapshot.username as string | undefined) ?? "Deleted user"

  const avatarV = user?.updated_at || user?.created_at || ""
  const avatarSrc = user
    ? `/api/avatar/${user.userid}${avatarV ? `?v=${encodeURIComponent(avatarV)}` : ""}`
    : (profileSnapshot.avatar as string | undefined) ?? ""
  const lastActive = authInfo?.last_sign_in_at
    ? formatDistanceToNow(new Date(authInfo.last_sign_in_at), { addSuffix: true })
    : "Never"

  return (
    <div className="max-w-6xl space-y-4">
      <Link href="/admin/users" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to Users
      </Link>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left Column: User Info & Management */}
        <div>
          <div className="space-y-6">
            <Card className="p-6">
              <div className="flex items-start justify-between">
                <div className="text-sm font-medium">Profile</div>
                {user ? (
                  <Button variant="outline" size="sm" className="gap-2" onClick={() => setProfileOpen(true)}>
                    <Pencil className="h-4 w-4" />
                    Edit
                  </Button>
                ) : (
                  <Badge variant="secondary">Deleted</Badge>
                )}
              </div>
              <Separator className="my-0 mt-4" />

              <div className="flex flex-col items-center text-center mt-6">
                <button
                  type="button"
                  className="group rounded-full"
                  onClick={() => setZoomSrc(avatarSrc)}
                  aria-label="View avatar"
                >
                  <Avatar className="h-28 w-28 overflow-hidden">
                    <AvatarImage
                      src={avatarSrc}
                      alt={user?.username ?? deletedUsername}
                      className="transition-transform duration-200 group-hover:scale-[1.06]"
                    />
                    <AvatarFallback>
                      {(user?.username ?? deletedUsername).slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                </button>
                <div className="mt-4">
                  <div className="text-xl font-semibold">{user?.username ?? deletedUsername}</div>
                  <div className="text-sm text-muted-foreground">
                    {user ? (user.profession ?? "—") : (profileSnapshot.profession as string | undefined) ?? "—"}
                  </div>
                </div>
                <div className="mt-3">
                  <Badge variant="secondary">{isDeleted ? "Deleted User" : "User"}</Badge>
                </div>
              </div>

              <Separator className="my-0 mt-6" />
              <dl className="space-y-3 text-sm mt-4">
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-muted-foreground">Age</dt>
                  <dd>{user ? (user.age ?? "—") : (profileSnapshot.age as number | undefined) ?? "—"}</dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-muted-foreground">Gender</dt>
                  <dd>{user ? (user.gender ?? "—") : (profileSnapshot.gender as string | undefined) ?? "—"}</dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-muted-foreground">Personality</dt>
                  <dd>
                    {user
                      ? (user.personality ?? "—")
                      : (profileSnapshot.personality as string | undefined) ?? "—"}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-muted-foreground">Location</dt>
                  <dd>{user ? (user.zipcode ?? "—") : (profileSnapshot.zipcode as string | undefined) ?? "—"}</dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-muted-foreground">User ID</dt>
                  <dd>
                    <Button variant="ghost" size="sm" onClick={() => {
                      navigator.clipboard.writeText(String(id))
                      toast.success("User ID copied to clipboard")
                    }}>
                      <Copy className="h-4 w-4" />
                      Copy
                    </Button>
                  </dd>
                </div>
                {isDeleted ? (
                  <div className="flex items-center justify-between gap-4">
                    <dt className="text-muted-foreground">Deleted At</dt>
                    <dd>{deletedAudit?.deleted_at ? new Date(deletedAudit.deleted_at).toLocaleString() : "—"}</dd>
                  </div>
                ) : null}
                <div className="space-y-1">
                  <dt className="text-muted-foreground">Bio</dt>
                  <dd className="text-sm">
                    {user ? (user.bio ?? "—") : (profileSnapshot.bio as string | undefined) ?? "—"}
                  </dd>
                </div>
              </dl>
            </Card>
          </div>
        </div>

        {/* Right Column: Tabs */}
        <div className="lg:col-span-2">
          <Card className="p-6">
            <Tabs defaultValue="posts" className="w-full">
              <TabsList>
                <TabsTrigger value="posts">Post History</TabsTrigger>
                <TabsTrigger value="history">Chat History</TabsTrigger>
                <TabsTrigger value="management">User Management</TabsTrigger>
              </TabsList>

              <TabsContent value="history" className="mt-4">
                {user ? (
                  <ChatHistory currentUserId={user.userid} />
                ) : (
                  <div className="space-y-3">
                    <div className="text-sm text-muted-foreground">
                      Showing archived chat history (captured at deletion time).
                    </div>
                    <Card className="p-0">
                      <div className="border-t">
                        <div className="max-h-[520px] overflow-auto">
                          <table className="w-full text-sm">
                            <thead className="sticky top-0 bg-background">
                              <tr className="border-b">
                                <th className="p-2 text-left">Time</th>
                                <th className="p-2 text-left">Match</th>
                                <th className="p-2 text-left">Sender</th>
                                <th className="p-2 text-left">Content</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(deletedAudit?.messages_snapshot ?? []).slice(0, 500).map((m, idx) => (
                                <tr key={idx} className="border-b">
                                  <td className="p-2 text-muted-foreground">
                                    {typeof m.created_at === "string" ? new Date(m.created_at).toLocaleString() : "—"}
                                  </td>
                                  <td className="p-2 text-muted-foreground">{String(m.match_id ?? "—")}</td>
                                  <td className="p-2 text-muted-foreground">{String(m.sender_id ?? "—")}</td>
                                  <td className="p-2">{String(m.content ?? m.media_url ?? "—")}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </Card>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="posts" className="mt-4">
                {user ? (
                  <PostsPanel userid={user.userid} onZoom={(src) => setZoomSrc(src)} />
                ) : (
                  <div className="space-y-4">
                    <div className="text-sm text-muted-foreground">
                      Showing archived posts & matches (captured at deletion time).
                    </div>

                    <Card className="p-0">
                      <div className="p-4 text-sm font-medium">Posts</div>
                      <div className="border-t">
                        <div className="max-h-[320px] overflow-auto">
                          <table className="w-full text-sm">
                            <thead className="sticky top-0 bg-background">
                              <tr className="border-b">
                                <th className="p-2 text-left">Created</th>
                                <th className="p-2 text-left">Description</th>
                                <th className="p-2 text-left">Photos</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(deletedAudit?.posts_snapshot ?? []).slice(0, 300).map((p, idx) => (
                                <tr key={idx} className="border-b">
                                  <td className="p-2 text-muted-foreground">
                                    {typeof p.created_at === "string" ? new Date(p.created_at).toLocaleString() : "—"}
                                  </td>
                                  <td className="p-2">{String(p.description ?? "—")}</td>
                                  <td className="p-2 text-muted-foreground">
                                    {Array.isArray(p.photos) ? p.photos.length : 0}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </Card>

                    <Card className="p-0">
                      <div className="p-4 text-sm font-medium">Matches</div>
                      <div className="border-t">
                        <div className="max-h-[280px] overflow-auto">
                          <table className="w-full text-sm">
                            <thead className="sticky top-0 bg-background">
                              <tr className="border-b">
                                <th className="p-2 text-left">Created</th>
                                <th className="p-2 text-left">Match ID</th>
                                <th className="p-2 text-left">User A</th>
                                <th className="p-2 text-left">User B</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(deletedAudit?.matches_snapshot ?? []).slice(0, 300).map((m, idx) => (
                                <tr key={idx} className="border-b">
                                  <td className="p-2 text-muted-foreground">
                                    {typeof m.created_at === "string" ? new Date(m.created_at).toLocaleString() : "—"}
                                  </td>
                                  <td className="p-2 text-muted-foreground">{String(m.id ?? "—")}</td>
                                  <td className="p-2 text-muted-foreground">{String(m.user_a ?? "—")}</td>
                                  <td className="p-2 text-muted-foreground">{String(m.user_b ?? "—")}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </Card>
                  </div>
                )}

                <div className="mt-6">
                  <div className="text-sm font-medium">Matchings</div>
                  <div className="mt-3">
                    <Card className="p-4">
                      {user ? (
                        <RelationshipGraph
                          initialRootUserId={user.userid}
                          showPicker={false}
                          heightClassName="h-[420px]"
                        />
                      ) : (
                        <div className="text-sm text-muted-foreground">
                          Relationship graph is not available for deleted users (live data is removed).
                        </div>
                      )}
                    </Card>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="management" className="mt-4 space-y-6">
                <div className="space-y-4">
                  <div className="text-sm font-medium">Session Information</div>
                  <div className="rounded-md border bg-muted/20 p-3 text-sm space-y-2">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Last Sign In</span>
                      <span className="font-medium">{lastActive}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Provider</span>
                      <span className="font-medium capitalize">
                        {authInfo?.app_metadata?.provider ?? deletedAudit?.provider ?? "—"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Email</span>
                      <span className="font-medium">{authInfo?.email ?? "—"}</span>
                    </div>
                  </div>
                </div>

                <Separator />

                <div className="space-y-4">
                  <div className="text-sm font-medium text-destructive">Danger Zone</div>
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center justify-between rounded-lg border border-destructive/20 bg-destructive/5 p-3">
                      <div className="text-sm">
                        <div className="font-medium text-destructive">Delete User</div>
                        <div className="text-muted-foreground text-xs">Permanently deletes user and all related data</div>
                      </div>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="destructive" size="sm" disabled={!user}>
                            <Trash2 className="h-4 w-4 mr-2" />
                            Delete
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete user permanently?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will permanently delete the user and cascade-delete their related data. This cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={hardDeleteUser}>Delete</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </Card>
        </div>
      </div>

      {user ? (
        <ProfileEditSheet
          open={profileOpen}
          onOpenChange={setProfileOpen}
          user={user}
          avatarSrc={avatarSrc}
          onSaved={(updates) => setUser((prev) => (prev ? { ...prev, ...updates } : prev))}
        />
      ) : null}

      <ImageZoomDialog src={zoomSrc} onClose={() => setZoomSrc(null)} />
    </div>
  )
}

