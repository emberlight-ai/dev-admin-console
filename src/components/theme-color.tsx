'use client'

import * as React from "react"
import { Check, Palette } from "lucide-react"

import { cn } from "@/lib/utils"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"

export type ThemeColor =
  | "blue"
  | "green"
  | "neutral"
  | "orange"
  | "red"
  | "rose"
  | "violet"
  | "yellow"

const THEME_COLORS: { value: ThemeColor; label: string }[] = [
  { value: "blue", label: "Blue" },
  { value: "green", label: "Green" },
  { value: "neutral", label: "Neutral" },
  { value: "orange", label: "Orange" },
  { value: "red", label: "Red" },
  { value: "rose", label: "Rose" },
  { value: "violet", label: "Violet" },
  { value: "yellow", label: "Yellow" },
]

const STORAGE_KEY = "theme-color"
const ATTR = "data-color"

function applyThemeColor(color: ThemeColor) {
  document.documentElement.setAttribute(ATTR, color)
  localStorage.setItem(STORAGE_KEY, color)
}

function getInitialThemeColor(): ThemeColor {
  const stored = (typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null) as ThemeColor | null
  if (stored && THEME_COLORS.some((c) => c.value === stored)) return stored
  return "green"
}

type ThemeColorContextValue = {
  color: ThemeColor
  setColor: (c: ThemeColor) => void
}

const ThemeColorContext = React.createContext<ThemeColorContextValue | null>(null)

export function ThemeColorProvider({ children }: { children: React.ReactNode }) {
  const [color, setColorState] = React.useState<ThemeColor>("green")

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

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className={cn("gap-2", className)}>
          <Palette className="h-4 w-4" />
          Theme
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {THEME_COLORS.map((c) => (
          <DropdownMenuItem
            key={c.value}
            onClick={() => setColor(c.value)}
            className="flex items-center justify-between"
          >
            <span>{c.label}</span>
            {color === c.value ? <Check className="h-4 w-4 opacity-80" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}


