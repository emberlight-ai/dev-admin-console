'use client'

import * as React from "react"
import Link from "next/link"
import { endOfDay, format, isSameDay, startOfDay, subDays } from "date-fns"
import { CalendarDays, ChevronDown, Eye } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"

type UserRow = {
  userid: string
  username: string
  gender?: string | null
  age?: number | null
  zipcode?: string | null
  location_name?: string | null
  avatar?: string | null
  created_at: string
}

type DeletedUserRow = {
  id: string
  deleted_user_id: string
  deleted_at: string
  provider?: string | null
  profile_snapshot?: { username?: string; avatar?: string } | null
  usage_snapshot?: {
    user_posts?: number
    messages?: number
    user_matches?: number
  } | null
}

import type { DateRange } from "react-day-picker"

type Environment = "Production" | "Sandbox"

// The date filter is day-granular: Today, Yesterday, then the previous days as
// individual buttons, plus a custom range. QUICK_DAY_COUNT controls how many
// single-day buttons are shown (today + yesterday + the rest).
const QUICK_DAY_COUNT = 7

function dayLabel(d: Date, today: Date): string {
  if (isSameDay(d, today)) return "Today"
  if (isSameDay(d, subDays(today, 1))) return "Yesterday"
  return format(d, "MMM d")
}

type ActiveSubscriberRow = {
  subscription_id: string
  user_id: string
  username: string
  avatar: string | null
  plan_name: string
  apple_product_id: string
  billing_period: string
  price_cents: number
  currency: string
  monthly_recurring_cents: number
  created_at: string | null
  current_period_end: string | null
  environment: string | null
}

function TableSkeleton({ columns = 8, rows = 5 }: { columns?: number; rows?: number }) {
  // Varied bar widths so the shimmer reads as content, not a uniform grid.
  const widths = ["70%", "55%", "80%", "45%", "60%", "65%", "50%", "40%"]
  return (
    <Table>
      <TableBody>
        {Array.from({ length: rows }).map((_, r) => (
          <TableRow key={r}>
            {Array.from({ length: columns }).map((_, c) => (
              <TableCell key={c} className={c === 0 ? "pl-4" : undefined}>
                {c === 0 ? (
                  <div className="h-9 w-9 animate-pulse rounded-full bg-muted" />
                ) : (
                  <div
                    className="h-4 animate-pulse rounded bg-muted"
                    style={{ width: widths[c % widths.length] }}
                  />
                )}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function StatCard({
  title,
  value,
  deltaPct,
  subtitle,
  showDelta = true,
}: {
  title: string
  value: string
  deltaPct: number
  subtitle: string
  showDelta?: boolean
}) {
  const up = deltaPct >= 0
  return (
    <Card className="p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="text-sm text-muted-foreground">{title}</div>
        {showDelta ? (
          <div
            className={cn(
              "inline-flex items-center rounded-full border px-2 py-0.5 text-xs",
              up ? "text-foreground" : "text-foreground"
            )}
          >
            {up ? "+" : ""}
            {deltaPct.toFixed(1)}%
          </div>
        ) : null}
      </div>
      <div className="mt-3 text-3xl font-semibold tracking-tight">{value}</div>
      <div className="mt-6 text-sm font-medium">{subtitle}</div>
    </Card>
  )
}

function SubscriptionsCard({
  monthly,
  yearly,
  environment,
  loading,
}: {
  monthly: number
  yearly: number
  environment: string
  loading: boolean
}) {
  return (
    <Card className="p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="text-sm text-muted-foreground">Subscriptions</div>
        <div className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
          {environment}
        </div>
      </div>
      <div className="mt-3 flex items-end gap-6">
        <div>
          <div className="text-3xl font-semibold tracking-tight tabular-nums">
            {loading ? "—" : monthly.toLocaleString()}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">New monthly</div>
        </div>
        <div>
          <div className="text-3xl font-semibold tracking-tight tabular-nums">
            {loading ? "—" : yearly.toLocaleString()}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">New yearly</div>
        </div>
      </div>
      <div className="mt-6 text-sm font-medium">New subscriptions in range</div>
    </Card>
  )
}

export default function ManageUsers() {
  const [users, setUsers] = React.useState<UserRow[]>([])
  const [loading, setLoading] = React.useState(true)
  // Deleted Users is collapsed by default; admins expand it on demand so the
  // page isn't dominated by a list they rarely need.
  const [deletedExpanded, setDeletedExpanded] = React.useState(false)
  const [deletedUsers, setDeletedUsers] = React.useState<DeletedUserRow[]>([])
  const [deletedLoading, setDeletedLoading] = React.useState(true)
  const [dateMode, setDateMode] = React.useState<"day" | "range">("day")
  const [selectedDay, setSelectedDay] = React.useState<Date>(() => startOfDay(new Date()))
  const [customRange, setCustomRange] = React.useState<DateRange | undefined>(undefined)
  const [calendarOpen, setCalendarOpen] = React.useState(false)
  const [environment, setEnvironment] = React.useState<Environment>("Production")

  // Today, Yesterday, then the previous days as individual quick buttons.
  const quickDays = React.useMemo(() => {
    const today = startOfDay(new Date())
    return Array.from({ length: QUICK_DAY_COUNT }, (_, i) => subDays(today, i))
  }, [])
  const [newMonthly, setNewMonthly] = React.useState(0)
  const [newYearly, setNewYearly] = React.useState(0)
  const [activeSubscribers, setActiveSubscribers] = React.useState<ActiveSubscriberRow[]>([])
  const [premiumIds, setPremiumIds] = React.useState<string[]>([])
  const [paidIds, setPaidIds] = React.useState<string[]>([])
  const [subscriptionsLoading, setSubscriptionsLoading] = React.useState(true)
  const [matchCounts, setMatchCounts] = React.useState<Record<string, number>>({})
  const [messageCounts, setMessageCounts] = React.useState<Record<string, number>>({})
  const [imageCounts, setImageCounts] = React.useState<Record<string, number>>({})

  const range = React.useMemo<DateRange>(() => {
    if (dateMode === "range" && customRange?.from) {
      return {
        from: startOfDay(customRange.from),
        to: endOfDay(customRange.to ?? customRange.from),
      }
    }
    return { from: startOfDay(selectedDay), to: endOfDay(selectedDay) }
  }, [dateMode, selectedDay, customRange])

  // Users with an active subscription in the selected environment are "premium".
  // Derived from premiumIds (not date-restricted), so the tag reflects current state
  // even when the date filter narrows the Active subscribers table.
  const premiumUserIds = React.useMemo(() => new Set(premiumIds), [premiumIds])

  const fetchUsers = React.useCallback(async () => {
    if (!range?.from || !range?.to) return
    setLoading(true)
    try {
      const qs = new URLSearchParams({
        mode: "list",
        is_digital_human: "false",
        created_from: new Date(range.from).toISOString(),
        created_to: new Date(range.to).toISOString(),
      })
      const res = await fetch(`/api/admin/users?${qs.toString()}`)
      const json = (await res.json()) as { data?: UserRow[]; error?: string }
      if (!res.ok) throw new Error(json.error || "Failed to fetch users")
      setUsers((json.data ?? []) as UserRow[])
    } catch (err: unknown) {
      console.error(err)
      setUsers([])
    }
    setLoading(false)
  }, [range])

  React.useEffect(() => {
    void fetchUsers()
  }, [fetchUsers])

  const fetchSubscriptions = React.useCallback(async () => {
    if (!range?.from || !range?.to) return
    setSubscriptionsLoading(true)
    try {
      const qs = new URLSearchParams({
        environment: environment.toLowerCase(),
        created_from: new Date(range.from).toISOString(),
        created_to: new Date(range.to).toISOString(),
      })
      const res = await fetch(`/api/admin/subscriptions?${qs.toString()}`)
      const json = (await res.json()) as {
        new_monthly?: number
        new_yearly?: number
        active_count?: number
        subscribers?: ActiveSubscriberRow[]
        premium_user_ids?: string[]
        paid_user_ids?: string[]
        error?: string
      }
      if (!res.ok) throw new Error(json.error || 'Failed to fetch subscriptions')
      setNewMonthly(json.new_monthly ?? 0)
      setNewYearly(json.new_yearly ?? 0)
      setActiveSubscribers(json.subscribers ?? [])
      setPremiumIds(json.premium_user_ids ?? [])
      setPaidIds(json.paid_user_ids ?? [])
    } catch (err: unknown) {
      console.error(err)
      setNewMonthly(0)
      setNewYearly(0)
      setActiveSubscribers([])
      setPremiumIds([])
      setPaidIds([])
    }
    setSubscriptionsLoading(false)
  }, [range, environment])

  React.useEffect(() => {
    void fetchSubscriptions()
  }, [fetchSubscriptions])

  const fetchMatchCounts = React.useCallback(async () => {
    try {
      const res = await fetch('/api/admin/users/match-counts')
      const json = (await res.json()) as { data?: Record<string, number>; error?: string }
      if (!res.ok) throw new Error(json.error || 'Failed to fetch match counts')
      setMatchCounts(json.data ?? {})
    } catch (err: unknown) {
      console.error(err)
      setMatchCounts({})
    }
  }, [])

  React.useEffect(() => {
    void fetchMatchCounts()
  }, [fetchMatchCounts])

  const fetchMessageCounts = React.useCallback(async () => {
    try {
      const res = await fetch('/api/admin/users/message-counts')
      const json = (await res.json()) as { data?: Record<string, number>; error?: string }
      if (!res.ok) throw new Error(json.error || 'Failed to fetch message counts')
      setMessageCounts(json.data ?? {})
    } catch (err: unknown) {
      console.error(err)
      setMessageCounts({})
    }
  }, [])

  React.useEffect(() => {
    void fetchMessageCounts()
  }, [fetchMessageCounts])

  const fetchImageCounts = React.useCallback(async () => {
    try {
      const res = await fetch('/api/admin/users/image-counts')
      const json = (await res.json()) as { data?: Record<string, number>; error?: string }
      if (!res.ok) throw new Error(json.error || 'Failed to fetch image counts')
      setImageCounts(json.data ?? {})
    } catch (err: unknown) {
      console.error(err)
      setImageCounts({})
    }
  }, [])

  React.useEffect(() => {
    void fetchImageCounts()
  }, [fetchImageCounts])

  const fetchDeletedUsers = React.useCallback(async () => {
    setDeletedLoading(true)
    try {
      const res = await fetch("/api/admin/deleted-users?mode=list")
      const json = (await res.json()) as { data?: DeletedUserRow[]; error?: string }
      if (!res.ok) throw new Error(json.error || "Failed to fetch deleted users")
      setDeletedUsers((json.data ?? []) as DeletedUserRow[])
    } catch (err: unknown) {
      console.error(err)
      setDeletedUsers([])
    }
    setDeletedLoading(false)
  }, [])

  React.useEffect(() => {
    void fetchDeletedUsers()
  }, [fetchDeletedUsers])

  // Cohort conversion for the selected range: of the new real users created in
  // the window, the share who have ever paid (in the selected environment).
  const paidUserIds = React.useMemo(() => new Set(paidIds), [paidIds])
  const conversion = React.useMemo(() => {
    const total = users.length
    const paid = users.reduce((n, u) => n + (paidUserIds.has(u.userid) ? 1 : 0), 0)
    return { total, paid, rate: total === 0 ? 0 : (paid / total) * 100 }
  }, [users, paidUserIds])

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Manage Users</h1>
          <p className="text-sm text-muted-foreground">Track growth and view users (non-digital humans).</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap items-center gap-1 rounded-md border p-1">
            {quickDays.map((d) => {
              const active = dateMode === "day" && isSameDay(d, selectedDay)
              return (
                <button
                  key={d.toISOString()}
                  type="button"
                  onClick={() => {
                    setDateMode("day")
                    setSelectedDay(d)
                  }}
                  className={cn(
                    "rounded px-2.5 py-1 text-sm font-medium transition-colors",
                    active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
                  )}
                >
                  {dayLabel(d, quickDays[0])}
                </button>
              )
            })}
            <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-sm font-medium transition-colors",
                    dateMode === "range"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted"
                  )}
                >
                  <CalendarDays className="h-3.5 w-3.5" />
                  {dateMode === "range" && customRange?.from
                    ? `${format(customRange.from, "MMM d")}${
                        customRange.to && !isSameDay(customRange.to, customRange.from)
                          ? ` – ${format(customRange.to, "MMM d")}`
                          : ""
                      }`
                    : "Custom range"}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <Calendar
                  mode="range"
                  numberOfMonths={2}
                  defaultMonth={subDays(new Date(), 1)}
                  selected={customRange}
                  onSelect={(r) => {
                    setCustomRange(r)
                    setDateMode("range")
                    if (r?.from && r?.to) setCalendarOpen(false)
                  }}
                  disabled={{ after: new Date() }}
                  autoFocus
                />
              </PopoverContent>
            </Popover>
          </div>
          <Tabs value={environment} onValueChange={(v) => setEnvironment(v as Environment)}>
            <TabsList>
              <TabsTrigger value="Production">Production</TabsTrigger>
              <TabsTrigger value="Sandbox">Sandbox</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <SubscriptionsCard
          monthly={newMonthly}
          yearly={newYearly}
          environment={environment}
          loading={subscriptionsLoading}
        />
        <StatCard
          title="New Customers"
          value={loading ? "—" : users.length.toLocaleString()}
          deltaPct={0}
          subtitle="Real users created in range"
          showDelta={false}
        />
        <StatCard
          title="Conversion rate"
          value={loading || subscriptionsLoading ? "—" : `${conversion.rate.toFixed(1)}%`}
          deltaPct={0}
          subtitle={`${conversion.paid} of ${conversion.total} new users paid (${environment})`}
          showDelta={false}
        />
      </div>

      <Card className="p-0">
        <div className="p-6">
          <div className="flex items-center gap-2 text-sm font-medium">
            Active subscribers
            <Badge variant="outline" className="font-normal">{environment}</Badge>
          </div>
          <div className="text-xs text-muted-foreground">
            {subscriptionsLoading
              ? 'Loading...'
              : `${activeSubscribers.length} active ${environment.toLowerCase()} subscription${activeSubscribers.length === 1 ? '' : 's'} (status ACTIVE, period not ended)`}
          </div>
        </div>
        <div className="border-t">
          {subscriptionsLoading ? (
            <TableSkeleton columns={8} />
          ) : activeSubscribers.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">No active subscriptions.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Avatar</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Billing</TableHead>
                  <TableHead>Subscribed</TableHead>
                  <TableHead>Renews / ends</TableHead>
                  <TableHead>Env</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activeSubscribers.map((s) => (
                  <TableRow key={s.subscription_id}>
                    <TableCell className="pl-4">
                      <Avatar className="h-9 w-9">
                        <AvatarImage src={`/api/avatar/${s.user_id}`} alt={s.username} />
                        <AvatarFallback>{s.username.slice(0, 2).toUpperCase()}</AvatarFallback>
                      </Avatar>
                    </TableCell>
                    <TableCell className="font-medium">{s.username}</TableCell>
                    <TableCell className="text-muted-foreground">
                      <div>{s.plan_name}</div>
                      <div className="text-xs font-mono">{s.apple_product_id}</div>
                    </TableCell>
                    <TableCell className="text-muted-foreground capitalize">{s.billing_period}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {s.created_at ? new Date(s.created_at).toLocaleDateString() : '—'}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {s.current_period_end
                        ? new Date(s.current_period_end).toLocaleString()
                        : '—'}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{s.environment ?? '—'}</TableCell>
                    <TableCell className="text-left">
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/admin/users/${s.user_id}`} className="gap-2">
                          <Eye className="h-4 w-4" />
                          View
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </Card>

      <Card className="p-0">
        <div className="p-6">
          <div className="text-sm font-medium">User List</div>
          <div className="text-xs text-muted-foreground">
            {loading ? "Loading..." : `${users.length} users joined in range`}
          </div>
        </div>
        <div className="border-t">
          {loading ? (
            <TableSkeleton columns={10} />
          ) : users.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/default-avatar.svg"
                alt="No users"
                className="h-16 w-16 opacity-70"
              />
              <div className="text-sm text-muted-foreground">No users found.</div>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Avatar</TableHead>
                  <TableHead>Username</TableHead>
                  <TableHead>Gender</TableHead>
                  <TableHead>Age</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Matches</TableHead>
                  <TableHead>Messages</TableHead>
                  <TableHead>Images</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => (
                  <TableRow key={u.userid}>
                    <TableCell className="pl-4">
                      <Avatar className="h-9 w-9">
                        <AvatarImage src={`/api/avatar/${u.userid}`} alt={u.username} />
                        <AvatarFallback>{u.username.slice(0, 2).toUpperCase()}</AvatarFallback>
                      </Avatar>
                    </TableCell>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <span>{u.username}</span>
                        {premiumUserIds.has(u.userid) ? (
                          <Badge className="bg-amber-500 text-amber-950 hover:bg-amber-600">Premium</Badge>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{u.gender ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{u.age ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{u.location_name || u.zipcode || "—"}</TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">{matchCounts[u.userid] ?? 0}</TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">{messageCounts[u.userid] ?? 0}</TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">{imageCounts[u.userid] ?? 0}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(u.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-left">
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/admin/users/${u.userid}`} className="gap-2">
                          <Eye className="h-4 w-4" />
                          View
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </Card>

      <Card className="p-0">
        <button
          type="button"
          onClick={() => setDeletedExpanded((v) => !v)}
          aria-expanded={deletedExpanded}
          className="flex w-full items-center justify-between gap-4 p-6 text-left transition-colors hover:bg-muted/40"
        >
          <div>
            <div className="text-sm font-medium">Deleted Users</div>
            <div className="text-xs text-muted-foreground">
              {deletedLoading
                ? "Loading..."
                : `${deletedUsers.length} deleted users · click to ${deletedExpanded ? "collapse" : "expand"}`}
            </div>
          </div>
          <ChevronDown
            className={cn(
              "h-5 w-5 shrink-0 text-muted-foreground transition-transform",
              deletedExpanded && "rotate-180"
            )}
          />
        </button>
        {deletedExpanded ? (
        <div className="border-t">
          {deletedLoading ? (
            <TableSkeleton columns={8} />
          ) : deletedUsers.length === 0 ? (
            <div className="py-10 text-center text-muted-foreground">No deleted users.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Avatar</TableHead>
                  <TableHead>Username</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Deleted</TableHead>
                  <TableHead>Posts</TableHead>
                  <TableHead>Matches</TableHead>
                  <TableHead>Messages</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deletedUsers.map((u) => {
                  const username = u.profile_snapshot?.username ?? "—"
                  const posts = u.usage_snapshot?.user_posts ?? 0
                  const matches = u.usage_snapshot?.user_matches ?? 0
                  const messages = u.usage_snapshot?.messages ?? 0
                  return (
                    <TableRow key={u.id}>
                      <TableCell className="pl-4">
                        <Avatar className="h-9 w-9">
                          <AvatarImage src={u.profile_snapshot?.avatar ?? ""} alt={username} />
                          <AvatarFallback>{String(username).slice(0, 2).toUpperCase()}</AvatarFallback>
                        </Avatar>
                      </TableCell>
                      <TableCell className="font-medium">{username}</TableCell>
                      <TableCell className="text-muted-foreground">{u.provider ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {u.deleted_at ? new Date(u.deleted_at).toLocaleString() : "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{posts}</TableCell>
                      <TableCell className="text-muted-foreground">{matches}</TableCell>
                      <TableCell className="text-muted-foreground">{messages}</TableCell>
                      <TableCell className="text-left">
                        <Button asChild variant="outline" size="sm">
                          <Link href={`/admin/users/${u.deleted_user_id}`} className="gap-2">
                            <Eye className="h-4 w-4" />
                            View
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </div>
        ) : null}
      </Card>
    </div>
  )
}
