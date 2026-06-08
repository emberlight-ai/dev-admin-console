'use client';

import * as React from 'react';
import Link from 'next/link';
import { Eye, Loader2, Star, ImageIcon } from 'lucide-react';
import { toast } from 'sonner';

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

type Row = {
  userid: string;
  username: string;
  avatar?: string | null;
  gender?: string | null;
  personality?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  chatImagesCount: number;
  matchCount: number;
};

export default function MatchingWhitelistPage() {
  const [rows, setRows] = React.useState<Row[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [removingId, setRemovingId] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/matching/whitelist');
      const json = (await res.json()) as { data?: Row[]; error?: string };
      if (!res.ok) throw new Error(json.error || 'Failed to load whitelist');
      setRows(json.data ?? []);
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : 'Failed to load whitelist');
    }
    setLoading(false);
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const remove = async (userid: string) => {
    setRemovingId(userid);
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(userid)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ whitelisted: false }),
      });
      if (!res.ok) throw new Error('Failed to remove from whitelist');
      setRows((prev) => prev.filter((r) => r.userid !== userid));
      toast.success('Removed from whitelist');
    } catch (err) {
      console.error(err);
      toast.error('Failed to remove from whitelist');
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <Star className="h-5 w-5 fill-amber-400 text-amber-400" />
          Whitelisted Digital Humans
        </h1>
        <p className="text-sm text-muted-foreground">
          Featured at the top of every eligible user&apos;s match deck. Toggle membership from a
          digital human&apos;s detail page.
        </p>
      </div>

      <div className="rounded-lg border bg-card">
        <div className="flex items-center justify-between border-b bg-muted/20 px-4 py-3">
          <div className="text-sm font-medium text-muted-foreground">
            {loading ? 'Loading…' : `${rows.length} whitelisted`}
          </div>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Digital Human</TableHead>
              <TableHead>Gender</TableHead>
              <TableHead>Personality</TableHead>
              <TableHead>Chat Images</TableHead>
              <TableHead>Matches</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center">
                  <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                  No whitelisted digital humans. Add some from a DH&apos;s detail page.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.userid} className="hover:bg-muted/20">
                  <TableCell className="pl-4">
                    <div className="flex items-center gap-2">
                      <Avatar className="h-9 w-9">
                        <AvatarImage
                          src={`/api/avatar/${r.userid}?v=${encodeURIComponent(r.updated_at || r.created_at || '')}`}
                          alt={r.username}
                        />
                        <AvatarFallback>{r.username?.slice(0, 2)?.toUpperCase()}</AvatarFallback>
                      </Avatar>
                      <Link
                        href={`/admin/digital-humans/${r.userid}`}
                        className="font-medium hover:underline"
                      >
                        {r.username || 'Unknown'}
                      </Link>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{r.gender ?? '—'}</TableCell>
                  <TableCell className="text-muted-foreground">{r.personality ?? '—'}</TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                      <ImageIcon className="h-3.5 w-3.5" />
                      {r.chatImagesCount}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{r.matchCount}</TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex items-center gap-2">
                      {r.chatImagesCount === 0 ? (
                        <Badge variant="outline" className="text-amber-600 border-amber-300">
                          no selfies
                        </Badge>
                      ) : null}
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/admin/digital-humans/${r.userid}`} className="gap-2">
                          <Eye className="h-4 w-4" />
                          Details
                        </Link>
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-destructive border-destructive/30 hover:bg-destructive hover:text-white"
                        onClick={() => remove(r.userid)}
                        disabled={removingId === r.userid}
                      >
                        {removingId === r.userid ? 'Removing…' : 'Remove'}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
