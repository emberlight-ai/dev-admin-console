'use client'

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  BookOpen,
  Bot,
  LogOut,
  ScrollText,
  Menu,
  LayoutDashboard,
  Users,
  Network,
  Flag,
  MessageSquare,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { ThemeToggle } from "@/components/theme-toggle"
import { ThemeColorPicker, useThemeColor } from "@/components/theme-color"
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet"
import { logout } from "@/actions/auth"
import GlareHover from "@/components/glare-hover"

const navGroups = [
  {
    title: "Users and Bots",
    items: [
      { href: "/admin/users", label: "Dashboard", icon: LayoutDashboard },
      { href: "/admin/digital-humans", label: "Digital Humans", icon: Bot },
      { href: "/admin/digital-human-prompts", label: "System Prompts", icon: ScrollText },
    ],
  },
  {
    title: "Matching",
    items: [
      { href: "/admin/matching/recommendations", label: "Recommendations", icon: Users },
      { href: "/admin/matching/matchings", label: "Matchings", icon: Network },
      { href: "/admin/matching/reports", label: "Reports", icon: Flag },
      { href: "/admin/matching/chat", label: "Chat", icon: MessageSquare },
    ],
  },
]

const backendGroup = {
  title: "Backend",
  items: [
    { href: "/admin/api-documents", label: "API Doc", icon: BookOpen },
  ],
}

function pickThreeIndices(seed: number) {
  // Deterministic pseudo-random selection so it stays stable per theme change.
  // xorshift32
  let x = (seed | 0) || 1
  const chosen = new Set<number>()
  while (chosen.size < 3) {
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    chosen.add(Math.abs(x) % 9)
  }
  return chosen
}

function StoneRingMark({ className, seed }: { className?: string; seed?: number }) {
  const colored = React.useMemo(() => pickThreeIndices(seed ?? 0), [seed])

  return (
    <svg
      aria-label="Amber Console"
      role="img"
      viewBox="0 0 36 36"
      className={cn("h-9 w-9 shrink-0", className)}
    >
      {Array.from({ length: 9 }).map((_, i) => {
        const x = 1 + (i % 3) * 12
        const y = 1 + Math.floor(i / 3) * 12
        const fill = colored.has(i) ? "var(--primary)" : "#2b2f35"
        return <rect key={i} x={x} y={y} width={10} height={10} rx={2} fill={fill} />
      })}
    </svg>
  )
}

function NavItem({
  item,
  pathname,
  onClick,
}: {
  item: { href: string; label: string; icon: React.ComponentType<{ className?: string }> }
  pathname: string
  onClick?: () => void
}) {
  const active = pathname.startsWith(item.href)
  const Icon = item.icon
  return (
    <Link
      href={item.href}
      onClick={onClick}
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
}

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { changeNonce } = useThemeColor()
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false)

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Desktop sidebar */}
      <div className="fixed inset-y-0 left-0 hidden w-64 border-r bg-sidebar md:flex md:flex-col">
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
            <StoneRingMark seed={changeNonce} />
            <span className="font-semibold tracking-wide text-xl">Matrix OS</span>
          </div>
        </GlareHover>
        <Separator />
        
        <nav className="flex-1 overflow-y-auto p-3 space-y-5">
          {navGroups.map((group) => (
            <div key={group.title}>
              <div className="px-2 text-xs font-medium tracking-wide text-muted-foreground">
                {group.title}
              </div>
              <div className="mt-2 space-y-1">
                {group.items.map((item) => (
                  <NavItem key={item.href} item={item} pathname={pathname} />
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="p-3 bg-sidebar space-y-4">
          <div>
            <div className="px-2 text-xs font-medium tracking-wide text-muted-foreground">
              {backendGroup.title}
            </div>
            <div className="mt-2 space-y-1">
              {backendGroup.items.map((item) => (
                <NavItem key={item.href} item={item} pathname={pathname} />
              ))}
            </div>
          </div>
          
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

      <div className="pl-0 md:pl-64">
        <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur">
          <div className="h-14 px-4 md:px-6 flex items-center justify-between md:justify-end gap-2">
            {/* Mobile nav trigger */}
            <div className="flex items-center gap-2 md:hidden">
              <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
                <SheetTrigger asChild>
                  <Button variant="outline" size="icon" aria-label="Open navigation">
                    <Menu className="h-4 w-4" />
                  </Button>
                </SheetTrigger>
                <SheetContent side="left" className="w-72 p-0 flex flex-col">
                  <div className="h-14 w-full px-4 flex items-center gap-2 border-b">
                    <StoneRingMark seed={changeNonce} />
                    <span className="font-semibold tracking-wide text-lg">Matrix OS</span>
                  </div>
                  <nav className="flex-1 overflow-y-auto p-3 space-y-5">
                    {navGroups.map((group) => (
                      <div key={group.title}>
                        <div className="px-2 text-xs font-medium tracking-wide text-muted-foreground">
                          {group.title}
                        </div>
                        <div className="mt-2 space-y-1">
                          {group.items.map((item) => (
                            <NavItem
                              key={item.href}
                              item={item}
                              pathname={pathname}
                              onClick={() => setMobileNavOpen(false)}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </nav>
                  
                  <div className="p-3 border-t space-y-4">
                    <div>
                      <div className="px-2 text-xs font-medium tracking-wide text-muted-foreground">
                        {backendGroup.title}
                      </div>
                      <div className="mt-2 space-y-1">
                        {backendGroup.items.map((item) => (
                          <NavItem
                            key={item.href}
                            item={item}
                            pathname={pathname}
                            onClick={() => setMobileNavOpen(false)}
                          />
                        ))}
                      </div>
                    </div>

                    <Button
                      variant="outline"
                      className="w-full justify-start gap-2"
                      onClick={() => {
                        setMobileNavOpen(false)
                        logout()
                      }}
                    >
                      <LogOut className="h-4 w-4" />
                      Sign Out
                    </Button>
                  </div>
                </SheetContent>
              </Sheet>
            </div>

            {/* Desktop: keep right-aligned controls; Mobile: controls still accessible */}
            <div className="flex items-center gap-2">
            <ThemeColorPicker />
            <ThemeToggle />
            </div>
          </div>
        </header>
        <main className="p-4 md:p-6">{children}</main>
      </div>
    </div>
  )
}
