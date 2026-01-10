'use client';

import * as React from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, RefreshCcw, MessageSquare } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';

type TrafficStats = {
  last_15m: number;
  last_1h: number;
  last_24h: number;
};

type UserDetails = {
  userid: string;
  username: string;
  is_digital_human: boolean;
  avatar?: string;
  personality?: string | null;
};

type RecentConversation = {
  match_id: string;
  last_message_at: string;
  last_message_sender_id: string;
  last_message_content: string;
  user_a_details: UserDetails;
  user_b_details: UserDetails;
};

export default function ChatTrafficPage() {
  const [stats, setStats] = React.useState<TrafficStats | null>(null);
  const [conversations, setConversations] = React.useState<RecentConversation[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);

  const fetchData = React.useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      const res = await fetch('/api/admin/matching/traffic');
      const json = await res.json();

      if (!res.ok) throw new Error(json.error || 'Failed to fetch traffic data');

      setStats(json.stats);
      setConversations(json.recent_conversations || []);
    } catch (error: unknown) {
      console.error(error);
      toast.error('Failed to load chat traffic.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  React.useEffect(() => {
    fetchData();
    // Optional: Auto-refresh every 30s
    const interval = setInterval(() => fetchData(true), 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const StatCard = ({ title, value, label }: { title: string; value: number | null; label: string }) => (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <MessageSquare className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value ?? '-'}</div>
        <p className="text-xs text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Chat Traffic</h1>
          <p className="text-muted-foreground">Monitor AI response volume and active conversations.</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => fetchData(true)}
          disabled={loading || refreshing}
        >
          <RefreshCcw className={`mr-2 h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard
          title="Last 15 Minutes"
          value={stats?.last_15m ?? null}
          label="AI Messages Sent"
        />
        <StatCard
          title="Last Hour"
          value={stats?.last_1h ?? null}
          label="AI Messages Sent"
        />
        <StatCard
          title="Last 24 Hours"
          value={stats?.last_24h ?? null}
          label="AI Messages Sent"
        />
      </div>

      <div className="rounded-md border">
        <div className="p-4 border-b bg-muted/40">
          <h3 className="font-semibold">Recent Active Conversations</h3>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Digital Human</TableHead>
              <TableHead>Personality</TableHead>
              <TableHead>User</TableHead>
              <TableHead>Last Message</TableHead>
              <TableHead>Time</TableHead>
              {/* <TableHead className="text-right">Actions</TableHead> */}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center">
                  <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
                </TableCell>
              </TableRow>
            ) : conversations.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                  No active conversations found.
                </TableCell>
              </TableRow>
            ) : (
              conversations.map((c) => {
                const userA = c.user_a_details;
                const userB = c.user_b_details;

                // Identify who is who
                // We assume one is bot, one is user. Or both users? logic handles bot-user matches.
                // find the bot
                const bot = userA?.is_digital_human ? userA : (userB?.is_digital_human ? userB : null);
                const user = userA?.is_digital_human ? userB : (userB?.is_digital_human ? userA : userA); // logic if both human? just show A as user

                // If both are bots or both humans (unlikely for AI Dashboard but possible in DB), handle gracefully

                const isSenderBot = c.last_message_sender_id === bot?.userid;

                return (
                  <TableRow key={c.match_id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <Avatar className="h-8 w-8">
                          <AvatarImage src={`/api/avatar/${bot?.userid}`} />
                          <AvatarFallback>{bot?.username?.substring(0, 2)}</AvatarFallback>
                        </Avatar>
                        {bot?.userid ? (
                          <Link
                            href={`/admin/digital-humans/${bot.userid}`}
                            className="hover:underline text-foreground"
                          >
                            {bot.username || 'Unknown Bot'}
                          </Link>
                        ) : (
                          <span>{bot?.username || 'Unknown Bot'}</span>
                        )}
                        <Badge variant="secondary" className="text-[10px] h-5">AI</Badge>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {bot?.personality || <span className="italic text-muted-foreground/60">—</span>}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Avatar className="h-8 w-8">
                          <AvatarImage src={`/api/avatar/${user?.userid}`} />
                          <AvatarFallback>{user?.username?.substring(0, 2)}</AvatarFallback>
                        </Avatar>
                        {user?.userid ? (
                          <Link
                            href={`/admin/users/${user.userid}`}
                            className="hover:underline text-foreground"
                          >
                            {user.username || 'Unknown User'}
                          </Link>
                        ) : (
                          <span>{user?.username || 'Unknown User'}</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="max-w-[300px] truncate text-sm text-muted-foreground">
                        <span className={isSenderBot ? "text-primary font-medium" : ""}>
                          {isSenderBot ? "AI: " : "User: "}
                        </span>
                        {c.last_message_content || "..."}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm whitespace-nowrap">
                      {c.last_message_at ? formatDistanceToNow(new Date(c.last_message_at), { addSuffix: true }) : '-'}
                    </TableCell>
                    {/* <TableCell className="text-right">
                       <Button variant="ghost" size="sm">View</Button>
                    </TableCell> */}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
