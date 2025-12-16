'use client'

import Link from "next/link"
import { usePathname } from "next/navigation"
import { LayoutDashboard, Users, Bot, LogOut } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { ThemeToggle } from "@/components/theme-toggle"
import { ThemeColorPicker } from "@/components/theme-color"
import { logout } from "@/actions/auth"

const nav = [
  { href: "/admin/digital-humans", label: "Manage Digital Humans", icon: Bot },
  { href: "/admin/users", label: "Manage Users", icon: Users },
]

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="fixed inset-y-0 left-0 w-64 border-r bg-sidebar">
        <div className="h-14 px-4 flex items-center gap-2">
          <LayoutDashboard className="h-4 w-4" />
          <span className="font-semibold tracking-wide">AMBER ADMIN</span>
        </div>
        <Separator />
        <nav className="p-2 space-y-1">
          {nav.map((item) => {
            const active = pathname.startsWith(item.href)
            const Icon = item.icon
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                  "hover:bg-accent hover:text-accent-foreground",
                  active && "bg-sidebar-accent text-sidebar-accent-foreground"
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            )
          })}
        </nav>
        <div className="absolute bottom-0 left-0 right-0 p-3">
          <Button
            variant="outline"
            className="w-full justify-start gap-2"
            onClick={() => logout()}
          >
            <LogOut className="h-4 w-4" />
            Sign Out
          </Button>
        </div>
      </div>

      <div className="pl-64">
        <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur">
          <div className="h-14 px-6 flex items-center justify-end gap-2">
            <ThemeColorPicker />
            <ThemeToggle />
          </div>
        </header>
        <main className="p-6">{children}</main>
      </div>
    </div>
  )
}


