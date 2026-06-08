'use client';

import * as React from 'react';
import Link from 'next/link';
import { Eye, Loader2, Star, ImageIcon, Plus } from 'lucide-react';
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
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogXCloseButton,
} from '@/components/ui/dialog';

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

type SearchRow = { userid: string; username: string; avatar?: string | null };

function AddToWhitelistDialog({
  existingIds,
  onAdded,
}: {
  existingIds: Set<string>;
  onAdded: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState('');
  const [results, setResults] = React.useState<SearchRow[]>([]);
  const [searching, setSearching] = React.useState(false);
  const [addingId, setAddingId] = React.useState<string | null>(null);

  React.useEffect(() => {
    const term = q.trim();
    if (!term) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(
          `/api/admin/users?mode=search&q=${encodeURIComponent(term)}&is_digital_human=true&limit=20`
        );
        const json = (await res.json()) as { data?: SearchRow[]; error?: string };
        if (!res.ok) throw new Error(json.error || 'Search failed');
        setResults((json.data ?? []).filter((u) => !existingIds.has(u.userid)));
      } catch (err) {
        console.error(err);
        toast.error('Search failed');
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [q, existingIds]);

  const add = async (userid: string) => {
    setAddingId(userid);
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(userid)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ whitelisted: true }),
      });
      if (!res.ok) throw new Error('Failed to add to whitelist');
      setResults((prev) => prev.filter((r) => r.userid !== userid));
      toast.success('Added to whitelist');
      onAdded();
    } catch (err) {
      console.error(err);
      toast.error('Failed to add to whitelist');
    } finally {
      setAddingId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <Plus className="h-4 w-4" />
          Add to whitelist
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogXCloseButton />
        <DialogHeader>
          <DialogTitle>Add a digital human to the whitelist</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 p-4 pt-0">
          <div className="relative">
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search digital humans by name…"
              autoFocus
            />
            {searching && (
              <div className="absolute right-2 top-1/2 -translate-y-1/2">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            )}
          </div>
          {q.trim() ? (
            <div className="max-h-72 divide-y overflow-auto rounded-md border">
              {results.length === 0 && !searching ? (
                <div className="p-3 text-center text-sm text-muted-foreground">
                  No matching digital humans (or already whitelisted).
                </div>
              ) : (
                results.map((u) => (
                  <div key={u.userid} className="flex items-center justify-between gap-2 px-3 py-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <Avatar className="h-7 w-7">
                        <AvatarImage src={`/api/avatar/${u.userid}`} alt={u.username} />
                        <AvatarFallback>{u.username?.slice(0, 2)?.toUpperCase()}</AvatarFallback>
                      </Avatar>
                      <span className="truncate text-sm">{u.username || u.userid}</span>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={addingId === u.userid}
                      onClick={() => add(u.userid)}
                    >
                      {addingId === u.userid ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <>
                          <Plus className="mr-1 h-3 w-3" />
                          Add
                        </>
                      )}
                    </Button>
                  </div>
                ))
              )}
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function MatchingWhitelistPage() {
  const [rows, setRows] = React.useState<Row[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [removingId, setRemovingId] = React.useState<string | null>(null);
  const existingIds = React.useMemo(() => new Set(rows.map((r) => r.userid)), [rows]);

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
          <AddToWhitelistDialog existingIds={existingIds} onAdded={load} />
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
                        {removingId === r.userid ? 'Removing…' : 'Remove from whitelist'}
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
