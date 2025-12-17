'use client'

import * as React from "react"
import Link from "next/link"
import { ArrowUpDown, Eye, Trash2, Plus, SlidersHorizontal } from "lucide-react"
import { toast } from "sonner"

import { supabase } from "@/lib/supabase"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogXCloseButton,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
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

type Row = {
  userid: string
  username: string
  profession?: string | null
  avatar?: string | null
  gender?: string | null
  created_at: string
  updated_at: string
  postsCount: number
}

export default function ManageDigitalHumans() {
  const [rows, setRows] = React.useState<Row[]>([])
  const [loading, setLoading] = React.useState(true)
  type GenderFilter = "all" | "female" | "male"
  const [genderFilter, setGenderFilter] = React.useState<GenderFilter>("all")
  type SortKey = "name" | "created" | "posts"
  type SortDir = "asc" | "desc"
  const [sortKey, setSortKey] = React.useState<SortKey>("created")
  const [sortDir, setSortDir] = React.useState<SortDir>("desc")

  const [columns, setColumns] = React.useState({
    avatar: true,
    profession: true,
    posts: true,
    created: true,
  })

  const visibleColumnCount = React.useMemo(() => {
    // name + actions are always visible
    return (
      (columns.avatar ? 1 : 0) +
      1 +
      (columns.profession ? 1 : 0) +
      (columns.posts ? 1 : 0) +
      (columns.created ? 1 : 0) +
      1
    )
  }, [columns])

  const toggleSort = React.useCallback(
    (key: SortKey) => {
      if (sortKey === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"))
        return
      }
      setSortKey(key)
      setSortDir(key === "name" ? "asc" : "desc")
    },
    [sortKey]
  )

  const sortedRows = React.useMemo(() => {
    const out = [...rows]
    const dir = sortDir === "asc" ? 1 : -1
    out.sort((a, b) => {
      if (sortKey === "name") {
        return a.username.localeCompare(b.username, undefined, { sensitivity: "base" }) * dir
      }
      if (sortKey === "posts") {
        return (a.postsCount - b.postsCount) * dir
      }
      // created
      return (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) * dir
    })
    return out
  }, [rows, sortKey, sortDir])

  const fetchRows = React.useCallback(async () => {
    setLoading(true)
    let q = supabase
      .from("users")
      .select("userid,username,profession,avatar,gender,created_at,updated_at")
      .eq("is_digital_human", true)
      .order("created_at", { ascending: false })

    if (genderFilter !== "all") {
      q = q.eq("gender", genderFilter === "female" ? "Female" : "Male")
    }

    const { data, error } = await q

    if (error) {
      console.error(error)
      toast.error("Failed to fetch digital humans")
    } else {
      const base = ((data as Omit<Row, "postsCount">[]) ?? []).map((r) => ({ ...r, postsCount: 0 }))
      const ids = base.map((r) => r.userid)
      if (ids.length) {
        const { data: postRows, error: postErr } = await supabase
          .from("user_posts")
          .select("userid")
          .in("userid", ids)

        if (postErr) {
          console.error(postErr)
        } else {
          const counts: Record<string, number> = {}
          for (const p of postRows ?? []) {
            const id = (p as { userid: string }).userid
            counts[id] = (counts[id] ?? 0) + 1
          }
          for (const r of base) r.postsCount = counts[r.userid] ?? 0
        }
      }
      setRows(base)
    }
    setLoading(false)
  }, [genderFilter])

  React.useEffect(() => {
    void fetchRows()
  }, [fetchRows])

  const deleteRow = async (userid: string) => {
    const { error } = await supabase.from("users").delete().eq("userid", userid)
    if (error) {
      toast.error("Failed to delete digital human")
      return
    }
    toast.success("Digital human deleted")
    void fetchRows()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Digital Humans</h1>
          <p className="text-sm text-muted-foreground">
            Manage digital humans and their personas.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline" className="gap-2">
                <SlidersHorizontal className="h-4 w-4" />
                Customize Columns
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogXCloseButton />
              <DialogHeader>
                <DialogTitle>Customize columns</DialogTitle>
                <DialogDescription>Choose which columns to show in the table.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-3 p-4 pt-0">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-input bg-background"
                    checked={columns.avatar}
                    onChange={(e) => setColumns((c) => ({ ...c, avatar: e.target.checked }))}
                  />
                  Avatar
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-input bg-background"
                    checked={columns.profession}
                    onChange={(e) => setColumns((c) => ({ ...c, profession: e.target.checked }))}
                  />
                  Profession
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-input bg-background"
                    checked={columns.posts}
                    onChange={(e) => setColumns((c) => ({ ...c, posts: e.target.checked }))}
                  />
                  Posts
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-input bg-background"
                    checked={columns.created}
                    onChange={(e) => setColumns((c) => ({ ...c, created: e.target.checked }))}
                  />
                  Created
                </label>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() =>
                    setColumns({
                      avatar: true,
                      profession: true,
                      posts: true,
                      created: true,
                    })
                  }
                >
                  Reset
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Button asChild className="gap-2">
            <Link href="/admin/digital-humans/create" className="gap-2">
              <Plus className="h-4 w-4" />
              Create Digital Human
            </Link>
          </Button>
        </div>
      </div>

      <div className="rounded-lg border bg-card">
        <div className="flex items-center justify-between border-b bg-muted/20 px-4 py-3">
          <div className="text-sm font-medium text-muted-foreground">All digital humans</div>
          <Tabs
            value={genderFilter}
            onValueChange={(v) => {
              if (v === "all" || v === "female" || v === "male") setGenderFilter(v)
            }}
          >
            <TabsList>
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="female">Female</TabsTrigger>
              <TabsTrigger value="male">Male</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              {columns.avatar ? <TableHead className="pl-4">Avatar</TableHead> : null}
              <TableHead>
                <button
                  type="button"
                  onClick={() => toggleSort("name")}
                  className="inline-flex items-center gap-1 text-left font-medium"
                >
                  Name <ArrowUpDown className="h-4 w-4 opacity-60" />
                </button>
              </TableHead>
              {columns.profession ? <TableHead>Profession</TableHead> : null}
              {columns.posts ? (
                <TableHead>
                  <button
                    type="button"
                    onClick={() => toggleSort("posts")}
                    className="inline-flex items-center gap-1 text-left font-medium"
                  >
                    Posts <ArrowUpDown className="h-4 w-4 opacity-60" />
                  </button>
                </TableHead>
              ) : null}
              {columns.created ? (
                <TableHead>
                  <button
                    type="button"
                    onClick={() => toggleSort("created")}
                    className="inline-flex items-center gap-1 text-left font-medium"
                  >
                    Created <ArrowUpDown className="h-4 w-4 opacity-60" />
                  </button>
                </TableHead>
              ) : null}
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={visibleColumnCount} className="py-10 text-center text-muted-foreground">
                  Loading...
                </TableCell>
              </TableRow>
            ) : sortedRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={visibleColumnCount} className="py-10 text-center text-muted-foreground">
                  No digital humans yet.
                </TableCell>
              </TableRow>
            ) : (
              sortedRows.map((r) => (
                <TableRow key={r.userid} className="hover:bg-muted/20">
                  {columns.avatar ? (
                    <TableCell className="pl-4">
                      <Avatar className="h-9 w-9">
                        <AvatarImage
                          src={`/api/avatar/${r.userid}?v=${encodeURIComponent(r.updated_at || r.created_at)}`}
                          alt={r.username}
                        />
                        <AvatarFallback>{r.username?.slice(0, 2)?.toUpperCase()}</AvatarFallback>
                      </Avatar>
                    </TableCell>
                  ) : null}
                  <TableCell className="font-medium">{r.username}</TableCell>
                  {columns.profession ? (
                    <TableCell className="text-muted-foreground">{r.profession ?? "—"}</TableCell>
                  ) : null}
                  {columns.posts ? <TableCell className="text-muted-foreground">{r.postsCount}</TableCell> : null}
                  {columns.created ? (
                    <TableCell className="text-muted-foreground">
                      {new Date(r.created_at).toLocaleDateString()}
                    </TableCell>
                  ) : null}
                  <TableCell className="text-right">
                    <div className="inline-flex items-center gap-2">
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/admin/digital-humans/${r.userid}`} className="gap-2">
                          <Eye className="h-4 w-4" />
                          Details
                        </Link>
                      </Button>

                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="destructive" size="sm" className="gap-2">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete digital human?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will permanently delete the user and related posts.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => deleteRow(r.userid)}>
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
