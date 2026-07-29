'use client'

import * as React from "react"
import Link from "next/link"
import { ArrowUpDown, Leaf, Plus, SlidersHorizontal, Star } from "lucide-react"
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

type Row = {
  userid: string
  username: string
  profession?: string | null
  bio?: string | null
  avatar?: string | null
  gender?: string | null
  personality?: string | null
  created_at: string
  updated_at: string
  postsCount: number
  chatImagesCount: number
  whitelisted?: boolean | null
  greenMode?: boolean | null
  featured?: boolean | null
}

/**
 * Avatar with a large hover preview.
 *
 * Built on Popover (driven by mouse enter/leave) rather than an inline
 * absolutely-positioned element: the shadcn Table wraps itself in an
 * `overflow-x-auto` container, which would clip any in-flow popup. Popover
 * portals to the body, so it escapes. `pointer-events-none` on the content
 * keeps it from swallowing the row's click, and auto-focus is suppressed so
 * merely hovering never steals the caret from an inline editor.
 */
function AvatarHoverPreview({
  src,
  alt,
  fallback,
}: {
  src: string
  alt: string
  fallback: string
}) {
  const [open, setOpen] = React.useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <span
          className="inline-block cursor-pointer"
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
        >
          <Avatar className="h-14 w-14">
            <AvatarImage src={src} alt={alt} />
            <AvatarFallback>{fallback}</AvatarFallback>
          </Avatar>
        </span>
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="center"
        sideOffset={12}
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="pointer-events-none w-auto p-1.5"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          className="h-64 w-64 rounded-md object-cover"
        />
        <div className="mt-1.5 truncate text-center text-xs text-muted-foreground">
          {alt}
        </div>
      </PopoverContent>
    </Popover>
  )
}

/**
 * Row-level switch for a `user_interests` tag (Featured / Green Mode).
 *
 * Sized for a comfortable pointer target — 56x32 with a 44px-tall padded hit
 * area — because these sit in dense table rows. `stopPropagation` on both
 * click and keydown is load-bearing: the row itself navigates on click, so
 * without it every toggle would also open the detail page.
 */
function TagSwitch({
  checked,
  pending,
  label,
  icon,
  onColor,
  onToggle,
}: {
  checked: boolean
  pending: boolean
  label: string
  icon: React.ReactNode
  onColor: string
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={pending}
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
      onKeyDown={(e) => e.stopPropagation()}
      className={cn(
        "inline-flex items-center justify-center px-2 py-1.5",
        pending && "opacity-50"
      )}
    >
      <span
        className={cn(
          "relative inline-flex h-8 w-14 shrink-0 items-center rounded-full border transition-colors",
          checked ? onColor : "border-input bg-muted"
        )}
      >
        <span
          className={cn(
            "inline-flex h-7 w-7 items-center justify-center rounded-full bg-background shadow transition-transform",
            checked ? "translate-x-[26px]" : "translate-x-[2px]"
          )}
        >
          {icon}
        </span>
      </span>
    </button>
  )
}

/**
 * Click-to-edit text cell. Single-line: Enter or blur saves, Escape reverts.
 * `multiline` swaps in a textarea for prose fields like Bio, where Enter has
 * to insert a newline — there, Cmd/Ctrl+Enter or blur saves.
 */
function InlineText({
  value,
  placeholder,
  multiline = false,
  onSave,
}: {
  value: string
  placeholder: string
  multiline?: boolean
  onSave: (next: string) => Promise<boolean>
}) {
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(value)
  const [saving, setSaving] = React.useState(false)

  // Re-sync when the row's value changes underneath (optimistic update or
  // a rollback after a failed save).
  React.useEffect(() => {
    if (!editing) setDraft(value)
  }, [value, editing])

  const commit = async () => {
    setEditing(false)
    if (draft.trim() === value.trim()) return
    setSaving(true)
    const ok = await onSave(draft.trim())
    if (!ok) setDraft(value)
    setSaving(false)
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setEditing(true)
        }}
        className={cn(
          "-mx-1 w-full rounded px-1 py-0.5 text-left",
          "hover:bg-muted hover:ring-1 hover:ring-border",
          multiline ? "line-clamp-2 max-w-[320px]" : "max-w-[220px] truncate",
          saving && "opacity-50",
          !value && "italic text-muted-foreground/60"
        )}
        title={multiline && value ? value : "Click to edit"}
      >
        {value || placeholder}
      </button>
    )
  }

  if (multiline) {
    return (
      <textarea
        autoFocus
        rows={4}
        value={draft}
        disabled={saving}
        onChange={(e) => setDraft(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          e.stopPropagation()
          // Enter must stay a newline in prose; save with the modifier.
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void commit()
          if (e.key === "Escape") {
            setDraft(value)
            setEditing(false)
          }
        }}
        className="w-full min-w-[280px] max-w-[320px] rounded-md border border-input bg-background px-2 py-1.5 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
    )
  }

  return (
    <input
      autoFocus
      value={draft}
      disabled={saving}
      onChange={(e) => setDraft(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onBlur={() => void commit()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === "Enter") void commit()
        if (e.key === "Escape") {
          setDraft(value)
          setEditing(false)
        }
      }}
      className="h-7 w-full max-w-[220px] rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    />
  )
}

/** Click-to-edit dropdown cell. Choosing an option saves immediately. */
function InlineSelect({
  value,
  options,
  onSave,
}: {
  value: string
  options: string[]
  onSave: (next: string) => Promise<boolean>
}) {
  const [editing, setEditing] = React.useState(false)
  const [saving, setSaving] = React.useState(false)

  if (!editing) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setEditing(true)
        }}
        className={cn(
          "-mx-1 w-full max-w-[180px] truncate rounded px-1 py-0.5 text-left",
          "hover:bg-muted hover:ring-1 hover:ring-border",
          saving && "opacity-50",
          !value && "italic text-muted-foreground/60"
        )}
        title="Click to edit"
      >
        {value || "Set persona"}
      </button>
    )
  }

  return (
    <select
      autoFocus
      value={value}
      disabled={saving}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      onBlur={() => setEditing(false)}
      onChange={async (e) => {
        const next = e.target.value
        setEditing(false)
        if (next === value) return
        setSaving(true)
        await onSave(next)
        setSaving(false)
      }}
      className="h-7 w-full max-w-[180px] rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      <option value="">—</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  )
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
  const whitelistedOnly = searchParams.get("whitelisted") === "true"
  const tagFilter = searchParams.get("tag") || ""

  // Local state for search input with debounce
  const [searchInput, setSearchInput] = React.useState(searchQuery)

  // Fetched personalities based on gender filter
  const [personalitiesByGender, setPersonalitiesByGender] = React.useState<Record<string, string[]>>({})

  type SortKey = "name" | "created" | "posts" | "images" | "featured" | "greenMode" | "whitelisted"
  type SortDir = "asc" | "desc"
  const [sortKey, setSortKey] = React.useState<SortKey>("created")
  const [sortDir, setSortDir] = React.useState<SortDir>("desc")

  const [columns, setColumns] = React.useState({
    avatar: true,
    profession: true,
    personality: true,
    bio: true,
    posts: true,
    chatImages: true,
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
    // name + Whitelisted + Featured + Green Mode are always visible; the
    // Actions column is gone (rows are clickable).
    return (
      (columns.avatar ? 1 : 0) +
      1 +
      (columns.profession ? 1 : 0) +
      (columns.personality ? 1 : 0) +
      (columns.bio ? 1 : 0) +
      (columns.posts ? 1 : 0) +
      (columns.chatImages ? 1 : 0) +
      (columns.created ? 1 : 0) +
      3
    )
  }, [columns])

  /// Persists one field on one DH and reconciles the row optimistically.
  /// Returns false on failure so the editor can restore its own draft.
  const saveRowField = React.useCallback(
    async (userid: string, field: "profession" | "personality" | "bio", value: string | null) => {
      const previous = rows.find((r) => r.userid === userid)?.[field] ?? null
      setRows((prev) =>
        prev.map((r) => (r.userid === userid ? { ...r, [field]: value } : r))
      )
      try {
        const res = await fetch(`/api/admin/users/${encodeURIComponent(userid)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ [field]: value }),
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body?.error || `Request failed (${res.status})`)
        }
        toast.success(
          field === "profession"
            ? "Profession updated"
            : field === "bio"
              ? "Bio updated"
              : "Persona updated"
        )
        return true
      } catch (e) {
        setRows((prev) =>
          prev.map((r) => (r.userid === userid ? { ...r, [field]: previous } : r))
        )
        toast.error(e instanceof Error ? e.message : "Couldn't save")
        return false
      }
    },
    [rows]
  )

  /// Rows open in a NEW TAB so the list (and its scroll position, filters and
  /// search) survives — this page is worked through in bulk.
  const openRow = React.useCallback((userid: string) => {
    window.open(`/admin/digital-humans/${userid}`, "_blank", "noopener,noreferrer")
  }, [])

  /// Whitelisted is a COLUMN on `users`, not a `user_interests` tag, so it
  /// writes through the user PATCH rather than the interests route.
  const toggleWhitelisted = React.useCallback(
    async (userid: string, next: boolean) => {
      const pendingKey = `${userid}:whitelisted`
      setTagPending((p) => new Set(p).add(pendingKey))
      setRows((prev) =>
        prev.map((r) => (r.userid === userid ? { ...r, whitelisted: next } : r))
      )
      try {
        const res = await fetch(`/api/admin/users/${encodeURIComponent(userid)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ whitelisted: next }),
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body?.error || `Request failed (${res.status})`)
        }
        toast.success(next ? "Whitelisted" : "Removed from whitelist")
      } catch (e) {
        setRows((prev) =>
          prev.map((r) => (r.userid === userid ? { ...r, whitelisted: !next } : r))
        )
        toast.error(e instanceof Error ? e.message : "Couldn't update whitelist")
      } finally {
        setTagPending((p) => {
          const n = new Set(p)
          n.delete(pendingKey)
          return n
        })
      }
    },
    []
  )

  /// Tag writes in flight, keyed `${userid}:${key}` — disables just that switch.
  const [tagPending, setTagPending] = React.useState<Set<string>>(new Set())

  /// Green Mode and Featured are both `user_interests` rows, so one handler
  /// covers both. PATCH (not PUT) so it only touches this one tag — PUT is
  /// replace-all and would wipe the DH's other tags.
  const toggleTag = React.useCallback(
    async (userid: string, key: "green_mode" | "featured", next: boolean) => {
      const field = key === "green_mode" ? "greenMode" : "featured"
      const pendingKey = `${userid}:${key}`
      setTagPending((p) => new Set(p).add(pendingKey))
      // Optimistic: the switch flips immediately and rolls back on failure —
      // the round trip is long enough that a lagging toggle feels broken.
      setRows((prev) =>
        prev.map((r) => (r.userid === userid ? { ...r, [field]: next } : r))
      )
      try {
        const res = await fetch(
          `/api/admin/digital-humans/${encodeURIComponent(userid)}/interests`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ key, enabled: next }),
          }
        )
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body?.error || `Request failed (${res.status})`)
        }
        const label = key === "green_mode" ? "Green Mode" : "Featured"
        toast.success(next ? `Added to ${label}` : `Removed from ${label}`)
      } catch (e) {
        setRows((prev) =>
          prev.map((r) => (r.userid === userid ? { ...r, [field]: !next } : r))
        )
        toast.error(e instanceof Error ? e.message : "Couldn't update tag")
      } finally {
        setTagPending((p) => {
          const n = new Set(p)
          n.delete(pendingKey)
          return n
        })
      }
    },
    []
  )

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
      if (sortKey === "images") {
        return (a.chatImagesCount - b.chatImagesCount) * dir
      }
      // Boolean columns: desc puts the tagged rows on top, which is the point.
      if (sortKey === "featured" || sortKey === "greenMode" || sortKey === "whitelisted") {
        const flag = (r: Row) =>
          sortKey === "featured" ? !!r.featured
            : sortKey === "greenMode" ? !!r.greenMode
              : !!r.whitelisted
        const delta = Number(flag(a)) - Number(flag(b))
        // Stable, readable secondary ordering inside each group.
        return delta !== 0
          ? delta * dir
          : a.username.localeCompare(b.username, undefined, { sensitivity: "base" })
      }
      // created
      return (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) * dir
    })
    return out
  }, [rows, sortKey, sortDir])

  // Fetch Personalities Effect
  //
  // BOTH genders are always fetched and kept separately. The filter dropdown
  // wants the union, but the inline Persona editor must offer only the personas
  // valid for THAT ROW's gender — personality is a join key into SystemPrompts
  // (keyed `gender:personality`), so a mismatched pair silently falls back to
  // the General prompt.
  React.useEffect(() => {
    let cancelled = false;
    const fetchPersonalities = async () => {
      try {
        const entries = await Promise.all(
          (["Female", "Male"] as const).map(async (g) => {
            const res = await fetch(`/api/system-prompts/personalities?gender=${encodeURIComponent(g)}`);
            if (!res.ok) return [g, [] as string[]] as const;
            const json = await res.json();
            return [g, ((json.data || []) as string[]).slice().sort()] as const;
          })
        );
        if (!cancelled) setPersonalitiesByGender(Object.fromEntries(entries) as Record<string, string[]>);
      } catch (err) {
        console.error("Failed to fetch personalities", err);
      }
    };

    fetchPersonalities();
    return () => { cancelled = true; };
  }, []);

  // Options for the top filter: union when viewing all genders.
  const personalities = React.useMemo(() => {
    const wanted =
      genderFilter === "all"
        ? ["Female", "Male"]
        : [genderFilter === "female" ? "Female" : "Male"];
    return Array.from(
      new Set(wanted.flatMap((g) => personalitiesByGender[g] ?? []))
    ).sort();
  }, [personalitiesByGender, genderFilter]);

  const fetchRows = React.useCallback(async (isLoadMore = false) => {
    if (isLoadMore) setLoadingMore(true)
    else setLoading(true)

    try {
      // Use offset state for pagination, but props from URL for filtering
      const currentOffset = isLoadMore ? offset : 0

      const searchParam = searchQuery ? `&search=${encodeURIComponent(searchQuery)}` : '';
      const res = await fetch(
        `/api/admin/digital-humans?gender=${encodeURIComponent(genderFilter)}&personality=${encodeURIComponent(personalityFilter === 'All' || personalityFilter === null ? 'all' : personalityFilter)}${searchParam}${whitelistedOnly ? '&whitelisted=true' : ''}${tagFilter ? `&tag=${encodeURIComponent(tagFilter)}` : ''}&offset=${currentOffset}&limit=${LIMIT}`
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
  }, [genderFilter, personalityFilter, searchQuery, whitelistedOnly, tagFilter, offset])

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
  const prevFilters = React.useRef({ genderFilter, personalityFilter, searchQuery, whitelistedOnly, tagFilter });

  React.useEffect(() => {
    const filtersChanged =
      prevFilters.current.genderFilter !== genderFilter ||
      prevFilters.current.personalityFilter !== personalityFilter ||
      prevFilters.current.whitelistedOnly !== whitelistedOnly ||
      prevFilters.current.tagFilter !== tagFilter ||
      prevFilters.current.searchQuery !== searchQuery;

    if (filtersChanged) {
      setOffset(0);
      setHasMore(true);
      prevFilters.current = { genderFilter, personalityFilter, searchQuery, whitelistedOnly, tagFilter };
      void fetchRows(false);
    } else if (isFirstRun.current) {
      void fetchRows(false);
      isFirstRun.current = false;
    }
  }, [genderFilter, personalityFilter, searchQuery, whitelistedOnly, tagFilter, fetchRows])


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
                    checked={columns.chatImages}
                    onChange={(e) => setColumns((c) => ({ ...c, chatImages: e.target.checked }))}
                  />
                  Chat images
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-input bg-background"
                    checked={columns.bio}
                    onChange={(e) => setColumns((c) => ({ ...c, bio: e.target.checked }))}
                  />
                  Bio
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
                      bio: true,
                      posts: true,
                      chatImages: true,
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

              {/* All three live in the URL like the other filters, so a
                  filtered list survives a refresh and can be shared as a link.
                  Filtering (server-side) is what actually isolates a cohort
                  across all 576 rows — the column sorts only reorder what's
                  already loaded. */}
              <Button
                type="button"
                variant={whitelistedOnly ? "default" : "outline"}
                size="sm"
                className="h-9 gap-2"
                aria-pressed={whitelistedOnly}
                onClick={() => updateFilters({ whitelisted: whitelistedOnly ? null : "true" })}
              >
                <Star
                  className={cn(
                    "h-4 w-4",
                    whitelistedOnly ? "fill-current" : "fill-amber-500 text-amber-500"
                  )}
                />
                Whitelisted
              </Button>

              <Button
                type="button"
                variant={tagFilter === "featured" ? "default" : "outline"}
                size="sm"
                className="h-9 gap-2"
                aria-pressed={tagFilter === "featured"}
                onClick={() =>
                  updateFilters({ tag: tagFilter === "featured" ? null : "featured" })
                }
              >
                <Star
                  className={cn(
                    "h-4 w-4",
                    tagFilter === "featured" ? "fill-current" : "fill-sky-600 text-sky-600"
                  )}
                />
                Featured
              </Button>

              <Button
                type="button"
                variant={tagFilter === "green_mode" ? "default" : "outline"}
                size="sm"
                className="h-9 gap-2"
                aria-pressed={tagFilter === "green_mode"}
                onClick={() =>
                  updateFilters({ tag: tagFilter === "green_mode" ? null : "green_mode" })
                }
              >
                <Leaf
                  className={cn(
                    "h-4 w-4",
                    tagFilter === "green_mode" ? "" : "text-emerald-600"
                  )}
                />
                Green Mode
              </Button>
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
              {columns.personality ? <TableHead>Persona</TableHead> : null}
              {columns.bio ? <TableHead className="min-w-[260px]">Bio</TableHead> : null}
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
              {columns.chatImages ? (
                <TableHead>
                  <button
                    type="button"
                    onClick={() => toggleSort("images")}
                    className="inline-flex items-center gap-1 text-left font-medium"
                  >
                    Chat Images <ArrowUpDown className="h-4 w-4 opacity-60" />
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
              <TableHead className="text-center">
                <button
                  type="button"
                  onClick={() => toggleSort("whitelisted")}
                  className="inline-flex items-center gap-1 font-medium"
                >
                  Whitelisted <ArrowUpDown className="h-4 w-4 opacity-60" />
                </button>
              </TableHead>
              <TableHead className="text-center">
                <button
                  type="button"
                  onClick={() => toggleSort("featured")}
                  className="inline-flex items-center gap-1 font-medium"
                >
                  Featured <ArrowUpDown className="h-4 w-4 opacity-60" />
                </button>
              </TableHead>
              <TableHead className="text-center">
                <button
                  type="button"
                  onClick={() => toggleSort("greenMode")}
                  className="inline-flex items-center gap-1 font-medium"
                >
                  Green Mode <ArrowUpDown className="h-4 w-4 opacity-60" />
                </button>
              </TableHead>
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
                  <TableRow
                    key={r.userid}
                    className="cursor-pointer hover:bg-muted/40"
                    // Keyboard-reachable too: losing the Details link would
                    // otherwise leave this row navigable by mouse only.
                    tabIndex={0}
                    role="link"
                    aria-label={`Open ${r.username} in a new tab`}
                    onClick={() => openRow(r.userid)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault()
                        openRow(r.userid)
                      }
                    }}
                  >
                    {columns.avatar ? (
                      <TableCell className="pl-4">
                        <AvatarHoverPreview
                          src={`/api/avatar/${r.userid}?v=${encodeURIComponent(r.updated_at || r.created_at)}`}
                          alt={r.username}
                          fallback={r.username?.slice(0, 2)?.toUpperCase() ?? "??"}
                        />
                      </TableCell>
                    ) : null}
                    <TableCell className="font-medium">{r.username}</TableCell>
                    {columns.profession ? (
                      <TableCell className="text-muted-foreground">
                        <InlineText
                          value={r.profession ?? ""}
                          placeholder="Add profession"
                          onSave={(v) => saveRowField(r.userid, "profession", v || null)}
                        />
                      </TableCell>
                    ) : null}
                    {columns.personality ? (
                      <TableCell className="text-muted-foreground">
                        <InlineSelect
                          value={r.personality ?? ""}
                          // Gender-scoped on purpose: personality is a join key
                          // into SystemPrompts (`gender:personality`), so an
                          // option from the other gender would silently fall
                          // back to the General prompt.
                          options={personalitiesByGender[r.gender ?? ""] ?? []}
                          onSave={(v) => saveRowField(r.userid, "personality", v || null)}
                        />
                      </TableCell>
                    ) : null}
                    {columns.bio ? (
                      <TableCell className="max-w-[320px] text-muted-foreground">
                        <InlineText
                          value={r.bio ?? ""}
                          placeholder="Add bio"
                          multiline
                          onSave={(v) => saveRowField(r.userid, "bio", v || null)}
                        />
                      </TableCell>
                    ) : null}
                    {columns.posts ? <TableCell className="text-muted-foreground">{r.postsCount}</TableCell> : null}
                    {columns.chatImages ? <TableCell className="text-muted-foreground">{r.chatImagesCount}</TableCell> : null}
                    {columns.created ? (
                      <TableCell className="text-muted-foreground">
                        {new Date(r.created_at).toLocaleDateString()}
                      </TableCell>
                    ) : null}
                    <TableCell className="text-center">
                      <TagSwitch
                        checked={!!r.whitelisted}
                        pending={tagPending.has(`${r.userid}:whitelisted`)}
                        label={`Whitelisted for ${r.username}`}
                        onColor="bg-amber-500 border-amber-500"
                        icon={
                          <Star
                            className={cn(
                              "h-3.5 w-3.5",
                              r.whitelisted
                                ? "fill-amber-500 text-amber-500"
                                : "text-muted-foreground"
                            )}
                          />
                        }
                        onToggle={() => void toggleWhitelisted(r.userid, !r.whitelisted)}
                      />
                    </TableCell>
                    <TableCell className="text-center">
                      <TagSwitch
                        checked={!!r.featured}
                        pending={tagPending.has(`${r.userid}:featured`)}
                        label={`Featured for ${r.username}`}
                        onColor="bg-sky-600 border-sky-600"
                        icon={
                          <Star
                            className={cn(
                              "h-3.5 w-3.5",
                              r.featured ? "fill-sky-600 text-sky-600" : "text-muted-foreground"
                            )}
                          />
                        }
                        onToggle={() => void toggleTag(r.userid, "featured", !r.featured)}
                      />
                    </TableCell>
                    <TableCell className="text-center">
                      <TagSwitch
                        checked={!!r.greenMode}
                        pending={tagPending.has(`${r.userid}:green_mode`)}
                        label={`Green Mode for ${r.username}`}
                        onColor="bg-emerald-600 border-emerald-600"
                        icon={
                          <Leaf
                            className={cn(
                              "h-3.5 w-3.5",
                              r.greenMode ? "text-emerald-600" : "text-muted-foreground"
                            )}
                          />
                        }
                        onToggle={() => void toggleTag(r.userid, "green_mode", !r.greenMode)}
                      />
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

