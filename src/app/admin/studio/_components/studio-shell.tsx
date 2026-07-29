"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  BarChart3,
  BookOpen,
  ChevronDown,
  CreditCard,
  LayoutDashboard,
  LifeBuoy,
  Plus,
  Puzzle,
  Settings,
  Sparkles,
  Users,
} from "lucide-react"

import { cn } from "@/lib/utils"

// ═══════════════════════════════════════════════════════════════════════════
// Creator Studio — the surface an EXPERT sees, not an operator.
//
// Deliberately not the admin shell: no Matrix OS branding, no ops tooling.
// This is the "deploy your expertise" product, so the chrome reads like a
// developer platform — one project selector, a short nav, a status footer.
// ═══════════════════════════════════════════════════════════════════════════

/** Andrew Huberman — the expert this studio is scoped to for the demo. */
export const DEMO_EXPERT_ID = "229f38dd-fd81-47c5-94b7-d3657e048738"
export const DEMO_EXPERT_NAME = "Andrew Huberman"

const NAV = [
  { href: "/admin/studio/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/admin/studio/earnings", label: "Earnings", icon: CreditCard },
  { href: "/admin/studio/audience", label: "Audience", icon: Users },
  { href: "/admin/studio/tools", label: "Skills & Tools", icon: Puzzle },
  { href: "/admin/studio/analytics", label: "Analytics", icon: BarChart3 },
]

const SECONDARY = [
  { href: "/admin/studio/settings", label: "Settings", icon: Settings },
  { href: "/admin/studio/docs", label: "Docs", icon: BookOpen },
  { href: "/admin/studio/support", label: "Support", icon: LifeBuoy },
]

export function StudioShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Sidebar */}
      <aside className="fixed inset-y-0 left-0 hidden w-[248px] flex-col border-r bg-sidebar md:flex">
        <div className="flex h-16 items-center gap-2.5 px-5">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-foreground">
            <Sparkles className="h-4 w-4 text-background" />
          </span>
          <span className="text-[15px] font-semibold tracking-tight">Amber Studio</span>
        </div>

        {/* Expert selector — the "project" of this platform */}
        <div className="px-3 pb-3">
          <button className="flex w-full items-center gap-2.5 rounded-xl border bg-card p-2.5 text-left transition-colors hover:bg-muted/60">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-400 to-teal-500 text-[12px] font-bold text-white">
              AH
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold leading-tight">
                {DEMO_EXPERT_NAME}
              </span>
              <span className="block text-[11px] text-muted-foreground">Published</span>
            </span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </button>
        </div>

        <nav className="flex-1 space-y-0.5 px-3">
          {NAV.map((item) => (
            <NavLink key={item.href} item={item} pathname={pathname} />
          ))}

          <div className="pt-4">
            <Link
              href="/admin/digital-humans/v2/create"
              className="flex items-center gap-2 rounded-xl border border-dashed px-3 py-2.5 text-[13.5px] font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
            >
              <Plus className="h-4 w-4" />
              New expert
            </Link>
          </div>
        </nav>

        <div className="space-y-0.5 border-t px-3 py-3">
          {SECONDARY.map((item) => (
            <NavLink key={item.href} item={item} pathname={pathname} muted />
          ))}
        </div>

        <div className="border-t px-5 py-3">
          <div className="flex items-center gap-2 text-[11.5px] text-muted-foreground">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            All systems operational
          </div>
        </div>
      </aside>

      <div className="pl-0 md:pl-[248px]">{children}</div>
    </div>
  )
}

function NavLink({
  item,
  pathname,
  muted,
}: {
  item: { href: string; label: string; icon: React.ComponentType<{ className?: string }> }
  pathname: string
  muted?: boolean
}) {
  const active = pathname.startsWith(item.href)
  return (
    <Link
      href={item.href}
      className={cn(
        "flex items-center gap-2.5 rounded-xl px-3 py-2 text-[13.5px] font-medium transition-colors",
        active
          ? "bg-muted text-foreground"
          : muted
            ? "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
            : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
      )}
    >
      <item.icon className="h-4 w-4" />
      {item.label}
    </Link>
  )
}

/** Page header used by every studio page, so the surfaces feel like one product. */
export function StudioHeader({
  title,
  subtitle,
  actions,
}: {
  title: string
  subtitle?: string
  actions?: React.ReactNode
}) {
  return (
    <header className="sticky top-0 z-10 border-b bg-background/85 backdrop-blur-xl">
      <div className="flex flex-wrap items-center gap-4 px-8 py-4">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[19px] font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="truncate text-[13px] text-muted-foreground">{subtitle}</p>}
        </div>
        {actions}
      </div>
    </header>
  )
}
