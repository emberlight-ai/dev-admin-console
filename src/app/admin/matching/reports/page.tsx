'use client';

import * as React from 'react';

import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
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

type UserLite = {
  userid: string;
  username: string;
  avatar?: string | null;
  is_digital_human?: boolean;
};

type PostLite = {
  id: string;
  description?: string | null;
  occurred_at?: string | null;
  created_at?: string | null;
};

type ReportRow = {
  id: string;
  reason?: string | null;
  created_at: string;
  target_post_id?: string | null;
  reporter?: UserLite | null;
  target_user?: UserLite | null;
  post?: PostLite | null;
};

type BlockRow = {
  id: string;
  created_at: string;
  blocker?: UserLite | null;
  blocked?: UserLite | null;
};

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0] ?? '?';
  const b = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (a + b).toUpperCase();
}

function UserCell({ user }: { user?: UserLite | null }) {
  if (!user) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex items-center gap-2">
      <Avatar className="h-7 w-7">
        <AvatarImage src={user.avatar ?? undefined} alt={user.username} />
        <AvatarFallback>{initials(user.username)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <div className="truncate font-medium">{user.username}</div>
        <div className="truncate text-xs text-muted-foreground">{user.userid}</div>
      </div>
    </div>
  );
}

export default function MatchingReportsPage() {
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [userReports, setUserReports] = React.useState<ReportRow[]>([]);
  const [postReports, setPostReports] = React.useState<ReportRow[]>([]);
  const [blocks, setBlocks] = React.useState<BlockRow[]>([]);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [reportsRes, blocksRes] = await Promise.all([
        fetch('/api/admin/matching/reports'),
        fetch('/api/admin/matching/blocks'),
      ]);

      const reportsJson = (await reportsRes.json()) as {
        userReports?: ReportRow[];
        postReports?: ReportRow[];
        error?: string;
      };
      if (!reportsRes.ok) throw new Error(reportsJson.error || 'Failed to load reports');

      const blocksJson = (await blocksRes.json()) as {
        blocks?: BlockRow[];
        error?: string;
      };
      if (!blocksRes.ok) throw new Error(blocksJson.error || 'Failed to load blocks');

      setUserReports(reportsJson.userReports ?? []);
      setPostReports(reportsJson.postReports ?? []);
      setBlocks(blocksJson.blocks ?? []);
    } catch (err) {
      console.error(err);
      setUserReports([]);
      setPostReports([]);
      setBlocks([]);
      setError(err instanceof Error ? err.message : 'Failed to load reports');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-2xl font-semibold tracking-tight">Reports</div>
          <div className="mt-1 text-sm text-muted-foreground">
            Simple view of user reports and post reports.
          </div>
        </div>
        <Button variant="outline" onClick={load} disabled={loading}>
          Refresh
        </Button>
      </div>

      {error ? (
        <Card className="p-4">
          <div className="text-sm text-destructive">{error}</div>
        </Card>
      ) : null}

      <Card className="p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="font-medium">Blocks</div>
          <div className="text-sm text-muted-foreground">{blocks.length}</div>
        </div>
        <div className="mt-3 overflow-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Blocker</TableHead>
                <TableHead>Blocked</TableHead>
                <TableHead className="whitespace-nowrap">Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {blocks.length ? (
                blocks.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="min-w-[260px]">
                      <UserCell user={b.blocker} />
                    </TableCell>
                    <TableCell className="min-w-[260px]">
                      <UserCell user={b.blocked} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {new Date(b.created_at).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={3} className="py-10 text-center text-sm text-muted-foreground">
                    No blocks.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      <Card className="p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="font-medium">User reports</div>
          <div className="text-sm text-muted-foreground">{userReports.length}</div>
        </div>
        <div className="mt-3 overflow-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reporter</TableHead>
                <TableHead>Target user</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead className="whitespace-nowrap">Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {userReports.length ? (
                userReports.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="min-w-[260px]">
                      <UserCell user={r.reporter} />
                    </TableCell>
                    <TableCell className="min-w-[260px]">
                      <UserCell user={r.target_user} />
                    </TableCell>
                    <TableCell className="min-w-[240px]">
                      <span className="text-sm">{r.reason || '—'}</span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {new Date(r.created_at).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={4} className="py-10 text-center text-sm text-muted-foreground">
                    No user reports.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      <Card className="p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="font-medium">Post reports</div>
          <div className="text-sm text-muted-foreground">{postReports.length}</div>
        </div>
        <div className="mt-3 overflow-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reporter</TableHead>
                <TableHead>Target user</TableHead>
                <TableHead>Post</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead className="whitespace-nowrap">Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {postReports.length ? (
                postReports.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="min-w-[260px]">
                      <UserCell user={r.reporter} />
                    </TableCell>
                    <TableCell className="min-w-[260px]">
                      <UserCell user={r.target_user} />
                    </TableCell>
                    <TableCell className="min-w-[220px]">
                      <div className="space-y-1">
                        <div className="font-mono text-xs text-muted-foreground">{r.target_post_id}</div>
                        {r.post?.description ? (
                          <div className="line-clamp-2 text-sm">{r.post.description}</div>
                        ) : null}
                        {r.post?.occurred_at ? (
                          <Badge variant="outline" className="text-xs">
                            occurred {new Date(r.post.occurred_at).toLocaleDateString()}
                          </Badge>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="min-w-[240px]">
                      <span className="text-sm">{r.reason || '—'}</span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {new Date(r.created_at).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                    No post reports.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}


