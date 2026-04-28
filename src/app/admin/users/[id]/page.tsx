'use client'

import * as React from "react"
import Link from "next/link"
import { useParams, useRouter, usePathname, useSearchParams } from "next/navigation"
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

type SubscriptionRecord = {
  id: string
  status: string
  current_period_start: string | null
  current_period_end: string | null
  environment: string | null
  created_at: string
  status_changed_at: string | null
  subscription_catalog: {
    name: string
    apple_product_id: string
  } | null
}

function formatCoordinate(value: number | string | null | undefined) {
  if (typeof value === "number" && Number.isFinite(value)) return value.toFixed(6)
  if (typeof value === "string" && value.trim()) return value
  return "—"
}

function permissionLabel(value: boolean | null | undefined) {
  if (value === true) return "Enabled"
  if (value === false) return "Disabled"
  return "—"
}

export default function UserDetail() {
  const { id } = useParams()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const currentTab = searchParams.get("tab") || "posts"

  const handleTabChange = (value: string) => {
    const newParams = new URLSearchParams(searchParams.toString())
    newParams.set("tab", value)
    router.replace(`${pathname}?${newParams.toString()}`, { scroll: false })
  }

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

  // Subscription Info
  const [subscriptions, setSubscriptions] = React.useState<SubscriptionRecord[]>([])
  const [isGranting, setIsGranting] = React.useState(false)
  const [grantPlanType, setGrantPlanType] = React.useState("monthly")
  const [revokingId, setRevokingId] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!id) return
    void fetchUser()
    void fetchAuthInfo()
    void fetchSubscriptions()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const fetchAuthInfo = async () => {
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(String(id))}/auth`)
      const json = await res.json()
      if (json.data) {
        setAuthInfo(json.data)
      }
    } catch (err) {
      console.error(err)
    }
  }

  const fetchSubscriptions = async () => {
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(String(id))}/subscriptions`)
      const json = await res.json()
      if (json.data) {
        setSubscriptions(json.data)
      }
    } catch (err) {
      console.error(err)
    }
  }

  const handleGrantMembership = async () => {
    setIsGranting(true)
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(String(id))}/subscriptions/grant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan_type: grantPlanType })
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "Failed to grant membership")
      toast.success(`Successfully granted ${grantPlanType} membership!`)
      void fetchSubscriptions() // refresh the table
    } catch (err) {
      console.error(err)
      toast.error(err instanceof Error ? err.message : "Failed to grant membership")
    }
    setIsGranting(false)
  }

  const handleRevoke = async (subid: string) => {
    setRevokingId(subid)
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(String(id))}/subscriptions/${encodeURIComponent(subid)}/revoke`, {
        method: 'POST'
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "Failed to revoke")
      toast.success("Subscription revoked instantly")
      void fetchSubscriptions()
    } catch (err) {
      console.error(err)
      toast.error(err instanceof Error ? err.message : "Failed to revoke subscription")
    }
    setRevokingId(null)
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

  const isPremium = subscriptions.some(s => s.status === 'ACTIVE' && (!s.current_period_end || new Date(s.current_period_end) > new Date()))

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
                  <div className="text-xl font-semibold flex items-center justify-center gap-2">
                    {user?.username ?? deletedUsername}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {user ? (user.profession ?? "—") : (profileSnapshot.profession as string | undefined) ?? "—"}
                  </div>
                </div>
                <div className="mt-3 flex gap-2">
                  <Badge variant="secondary">{isDeleted ? "Deleted User" : "User"}</Badge>
                  {isPremium && <Badge className="bg-amber-500 hover:bg-amber-600">Premium</Badge>}
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
                  <dt className="text-muted-foreground">Location Name</dt>
                  <dd className="text-right">
                    {user
                      ? (user.location_name ?? "—")
                      : (profileSnapshot.location_name as string | undefined) ?? "—"}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-muted-foreground">Longitude</dt>
                  <dd>{formatCoordinate(user ? user.longitude : (profileSnapshot.longitude as number | string | null | undefined))}</dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-muted-foreground">Latitude</dt>
                  <dd>{formatCoordinate(user ? user.latitude : (profileSnapshot.latitude as number | string | null | undefined))}</dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-muted-foreground">Notifications</dt>
                  <dd>
                    <Badge variant={user?.notification_enabled ? "default" : "secondary"}>
                      {permissionLabel(user ? user.notification_enabled : (profileSnapshot.notification_enabled as boolean | null | undefined))}
                    </Badge>
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-muted-foreground">Geo Enabled</dt>
                  <dd>
                    <Badge variant={user?.location_enabled ? "default" : "secondary"}>
                      {permissionLabel(user ? user.location_enabled : (profileSnapshot.location_enabled as boolean | null | undefined))}
                    </Badge>
                  </dd>
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
            <Tabs value={currentTab} onValueChange={handleTabChange} className="w-full">
              <TabsList>
                <TabsTrigger value="posts">Post History</TabsTrigger>
                <TabsTrigger value="history">Chat History</TabsTrigger>
                <TabsTrigger value="subscriptions">Subscriptions</TabsTrigger>
                <TabsTrigger value="management">User Management</TabsTrigger>
              </TabsList>

              <TabsContent value="subscriptions" className="mt-4">
                <div className="space-y-4">
                  <Card className="p-0">
                    <div className="p-4 border-b bg-muted/20 flex items-center justify-between">
                      <div>
                        <div className="font-medium text-sm">Manual Grant</div>
                        <div className="text-xs text-muted-foreground mt-1">Grant an ACTIVE membership instantly (bypasses StoreKit).</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button 
                              disabled={isGranting || !user} 
                              size="sm"
                              className="bg-amber-500 hover:bg-amber-600 text-white shadow-md transition-all"
                            >
                              Grant Membership
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Grant Membership</AlertDialogTitle>
                              <AlertDialogDescription>
                                Manually grant a premium membership. This will instantly activate their account for the selected duration without charging them via StoreKit.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <div className="py-4">
                              <label className="text-sm font-medium mb-2 block">Select Plan Duration</label>
                              <select 
                                value={grantPlanType} 
                                onChange={(e) => setGrantPlanType(e.target.value)}
                                className="w-full h-10 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                              >
                                <option value="monthly">1 Month</option>
                                <option value="yearly">1 Year</option>
                              </select>
                            </div>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction 
                                onClick={(e) => {
                                  e.preventDefault()
                                  handleGrantMembership()
                                }} 
                                disabled={isGranting}
                                className="bg-amber-500 hover:bg-amber-600"
                              >
                                {isGranting ? "Granting..." : "Confirm Grant"}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>

                    <div className="border-t">
                      <div className="max-h-[520px] overflow-auto">
                        <table className="w-full text-sm">
                          <thead className="sticky top-0 bg-background border-b z-10">
                            <tr>
                              <th className="p-3 text-left font-medium text-muted-foreground">Plan</th>
                              <th className="p-3 text-left font-medium text-muted-foreground">Status</th>
                              <th className="p-3 text-left font-medium text-muted-foreground">Environment</th>
                              <th className="p-3 text-left font-medium text-muted-foreground">Created</th>
                              <th className="p-3 text-left font-medium text-muted-foreground">Expires</th>
                              <th className="p-3 text-right font-medium text-muted-foreground">Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {subscriptions.length === 0 ? (
                              <tr>
                                <td colSpan={6} className="p-6 text-center text-muted-foreground text-sm">
                                  No subscription history found.
                                </td>
                              </tr>
                            ) : subscriptions.map((s) => {
                              const isActive = s.status === 'ACTIVE' && (!s.current_period_end || new Date(s.current_period_end) > new Date())
                              return (
                                <tr key={s.id} className="border-b last:border-0 hover:bg-muted/50 transition-colors">
                                  <td className="p-3">
                                    <div className="font-medium">{s.subscription_catalog?.name ?? "Unknown Plan"}</div>
                                  </td>
                                  <td className="p-3">
                                    <Badge variant={isActive ? "default" : (s.status === 'PURCHASING' ? "secondary" : "outline")}
                                      className={isActive ? "bg-amber-500 hover:bg-amber-600" : ""}>
                                      {isActive ? 'ACTIVE' : s.status}
                                    </Badge>
                                  </td>
                                  <td className="p-3 text-muted-foreground">
                                    {s.environment ?? "—"}
                                  </td>
                                  <td className="p-3 text-muted-foreground">
                                    {new Date(s.created_at).toLocaleString()}
                                  </td>
                                  <td className="p-3 text-muted-foreground">
                                    {s.current_period_end ? new Date(s.current_period_end).toLocaleString() : "—"}
                                  </td>
                                  <td className="p-3 text-right">
                                    {isActive ? (
                                      <Button 
                                        variant="outline" 
                                        size="sm" 
                                        onClick={() => handleRevoke(s.id)}
                                        disabled={revokingId === s.id}
                                        className="h-7 text-xs text-destructive border-destructive/30 hover:bg-destructive hover:text-white"
                                      >
                                        {revokingId === s.id ? "Revoking..." : "Revoke"}
                                      </Button>
                                    ) : null}
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </Card>
                </div>
              </TabsContent>

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

