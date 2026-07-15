'use client'

import * as React from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Plus, Search } from "lucide-react"

import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"

type Gender = "Female" | "Male"

// Contextual personalities list rendered inside the main sidebar while editing a
// prompt, so the editor keeps full width. Switching navigates; the editor's
// rename fires a `personality-renamed` event we listen for to stay in sync.
export function PersonalityNav({ onNavigate }: { onNavigate?: () => void }) {
  const searchParams = useSearchParams()
  const urlGender: Gender = searchParams.get("gender") === "Male" ? "Male" : "Female"
  const urlPersonality = searchParams.get("personality") ?? ""

  const [gender, setGender] = React.useState<Gender>(urlGender)
  const [activePersonality, setActivePersonality] = React.useState(urlPersonality)
  const [names, setNames] = React.useState<string[]>([])
  const [loading, setLoading] = React.useState(true)
  const [query, setQuery] = React.useState("")

  React.useEffect(() => setGender(urlGender), [urlGender])
  React.useEffect(() => setActivePersonality(urlPersonality), [urlPersonality])

  const fetchNames = React.useCallback((g: Gender) => {
    setLoading(true)
    fetch(`/api/system-prompts/personalities?gender=${encodeURIComponent(g)}`)
      .then((r) => r.json())
      .then((j) => setNames(Array.isArray(j.data) ? (j.data as string[]) : []))
      .catch(() => setNames([]))
      .finally(() => setLoading(false))
  }, [])

  React.useEffect(() => fetchNames(gender), [gender, fetchNames])

  React.useEffect(() => {
    const onRenamed = (e: Event) => {
      const detail = (e as CustomEvent).detail as { gender?: string; newName?: string } | undefined
      if (!detail || detail.gender !== gender) return
      if (detail.newName) setActivePersonality(detail.newName)
      fetchNames(gender)
    }
    window.addEventListener("personality-renamed", onRenamed)
    return () => window.removeEventListener("personality-renamed", onRenamed)
  }, [gender, fetchNames])

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    return names.filter((n) => n.toLowerCase().includes(q)).sort((a, b) => a.localeCompare(b))
  }, [names, query])

  return (
    <div>
      <div className="flex items-center justify-between px-2">
        <span className="text-xs font-medium tracking-wide text-muted-foreground">Personalities</span>
        <Link
          href={`/admin/personas/manage?gender=${gender}`}
          onClick={onNavigate}
          aria-label="New personality"
          title="New personality"
          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <Plus className="h-4 w-4" />
        </Link>
      </div>

      <div className="mt-2 space-y-2 px-1">
        <div className="inline-flex w-full rounded-md border p-0.5">
          {(["Female", "Male"] as Gender[]).map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setGender(g)}
              className={cn(
                "flex-1 rounded px-2 py-1 text-xs font-medium transition-colors",
                gender === g ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
              )}
            >
              {g}
            </button>
          ))}
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            className="h-8 pl-7 text-xs"
          />
        </div>
      </div>

      <div className="mt-2 space-y-0.5">
        {loading ? (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">
            {names.length === 0 ? "No personalities yet" : "No matches"}
          </div>
        ) : (
          filtered.map((name) => {
            const active = gender === urlGender && name === activePersonality
            return (
              <Link
                key={name}
                href={`/admin/personas/manage?gender=${gender}&personality=${encodeURIComponent(name)}`}
                onClick={onNavigate}
                title={name}
                className={cn(
                  "block truncate rounded-md px-3 py-1.5 text-sm transition-colors",
                  active
                    ? "sidebar-active font-medium text-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                )}
              >
                {name}
              </Link>
            )
          })
        )}
      </div>
    </div>
  )
}
