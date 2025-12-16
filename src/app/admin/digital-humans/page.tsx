'use client'

import * as React from "react"
import Link from "next/link"
import { Eye, Trash2, Plus } from "lucide-react"
import { toast } from "sonner"

import { supabase } from "@/lib/supabase"
import { Button } from "@/components/ui/button"
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
  created_at: string
}

export default function ManageDigitalHumans() {
  const [rows, setRows] = React.useState<Row[]>([])
  const [loading, setLoading] = React.useState(true)

  const fetchRows = React.useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from("users")
      .select("userid,username,profession,avatar,created_at")
      .eq("is_digital_human", true)
      .order("created_at", { ascending: false })

    if (error) {
      console.error(error)
      toast.error("Failed to fetch digital humans")
    } else {
      setRows((data as Row[]) ?? [])
    }
    setLoading(false)
  }, [])

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
        <Button asChild>
          <Link href="/admin/digital-humans/create" className="gap-2">
            <Plus className="h-4 w-4" />
            Create Bot
          </Link>
        </Button>
      </div>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Avatar</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Profession</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                  Loading...
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                  No digital humans yet.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.userid}>
                  <TableCell>
                    <Avatar className="h-9 w-9">
                      <AvatarImage src={r.avatar ?? undefined} alt={r.username} />
                      <AvatarFallback>{r.username?.slice(0, 2)?.toUpperCase()}</AvatarFallback>
                    </Avatar>
                  </TableCell>
                  <TableCell className="font-medium">{r.username}</TableCell>
                  <TableCell className="text-muted-foreground">{r.profession ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(r.created_at).toLocaleDateString()}
                  </TableCell>
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
                            Delete
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
