'use client'

import * as React from 'react'
import { Leaf, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { cn } from '@/lib/utils'

type PersonaGender = 'female' | 'male' | 'mixed' | 'unknown'
type PersonaOption = { personality: string; gender: PersonaGender }

type GreenModeResponse = {
  data?: {
    personalities?: string[]
    availablePersonalities?: PersonaOption[]
  }
  error?: string
}

/// Compact green-mode control, embedded in the config page's Matching tab
/// (replaces the old standalone /admin/matching/green-mode page).
///
/// One chip cloud, one interaction: click a persona to toggle it in or out of
/// the set. Female personas are pink, male are blue, so it's obvious at a
/// glance which DECK a selection feeds — and a warning appears when green mode
/// is active but one gender has no personas (that deck would serve no cards).
/// Saves automatically, debounced.
export function GreenModeSection() {
  const [available, setAvailable] = React.useState<PersonaOption[]>([])
  const [selected, setSelected] = React.useState<string[]>([])
  const [saved, setSaved] = React.useState<string[]>([])
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)

  const selectedKeys = React.useMemo(
    () => new Set(selected.map((p) => p.toLowerCase())),
    [selected]
  )
  const isDirty = React.useMemo(
    () => JSON.stringify(selected) !== JSON.stringify(saved),
    [selected, saved]
  )

  React.useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/admin/matching/green-mode')
        const json = (await res.json()) as GreenModeResponse
        if (!res.ok) throw new Error(json.error || 'Failed to load green mode')
        if (cancelled) return
        const next = json.data?.personalities ?? []
        setSelected(next)
        setSaved(next)
        setAvailable(json.data?.availablePersonalities ?? [])
      } catch (err) {
        console.error(err)
        if (!cancelled) toast.error(err instanceof Error ? err.message : 'Failed to load green mode')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Debounced auto-save whenever the set changes.
  React.useEffect(() => {
    if (loading || !isDirty) return
    const next = selected
    const t = setTimeout(async () => {
      setSaving(true)
      try {
        const res = await fetch('/api/admin/matching/green-mode', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ personalities: next }),
        })
        const json = (await res.json()) as GreenModeResponse
        if (!res.ok) throw new Error(json.error || 'Failed to save green mode')
        const savedNow = json.data?.personalities ?? next
        setSelected(savedNow)
        setSaved(savedNow)
      } catch (err) {
        console.error(err)
        toast.error(err instanceof Error ? err.message : 'Failed to save green mode')
      } finally {
        setSaving(false)
      }
    }, 400)
    return () => clearTimeout(t)
  }, [isDirty, loading, selected])

  const toggle = (personality: string) => {
    const key = personality.toLowerCase()
    setSelected((prev) =>
      prev.some((p) => p.toLowerCase() === key)
        ? prev.filter((p) => p.toLowerCase() !== key)
        : [...prev, personality].sort((a, b) => a.localeCompare(b))
    )
  }

  // Selected personas that no live DH carries anymore (renamed/retired) still
  // need to be visible so they can be removed.
  const orphanSelected = React.useMemo(() => {
    const availableKeys = new Set(available.map((o) => o.personality.toLowerCase()))
    return selected.filter((p) => !availableKeys.has(p.toLowerCase()))
  }, [available, selected])

  const femaleOptions = available.filter((o) => o.gender === 'female' || o.gender === 'mixed')
  const maleOptions = available.filter((o) => o.gender === 'male' || o.gender === 'mixed')
  const otherOptions = available.filter((o) => o.gender === 'unknown')

  const active = selected.length > 0
  const selectedFor = (options: PersonaOption[]) =>
    options.filter((o) => selectedKeys.has(o.personality.toLowerCase())).length

  const chip = (personality: string, tone: 'pink' | 'blue' | 'gray') => {
    const isOn = selectedKeys.has(personality.toLowerCase())
    const tones = {
      pink: isOn
        ? 'border-pink-500 bg-pink-500 text-white hover:bg-pink-600'
        : 'border-pink-200 bg-pink-50 text-pink-700 hover:border-pink-400 dark:border-pink-900 dark:bg-pink-950 dark:text-pink-300',
      blue: isOn
        ? 'border-blue-500 bg-blue-500 text-white hover:bg-blue-600'
        : 'border-blue-200 bg-blue-50 text-blue-700 hover:border-blue-400 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-300',
      gray: isOn
        ? 'border-gray-500 bg-gray-500 text-white hover:bg-gray-600'
        : 'border-gray-200 bg-gray-50 text-gray-600 hover:border-gray-400 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300',
    }
    return (
      <button
        key={personality}
        type="button"
        onClick={() => toggle(personality)}
        aria-pressed={isOn}
        className={cn(
          'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
          tones[tone]
        )}
      >
        {personality}
      </button>
    )
  }

  const group = (label: string, options: PersonaOption[], tone: 'pink' | 'blue') => {
    if (options.length === 0) return null
    const count = selectedFor(options)
    return (
      <div className="space-y-1.5">
        <div className="text-xs font-medium text-muted-foreground">
          {label} · {count} of {options.length} selected
        </div>
        <div className="flex flex-wrap gap-1.5">
          {options.map((o) => chip(o.personality, tone))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium">
            <Leaf className="h-4 w-4 text-emerald-500" />
            Green mode
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-[11px] font-semibold',
                active
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                  : 'bg-muted text-muted-foreground'
              )}
            >
              {active ? `Active · ${selected.length}` : 'Off'}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            When any personas are selected, every matching feed only serves those
            personalities. Click a persona to toggle it; empty set = normal matching.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
          {saving ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Saving…
            </>
          ) : isDirty ? (
            'Pending…'
          ) : (
            'Saved'
          )}
        </div>
      </div>

      {loading ? (
        <div className="py-4 text-center text-sm text-muted-foreground">Loading…</div>
      ) : (
        <>
          {/* Deck-coverage warnings: green mode filters BOTH decks, so an
              all-female set silently empties the male deck (and vice versa). */}
          {active && maleOptions.length > 0 && selectedFor(maleOptions) === 0 ? (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
              No male personas selected — users browsing men will see an empty deck.
            </div>
          ) : null}
          {active && femaleOptions.length > 0 && selectedFor(femaleOptions) === 0 ? (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
              No female personas selected — users browsing women will see an empty deck.
            </div>
          ) : null}

          {group('Female personas', femaleOptions, 'pink')}
          {group('Male personas', maleOptions, 'blue')}
          {otherOptions.length > 0 ? (
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-muted-foreground">
                Ungendered · {selectedFor(otherOptions)} of {otherOptions.length} selected
              </div>
              <div className="flex flex-wrap gap-1.5">
                {otherOptions.map((o) => chip(o.personality, 'gray'))}
              </div>
            </div>
          ) : null}

          {orphanSelected.length > 0 ? (
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-muted-foreground">
                Selected but no live digital humans carry these
              </div>
              <div className="flex flex-wrap gap-1.5">
                {orphanSelected.map((p) => chip(p, 'gray'))}
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}
