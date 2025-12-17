'use client'

import Link from "next/link"
import { usePathname } from "next/navigation"
import { BookOpen, Users, Bot, LogOut, Github, GitBranch } from "lucide-react"

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
    items: [
      { href: "/admin/api-documents", label: "API Documents", icon: BookOpen },
      { href: "https://github.com/emberlight-ai/dev-admin-console", label: "Github Repository", icon: GitBranch }
    ],
  },
]

function StoneRingMark({ className }: { className?: string }) {
  return (
    <svg
      aria-label="Amber Console"
      role="img"
      viewBox="0 0 512 512"
      className={cn("h-9 w-9 shrink-0", className)}
    >
      <defs>
        {/* Theme-driven gradient: start is primary, end is a darker version of primary */}
        <linearGradient id="amberThemeGradient" x1="0" x2="1" gradientUnits="userSpaceOnUse">
          <stop offset="0" style={{ stopColor: "var(--primary)" }} />
          <stop
            offset="1"
            style={{
              stopColor: "color-mix(in oklab, var(--primary) 55%, black)",
            }}
          />
        </linearGradient>

        <linearGradient
          id="amberObjGradient"
          x1="0"
          x2="1"
          gradientUnits="userSpaceOnUse"
          gradientTransform="translate(79.89124 371.70493) rotate(5) scale(380.74694)"
        >
          <stop offset="0" style={{ stopColor: "var(--primary)" }} />
          <stop
            offset="1"
            style={{
              stopColor: "color-mix(in oklab, var(--primary) 55%, black)",
            }}
          />
        </linearGradient>

        <linearGradient
          id="amberObjGradient2"
          x1="0"
          x2="1"
          gradientUnits="userSpaceOnUse"
          gradientTransform="translate(79.73674 127.01595) rotate(-1) scale(379.6649)"
        >
          <stop offset="0" style={{ stopColor: "var(--primary)" }} />
          <stop
            offset="1"
            style={{
              stopColor: "color-mix(in oklab, var(--primary) 55%, black)",
            }}
          />
        </linearGradient>

        <linearGradient
          id="amberObjGradient3"
          x1="0"
          x2="1"
          gradientUnits="userSpaceOnUse"
          gradientTransform="translate(16.332224 279.18895) rotate(-5) scale(493.2124)"
        >
          <stop offset="0" style={{ stopColor: "var(--primary)" }} />
          <stop
            offset="1"
            style={{
              stopColor: "color-mix(in oklab, var(--primary) 55%, black)",
            }}
          />
        </linearGradient>
      </defs>

      <g fill="none" stroke="none">
        <g>
          <path
            d="M 422.1714 435.14324 L 216.88234 435.14324 C 168.4522 435.14324 129.14659 354.88707 129.14659 256 C 129.14659 157.11293 168.4522 76.85676 216.88234 76.85676 L 422.1714 76.85676 C 324.0433 -8.433152 172.70879 -5.5228915 78.21171 85.58754 C -19.403903 179.70378 -19.403903 332.29622 78.21171 426.41246 C 172.70879 517.5229 324.0433 520.43315 422.1714 435.14324 Z"
            fill="#1e2125"
          />
          <path
            d="M 130.08027 304.45274 C 130.0635 304.45272 130.04673 304.45272 130.02997 304.45274 L 127.66737 304.45274 L 127.66737 304.53267 C 122.06848 304.90852 116.61448 306.60954 112.327 309.63573 C 102.53597 316.54637 102.53597 327.7507 112.327 334.66135 C 116.61448 337.68754 122.06848 339.38856 127.66737 339.7644 L 127.66737 339.84434 L 130.02997 339.84434 C 130.04673 339.84436 130.0635 339.84436 130.08027 339.84434 L 467.89665 339.84434 C 467.9134 339.84436 467.9302 339.84436 467.94695 339.84434 L 471.5034 339.84434 L 471.5034 339.6639 C 476.6795 339.1395 481.66784 337.472 485.6499 334.66135 C 495.44094 327.7507 495.44094 316.54637 485.6499 309.63573 C 481.66784 306.8251 476.6795 305.15757 471.5034 304.63316 L 471.5034 304.45274 L 467.94695 304.45274 C 467.9302 304.45272 467.9134 304.45272 467.89665 304.45274 Z"
            fill="#1e2125"
          />
          <path
            d="M 102.80455 172.15566 C 102.78652 172.15564 102.7685 172.15564 102.75047 172.15566 L 100.2103 172.15566 L 100.2103 172.2356 C 94.19061 172.61144 88.3267 174.31246 83.71698 177.33865 C 73.19008 184.24929 73.19008 195.45363 83.71698 202.36427 C 88.3267 205.39046 94.19062 207.09148 100.2103 207.46733 L 100.2103 207.54726 L 102.75047 207.54726 C 102.7685 207.54728 102.78652 207.54728 102.80455 207.54726 L 466.01045 207.54726 C 466.0285 207.54728 466.0465 207.54728 466.0645 207.54726 L 469.8883 207.54726 L 469.8883 207.36684 C 475.4534 206.84242 480.81665 205.1749 485.098 202.36427 C 495.6249 195.45363 495.6249 184.24929 485.098 177.33865 C 480.81665 174.52802 475.4534 172.8605 469.8883 172.33608 L 469.8883 172.15566 L 466.0645 172.15566 C 466.0465 172.15564 466.0285 172.15564 466.01045 172.15566 Z"
            fill="#1e2125"
          />
          <path
            d="M 94.31761 370.60128 C 94.30804 370.60126 94.29847 370.60126 94.28889 370.60128 L 92.93988 370.60128 L 92.93988 370.6812 C 89.74298 371.05706 86.62881 372.75808 84.18071 375.78427 C 78.59016 382.6949 78.59016 393.89924 84.18071 400.80988 C 86.62881 403.83607 89.74298 405.5371 92.93988 405.91293 L 92.93988 405.99287 L 94.28889 405.99287 C 94.29847 405.9929 94.30804 405.9929 94.31761 405.99287 L 287.20665 405.99287 C 287.21623 405.9929 287.2258 405.9929 287.23537 405.99287 L 289.26608 405.99287 L 289.26608 405.81244 C 292.22156 405.28803 295.06984 403.6205 297.34356 400.80988 C 302.9341 393.89924 302.9341 382.6949 297.34356 375.78427 C 295.06984 372.97364 292.22156 371.3061 289.26608 370.7817 L 289.26608 370.60128 L 287.23537 370.60128 C 287.2258 370.60126 287.21623 370.60126 287.20665 370.60128 Z M 364.03783 370.60127 C 354.77836 370.60127 347.26343 378.529 347.26343 388.29706 C 347.26343 398.06514 354.77836 405.99286 364.03783 405.99286 L 442.31836 405.99286 C 451.57783 405.99286 459.09276 398.06514 459.09276 388.29706 C 459.09276 378.529 451.57783 370.60127 442.31836 370.60127 L 364.03783 370.60127"
            fill="url(#amberObjGradient)"
          />
          <path
            d="M 444.76294 141.39872 C 444.7725 141.39874 444.7821 141.39874 444.79166 141.39872 L 446.1407 141.39872 L 446.1407 141.31878 C 449.33757 140.94294 452.45174 139.24192 454.89984 136.21573 C 460.4904 129.30509 460.4904 118.10075 454.89984 111.19011 C 452.45174 108.16392 449.33757 106.4629 446.1407 106.08705 L 446.1407 106.00711 L 444.79166 106.00711 C 444.7821 106.0071 444.7725 106.0071 444.76294 106.00711 L 251.8739 106.00711 C 251.86433 106.0071 251.85475 106.0071 251.84518 106.00711 L 249.81448 106.00711 L 249.81448 106.18754 C 246.859 106.71195 244.01072 108.37948 241.737 111.19011 C 236.14644 118.10075 236.14644 129.30509 241.737 136.21573 C 244.01072 139.02636 246.859 140.69388 249.81448 141.2183 L 249.81448 141.39872 L 251.84518 141.39872 C 251.85475 141.39874 251.86433 141.39874 251.8739 141.39872 Z M 175.04273 141.39873 C 184.3022 141.39873 191.81713 133.47101 191.81713 123.70293 C 191.81713 113.93484 184.3022 106.00712 175.04273 106.00712 L 96.7622 106.00712 C 87.50273 106.00712 79.987795 113.93484 79.987795 123.70293 C 79.987795 133.47101 87.50273 141.39873 96.7622 141.39873 L 175.04273 141.39873"
            fill="url(#amberObjGradient2)"
          />
          <path
            d="M 35.202813 240.43222 C 30.202498 240.10093 25.087057 241.79594 21.264763 245.51725 C 14.245079 252.35142 14.245079 263.4318 21.264763 270.26596 C 25.087057 273.98728 30.202498 275.6823 35.202813 275.351 L 35.202813 275.3916 L 488.48433 275.3916 L 488.48433 275.36476 C 493.5522 275.63003 498.7134 273.93043 502.5848 270.26596 C 509.80506 263.4318 509.80506 252.35142 502.5848 245.51725 C 498.7134 241.8528 493.5522 240.1532 488.48433 240.41846 L 488.48433 240 L 35.202813 240 Z"
            fill="url(#amberObjGradient3)"
          />
        </g>
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
            <span className="font-semibold tracking-wide text-xl">Amber Foundry</span>
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


