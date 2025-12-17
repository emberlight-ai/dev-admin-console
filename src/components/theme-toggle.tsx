'use client'

import * as React from "react"
import { Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"

import { Button } from "@/components/ui/button"

export function ThemeToggle() {
  const { setTheme, theme, resolvedTheme } = useTheme()
  const [mounted, setMounted] = React.useState(false)

  React.useEffect(() => {
    setMounted(true)
  }, [])

  // If user hasn't picked a theme yet, next-themes uses "system".
  // Use resolvedTheme to decide what we're currently showing.
  const current = mounted ? (theme === "system" ? resolvedTheme : theme) ?? "light" : "light"

  const toggle = () => {
    setTheme(current === "dark" ? "light" : "dark")
  }

  return (
    <Button variant="outline" size="icon" onClick={toggle} disabled={!mounted}>
      {!mounted ? (
        <Sun className="h-4 w-4 opacity-0" />
      ) : current === "dark" ? (
        <Moon className="h-4 w-4" />
      ) : (
        <Sun className="h-4 w-4" />
      )}
      <span className="sr-only">Toggle theme</span>
    </Button>
  )
}


