'use client'

import * as React from "react"
import Link from "next/link"
import { toast } from "sonner"
import { Eye } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

type DeletedUserRow = {
  userid: string
  // Sourced from the delete-time audit snapshot now (the live row is wiped on
  // delete), so absent for accounts that never had a username set.
  username: string | null
  avatar?: string | null
  gender?: string | null
  age?: number | null
  location_name?: string | null
  created_at: string
  deleted_at: string | null
}

export default function DeletedUsersPage() {
  const [rows, setRows] = React.useState<DeletedUserRow[]>([])
  const [loading, setLoading] = React.useState(true)

  const fetchRows = React.useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/admin/deleted-users?mode=list")
      const json = (await res.json()) as { data?: DeletedUserRow[]; error?: string }
      if (!res.ok) throw new Error(json.error || "Failed to load deleted users")
      setRows(json.data ?? [])
    } catch (err: unknown) {
      console.error(err)
      setRows([])
      toast.error(err instanceof Error ? err.message : "Failed to load deleted users")
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void fetchRows()
  }, [fetchRows])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Deleted Users</h1>
        <p className="text-sm text-muted-foreground">
          Accounts that requested deletion. This app preserves everything — posts,
          photos, and full chat transcripts are archived, not destroyed — so a
          returning sign-in with the same identity gets a clean account while the
          business keeps the history. Open &ldquo;Archive&rdquo; to browse it.
        </p>
      </div>

      <Card className="p-0">
        <div className="p-6">
          <div className="text-sm font-medium">Deleted accounts</div>
          <div className="text-xs text-muted-foreground">
            {loading ? "Loading..." : `${rows.length} deleted ${rows.length === 1 ? "user" : "users"}`}
          </div>
        </div>
        <div className="border-t">
          {loading ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Loading...</div>
          ) : rows.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">No deleted users.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Avatar</TableHead>
                  <TableHead>Username</TableHead>
                  <TableHead>Gender</TableHead>
                  <TableHead>Age</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead>Deleted</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((u) => (
                  <TableRow key={u.userid}>
                    <TableCell className="pl-4">
                      <Avatar className="h-9 w-9">
                        {/* Live /api/avatar/[userid] reads users.avatar, which is
                            wiped on delete — use the archived snapshot URL instead
                            (rewritten to the archived/ storage path). */}
                        <AvatarImage src={u.avatar ?? undefined} alt={u.username ?? ""} />
                        <AvatarFallback>{initials(u.username || "?")}</AvatarFallback>
                      </Avatar>
                    </TableCell>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <span>{u.username || "—"}</span>
                        <Badge variant="destructive">Deleted</Badge>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{u.gender ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{u.age ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{u.location_name || "—"}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(u.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {u.deleted_at ? new Date(u.deleted_at).toLocaleString() : "—"}
                    </TableCell>
                    <TableCell className="text-left">
                      <div className="flex gap-2">
                        <Button asChild variant="default" size="sm">
                          <Link href={`/admin/deleted-users/${u.userid}`} className="gap-2">
                            <Eye className="h-4 w-4" />
                            Archive
                          </Link>
                        </Button>
                        <Button asChild variant="outline" size="sm">
                          <Link href={`/admin/users/${u.userid}`}>Billing</Link>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </Card>
    </div>
  )
}
