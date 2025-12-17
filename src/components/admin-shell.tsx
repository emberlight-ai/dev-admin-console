'use client'

import Link from "next/link"
import { usePathname } from "next/navigation"
import { BookOpen, Users, Bot, LogOut } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { ThemeToggle } from "@/components/theme-toggle"
import { ThemeColorPicker, useThemeColor } from "@/components/theme-color"
import { logout } from "@/actions/auth"
import GlareHover from "@/components/glare-hover"

const navGroups: {
  title: string
  items: { href: string; label: string; icon: React.ComponentType<{ className?: string }> }[]
}[] = [
  {
    title: "Users and Bots",
    items: [
      { href: "/admin/users", label: "Manage Users", icon: Users },
      { href: "/admin/digital-humans", label: "Manage Digital Humans", icon: Bot },
    ],
  },
  {
    title: "Backend",
    items: [{ href: "/admin/api-documents", label: "API Documents", icon: BookOpen }],
  },
]

function StoneRingMark({ className }: { className?: string }) {
  return (
    <svg
      aria-label="Amber Console"
      role="img"
      viewBox="0 0 64 64"
      className={cn("h-9 w-8 shrink-0", className)}
    >
      {/* Ring band (light, like the reference) */}
      <circle
        cx="32"
        cy="44"
        r="18"
        fill="none"
        stroke="var(--muted-foreground)"
        strokeWidth="6"
        strokeLinecap="round"
        opacity="0.55"
      />

      {/* Diamond (fill tinted by theme) */}
      <g fill="var(--primary)" opacity="0.95">
        {/* top table */}
        <polygon points="18,10 46,10 52,22 12,22" />
        {/* center facets */}
        <polygon points="12,22 32,54 52,22" />
        <polygon points="18,10 32,22 46,10" opacity="0.9" />
      </g>

      {/* Diamond outlines / facet lines (black) */}
      <g stroke="#000" strokeWidth="3" strokeLinejoin="round" fill="none" opacity="0.30">
        <polygon points="18,10 46,10 52,22 32,54 12,22" />
        <line x1="18" y1="10" x2="32" y2="22" opacity="0.55"/>
        <line x1="46" y1="10" x2="32" y2="22" opacity="0.55"/>
        <line x1="12" y1="22" x2="32" y2="22" opacity="0.55"/>
        <line x1="52" y1="22" x2="32" y2="22" opacity="0.55"/>
        <line x1="32" y1="22" x2="32" y2="54" opacity="0.55"/>
      </g>
    </svg>
  )
}

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { changeNonce } = useThemeColor()

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="fixed inset-y-0 left-0 w-64 border-r bg-sidebar">
        <GlareHover
          width="100%"
          height="56px"
          borderRadius="0px"
          borderColor="transparent"
          className="border-x-0 border-t-0"
          glareOpacity={0.65}
          glareSize={360}
          transitionDuration={900}
          triggerOnHover={false}
          triggerKey={changeNonce}
        >
          <div className="h-14 w-full px-4 flex items-center gap-2">
            <StoneRingMark />
            <span className="font-semibold tracking-wide text-xl">Amber Console</span>
          </div>
        </GlareHover>
        <Separator />
        <nav className="p-3 space-y-5">
          {navGroups.map((group) => (
            <div key={group.title}>
              <div className="px-2 text-xs font-medium tracking-wide text-muted-foreground">
                {group.title}
              </div>
              <div className="mt-2 space-y-1">
                {group.items.map((item) => {
                  const active = pathname.startsWith(item.href)
                  const Icon = item.icon
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                        "hover:bg-accent hover:text-accent-foreground",
                        active && "sidebar-active text-foreground"
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      {item.label}
                    </Link>
                  )
                })}
              </div>
            </div>
          ))}
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


