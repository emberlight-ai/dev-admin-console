"use client"

import * as React from "react"
import { Loader2, Plus, Search, X } from "lucide-react"
import { toast } from "sonner"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogXCloseButton,
} from "@/components/ui/dialog"

type Verdict = "great" | "ok" | "poor" | "low data"

type Member = {
  userid: string
  username: string | null
  avatar: string | null
  gender: string | null
  personality: string | null
  is_digital_human: boolean | null
  likes: number
  dislikes: number
  total: number
  likeRate: number | null
  verdict: Verdict
}

type Candidate = {
  userid: string
  username: string | null
  gender: string | null
  personality: string | null
  likes: number
  dislikes: number
  total: number
  likeRate: number | null
  verdict: Verdict
  tier: "proven" | "promising"
}

type SearchRow = {
  userid: string
  username: string
  gender?: string | null
  personality?: string | null
}

const pct = (r: number | null) => (r == null ? "—" : `${Math.round(r * 100)}%`)

function VerdictBadge({ verdict }: { verdict: Verdict }) {
  if (verdict === "great") return <Badge className="bg-emerald-600 hover:bg-emerald-600">great</Badge>
  if (verdict === "poor") return <Badge className="bg-red-600 hover:bg-red-600">poor</Badge>
  if (verdict === "ok") return <Badge variant="secondary">ok</Badge>
  return <Badge variant="outline" className="text-muted-foreground">low data</Badge>
}

/** Like-rate + verdict + volume, right-aligned. */
function PerfCell({ likeRate, total, verdict }: { likeRate: number | null; total: number; verdict: Verdict }) {
  return (
    <div className="flex items-center gap-2">
      <div className="text-right">
        <div className="text-sm font-semibold tabular-nums">{pct(likeRate)}</div>
        <div className="text-[10px] text-muted-foreground tabular-nums">{total} swipes</div>
      </div>
      <VerdictBadge verdict={verdict} />
    </div>
  )
}

export function AssignDigitalHumansDialog({
  interestKey,
  interestName,
  onOpenChange,
  onChanged,
}: {
  interestKey: string | null
  interestName: string
  onOpenChange: (open: boolean) => void
  onChanged?: () => void
}) {
  const open = interestKey != null
  const [members, setMembers] = React.useState<Member[]>([])
  const [candidates, setCandidates] = React.useState<Candidate[]>([])
  const [loading, setLoading] = React.useState(true)
  const [busyId, setBusyId] = React.useState<string | null>(null)

  const [search, setSearch] = React.useState("")
  const [results, setResults] = React.useState<SearchRow[]>([])
  const [searching, setSearching] = React.useState(false)

  const memberIds = React.useMemo(() => new Set(members.map((m) => m.userid)), [members])

  const load = React.useCallback(async () => {
    if (!interestKey) return
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/interests/${encodeURIComponent(interestKey)}/members`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "Failed to load")
      setMembers(json.data ?? [])
      setCandidates(json.candidates ?? [])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load")
    } finally {
      setLoading(false)
    }
  }, [interestKey])

  React.useEffect(() => {
    if (open) {
      setSearch("")
      setResults([])
      void load()
    }
  }, [open, load])

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

  const add = async (userid: string) => {
    if (!interestKey) return
    setBusyId(userid)
    try {
      const res = await fetch(`/api/admin/interests/${encodeURIComponent(interestKey)}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userid }),
      })
      if (!res.ok) throw new Error((await res.json()).error || "Failed to add")
      toast.success("Added")
      onChanged?.()
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add")
    } finally {
      setBusyId(null)
    }
  }

  const remove = async (userid: string) => {
    if (!interestKey) return
    setBusyId(userid)
    try {
      const res = await fetch(
        `/api/admin/interests/${encodeURIComponent(interestKey)}/members?user_id=${encodeURIComponent(userid)}`,
        { method: "DELETE" }
      )
      if (!res.ok) throw new Error((await res.json()).error || "Failed to remove")
      toast.success("Removed")
      onChanged?.()
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove")
    } finally {
      setBusyId(null)
    }
  }

  const avatarSrc = (userid: string) => `/api/avatar/${userid}`
  const initials = (name?: string | null) => (name?.trim()?.[0] ?? "?").toUpperCase()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden sm:max-w-2xl">
        <DialogXCloseButton />
        <DialogHeader>
          <DialogTitle>Assign digital humans · {interestName}</DialogTitle>
          <DialogDescription>
            Like-rate and verdict come from real users&apos; swipes on each DH. Add strong performers;
            watch for members marked <span className="font-medium text-red-600">poor</span>.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 pt-0">
          {/* Search to add a specific DH */}
          <div className="space-y-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search digital humans by name…"
                className="pl-8"
              />
              {searching && <Loader2 className="absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
            </div>
            {search.trim() && (
              <div className="max-h-56 divide-y overflow-auto rounded-md border">
                {!searching && results.length === 0 ? (
                  <div className="p-3 text-center text-xs text-muted-foreground">No matches.</div>
                ) : (
                  results.map((r) => {
                    const already = memberIds.has(r.userid)
                    return (
                      <div key={r.userid} className="flex items-center justify-between gap-2 px-3 py-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <Avatar className="h-7 w-7">
                            <AvatarImage src={avatarSrc(r.userid)} alt={r.username} />
                            <AvatarFallback>{initials(r.username)}</AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium">{r.username}</div>
                            <div className="truncate text-xs text-muted-foreground">{r.personality ?? "—"}</div>
                          </div>
                        </div>
                        <Button size="sm" variant={already ? "outline" : "default"} disabled={already || busyId === r.userid} onClick={() => void add(r.userid)}>
                          {busyId === r.userid ? <Loader2 className="h-3 w-3 animate-spin" /> : already ? "Added" : <><Plus className="mr-1 h-3 w-3" /> Add</>}
                        </Button>
                      </div>
                    )
                  })
                )}
              </div>
            )}
          </div>

          {loading ? (
            <div className="flex min-h-32 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {/* Current members, ranked by like-rate */}
              <section className="space-y-2">
                <div className="text-sm font-medium">Members ({members.length})</div>
                {members.length === 0 ? (
                  <div className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
                    No digital humans yet — add strong performers below.
                  </div>
                ) : (
                  <div className="divide-y rounded-md border">
                    {members.map((m) => (
                      <div key={m.userid} className="flex items-center justify-between gap-2 px-3 py-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <Avatar className="h-8 w-8">
                            <AvatarImage src={avatarSrc(m.userid)} alt={m.username ?? ""} />
                            <AvatarFallback>{initials(m.username)}</AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium">{m.username ?? "Unknown"}</div>
                            <div className="truncate text-xs text-muted-foreground">{m.personality ?? "—"}</div>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-3">
                          <PerfCell likeRate={m.likeRate} total={m.total} verdict={m.verdict} />
                          <Button size="icon" variant="ghost" title="Remove" disabled={busyId === m.userid} onClick={() => void remove(m.userid)}>
                            {busyId === m.userid ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Top performers not yet in this category */}
              <section className="space-y-2">
                <div className="text-sm font-medium">Top performers to add ({candidates.length})</div>
                {candidates.length === 0 ? (
                  <div className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
                    No other digital humans with enough swipes to rank yet.
                  </div>
                ) : (
                  <div className="divide-y rounded-md border">
                    {candidates.map((c) => (
                      <div key={c.userid} className="flex items-center justify-between gap-2 px-3 py-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <Avatar className="h-8 w-8">
                            <AvatarImage src={avatarSrc(c.userid)} alt={c.username ?? ""} />
                            <AvatarFallback>{initials(c.username)}</AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium">{c.username ?? "Unknown"}</div>
                            <div className="truncate text-xs text-muted-foreground">{c.personality ?? "—"}</div>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-3">
                          <PerfCell likeRate={c.likeRate} total={c.total} verdict={c.verdict} />
                          <Button size="sm" variant="outline" disabled={busyId === c.userid} onClick={() => void add(c.userid)}>
                            {busyId === c.userid ? <Loader2 className="h-3 w-3 animate-spin" /> : <><Plus className="mr-1 h-3 w-3" /> Add</>}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
