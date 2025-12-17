'use client'

import * as React from "react"
import { Check, ChevronDown, Palette } from "lucide-react"

import { cn } from "@/lib/utils"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"

export type ThemeColor =
  | "magic"
  | "cold"
  | "fire"
  | "sacred"
  | "poison"
  | "blood"
  | "dark"
  | "quality"

const THEME_COLORS: { value: ThemeColor; label: string }[] = [
  { value: "magic", label: "Magic" },
  { value: "cold", label: "Cold" },
  { value: "fire", label: "Fire" },
  { value: "sacred", label: "Sacred" },
  { value: "poison", label: "Poison" },
  { value: "blood", label: "Blood" },
  { value: "dark", label: "Dark" },
  { value: "quality", label: "Quality" },
]

const COLOR_SWATCH: Record<ThemeColor, string> = {
  // Elden Ring / Dark Souls-inspired affinities (still readable for SaaS UI)
  magic: "hsl(221 92% 56%)",   // vibrant glintstone blue
  cold: "hsl(196 92% 55%)",    // brighter icy cyan
  fire: "hsl(22 95% 55%)",     // hotter orange
  sacred: "hsl(46 98% 56%)",   // richer gold
  poison: "#5da500",           // vibrant poison green
  blood: "hsl(356 88% 52%)",   // vivid crimson
  dark: "hsl(268, 51%, 38%)",  // deeper violet
  quality: "hsl(215 22% 52%)", // cleaner steel
}

const STORAGE_KEY = "theme-color"
const ATTR = "data-color"

function applyThemeColor(color: ThemeColor) {
  document.documentElement.setAttribute(ATTR, color)
  localStorage.setItem(STORAGE_KEY, color)
}

function getInitialThemeColor(): ThemeColor {
  const storedRaw = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null
  // Backwards compatibility for older values (AntD -> premium palette -> affinities)
  const migrated =
    storedRaw === "green" ? "poison" :
    storedRaw === "red" ? "blood" :
    storedRaw === "neutral" ? "quality" :
    storedRaw === "indigo" ? "magic" :
    storedRaw === "ocean" ? "cold" :
    storedRaw === "slate" ? "quality" :
    storedRaw === "sage" ? "poison" :
    storedRaw === "amber" ? "fire" :
    storedRaw === "crimson" ? "blood" :
    storedRaw === "plum" ? "dark" :
    storedRaw === "sky" ? "magic" :
    storedRaw

  const stored = migrated as ThemeColor | null
  if (stored && THEME_COLORS.some((c) => c.value === stored)) return stored
  return "magic"
}

type ThemeColorContextValue = {
  color: ThemeColor
  setColor: (c: ThemeColor) => void
  changeNonce: number
}

const ThemeColorContext = React.createContext<ThemeColorContextValue | null>(null)

export function ThemeColorProvider({ children }: { children: React.ReactNode }) {
  const [color, setColorState] = React.useState<ThemeColor>("magic")
  const [changeNonce, setChangeNonce] = React.useState(0)

  React.useEffect(() => {
    const initial = getInitialThemeColor()
    setColorState(initial)
    applyThemeColor(initial)
  }, [])

  const setColor = React.useCallback((c: ThemeColor) => {
    setColorState(c)
    applyThemeColor(c)
    setChangeNonce((n) => n + 1)
  }, [])

  return (
    <ThemeColorContext.Provider value={{ color, setColor, changeNonce }}>
      {children}
    </ThemeColorContext.Provider>
  )
}

export function useThemeColor() {
  const ctx = React.useContext(ThemeColorContext)
  if (!ctx) throw new Error("useThemeColor must be used within ThemeColorProvider")
  return ctx
}

export function ThemeColorPicker({ className }: { className?: string }) {
  const { color, setColor } = useThemeColor()
  const current = THEME_COLORS.find((c) => c.value === color) ?? THEME_COLORS[0]

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className={cn("gap-2", className)}>
          <Palette className="h-4 w-4" />
          <span className="text-muted-foreground">Theme:</span>
          <span className="font-medium">{current.label}</span>
          <span
            aria-hidden
            className="ml-1 inline-block h-3.5 w-3.5 rounded-full border"
            style={{ backgroundColor: COLOR_SWATCH[color] }}
          />
          <ChevronDown className="ml-1 h-4 w-4 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <div className="grid grid-cols-4 gap-2 p-2">
          {THEME_COLORS.map((c) => {
            const selected = color === c.value
            return (
              <DropdownMenuItem
                key={c.value}
                onClick={() => setColor(c.value)}
                className={cn(
                  "relative flex h-10 w-10 items-center justify-center rounded-md p-0",
                  "focus:bg-accent focus:text-accent-foreground",
                  selected && "ring-2 ring-ring"
                )}
                title={c.label}
              >
                <span
                  aria-hidden
                  className="h-5 w-5 rounded-full border"
                  style={{ backgroundColor: COLOR_SWATCH[c.value] }}
                />
                <span className="sr-only">{c.label}</span>
                {selected ? (
                  <Check className="absolute -right-1 -top-1 h-4 w-4 rounded-full bg-background p-[1px]" />
                ) : null}
              </DropdownMenuItem>
            )
          })}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}


