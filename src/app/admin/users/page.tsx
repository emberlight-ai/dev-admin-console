'use client'

import * as React from "react"
import { format, subDays } from "date-fns"
import { Calendar as CalendarIcon } from "lucide-react"

import { supabase } from "@/lib/supabase"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Calendar } from "@/components/ui/calendar"
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
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
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

import type { DateRange } from "react-day-picker"

export default function ManageUsers() {
  const [users, setUsers] = React.useState<UserRow[]>([])
  const [loading, setLoading] = React.useState(true)
  const [range, setRange] = React.useState<DateRange | undefined>({
    from: subDays(new Date(), 30),
    to: new Date(),
  })

  const fetchUsers = React.useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from("users")
      .select("userid,username,gender,age,zipcode,avatar,created_at")
      .eq("is_digital_human", false)
      .order("created_at", { ascending: false })

    if (error) {
      console.error(error)
      setUsers([])
    } else {
      setUsers((data as UserRow[]) ?? [])
    }
    setLoading(false)
  }, [])

  React.useEffect(() => {
    void fetchUsers()
  }, [fetchUsers])

  const chartData = (() => {
    if (!range?.from || !range?.to) return []
    const start = new Date(range.from)
    const end = new Date(range.to)

    const days: Record<string, number> = {}
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      days[format(d, "yyyy-MM-dd")] = 0
    }

    for (const u of users) {
      const dt = new Date(u.created_at)
      if (dt >= start && dt <= new Date(end.getTime() + 24 * 60 * 60 * 1000 - 1)) {
        const key = format(dt, "yyyy-MM-dd")
        if (key in days) days[key] += 1
      }
    }

    let total = 0
    return Object.keys(days)
      .sort()
      .map((date) => {
        total += days[date]
        return { date, users: total }
      })
  })()

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Manage Users</h1>
          <p className="text-sm text-muted-foreground">
            Track growth and view users (non-digital humans).
          </p>
        </div>

        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className={cn(
                "w-[260px] justify-start text-left font-normal",
                !range?.from && "text-muted-foreground"
              )}
            >
              <CalendarIcon className="mr-2 h-4 w-4" />
              {range?.from ? (
                range?.to ? (
                  <>
                    {format(range.from, "yyyy-MM-dd")} — {format(range.to, "yyyy-MM-dd")}
                  </>
                ) : (
                  format(range.from, "yyyy-MM-dd")
                )
              ) : (
                <span>Pick a date range</span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="end">
            <Calendar
              mode="range"
              selected={range}
              onSelect={setRange}
              numberOfMonths={2}
              defaultMonth={range?.from}
            />
          </PopoverContent>
        </Popover>
      </div>

      <Card className="p-6">
        <div className="mb-3">
          <div className="text-sm font-medium">User Growth (Cumulative)</div>
          <div className="text-xs text-muted-foreground">Based on created_at</div>
        </div>

        <div className="h-[300px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" />
              <YAxis stroke="hsl(var(--muted-foreground))" />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--popover))",
                  border: "1px solid hsl(var(--border))",
                  color: "hsl(var(--popover-foreground))",
                }}
              />
              <Line
                type="monotone"
                dataKey="users"
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
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
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Avatar</TableHead>
                <TableHead>Username</TableHead>
                <TableHead>Gender</TableHead>
                <TableHead>Age</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Joined</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                    Loading...
                  </TableCell>
                </TableRow>
              ) : users.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                    No users found.
                  </TableCell>
                </TableRow>
              ) : (
                users.map((u) => (
                  <TableRow key={u.userid}>
                    <TableCell>
                      <Avatar className="h-9 w-9">
                        <AvatarImage src={u.avatar ?? undefined} alt={u.username} />
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
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  )
}
