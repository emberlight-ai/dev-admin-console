'use client'

import { Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"

import { Button } from "@/components/ui/button"

export function ThemeToggle() {
  const { setTheme, theme, resolvedTheme } = useTheme()

  // If user hasn't picked a theme yet, next-themes uses "system".
  // Use resolvedTheme to decide what we're currently showing.
  const current = (theme === "system" ? resolvedTheme : theme) ?? "light"

  const toggle = () => {
    setTheme(current === "dark" ? "light" : "dark")
  }

  return (
    <Button variant="outline" size="icon" onClick={toggle}>
      {current === "dark" ? (
        <Moon className="h-4 w-4" />
      ) : (
        <Sun className="h-4 w-4" />
      )}
      <span className="sr-only">Toggle theme</span>
    </Button>
  )
}


