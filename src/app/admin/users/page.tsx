'use client'

import * as React from "react"
import Link from "next/link"
import { format, subDays } from "date-fns"
import { Eye } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
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

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  Line,
  XAxis,
  YAxis,
} from "recharts"

type UserRow = {
  userid: string
  username: string
  gender?: string | null
  age?: number | null
  zipcode?: string | null
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

type Preset = "90" | "30" | "7"

function StatCard({
  title,
  value,
  deltaPct,
  subtitle,
}: {
  title: string
  value: string
  deltaPct: number
  subtitle: string
}) {
  const up = deltaPct >= 0
  return (
    <Card className="p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="text-sm text-muted-foreground">{title}</div>
        <div
          className={cn(
            "inline-flex items-center rounded-full border px-2 py-0.5 text-xs",
            up ? "text-foreground" : "text-foreground"
          )}
        >
          {up ? "+" : ""}
          {deltaPct.toFixed(1)}%
        </div>
      </div>
      <div className="mt-3 text-3xl font-semibold tracking-tight">{value}</div>
      <div className="mt-6 text-sm font-medium">{subtitle}</div>
    </Card>
  )
}

export default function ManageUsers() {
  const [users, setUsers] = React.useState<UserRow[]>([])
  const [loading, setLoading] = React.useState(true)
  const [deletedUsers, setDeletedUsers] = React.useState<DeletedUserRow[]>([])
  const [deletedLoading, setDeletedLoading] = React.useState(true)
  const [chartRows, setChartRows] = React.useState<
    { created_at: string; is_digital_human: boolean }[]
  >([])
  const [prevChartRows, setPrevChartRows] = React.useState<
    { created_at: string; is_digital_human: boolean }[]
  >([])
  const [preset, setPreset] = React.useState<Preset>("7")
  const [totalRealAllTime, setTotalRealAllTime] = React.useState<number>(0)
  const [earningsStats, setEarningsStats] = React.useState<{
    total_earnings_cents: number
    this_month_earnings_cents: number
  } | null>(null)
  const [purchases, setPurchases] = React.useState<
    {
      id: string
      userid: string
      plan_id: string
      amount_cents: number
      created_at: string
      username: string | null
      source?: string
      transaction_id?: string | null
      original_transaction_id?: string | null
      environment?: string | null
      product_id_apple?: string | null
    }[]
  >([])
  const [purchasesLoading, setPurchasesLoading] = React.useState(true)

  const range = React.useMemo<DateRange>(() => {
    const days = Number(preset)
    return { from: subDays(new Date(), days), to: new Date() }
  }, [preset])

  const fetchUsers = React.useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/admin/users?mode=list&is_digital_human=false")
      const json = (await res.json()) as { data?: UserRow[]; error?: string }
      if (!res.ok) throw new Error(json.error || "Failed to fetch users")
      setUsers((json.data ?? []) as UserRow[])
    } catch (err: unknown) {
      console.error(err)
      setUsers([])
    }
    setLoading(false)
  }, [])

  React.useEffect(() => {
    void fetchUsers()
  }, [fetchUsers])

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

  const fetchChartRows = React.useCallback(async () => {
    if (!range?.from || !range?.to) return
    const start = new Date(range.from)
    const end = new Date(range.to)
    // include entire end day
    const endInclusive = new Date(end.getTime() + 24 * 60 * 60 * 1000 - 1)

    try {
      const qs = new URLSearchParams({
        mode: "chart",
        created_from: start.toISOString(),
        created_to: endInclusive.toISOString(),
      })
      const res = await fetch(`/api/admin/users?${qs.toString()}`)
      const json = (await res.json()) as {
        data?: { created_at: string; is_digital_human: boolean }[]
        error?: string
      }
      if (!res.ok) throw new Error(json.error || "Failed to fetch chart rows")
      setChartRows((json.data ?? []) as { created_at: string; is_digital_human: boolean }[])
    } catch (err: unknown) {
      console.error(err)
      setChartRows([])
    }
  }, [range])

  React.useEffect(() => {
    void fetchChartRows()
  }, [fetchChartRows])

  const fetchPrevChartRows = React.useCallback(async () => {
    if (!range?.from || !range?.to) return
    const start = new Date(range.from)
    const end = new Date(range.to)
    const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)))
    const prevEndInclusive = new Date(start.getTime() - 1)
    const prevStart = new Date(start.getTime() - days * 24 * 60 * 60 * 1000)

    try {
      const qs = new URLSearchParams({
        mode: "chart",
        created_from: prevStart.toISOString(),
        created_to: prevEndInclusive.toISOString(),
      })
      const res = await fetch(`/api/admin/users?${qs.toString()}`)
      const json = (await res.json()) as {
        data?: { created_at: string; is_digital_human: boolean }[]
        error?: string
      }
      if (!res.ok) throw new Error(json.error || "Failed to fetch previous chart rows")
      setPrevChartRows((json.data ?? []) as { created_at: string; is_digital_human: boolean }[])
    } catch (err: unknown) {
      console.error(err)
      setPrevChartRows([])
    }
  }, [range])

  React.useEffect(() => {
    void fetchPrevChartRows()
  }, [fetchPrevChartRows])

  React.useEffect(() => {
    // Total revenue uses $10 per real user (all time)
    const run = async () => {
      try {
        const res = await fetch("/api/admin/users?mode=count&is_digital_human=false")
        const json = (await res.json()) as { count?: number; error?: string }
        if (!res.ok) throw new Error(json.error || "Failed to fetch user count")
        setTotalRealAllTime(json.count ?? 0)
      } catch (err: unknown) {
        console.error(err)
        setTotalRealAllTime(0)
      }
    }
    void run()
  }, [])

  React.useEffect(() => {
    const run = async () => {
      try {
        const res = await fetch("/api/admin/purchases/stats")
        const json = (await res.json()) as {
          data?: { total_earnings_cents?: number; this_month_earnings_cents?: number }
          error?: string
        }
        if (!res.ok) throw new Error(json.error || "Failed to fetch earnings")
        setEarningsStats({
          total_earnings_cents: json.data?.total_earnings_cents ?? 0,
          this_month_earnings_cents: json.data?.this_month_earnings_cents ?? 0,
        })
      } catch (err: unknown) {
        console.error(err)
        setEarningsStats(null)
      }
    }
    void run()
  }, [])

  React.useEffect(() => {
    const run = async () => {
      try {
        const res = await fetch("/api/admin/purchases")
        const json = (await res.json()) as {
          data?: {
            id: string
            userid: string
            plan_id: string
            amount_cents: number
            created_at: string
            username?: string | null
            source?: string
            transaction_id?: string | null
            original_transaction_id?: string | null
            environment?: string | null
            product_id_apple?: string | null
          }[]
          error?: string
        }
        if (!res.ok) throw new Error(json.error || "Failed to fetch purchases")
        setPurchases(
          (json.data ?? []).map((p) => ({
            id: p.id,
            userid: p.userid,
            plan_id: p.plan_id,
            amount_cents: p.amount_cents,
            created_at: p.created_at,
            username: p.username ?? null,
            source: p.source,
            transaction_id: p.transaction_id ?? null,
            original_transaction_id: p.original_transaction_id ?? null,
            environment: p.environment ?? null,
            product_id_apple: p.product_id_apple ?? null,
          }))
        )
      } catch (err: unknown) {
        console.error(err)
        setPurchases([])
      } finally {
        setPurchasesLoading(false)
      }
    }
    void run()
  }, [])

  const chartData = (() => {
    if (!range?.from || !range?.to) return []
    const start = new Date(range.from)
    const end = new Date(range.to)

    const days: Record<string, { real: number; digital: number }> = {}
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      days[format(d, "yyyy-MM-dd")] = { real: 0, digital: 0 }
    }

    for (const r of chartRows) {
      const dt = new Date(r.created_at)
      const key = format(dt, "yyyy-MM-dd")
      if (!(key in days)) continue
      if (r.is_digital_human) days[key].digital += 1
      else days[key].real += 1
    }

    return Object.keys(days)
      .sort()
      .map((date) => {
        return { date, real: days[date].real, digital: days[date].digital }
      })
  })()

  const summary = React.useMemo(() => {
    const currentReal = chartRows.filter((r) => !r.is_digital_human).length
    const currentDigital = chartRows.filter((r) => r.is_digital_human).length
    const prevReal = prevChartRows.filter((r) => !r.is_digital_human).length
    const prevDigital = prevChartRows.filter((r) => r.is_digital_human).length

    const pct = (curr: number, prev: number) => {
      if (prev === 0) return curr === 0 ? 0 : 100
      return ((curr - prev) / prev) * 100
    }

    const revenue = currentReal * 10
    const prevRevenue = prevReal * 10
    const growthRate = pct(currentReal + currentDigital, prevReal + prevDigital)

    return {
      currentReal,
      currentDigital,
      revenue,
      totalRevenue: totalRealAllTime * 10,
      pctReal: pct(currentReal, prevReal),
      pctDigital: pct(currentDigital, prevDigital),
      pctRevenue: pct(revenue, prevRevenue),
      growthRate,
    }
  }, [chartRows, prevChartRows, totalRealAllTime])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Manage Users</h1>
        <p className="text-sm text-muted-foreground">Track growth and view users (non-digital humans).</p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-5">
        <StatCard
          title="This month revenue"
          value={
            earningsStats != null
              ? `$${((earningsStats.this_month_earnings_cents ?? 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
              : "—"
          }
          deltaPct={0}
          subtitle="From subscription purchases (current calendar month, UTC)"
        />
        <StatCard
          title="Total revenue"
          value={
            earningsStats != null
              ? `$${((earningsStats.total_earnings_cents ?? 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
              : "—"
          }
          deltaPct={0}
          subtitle="From subscription purchases (all time)"
        />
        <StatCard
          title="New Customers"
          value={summary.currentReal.toLocaleString()}
          deltaPct={summary.pctReal}
          subtitle="Real users created in range"
        />
        <StatCard
          title="Digital Humans"
          value={summary.currentDigital.toLocaleString()}
          deltaPct={summary.pctDigital}
          subtitle="Digital humans created in range"
        />
        <StatCard
          title="Growth Rate"
          value={`${summary.growthRate.toFixed(1)}%`}
          deltaPct={summary.growthRate}
          subtitle="Versus previous period"
        />
      </div>

      <Card className="p-6">
        <div className="mb-3 flex items-start justify-between gap-4">
          <div>
            <div className="text-lg font-semibold tracking-tight">Total Visitors</div>
            <div className="text-sm text-muted-foreground">
              Daily creations for the selected range
            </div>
          </div>
          <Tabs value={preset} onValueChange={(v) => setPreset(v as Preset)}>
            <TabsList>
              <TabsTrigger value="90">Last 3 months</TabsTrigger>
              <TabsTrigger value="30">Last 30 days</TabsTrigger>
              <TabsTrigger value="7">Last 7 days</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <div className="h-[300px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ left: 8, right: 16, top: 8, bottom: 0 }}>
              <defs>
                <linearGradient id="fillReal" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.35} />
                  <stop offset="85%" stopColor="var(--primary)" stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="fillDigital" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--ring)" stopOpacity={0.25} />
                  <stop offset="85%" stopColor="var(--ring)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.7} />
              <XAxis
                dataKey="date"
                tickFormatter={(d) => format(new Date(d), "MMM dd")}
                stroke="var(--muted-foreground)"
              />
              <YAxis stroke="var(--muted-foreground)" />
              <Tooltip
                contentStyle={{
                  backgroundColor: "var(--popover)",
                  border: "1px solid var(--border)",
                  color: "var(--popover-foreground)",
                }}
              />
              <Area
                type="monotone"
                dataKey="digital"
                name="Digital humans"
                stroke="var(--ring)"
                strokeWidth={2}
                fill="url(#fillDigital)"
                dot={false}
                activeDot={{ r: 4 }}
              />
              <Area
                type="monotone"
                dataKey="real"
                name="Real humans"
                stroke="var(--primary)"
                strokeWidth={2}
                fill="url(#fillReal)"
                dot={false}
                activeDot={{ r: 4 }}
              />
              {/* keep Line import for future; Recharts legend not shown to match screenshot */}
              <Line type="monotone" dataKey="real" hide />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card className="p-0">
        <div className="p-6">
          <div className="text-sm font-medium">Purchases</div>
          <div className="text-xs text-muted-foreground">
            {purchasesLoading ? "Loading..." : `${purchases.length} purchase(s)`}
          </div>
        </div>
        <div className="border-t">
          {purchasesLoading ? (
            <div className="py-10 text-center text-muted-foreground">Loading...</div>
          ) : purchases.length === 0 ? (
            <div className="py-10 text-center text-muted-foreground">No purchases yet.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Avatar</TableHead>
                  <TableHead>Username</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Tx ID</TableHead>
                  <TableHead>Env</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {purchases.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="pl-4">
                      <Avatar className="h-9 w-9">
                        <AvatarImage src={`/api/avatar/${p.userid}`} alt={p.username ?? p.userid} />
                        <AvatarFallback>{(p.username ?? p.userid.slice(0, 8)).slice(0, 2).toUpperCase()}</AvatarFallback>
                      </Avatar>
                    </TableCell>
                    <TableCell className="font-medium">
                      {p.username ?? p.userid.slice(0, 8) + "…"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{p.plan_id}</TableCell>
                    <TableCell className="text-muted-foreground">
                      <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium">
                        {p.source ?? "—"}
                      </span>
                    </TableCell>
                    <TableCell className="font-mono text-muted-foreground text-xs max-w-[100px] truncate" title={p.transaction_id ?? undefined}>
                      {p.transaction_id ? p.transaction_id.slice(0, 12) + "…" : "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">{p.environment ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">
                      ${(p.amount_cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {format(new Date(p.created_at), "MMM d, yyyy HH:mm")}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/admin/users/${p.userid}`} className="gap-2">
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
            {loading ? "Loading..." : `${users.length} users`}
          </div>
        </div>
        <div className="border-t">
          {loading ? (
            <div className="py-10 text-center text-muted-foreground">Loading...</div>
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
                    <TableCell className="font-medium">{u.username}</TableCell>
                    <TableCell className="text-muted-foreground">{u.gender ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{u.age ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{u.zipcode ?? "—"}</TableCell>
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
        <div className="p-6">
          <div className="text-sm font-medium">Deleted Users</div>
          <div className="text-xs text-muted-foreground">
            {deletedLoading ? "Loading..." : `${deletedUsers.length} deleted users`}
          </div>
        </div>
        <div className="border-t">
          {deletedLoading ? (
            <div className="py-10 text-center text-muted-foreground">Loading...</div>
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
      </Card>
    </div>
  )
}
