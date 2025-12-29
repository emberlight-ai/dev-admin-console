'use client';

import * as React from 'react';
import { format, subMinutes, subHours, subDays } from 'date-fns';
import { Eye } from 'lucide-react';
import Link from 'next/link';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

type Preset = '15m' | '1h' | '1d';
type ViewTab = 'invites' | 'matches';

type Stats = {
  invites: {
    userToUser: number;
    userToDH: number;
    dhToUser: number;
  };
  matches: {
    userToUser: number;
    dhMatch: number;
  };
};

type ChartData = {
  invites: { created_at: string }[];
  matches: { created_at: string }[];
};

type InviteRow = {
  id: string;
  from_user_id: string;
  to_user_id: string;
  created_at: string;
  from_user: {
    userid: string;
    username: string;
    avatar: string | null;
    is_digital_human: boolean;
  } | null;
  to_user: {
    userid: string;
    username: string;
    avatar: string | null;
    is_digital_human: boolean;
  } | null;
};

type MatchRow = {
  id: string;
  user_a: string;
  user_b: string;
  created_at: string;
  user_a_data: {
    userid: string;
    username: string;
    avatar: string | null;
    is_digital_human: boolean;
  } | null;
  user_b_data: {
    userid: string;
    username: string;
    avatar: string | null;
    is_digital_human: boolean;
  } | null;
};

function StatCard({
  title,
  value,
  deltaPct,
  subtitle,
}: {
  title: string;
  value: string;
  deltaPct: number;
  subtitle: string;
}) {
  const up = deltaPct >= 0;
  return (
    <Card className="p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="text-sm text-muted-foreground">{title}</div>
        <div
          className={cn(
            'inline-flex items-center rounded-full border px-2 py-0.5 text-xs',
            up ? 'text-foreground' : 'text-foreground'
          )}
        >
          {up ? '+' : ''}
          {deltaPct.toFixed(1)}%
        </div>
      </div>
      <div className="mt-3 text-3xl font-semibold tracking-tight">{value}</div>
      <div className="mt-6 text-sm font-medium">{subtitle}</div>
    </Card>
  );
}

export default function MatchingGraphPage() {
  const [stats, setStats] = React.useState<Stats | null>(null);
  const [chartData, setChartData] = React.useState<ChartData | null>(null);
  const [prevChartData, setPrevChartData] = React.useState<ChartData | null>(null);
  const [preset, setPreset] = React.useState<Preset>('1h');
  const [viewTab, setViewTab] = React.useState<ViewTab>('invites');
  const [invites, setInvites] = React.useState<InviteRow[]>([]);
  const [matches, setMatches] = React.useState<MatchRow[]>([]);
  const [listLoading, setListLoading] = React.useState(true);

  const range = React.useMemo(() => {
    const now = new Date();
    switch (preset) {
      case '15m':
        return { from: subMinutes(now, 15), to: now };
      case '1h':
        return { from: subHours(now, 1), to: now };
      case '1d':
        return { from: subDays(now, 1), to: now };
    }
  }, [preset]);

  const fetchStats = React.useCallback(async () => {
    try {
      const qs = new URLSearchParams({
        mode: 'stats',
        preset: preset,
      });
      const res = await fetch(`/api/admin/matching/matchings?${qs.toString()}`);
      const json = (await res.json()) as { invites?: Stats['invites']; matches?: Stats['matches']; error?: string };
      if (!res.ok) throw new Error(json.error || 'Failed to fetch stats');
      if (json.invites && json.matches) {
        setStats({ invites: json.invites, matches: json.matches });
      }
    } catch (err: unknown) {
      console.error(err);
      setStats(null);
    }
  }, [preset]);

  React.useEffect(() => {
    void fetchStats();
    // Refresh stats every 30 seconds
    const interval = setInterval(() => {
      void fetchStats();
    }, 30000);
    return () => clearInterval(interval);
  }, [fetchStats]);

  const fetchChartData = React.useCallback(async () => {
    if (!range?.from || !range?.to) return;
    const start = new Date(range.from);
    const end = new Date(range.to);
    // Add a small buffer to include the end time, but not 24 hours
    const endInclusive = new Date(end.getTime() + 1000); // Add 1 second to be inclusive

    try {
      const qs = new URLSearchParams({
        mode: 'chart',
        created_from: start.toISOString(),
        created_to: endInclusive.toISOString(),
      });
      const res = await fetch(`/api/admin/matching/matchings?${qs.toString()}`);
      const json = (await res.json()) as { invites?: ChartData['invites']; matches?: ChartData['matches']; error?: string };
      if (!res.ok) throw new Error(json.error || 'Failed to fetch chart data');
      setChartData({ 
        invites: json.invites ?? [], 
        matches: json.matches ?? [] 
      });
    } catch (err: unknown) {
      console.error(err);
      setChartData(null);
    }
  }, [range]);

  React.useEffect(() => {
    void fetchChartData();
  }, [fetchChartData]);

  const fetchPrevChartData = React.useCallback(async () => {
    if (!range?.from || !range?.to) return;
    const start = new Date(range.from);
    const end = new Date(range.to);
    const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)));
    const prevEndInclusive = new Date(start.getTime() - 1);
    const prevStart = new Date(start.getTime() - days * 24 * 60 * 60 * 1000);

    try {
      const qs = new URLSearchParams({
        mode: 'chart',
        created_from: prevStart.toISOString(),
        created_to: prevEndInclusive.toISOString(),
      });
      const res = await fetch(`/api/admin/matching/matchings?${qs.toString()}`);
      const json = (await res.json()) as { invites?: ChartData['invites']; matches?: ChartData['matches']; error?: string };
      if (!res.ok) throw new Error(json.error || 'Failed to fetch previous chart data');
      if (json.invites && json.matches) {
        setPrevChartData({ invites: json.invites, matches: json.matches });
      }
    } catch (err: unknown) {
      console.error(err);
      setPrevChartData(null);
    }
  }, [range]);

  React.useEffect(() => {
    void fetchPrevChartData();
  }, [fetchPrevChartData]);

  const fetchList = React.useCallback(async () => {
    setListLoading(true);
    try {
      const res = await fetch('/api/admin/matching/matchings?mode=list&limit=100');
      const json = (await res.json()) as { invites?: InviteRow[]; matches?: MatchRow[]; error?: string };
      if (!res.ok) throw new Error(json.error || 'Failed to fetch list');
      setInvites((json.invites ?? []) as InviteRow[]);
      setMatches((json.matches ?? []) as MatchRow[]);
    } catch (err: unknown) {
      console.error(err);
      setInvites([]);
      setMatches([]);
    }
    setListLoading(false);
  }, []);

  React.useEffect(() => {
    void fetchList();
  }, [fetchList]);

  const processedChartData = React.useMemo(() => {
    if (!chartData || !range?.from || !range?.to) return [];
    const start = new Date(range.from);
    const end = new Date(range.to);

    // Determine time bucket size based on preset
    let bucketMinutes = 1;
    if (preset === '1d') bucketMinutes = 60; // 1 hour buckets for 1 day
    else if (preset === '1h') bucketMinutes = 5; // 5 minute buckets for 1 hour
    // 15m uses 1 minute buckets

    const bucketMs = bucketMinutes * 60 * 1000;
    
    // Helper function to get bucket key from a date
    const getBucketKey = (date: Date): string => {
      const floored = new Date(Math.floor(date.getTime() / bucketMs) * bucketMs);
      return format(floored, 'yyyy-MM-dd HH:mm');
    };

    const buckets: Record<string, { invites: number; matches: number }> = {};
    let current = new Date(start);
    const endTime = end.getTime();
    
    // Create buckets
    while (current.getTime() <= endTime) {
      const key = getBucketKey(current);
      buckets[key] = { invites: 0, matches: 0 };
      current = new Date(current.getTime() + bucketMs);
    }

    // Process invites - ensure we capture all data
    for (const invite of chartData.invites) {
      const dt = new Date(invite.created_at);
      const key = getBucketKey(dt);
      // If bucket doesn't exist, create it (data might be slightly outside range)
      if (!(key in buckets)) {
        buckets[key] = { invites: 0, matches: 0 };
      }
      buckets[key].invites += 1;
    }

    // Process matches - ensure we capture all data
    for (const match of chartData.matches) {
      const dt = new Date(match.created_at);
      const key = getBucketKey(dt);
      // If bucket doesn't exist, create it (data might be slightly outside range)
      if (!(key in buckets)) {
        buckets[key] = { invites: 0, matches: 0 };
      }
      buckets[key].matches += 1;
    }

    return Object.keys(buckets)
      .sort()
      .map((key) => ({
        time: key,
        invites: buckets[key].invites,
        matches: buckets[key].matches,
      }));
  }, [chartData, range, preset]);

  const filteredChartData = React.useMemo(() => {
    return processedChartData.map((item) => ({
      time: item.time,
      value: viewTab === 'invites' ? item.invites : item.matches,
      invites: item.invites,
      matches: item.matches,
    }));
  }, [processedChartData, viewTab]);

  const summary = React.useMemo(() => {
    if (!stats) {
      return {
        invitesUserToUser: 0,
        invitesUserToDH: 0,
        invitesDHToUser: 0,
        matchesUserToUser: 0,
        matchesDHMatch: 0,
        pctInvites: 0,
        pctMatches: 0,
      };
    }

    const currentInvites = chartData?.invites.length ?? 0;
    const currentMatches = chartData?.matches.length ?? 0;
    const prevInvites = prevChartData?.invites.length ?? 0;
    const prevMatches = prevChartData?.matches.length ?? 0;

    const pct = (curr: number, prev: number) => {
      if (prev === 0) return curr === 0 ? 0 : 100;
      return ((curr - prev) / prev) * 100;
    };

    return {
      invitesUserToUser: stats.invites.userToUser,
      invitesUserToDH: stats.invites.userToDH,
      invitesDHToUser: stats.invites.dhToUser,
      matchesUserToUser: stats.matches.userToUser,
      matchesDHMatch: stats.matches.dhMatch,
      pctInvites: pct(currentInvites, prevInvites),
      pctMatches: pct(currentMatches, prevMatches),
    };
  }, [stats, chartData, prevChartData]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Matchings</h1>
        <p className="text-sm text-muted-foreground">
          Track new matches and invites happening in real-time.
        </p>
      </div>

      <div className="flex items-center gap-4">
        <Tabs value={viewTab} onValueChange={(v) => setViewTab(v as ViewTab)}>
          <TabsList>
            <TabsTrigger value="invites">Invites</TabsTrigger>
            <TabsTrigger value="matches">Matches</TabsTrigger>
          </TabsList>
        </Tabs>
        <Tabs value={preset} onValueChange={(v) => setPreset(v as Preset)}>
          <TabsList>
            <TabsTrigger value="15m">Last 15 min</TabsTrigger>
            <TabsTrigger value="1h">Last 1 hour</TabsTrigger>
            <TabsTrigger value="1d">Last 1 day</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {viewTab === 'invites' ? (
          <>
            <StatCard
              title="User → User"
              value={summary.invitesUserToUser.toLocaleString()}
              deltaPct={summary.pctInvites}
              subtitle={`Real users to real users (${preset === '15m' ? '15 min' : preset === '1h' ? '1 hour' : '1 day'})`}
            />
            <StatCard
              title="User → Digital Human"
              value={summary.invitesUserToDH.toLocaleString()}
              deltaPct={summary.pctInvites}
              subtitle={`Real users to digital humans (${preset === '15m' ? '15 min' : preset === '1h' ? '1 hour' : '1 day'})`}
            />
            <StatCard
              title="Digital Human → User"
              value={summary.invitesDHToUser.toLocaleString()}
              deltaPct={summary.pctInvites}
              subtitle={`Digital humans to real users (${preset === '15m' ? '15 min' : preset === '1h' ? '1 hour' : '1 day'})`}
            />
          </>
        ) : (
          <>
            <StatCard
              title="Real Human Matches"
              value={summary.matchesUserToUser.toLocaleString()}
              deltaPct={summary.pctMatches}
              subtitle={`Both users are real humans (${preset === '15m' ? '15 min' : preset === '1h' ? '1 hour' : '1 day'})`}
            />
            <StatCard
              title="Digital Human Matches"
              value={summary.matchesDHMatch.toLocaleString()}
              deltaPct={summary.pctMatches}
              subtitle={`At least one party is a digital human (${preset === '15m' ? '15 min' : preset === '1h' ? '1 hour' : '1 day'})`}
            />
          </>
        )}
      </div>

      <Card className="p-6">
        <div className="mb-3">
          <div className="text-lg font-semibold tracking-tight">Activity Timeline</div>
          <div className="text-sm text-muted-foreground">
            {viewTab === 'invites' ? 'Invites' : 'Matches'} over time for the selected range
          </div>
        </div>

        <div className="h-[300px] w-full">
          {filteredChartData.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              No data available for the selected time range
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={filteredChartData} margin={{ left: 8, right: 16, top: 8, bottom: 0 }}>
                <defs>
                  <linearGradient id="fillInvites" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.35} />
                    <stop offset="85%" stopColor="var(--primary)" stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="fillMatches" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--ring)" stopOpacity={0.25} />
                    <stop offset="85%" stopColor="var(--ring)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.7} />
                <XAxis
                  dataKey="time"
                  tickFormatter={(d) => {
                    try {
                      // Parse the time string (format: "yyyy-MM-dd HH:mm")
                      const [datePart, timePart] = d.split(' ');
                      if (!datePart || !timePart) return d;
                      const [year, month, day] = datePart.split('-');
                      const [hour, minute] = timePart.split(':');
                      const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(minute));
                      
                      if (preset === '1d') return format(date, 'HH:mm');
                      if (preset === '1h') return format(date, 'HH:mm');
                      return format(date, 'HH:mm');
                    } catch {
                      return d;
                    }
                  }}
                  stroke="var(--muted-foreground)"
                />
                <YAxis stroke="var(--muted-foreground)" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--popover)',
                    border: '1px solid var(--border)',
                    color: 'var(--popover-foreground)',
                  }}
                />
                {viewTab === 'invites' ? (
                  <Area
                    type="monotone"
                    dataKey="value"
                    name="Invites"
                    stroke="var(--primary)"
                    strokeWidth={2}
                    fill="url(#fillInvites)"
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                ) : (
                  <Area
                    type="monotone"
                    dataKey="value"
                    name="Matches"
                    stroke="var(--ring)"
                    strokeWidth={2}
                    fill="url(#fillMatches)"
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                )}
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </Card>

      <Card className="p-0">
        <div className="p-6">
          <div className="text-sm font-medium">Recent Activity</div>
          <div className="text-xs text-muted-foreground">
            {listLoading
              ? 'Loading...'
              : viewTab === 'invites'
                ? `${invites.length} invites`
                : `${matches.length} matches`}
          </div>
        </div>
        <div className="border-t">
          {listLoading ? (
            <div className="py-10 text-center text-muted-foreground">Loading...</div>
          ) : viewTab === 'invites' ? (
            invites.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
                <div className="text-sm text-muted-foreground">No invites found.</div>
              </div>
            ) : (
              <div className="p-6">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-4">From User</TableHead>
                      <TableHead>To User</TableHead>
                      <TableHead>Time</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invites.slice(0, 50).map((invite) => (
                      <TableRow key={invite.id}>
                        <TableCell className="pl-4">
                          <div className="flex items-center gap-2">
                            <Avatar className="h-8 w-8">
                              <AvatarImage
                                src={invite.from_user?.avatar ? `/api/avatar/${invite.from_user.userid}` : undefined}
                                alt={invite.from_user?.username || 'Unknown'}
                              />
                              <AvatarFallback>
                                {invite.from_user?.username.slice(0, 2).toUpperCase() || '??'}
                              </AvatarFallback>
                            </Avatar>
                            <div>
                              <div className="font-medium">
                                {invite.from_user?.username || 'Unknown'}
                                {invite.from_user?.is_digital_human && (
                                  <span className="ml-2 text-xs text-muted-foreground">(DH)</span>
                                )}
                              </div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Avatar className="h-8 w-8">
                              <AvatarImage
                                src={invite.to_user?.avatar ? `/api/avatar/${invite.to_user.userid}` : undefined}
                                alt={invite.to_user?.username || 'Unknown'}
                              />
                              <AvatarFallback>
                                {invite.to_user?.username.slice(0, 2).toUpperCase() || '??'}
                              </AvatarFallback>
                            </Avatar>
                            <div>
                              <div className="font-medium">
                                {invite.to_user?.username || 'Unknown'}
                                {invite.to_user?.is_digital_human && (
                                  <span className="ml-2 text-xs text-muted-foreground">(DH)</span>
                                )}
                              </div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {new Date(invite.created_at).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-left">
                          <Button asChild variant="outline" size="sm">
                            <Link href={`/admin/users/${invite.from_user_id}`} className="gap-2">
                              <Eye className="h-4 w-4" />
                              View
                            </Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )
          ) : matches.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
              <div className="text-sm text-muted-foreground">No matches found.</div>
            </div>
          ) : (
            <div className="p-6">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">User A</TableHead>
                    <TableHead>User B</TableHead>
                    <TableHead>Time</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {matches.slice(0, 50).map((match) => (
                    <TableRow key={match.id}>
                      <TableCell className="pl-4">
                        <div className="flex items-center gap-2">
                          <Avatar className="h-8 w-8">
                            <AvatarImage
                              src={match.user_a_data?.avatar ? `/api/avatar/${match.user_a_data.userid}` : undefined}
                              alt={match.user_a_data?.username || 'Unknown'}
                            />
                            <AvatarFallback>
                              {match.user_a_data?.username.slice(0, 2).toUpperCase() || '??'}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <div className="font-medium">
                              {match.user_a_data?.username || 'Unknown'}
                              {match.user_a_data?.is_digital_human && (
                                <span className="ml-2 text-xs text-muted-foreground">(DH)</span>
                              )}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Avatar className="h-8 w-8">
                            <AvatarImage
                              src={match.user_b_data?.avatar ? `/api/avatar/${match.user_b_data.userid}` : undefined}
                              alt={match.user_b_data?.username || 'Unknown'}
                            />
                            <AvatarFallback>
                              {match.user_b_data?.username.slice(0, 2).toUpperCase() || '??'}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <div className="font-medium">
                              {match.user_b_data?.username || 'Unknown'}
                              {match.user_b_data?.is_digital_human && (
                                <span className="ml-2 text-xs text-muted-foreground">(DH)</span>
                              )}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {new Date(match.created_at).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-left">
                        <Button asChild variant="outline" size="sm">
                          <Link href={`/admin/users/${match.user_a}`} className="gap-2">
                            <Eye className="h-4 w-4" />
                            View
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
