'use client'

import * as React from "react"
import { useTheme } from "next-themes"
import { Check, Monitor, Moon, Sun } from "lucide-react"

import { cn } from "@/lib/utils"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { COLOR_SWATCH, THEME_COLORS, useThemeColor } from "@/components/theme-color"

const APPEARANCE = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "Auto", icon: Monitor },
] as const

export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const { theme, setTheme } = useTheme()
  const { color, setColor } = useThemeColor()
  const [mounted, setMounted] = React.useState(false)
  React.useEffect(() => setMounted(true), [])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Personalize how the console looks.</DialogDescription>
        </DialogHeader>

        <div className="space-y-6 pt-2">
          <div className="space-y-2">
            <div className="text-sm font-medium">Appearance</div>
            <div className="grid grid-cols-3 gap-2">
              {APPEARANCE.map((a) => {
                const Icon = a.icon
                const active = mounted && theme === a.value
                return (
                  <button
                    key={a.value}
                    type="button"
                    onClick={() => setTheme(a.value)}
                    aria-pressed={active}
                    className={cn(
                      "flex flex-col items-center gap-1.5 rounded-lg border p-3 text-xs font-medium transition-colors",
                      active
                        ? "border-primary bg-primary/5 text-primary ring-1 ring-primary"
                        : "text-muted-foreground hover:bg-accent"
                    )}
                  >
                    <Icon className="h-5 w-5" />
                    {a.label}
                  </button>
                )
              })}
            </div>
            <p className="text-xs text-muted-foreground">Auto follows your system setting.</p>
          </div>

          <div className="space-y-2">
            <div className="text-sm font-medium">Accent color</div>
            <div className="grid grid-cols-4 gap-2">
              {THEME_COLORS.map((c) => {
                const selected = color === c.value
                return (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setColor(c.value)}
                    title={c.label}
                    aria-pressed={selected}
                    className={cn(
                      "flex flex-col items-center gap-1.5 rounded-lg border p-2 text-[11px] transition-colors hover:bg-accent",
                      selected ? "border-primary ring-1 ring-primary" : ""
                    )}
                  >
                    <span
                      className="relative inline-flex h-6 w-6 items-center justify-center rounded-full border"
                      style={{ backgroundColor: COLOR_SWATCH[c.value] }}
                    >
                      {selected ? (
                        <Check className="absolute -right-1 -top-1 h-4 w-4 rounded-full bg-background p-[1px] text-foreground" />
                      ) : null}
                    </span>
                    <span className={cn(selected ? "font-medium text-foreground" : "text-muted-foreground")}>
                      {c.label}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
