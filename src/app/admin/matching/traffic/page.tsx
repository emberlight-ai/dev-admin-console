'use client';

import * as React from 'react';
import Link from 'next/link';
import { endOfDay, format, formatDistanceToNow, isSameDay, startOfDay, subDays } from 'date-fns';
import type { DateRange } from 'react-day-picker';
import { CalendarDays, Eye, Loader2, MessageSquare, RefreshCcw, Users } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { toast } from 'sonner';

const QUICK_DAY_COUNT = 7;

function dayLabel(d: Date, today: Date): string {
  if (isSameDay(d, today)) return 'Today';
  if (isSameDay(d, subDays(today, 1))) return 'Yesterday';
  return format(d, 'MMM d');
}

type UserTraffic = {
  user_id: string;
  username: string | null;
  avatar: string | null;
  user_messages: number;
  dh_replies: number;
  active_conversations: number;
  last_active: string | null;
  in_cooldown: boolean;
};

type ConversationTraffic = {
  match_id: string;
  real_user_id: string;
  real_username: string | null;
  dh_user_id: string;
  dh_username: string | null;
  dh_personality: string | null;
  user_messages: number;
  dh_replies: number;
  total_messages: number;
  last_message_at: string | null;
  last_message_content: string | null;
};

type Overview = {
  active_users: number;
  user_messages: number;
  dh_replies: number;
  active_conversations: number;
};

function StatCard({ title, value, label, loading }: { title: string; value: number; label: string; loading: boolean }) {
  return (
    <Card className="p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="text-sm text-muted-foreground">{title}</div>
        <MessageSquare className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="mt-3 text-3xl font-semibold tracking-tight tabular-nums">
        {loading ? '—' : value.toLocaleString()}
      </div>
      <div className="mt-6 text-sm font-medium">{label}</div>
    </Card>
  );
}

function TableSkeleton({ columns, rows = 6 }: { columns: number; rows?: number }) {
  const widths = ['60%', '45%', '55%', '40%', '50%', '35%', '45%'];
  return (
    <TableBody>
      {Array.from({ length: rows }).map((_, r) => (
        <TableRow key={r}>
          {Array.from({ length: columns }).map((_, c) => (
            <TableCell key={c} className={c === 0 ? 'pl-4' : undefined}>
              {c === 1 ? (
                <div className="h-9 w-9 animate-pulse rounded-full bg-muted" />
              ) : (
                <div className="h-4 animate-pulse rounded bg-muted" style={{ width: widths[c % widths.length] }} />
              )}
            </TableCell>
          ))}
        </TableRow>
      ))}
    </TableBody>
  );
}

export default function ChatTrafficPage() {
  const [dateMode, setDateMode] = React.useState<'day' | 'range'>('day');
  const [selectedDay, setSelectedDay] = React.useState<Date>(() => startOfDay(new Date()));
  const [customRange, setCustomRange] = React.useState<DateRange | undefined>(undefined);
  const [calendarOpen, setCalendarOpen] = React.useState(false);

  const [overview, setOverview] = React.useState<Overview | null>(null);
  const [users, setUsers] = React.useState<UserTraffic[]>([]);
  const [conversations, setConversations] = React.useState<ConversationTraffic[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);

  const quickDays = React.useMemo(() => {
    const today = startOfDay(new Date());
    return Array.from({ length: QUICK_DAY_COUNT }, (_, i) => subDays(today, i));
  }, []);

  const range = React.useMemo<DateRange>(() => {
    if (dateMode === 'range' && customRange?.from) {
      return { from: startOfDay(customRange.from), to: endOfDay(customRange.to ?? customRange.from) };
    }
    return { from: startOfDay(selectedDay), to: endOfDay(selectedDay) };
  }, [dateMode, selectedDay, customRange]);

  const fetchData = React.useCallback(
    async (isRefresh = false) => {
      if (!range.from || !range.to) return;
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      try {
        const qs = new URLSearchParams({
          from: new Date(range.from).toISOString(),
          to: new Date(range.to).toISOString(),
        });
        const res = await fetch(`/api/admin/matching/traffic?${qs.toString()}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Failed to fetch traffic');
        setOverview(json.overview ?? null);
        setUsers(json.users ?? []);
        setConversations(json.conversations ?? []);
      } catch (err: unknown) {
        console.error(err);
        toast.error(err instanceof Error ? err.message : 'Failed to load chat traffic.');
        setOverview(null);
        setUsers([]);
        setConversations([]);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [range]
  );

  React.useEffect(() => {
    void fetchData();
  }, [fetchData]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Chat Traffic</h1>
          <p className="text-sm text-muted-foreground">
            Which real users are driving conversation volume (and AI-reply cost) in the selected range.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap items-center gap-1 rounded-md border p-1">
            {quickDays.map((d) => {
              const active = dateMode === 'day' && isSameDay(d, selectedDay);
              return (
                <button
                  key={d.toISOString()}
                  type="button"
                  onClick={() => {
                    setDateMode('day');
                    setSelectedDay(d);
                  }}
                  className={cn(
                    'rounded px-2.5 py-1 text-sm font-medium transition-colors',
                    active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'
                  )}
                >
                  {dayLabel(d, quickDays[0])}
                </button>
              );
            })}
            <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-sm font-medium transition-colors',
                    dateMode === 'range' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'
                  )}
                >
                  <CalendarDays className="h-3.5 w-3.5" />
                  {dateMode === 'range' && customRange?.from
                    ? `${format(customRange.from, 'MMM d')}${
                        customRange.to && !isSameDay(customRange.to, customRange.from)
                          ? ` – ${format(customRange.to, 'MMM d')}`
                          : ''
                      }`
                    : 'Custom range'}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <Calendar
                  mode="range"
                  numberOfMonths={2}
                  defaultMonth={subDays(new Date(), 1)}
                  selected={customRange}
                  onSelect={(r) => {
                    setCustomRange(r);
                    setDateMode('range');
                    if (r?.from && r?.to) setCalendarOpen(false);
                  }}
                  disabled={{ after: new Date() }}
                  autoFocus
                />
              </PopoverContent>
            </Popover>
          </div>
          <Button variant="outline" size="sm" onClick={() => fetchData(true)} disabled={loading || refreshing}>
            <RefreshCcw className={cn('mr-2 h-4 w-4', refreshing && 'animate-spin')} />
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <StatCard title="Active Users" value={overview?.active_users ?? 0} label="Real users who messaged" loading={loading} />
        <StatCard title="User Messages" value={overview?.user_messages ?? 0} label="Sent by real users" loading={loading} />
        <StatCard title="AI Replies" value={overview?.dh_replies ?? 0} label="Digital-human turns (cost driver)" loading={loading} />
        <StatCard title="Conversations" value={overview?.active_conversations ?? 0} label="Active in range" loading={loading} />
      </div>

      {/* Top users */}
      <Card className="p-0">
        <div className="flex flex-wrap items-center gap-2 p-6">
          <Users className="h-4 w-4 text-muted-foreground" />
          <div className="text-sm font-medium">Top users by traffic</div>
          <span className="text-xs text-muted-foreground">
            {loading ? 'Loading…' : `${users.length} active user${users.length === 1 ? '' : 's'} · sorted by messages sent`}
          </span>
        </div>
        <div className="overflow-x-auto border-t">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12 pl-4">#</TableHead>
                <TableHead>User</TableHead>
                <TableHead className="text-right">Messages sent</TableHead>
                <TableHead className="text-right">AI replies</TableHead>
                <TableHead className="text-right">Conversations</TableHead>
                <TableHead>Cooldown</TableHead>
                <TableHead>Last active</TableHead>
                <TableHead className="pr-4 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            {loading ? (
              <TableSkeleton columns={8} />
            ) : users.length === 0 ? (
              <TableBody>
                <TableRow>
                  <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                    No user traffic in this range.
                  </TableCell>
                </TableRow>
              </TableBody>
            ) : (
              <TableBody>
                {users.map((u, i) => (
                  <TableRow key={u.user_id}>
                    <TableCell className="pl-4 text-muted-foreground tabular-nums">{i + 1}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Avatar className="h-9 w-9">
                          <AvatarImage src={`/api/avatar/${u.user_id}`} alt={u.username ?? ''} />
                          <AvatarFallback>{(u.username ?? '??').slice(0, 2).toUpperCase()}</AvatarFallback>
                        </Avatar>
                        <span className="font-medium">{u.username || 'Unknown User'}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {u.user_messages.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {u.dh_replies.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {u.active_conversations.toLocaleString()}
                    </TableCell>
                    <TableCell>
                      {u.in_cooldown ? (
                        <Badge variant="outline" className="border-sky-500/50 text-sky-600 dark:text-sky-400">
                          Cooldown
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {u.last_active ? formatDistanceToNow(new Date(u.last_active), { addSuffix: true }) : '—'}
                    </TableCell>
                    <TableCell className="pr-4 text-right">
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/admin/users/${u.user_id}`} className="gap-2">
                          <Eye className="h-4 w-4" />
                          View
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            )}
          </Table>
        </div>
      </Card>

      {/* Busiest conversations */}
      <Card className="p-0">
        <div className="p-6">
          <div className="text-sm font-medium">Busiest conversations</div>
          <div className="text-xs text-muted-foreground">Top user ↔ digital-human threads by messages in range.</div>
        </div>
        <div className="overflow-x-auto border-t">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">User</TableHead>
                <TableHead>Digital Human</TableHead>
                <TableHead className="text-right">User</TableHead>
                <TableHead className="text-right">AI</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Last message</TableHead>
                <TableHead className="pr-4">When</TableHead>
              </TableRow>
            </TableHeader>
            {loading ? (
              <TableSkeleton columns={7} rows={4} />
            ) : conversations.length === 0 ? (
              <TableBody>
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                    No conversations in this range.
                  </TableCell>
                </TableRow>
              </TableBody>
            ) : (
              <TableBody>
                {conversations.map((c) => (
                  <TableRow key={c.match_id}>
                    <TableCell className="pl-4">
                      <Link
                        href={`/admin/users/${c.real_user_id}?tab=history`}
                        className="font-medium hover:underline"
                      >
                        {c.real_username || 'Unknown User'}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <Link href={`/admin/digital-humans/${c.dh_user_id}`} className="hover:underline">
                          {c.dh_username || 'Unknown'}
                        </Link>
                        <Badge variant="secondary" className="h-5 text-[10px]">AI</Badge>
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{c.user_messages}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{c.dh_replies}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{c.total_messages}</TableCell>
                    <TableCell className="max-w-[280px]">
                      <div className="truncate text-sm text-muted-foreground">{c.last_message_content || '…'}</div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap pr-4 text-sm text-muted-foreground">
                      {c.last_message_at ? formatDistanceToNow(new Date(c.last_message_at), { addSuffix: true }) : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            )}
          </Table>
        </div>
      </Card>
    </div>
  );
}
