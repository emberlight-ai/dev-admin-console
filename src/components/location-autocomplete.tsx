"use client"

import * as React from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type MapboxFeature = {
  id?: string
  place_name?: string
  center?: [number, number] // [lon, lat]
}

export type LocationSelection = {
  name: string
  longitude: number
  latitude: number
}

export function LocationAutocomplete({
  label = "Location",
  value,
  onValueChange,
  onSelect,
  onClear,
  placeholder = "Search for a place...",
  disabled,
}: {
  label?: string
  value: string
  onValueChange: (v: string) => void
  onSelect: (sel: LocationSelection) => void
  onClear?: () => void
  placeholder?: string
  disabled?: boolean
}) {
  const token = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN

  const [open, setOpen] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [results, setResults] = React.useState<LocationSelection[]>([])
  const [error, setError] = React.useState<string | null>(null)

  const fetchIdRef = React.useRef(0)

  React.useEffect(() => {
    const q = value.trim()
    setError(null)

    if (!open) return
    if (!q) {
      setResults([])
      return
    }
    if (!token) {
      setResults([])
      setError("Missing NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN")
      return
    }

    const fetchId = ++fetchIdRef.current
    const controller = new AbortController()

    const t = window.setTimeout(async () => {
      try {
        setLoading(true)
        const url =
          "https://api.mapbox.com/geocoding/v5/mapbox.places/" +
          encodeURIComponent(q) +
          ".json?access_token=" +
          encodeURIComponent(token) +
          "&autocomplete=true&limit=6&types=place,locality,neighborhood,address"

        const res = await fetch(url, { signal: controller.signal })
        if (!res.ok) throw new Error(`Mapbox error (${res.status})`)
        const json = (await res.json()) as { features?: MapboxFeature[] }

        if (fetchIdRef.current !== fetchId) return
        const next = (json.features ?? [])
          .map((f) => {
            const name = f.place_name
            const center = f.center
            if (!name || !center || center.length < 2) return null
            return { name, longitude: center[0], latitude: center[1] } as LocationSelection
          })
          .filter((x): x is LocationSelection => Boolean(x))

        setResults(next)
      } catch (e: unknown) {
        if (controller.signal.aborted) return
        setResults([])
        setError(e instanceof Error ? e.message : "Failed to fetch locations")
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }, 250)

    return () => {
      controller.abort()
      window.clearTimeout(t)
    }
  }, [open, token, value])

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label>{label}</Label>
        {onClear ? (
          <Button type="button" variant="ghost" size="sm" onClick={onClear} disabled={disabled}>
            Clear
          </Button>
        ) : null}
      </div>

      <div className="relative">
        <Input
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            // allow click selection to register before closing
            window.setTimeout(() => setOpen(false), 120)
          }}
        />

        {open ? (
          <div className="absolute z-50 mt-2 w-full rounded-md border bg-background shadow">
            {error ? <div className="p-3 text-xs text-destructive">{error}</div> : null}
            {!error && loading ? <div className="p-3 text-xs text-muted-foreground">Searching…</div> : null}
            {!error && !loading && results.length === 0 ? (
              <div className="p-3 text-xs text-muted-foreground">No results</div>
            ) : null}

            {!error && results.length > 0 ? (
              <ul className="max-h-64 overflow-auto py-1">
                {results.map((r) => (
                  <li key={`${r.longitude},${r.latitude},${r.name}`}>
                    <button
                      type="button"
                      className="w-full px-3 py-2 text-left text-sm hover:bg-muted"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        onSelect(r)
                        setOpen(false)
                      }}
                    >
                      <div className="font-medium">{r.name}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        lon {r.longitude.toFixed(4)} · lat {r.latitude.toFixed(4)}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}


