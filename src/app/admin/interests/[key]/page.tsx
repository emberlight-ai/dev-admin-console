"use client"

import * as React from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { ArrowLeft, Plus, X } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"

type Member = {
  userid: string
  username: string
  avatar: string | null
  gender: string | null
  personality: string | null
  is_digital_human: boolean | null
}

export default function InterestMembersPage() {
  const params = useParams()
  const key = String(params.key ?? "")

  const [members, setMembers] = React.useState<Member[]>([])
  const [loading, setLoading] = React.useState(true)
  const [search, setSearch] = React.useState("")
  const [results, setResults] = React.useState<Member[]>([])
  const [searching, setSearching] = React.useState(false)

  const memberIds = React.useMemo(() => new Set(members.map((m) => m.userid)), [members])

  const loadMembers = React.useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/interests/${encodeURIComponent(key)}/members`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "Failed to load members")
      setMembers(json.data ?? [])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load members")
    } finally {
      setLoading(false)
    }
  }, [key])

  React.useEffect(() => { void loadMembers() }, [loadMembers])

  // Debounced DH search (reuses the digital-humans admin endpoint).
  React.useEffect(() => {
    const q = search.trim()
    if (!q) { setResults([]); return }
    let cancelled = false
    setSearching(true)
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/admin/digital-humans?gender=all&personality=all&search=${encodeURIComponent(q)}&offset=0&limit=15`
        )
        const json = await res.json()
        if (!cancelled) setResults(res.ok ? (json.data ?? []) : [])
      } catch {
        if (!cancelled) setResults([])
      } finally {
        if (!cancelled) setSearching(false)
      }
    }, 300)
    return () => { cancelled = true; clearTimeout(t) }
  }, [search])

  const addMember = async (m: Member) => {
    try {
      const res = await fetch(`/api/admin/interests/${encodeURIComponent(key)}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: m.userid }),
      })
      if (!res.ok) throw new Error((await res.json()).error || "Failed")
      setMembers((prev) => (prev.some((x) => x.userid === m.userid) ? prev : [m, ...prev]))
      toast.success(`Added ${m.username}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add")
    }
  }

  const removeMember = async (m: Member) => {
    try {
      const res = await fetch(
        `/api/admin/interests/${encodeURIComponent(key)}/members?user_id=${encodeURIComponent(m.userid)}`,
        { method: "DELETE" }
      )
      if (!res.ok) throw new Error((await res.json()).error || "Failed")
      setMembers((prev) => prev.filter((x) => x.userid !== m.userid))
      toast.success(`Removed ${m.username}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove")
    }
  }

  const avatarSrc = (m: Member) => `/api/avatar/${m.userid}`

  return (
    <div className="max-w-4xl space-y-4">
      <Link href="/admin/interests" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to Interests
      </Link>

      <div>
        <h1 className="text-xl font-semibold">
          Members · <span className="font-mono text-base">{key}</span>
        </h1>
        <p className="text-sm text-muted-foreground">
          Digital humans in this category appear on its Explore page in the app.
        </p>
      </div>

      {/* Add via DH search */}
      <Card className="p-4 space-y-3">
        <div className="text-sm font-semibold">Add digital humans</div>
        <Input
          value={search}
          placeholder="Search digital humans by name…"
          onChange={(e) => setSearch(e.target.value)}
        />
        {search.trim() && (
          <div className="divide-y rounded-md border">
            {searching ? (
              <div className="p-3 text-xs text-muted-foreground">Searching…</div>
            ) : results.length === 0 ? (
              <div className="p-3 text-xs text-muted-foreground">No matches.</div>
            ) : (
              results.map((m) => {
                const already = memberIds.has(m.userid)
                return (
                  <div key={m.userid} className="flex items-center justify-between p-2">
                    <div className="flex items-center gap-3">
                      <Avatar className="h-8 w-8">
                        <AvatarImage src={avatarSrc(m)} alt={m.username} />
                        <AvatarFallback>{m.username?.[0] ?? "?"}</AvatarFallback>
                      </Avatar>
                      <div>
                        <div className="text-sm font-medium">{m.username}</div>
                        <div className="text-xs text-muted-foreground">{m.personality ?? "—"}</div>
                      </div>
                    </div>
                    <Button size="sm" variant={already ? "outline" : "default"} disabled={already} onClick={() => void addMember(m)}>
                      {already ? "Added" : <><Plus className="mr-1 h-3 w-3" /> Add</>}
                    </Button>
                  </div>
                )
              })
            )}
          </div>
        )}
      </Card>

      {/* Current members */}
      <Card className="p-4">
        <div className="mb-3 text-sm font-semibold">
          Current members {members.length > 0 && <span className="text-muted-foreground">({members.length})</span>}
        </div>
        {loading ? (
          <div className="text-xs text-muted-foreground">Loading…</div>
        ) : members.length === 0 ? (
          <div className="text-xs text-muted-foreground">No members yet — add some above.</div>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {members.map((m) => (
              <div key={m.userid} className="flex items-center justify-between rounded-md border p-2">
                <Link href={`/admin/digital-humans/${m.userid}`} className="flex items-center gap-3 hover:opacity-80">
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={avatarSrc(m)} alt={m.username} />
                    <AvatarFallback>{m.username?.[0] ?? "?"}</AvatarFallback>
                  </Avatar>
                  <div>
                    <div className="text-sm font-medium">{m.username}</div>
                    <div className="text-xs text-muted-foreground">
                      {m.is_digital_human ? (m.personality ?? "DH") : "Real user"}
                    </div>
                  </div>
                </Link>
                <Button size="icon" variant="ghost" title="Remove" onClick={() => void removeMember(m)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
