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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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

  // Purchases (subscription_purchases for this user)
  type PurchaseRow = {
    id: string
    userid: string
    plan_id: string
    amount_cents: number
    created_at: string
    source?: string
    transaction_id?: string | null
    environment?: string | null
    product_id_apple?: string | null
  }
  const [purchases, setPurchases] = React.useState<PurchaseRow[]>([])
  const [purchasesLoading, setPurchasesLoading] = React.useState(false)

  // Balance (free messages / swipes) for admin edit
  type BalanceRow = {
    free_msgs_today: number
    free_msgs_updated_date: string | null
    free_swipe_today: number
    free_swipe_updated_date: string | null
  }
  const [balance, setBalance] = React.useState<BalanceRow | null>(null)
  const [balanceLoading, setBalanceLoading] = React.useState(false)
  const [balanceSaving, setBalanceSaving] = React.useState(false)
  const [balanceForm, setBalanceForm] = React.useState({ free_msgs_today: "", free_swipe_today: "" })

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

  const fetchPurchases = async () => {
    if (!id) return
    setPurchasesLoading(true)
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(String(id))}/purchases`)
      const json = (await res.json()) as { data?: PurchaseRow[]; error?: string }
      if (res.ok && Array.isArray(json.data)) {
        setPurchases(json.data)
      } else {
        setPurchases([])
      }
    } catch (err) {
      console.error(err)
      setPurchases([])
    }
    setPurchasesLoading(false)
  }

  const fetchBalance = async () => {
    if (!id) return
    setBalanceLoading(true)
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(String(id))}/balance`)
      const json = (await res.json()) as BalanceRow & { error?: string }
      if (res.ok && !json.error) {
        setBalance({
          free_msgs_today: json.free_msgs_today ?? 0,
          free_msgs_updated_date: json.free_msgs_updated_date ?? null,
          free_swipe_today: json.free_swipe_today ?? 0,
          free_swipe_updated_date: json.free_swipe_updated_date ?? null,
        })
        setBalanceForm({
          free_msgs_today: String(json.free_msgs_today ?? 0),
          free_swipe_today: String(json.free_swipe_today ?? 0),
        })
      } else {
        setBalance(null)
      }
    } catch (err) {
      console.error(err)
      setBalance(null)
    }
    setBalanceLoading(false)
  }

  const saveBalance = async () => {
    if (!id) return
    const msgs = balanceForm.free_msgs_today.trim()
    const swipes = balanceForm.free_swipe_today.trim()
    const body: { free_msgs_today?: number; free_swipe_today?: number } = {}
    if (msgs !== "") body.free_msgs_today = parseInt(msgs, 10)
    if (swipes !== "") body.free_swipe_today = parseInt(swipes, 10)
    if (Object.keys(body).length === 0) {
      toast.info("Enter at least one value to update")
      return
    }
    if (body.free_msgs_today != null && (Number.isNaN(body.free_msgs_today) || body.free_msgs_today < 0)) {
      toast.error("Free messages must be a non-negative number")
      return
    }
    if (body.free_swipe_today != null && (Number.isNaN(body.free_swipe_today) || body.free_swipe_today < 0)) {
      toast.error("Free swipes must be a non-negative number")
      return
    }
    setBalanceSaving(true)
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(String(id))}/balance`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const json = (await res.json()) as BalanceRow & { error?: string }
      if (!res.ok) throw new Error(json.error || "Failed to update balance")
      setBalance({
        free_msgs_today: json.free_msgs_today ?? 0,
        free_msgs_updated_date: json.free_msgs_updated_date ?? null,
        free_swipe_today: json.free_swipe_today ?? 0,
        free_swipe_updated_date: json.free_swipe_updated_date ?? null,
      })
      setBalanceForm({
        free_msgs_today: String(json.free_msgs_today ?? 0),
        free_swipe_today: String(json.free_swipe_today ?? 0),
      })
      toast.success("Balance updated")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update balance")
      console.error(err)
    }
    setBalanceSaving(false)
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
                <TabsTrigger value="purchases" onClick={() => void fetchPurchases()}>
                  Purchases
                </TabsTrigger>
                <TabsTrigger value="management" onClick={() => user ? void fetchBalance() : undefined}>
                  User Management
                </TabsTrigger>
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

              <TabsContent value="purchases" className="mt-4">
                <div className="text-sm font-medium">Subscription purchases</div>
                <p className="text-muted-foreground text-sm mt-1">
                  All purchases recorded for this user (plan, amount, date).
                </p>
                {purchasesLoading ? (
                  <div className="text-sm text-muted-foreground mt-4">Loading...</div>
                ) : purchases.length === 0 ? (
                  <div className="text-sm text-muted-foreground mt-4 rounded-md border bg-muted/20 p-4">
                    No purchases recorded.
                  </div>
                ) : (
                  <Card className="p-0 mt-3">
                    <div className="border-t">
                      <div className="max-h-[320px] overflow-auto">
                        <table className="w-full text-sm">
                          <thead className="sticky top-0 bg-background">
                            <tr className="border-b">
                              <th className="p-2 text-left">Date</th>
                              <th className="p-2 text-left">Plan</th>
                              <th className="p-2 text-left">Source</th>
                              <th className="p-2 text-left">Tx ID</th>
                              <th className="p-2 text-left">Env</th>
                              <th className="p-2 text-left">Amount</th>
                              <th className="p-2 text-left">Purchase ID</th>
                            </tr>
                          </thead>
                          <tbody>
                            {purchases.map((p) => (
                              <tr key={p.id} className="border-b">
                                <td className="p-2 text-muted-foreground">
                                  {p.created_at ? new Date(p.created_at).toLocaleString() : "—"}
                                </td>
                                <td className="p-2 capitalize">{p.plan_id ?? "—"}</td>
                                <td className="p-2">
                                  <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium">
                                    {p.source ?? "—"}
                                  </span>
                                </td>
                                <td className="p-2 font-mono text-xs text-muted-foreground truncate max-w-[120px]" title={p.transaction_id ?? undefined}>
                                  {p.transaction_id ? p.transaction_id.slice(0, 14) + "…" : "—"}
                                </td>
                                <td className="p-2 text-muted-foreground text-xs">{p.environment ?? "—"}</td>
                                <td className="p-2 font-medium">
                                  ${((p.amount_cents ?? 0) / 100).toFixed(2)}
                                </td>
                                <td className="p-2 text-muted-foreground font-mono text-xs">
                                  {p.id}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </Card>
                )}
              </TabsContent>

              <TabsContent value="management" className="mt-4 space-y-6">
                {user ? (
                  <>
                    <div className="space-y-4">
                      <div className="text-sm font-medium">Free messages & swipes</div>
                      <p className="text-muted-foreground text-xs">
                        Edit this user&apos;s daily balance. Leave a field empty to keep current value. Dates update to today when you change the corresponding value.
                      </p>
                      {balanceLoading ? (
                        <div className="text-sm text-muted-foreground">Loading balance...</div>
                      ) : (
                        <div className="rounded-md border bg-muted/20 p-4 space-y-4 max-w-sm">
                          <div className="grid gap-2">
                            <Label htmlFor="balance-msgs">Free messages today</Label>
                            <Input
                              id="balance-msgs"
                              type="number"
                              min={0}
                              value={balanceForm.free_msgs_today}
                              onChange={(e) => setBalanceForm((p) => ({ ...p, free_msgs_today: e.target.value }))}
                              placeholder={balance ? String(balance.free_msgs_today) : "0"}
                            />
                            {balance?.free_msgs_updated_date ? (
                              <p className="text-xs text-muted-foreground">
                                Last updated: {new Date(balance.free_msgs_updated_date).toLocaleDateString()}
                              </p>
                            ) : null}
                          </div>
                          <div className="grid gap-2">
                            <Label htmlFor="balance-swipes">Free swipes today</Label>
                            <Input
                              id="balance-swipes"
                              type="number"
                              min={0}
                              value={balanceForm.free_swipe_today}
                              onChange={(e) => setBalanceForm((p) => ({ ...p, free_swipe_today: e.target.value }))}
                              placeholder={balance ? String(balance.free_swipe_today) : "0"}
                            />
                            {balance?.free_swipe_updated_date ? (
                              <p className="text-xs text-muted-foreground">
                                Last updated: {new Date(balance.free_swipe_updated_date).toLocaleDateString()}
                              </p>
                            ) : null}
                          </div>
                          <Button onClick={saveBalance} disabled={balanceSaving}>
                            {balanceSaving ? "Updating..." : "Update balance"}
                          </Button>
                        </div>
                      )}
                    </div>
                    <Separator />
                  </>
                ) : null}

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

