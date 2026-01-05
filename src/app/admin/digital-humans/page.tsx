'use client'

import * as React from "react"
import Link from "next/link"
import { ArrowUpDown, Eye, Plus, SlidersHorizontal } from "lucide-react"
import { toast } from "sonner"
import { useRouter, useSearchParams, usePathname } from "next/navigation"

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

type Row = {
  userid: string
  username: string
  profession?: string | null
  avatar?: string | null
  gender?: string | null
  personality?: string | null
  created_at: string
  updated_at: string
  postsCount: number
}

function ManageDigitalHumansContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const pathname = usePathname()

  const [rows, setRows] = React.useState<Row[]>([])
  const [loading, setLoading] = React.useState(true)
  const [loadingMore, setLoadingMore] = React.useState(false)
  const [hasMore, setHasMore] = React.useState(true)
  const [offset, setOffset] = React.useState(0)
  const LIMIT = 50

  // Derived state from URL params
  const genderFilter = (searchParams.get("gender") as "all" | "female" | "male") || "all"
  const personalityFilter = searchParams.get("personality") || "All"
  const searchQuery = searchParams.get("search") || ""

  // Local state for search input with debounce
  const [searchInput, setSearchInput] = React.useState(searchQuery)

  // Fetched personalities based on gender filter
  const [personalities, setPersonalities] = React.useState<string[]>([])

  type SortKey = "name" | "created" | "posts"
  type SortDir = "asc" | "desc"
  const [sortKey, setSortKey] = React.useState<SortKey>("created")
  const [sortDir, setSortDir] = React.useState<SortDir>("desc")

  const [columns, setColumns] = React.useState({
    avatar: true,
    profession: true,
    personality: true,
    posts: true,
    created: false,
  })

  // Helper to update URL params
  const updateFilters = React.useCallback((updates: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(updates)) {
      if (value === null) {
        params.delete(key)
      } else {
        params.set(key, value)
      }
    }
    // Always reset pagination when filters change
    router.replace(`${pathname}?${params.toString()}`)
  }, [searchParams, pathname, router])

  const visibleColumnCount = React.useMemo(() => {
    // name + actions are always visible
    return (
      (columns.avatar ? 1 : 0) +
      1 +
      (columns.profession ? 1 : 0) +
      (columns.personality ? 1 : 0) +
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

  // Fetch Personalities Effect
  React.useEffect(() => {
    let cancelled = false;
    const fetchPersonalities = async () => {
      const gendersToFetch = genderFilter === 'all' ? ['Male', 'Female'] : [genderFilter === 'female' ? 'Female' : 'Male'];
      const allPersonalities = new Set<string>();

      try {
        for (const g of gendersToFetch) {
          const res = await fetch(`/api/system-prompts/personalities?gender=${encodeURIComponent(g)}`);
          if (res.ok) {
            const json = await res.json();
            (json.data || []).forEach((p: string) => allPersonalities.add(p));
          }
        }
        if (!cancelled) {
          setPersonalities(Array.from(allPersonalities).sort());
        }
      } catch (err) {
        console.error("Failed to fetch personalities", err);
      }
    };

    fetchPersonalities();
    return () => { cancelled = true; };
  }, [genderFilter]);

  const fetchRows = React.useCallback(async (isLoadMore = false) => {
    if (isLoadMore) setLoadingMore(true)
    else setLoading(true)

    try {
      // Use offset state for pagination, but props from URL for filtering
      const currentOffset = isLoadMore ? offset : 0

      const searchParam = searchQuery ? `&search=${encodeURIComponent(searchQuery)}` : '';
      const res = await fetch(
        `/api/admin/digital-humans?gender=${encodeURIComponent(genderFilter)}&personality=${encodeURIComponent(personalityFilter === 'All' || personalityFilter === null ? 'all' : personalityFilter)}${searchParam}&offset=${currentOffset}&limit=${LIMIT}`
      )
      const json = (await res.json()) as { data?: Row[]; error?: string }
      if (!res.ok) throw new Error(json.error || "Failed to fetch digital humans")

      const newRows = (json.data ?? []) as Row[]

      if (newRows.length < LIMIT) {
        setHasMore(false)
      } else {
        setHasMore(true)
      }

      if (isLoadMore) {
        setRows(prev => [...prev, ...newRows])
        setOffset(prev => prev + LIMIT)
      } else {
        setRows(newRows)
        setOffset(LIMIT)
      }
    } catch (err: unknown) {
      console.error(err)
      toast.error(err instanceof Error ? err.message : "Failed to fetch digital humans")
      if (!isLoadMore) setRows([])
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [genderFilter, personalityFilter, searchQuery, offset])

  // Debounce search input to URL param
  React.useEffect(() => {
    const timer = setTimeout(() => {
      if (searchInput !== searchQuery) {
        updateFilters({ search: searchInput || null });
      }
    }, 300); // 300ms debounce

    return () => clearTimeout(timer);
  }, [searchInput]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync searchInput with URL param when it changes externally
  React.useEffect(() => {
    setSearchInput(searchQuery);
  }, [searchQuery]);

  // Reset offset and fetch when filters change (detected via URL change)
  // We use a ref to track if this is the initial mount or a filter change
  const isFirstRun = React.useRef(true);
  const prevFilters = React.useRef({ genderFilter, personalityFilter, searchQuery });

  React.useEffect(() => {
    const filtersChanged =
      prevFilters.current.genderFilter !== genderFilter ||
      prevFilters.current.personalityFilter !== personalityFilter ||
      prevFilters.current.searchQuery !== searchQuery;

    if (filtersChanged) {
      setOffset(0);
      setHasMore(true);
      prevFilters.current = { genderFilter, personalityFilter, searchQuery };
      void fetchRows(false);
    } else if (isFirstRun.current) {
      void fetchRows(false);
      isFirstRun.current = false;
    }
  }, [genderFilter, personalityFilter, searchQuery, fetchRows])


  // Infinite scroll
  const observerTarget = React.useRef(null)

  React.useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loading && !loadingMore) {
          void fetchRows(true)
        }
      },
      { threshold: 0.1 }
    )

    if (observerTarget.current) {
      observer.observe(observerTarget.current)
    }

    return () => observer.disconnect()
  }, [hasMore, loading, loadingMore, fetchRows])

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
                    checked={columns.personality}
                    onChange={(e) => setColumns((c) => ({ ...c, personality: e.target.checked }))}
                  />
                  Personality
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
                      personality: true,
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
          <div className="flex items-center gap-4">
            <div className="text-sm font-medium text-muted-foreground">All digital humans</div>

            <div className="flex items-center gap-2">
              <input
                type="text"
                placeholder="Search by name..."
                className="h-9 w-[200px] rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
              <select
                className="h-9 w-[150px] rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={personalityFilter}
                onChange={(e) => updateFilters({ personality: e.target.value })}
              >
                <option value="All">All Personalities</option>
                {personalities.map(p => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>

              <Tabs
                value={genderFilter}
                onValueChange={(v) => {
                  // Reset personality to All when changing gender to avoid mismatch
                  updateFilters({ gender: v, personality: 'All' })
                }}
              >
                <TabsList>
                  <TabsTrigger value="all">All</TabsTrigger>
                  <TabsTrigger value="female">Female</TabsTrigger>
                  <TabsTrigger value="male">Male</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          </div>
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
              {columns.personality ? <TableHead>Personality</TableHead> : null}
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
              <>
                {sortedRows.map((r) => (
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
                    {columns.personality ? (
                      <TableCell className="text-muted-foreground">{r.personality ?? "—"}</TableCell>
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
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {/* Sentinel for infinite scroll */}
                <TableRow>
                  <TableCell colSpan={visibleColumnCount} className="p-0 border-0">
                    <div ref={observerTarget} className="h-4 w-full" />
                  </TableCell>
                </TableRow>
                {loadingMore && (
                  <TableRow>
                    <TableCell colSpan={visibleColumnCount} className="text-center py-4 text-muted-foreground">
                      Loading more...
                    </TableCell>
                  </TableRow>
                )}
              </>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

export default function ManageDigitalHumans() {
  return (
    <React.Suspense fallback={<div>Loading...</div>}>
      <ManageDigitalHumansContent />
    </React.Suspense>
  )
}

