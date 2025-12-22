'use client'

import * as React from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { ArrowLeft, Pencil, Trash2 } from "lucide-react"
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
import type { DbUser } from "@/app/admin/digital-humans/[id]/_components/types"

export default function UserDetail() {
  const { id } = useParams()
  const [user, setUser] = React.useState<DbUser | null>(null)
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
      if (!res.ok) throw new Error(json.error || "Failed to fetch user details")
      if (!json.data) throw new Error("User not found")
      setUser(json.data)
    } catch (err: unknown) {
      console.error(err)
      toast.error(err instanceof Error ? err.message : "Failed to fetch user details")
      setUser(null)
    }
    setLoading(false)
  }

  const softDeleteUser = async () => {
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(String(id))}/soft-delete`, {
        method: "POST",
      })
      if (!res.ok) throw new Error("Failed to delete user")
      toast.success("User soft deleted")
      // Optionally redirect or refresh
      void fetchUser()
    } catch (err) {
      toast.error("Error deleting user")
      console.error(err)
    }
  }

  if (loading) return <div className="text-sm text-muted-foreground">Loading...</div>
  if (!user) return <div className="text-sm text-muted-foreground">User not found</div>

  const avatarV = user.updated_at || user.created_at || ""
  const avatarSrc = `/api/avatar/${user.userid}${avatarV ? `?v=${encodeURIComponent(avatarV)}` : ""}`
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
                <Button variant="outline" size="sm" className="gap-2" onClick={() => setProfileOpen(true)}>
                  <Pencil className="h-4 w-4" />
                  Edit
                </Button>
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
                      alt={user.username}
                      className="transition-transform duration-200 group-hover:scale-[1.06]"
                    />
                    <AvatarFallback>{user.username.slice(0, 2).toUpperCase()}</AvatarFallback>
                  </Avatar>
                </button>
                <div className="mt-4">
                  <div className="text-xl font-semibold">{user.username}</div>
                  <div className="text-sm text-muted-foreground">{user.profession ?? "—"}</div>
                </div>
                <div className="mt-3">
                  <Badge variant="secondary">User</Badge>
                </div>
              </div>

              <Separator className="my-0 mt-6" />
              <dl className="space-y-3 text-sm mt-4">
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-muted-foreground">Age</dt>
                  <dd>{user.age ?? "—"}</dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-muted-foreground">Gender</dt>
                  <dd>{user.gender ?? "—"}</dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-muted-foreground">Personality</dt>
                  <dd>{user.personality ?? "—"}</dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-muted-foreground">Location</dt>
                  <dd>{user.zipcode ?? "—"}</dd>
                </div>
                <div className="space-y-1">
                  <dt className="text-muted-foreground">Bio</dt>
                  <dd className="text-sm">{user.bio ?? "—"}</dd>
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
                <TabsTrigger value="management">User Management</TabsTrigger>
              </TabsList>

              <TabsContent value="posts" className="mt-4">
                <PostsPanel userid={user.userid} onZoom={(src) => setZoomSrc(src)} />
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
                      <span className="font-medium capitalize">{authInfo?.app_metadata?.provider ?? "—"}</span>
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
                        <div className="text-muted-foreground text-xs">Soft delete profile & sign out</div>
                      </div>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="destructive" size="sm">
                            <Trash2 className="h-4 w-4 mr-2" />
                            Delete
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                        <AlertDialogTitle>Delete user?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will soft delete the user profile. They can sign up again with a new account using the same email.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={softDeleteUser}>Delete</AlertDialogAction>
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

      <ProfileEditSheet
        open={profileOpen}
        onOpenChange={setProfileOpen}
        user={user}
        avatarSrc={avatarSrc}
        onSaved={(updates) => setUser((prev) => (prev ? { ...prev, ...updates } : prev))}
      />

      <ImageZoomDialog src={zoomSrc} onClose={() => setZoomSrc(null)} />
    </div>
  )
}

