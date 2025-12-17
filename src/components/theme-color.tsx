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
  | "indigo"
  | "ocean"
  | "slate"
  | "sage"
  | "amber"
  | "crimson"
  | "plum"
  | "sky"

const THEME_COLORS: { value: ThemeColor; label: string }[] = [
  { value: "indigo", label: "Indigo" },
  { value: "ocean", label: "Ocean" },
  { value: "slate", label: "Slate" },
  { value: "sage", label: "Sage" },
  { value: "amber", label: "Amber" },
  { value: "crimson", label: "Crimson" },
  { value: "plum", label: "Plum" },
  { value: "sky", label: "Sky" },
]

const COLOR_SWATCH: Record<ThemeColor, string> = {
  // Premium SaaS palette (muted, brandable)
  indigo: "hsl(231 48% 48%)",  // ~ #3F51B5
  ocean: "hsl(190 65% 32%)",   // deep teal
  slate: "hsl(215 18% 34%)",   // graphite/slate
  sage: "hsl(164 34% 32%)",    // muted green
  amber: "hsl(28 75% 42%)",    // warm amber
  crimson: "hsl(349 64% 38%)", // premium red (cardinal-ish)
  plum: "hsl(270 32% 42%)",    // muted violet
  sky: "hsl(201 78% 36%)",     // premium blue
}

const STORAGE_KEY = "theme-color"
const ATTR = "data-color"

function applyThemeColor(color: ThemeColor) {
  document.documentElement.setAttribute(ATTR, color)
  localStorage.setItem(STORAGE_KEY, color)
}

function getInitialThemeColor(): ThemeColor {
  const storedRaw = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null
  // Backwards compatibility for older values (AntD -> early shadcn -> premium palette)
  const migrated =
    storedRaw === "green" ? "sage" :
    storedRaw === "red" ? "crimson" :
    storedRaw === "neutral" ? "slate" :
    storedRaw === "blue" ? "sky" :
    storedRaw === "lime" ? "sage" :
    storedRaw === "cyan" ? "ocean" :
    storedRaw === "orange" ? "amber" :
    storedRaw === "cardinal" ? "crimson" :
    storedRaw === "rose" ? "crimson" :
    storedRaw === "violet" ? "plum" :
    storedRaw === "yellow" ? "amber" :
    storedRaw

  const stored = migrated as ThemeColor | null
  if (stored && THEME_COLORS.some((c) => c.value === stored)) return stored
  return "indigo"
}

type ThemeColorContextValue = {
  color: ThemeColor
  setColor: (c: ThemeColor) => void
}

const ThemeColorContext = React.createContext<ThemeColorContextValue | null>(null)

export function ThemeColorProvider({ children }: { children: React.ReactNode }) {
  const [color, setColorState] = React.useState<ThemeColor>("indigo")

  React.useEffect(() => {
    const initial = getInitialThemeColor()
    setColorState(initial)
    applyThemeColor(initial)
  }, [])

  const setColor = React.useCallback((c: ThemeColor) => {
    setColorState(c)
    applyThemeColor(c)
  }, [])

  return (
    <ThemeColorContext.Provider value={{ color, setColor }}>
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


