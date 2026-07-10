'use client';

import * as React from 'react';
import Link from 'next/link';
import { Eye, Search, Trash2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

type Row = {
  userid: string;
  username: string | null;
  gender?: string | null;
  age?: number | null;
  zipcode?: string | null;
  location_name?: string | null;
  avatar?: string | null;
  created_at: string;
  updated_at?: string | null;
};

const LIMIT = 50;

export default function RealHumansPage() {
  const [rows, setRows] = React.useState<Row[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [hasMore, setHasMore] = React.useState(true);
  const [premiumIds, setPremiumIds] = React.useState<Set<string>>(new Set());

  const [searchInput, setSearchInput] = React.useState('');
  const [query, setQuery] = React.useState('');

  const offsetRef = React.useRef(0);
  const observerTarget = React.useRef<HTMLDivElement | null>(null);

  // Premium tag: currently-active subscribers across all environments (not
  // date-restricted — reflects present state). Same source as /admin/users.
  React.useEffect(() => {
    fetch('/api/admin/subscriptions?environment=all')
      .then(async (res) => {
        const json = await res.json();
        if (res.ok) setPremiumIds(new Set<string>(json.premium_user_ids ?? []));
      })
      .catch(() => {});
  }, []);

  const fetchRows = React.useCallback(
    async (isLoadMore: boolean) => {
      if (isLoadMore) setLoadingMore(true);
      else setLoading(true);
      const offset = isLoadMore ? offsetRef.current : 0;
      try {
        const qs = new URLSearchParams({
          mode: 'list',
          is_digital_human: 'false',
          include_deleted: 'false',
          limit: String(LIMIT),
          offset: String(offset),
        });
        if (query) qs.set('q', query);
        const res = await fetch(`/api/admin/users?${qs.toString()}`);
        const json = (await res.json()) as { data?: Row[]; error?: string };
        if (!res.ok) throw new Error(json.error || 'Failed to load users');
        const newRows = json.data ?? [];
        setHasMore(newRows.length === LIMIT);
        offsetRef.current = offset + newRows.length;
        setRows((prev) => (isLoadMore ? [...prev, ...newRows] : newRows));
      } catch (err: unknown) {
        console.error(err);
        toast.error(err instanceof Error ? err.message : 'Failed to load users');
        if (!isLoadMore) setRows([]);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [query]
  );

  // Debounce the search box into `query`.
  React.useEffect(() => {
    const t = setTimeout(() => setQuery(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Refetch from the top whenever the query changes (and on mount).
  React.useEffect(() => {
    offsetRef.current = 0;
    setHasMore(true);
    void fetchRows(false);
  }, [fetchRows]);

  // Infinite scroll.
  React.useEffect(() => {
    const el = observerTarget.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loading && !loadingMore) {
          void fetchRows(true);
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, loading, loadingMore, fetchRows]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Real Humans</h1>
          <p className="text-sm text-muted-foreground">Browse and search real (non-bot) user accounts.</p>
        </div>
        <Button asChild variant="outline" size="icon" title="Deleted users (trash)">
          <Link href="/admin/deleted-users" aria-label="Deleted users">
            <Trash2 className="h-4 w-4" />
          </Link>
        </Button>
      </div>

      <div className="rounded-lg border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/20 px-4 py-3">
          <div className="text-sm font-medium text-muted-foreground">All real humans</div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search by name..."
              className="h-9 w-[220px] rounded-md border border-input bg-transparent pl-8 pr-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Avatar</TableHead>
                <TableHead>Username</TableHead>
                <TableHead>Gender</TableHead>
                <TableHead>Age</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                    <Loader2 className="mx-auto h-6 w-6 animate-spin" />
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                    {query ? `No users matching “${query}”.` : 'No real humans found.'}
                  </TableCell>
                </TableRow>
              ) : (
                <>
                  {rows.map((u) => (
                    <TableRow key={u.userid} className="hover:bg-muted/20">
                      <TableCell className="pl-4">
                        <Avatar className="h-9 w-9">
                          <AvatarImage src={`/api/avatar/${u.userid}`} alt={u.username ?? ''} />
                          <AvatarFallback>{(u.username ?? '??').slice(0, 2).toUpperCase()}</AvatarFallback>
                        </Avatar>
                      </TableCell>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <span>{u.username || '—'}</span>
                          {premiumIds.has(u.userid) ? (
                            <Badge className="bg-amber-500 text-amber-950 hover:bg-amber-600">Premium</Badge>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{u.gender ?? '—'}</TableCell>
                      <TableCell className="text-muted-foreground">{u.age ?? '—'}</TableCell>
                      <TableCell className="text-muted-foreground">{u.location_name || u.zipcode || '—'}</TableCell>
                      <TableCell className="text-muted-foreground">{new Date(u.created_at).toLocaleDateString()}</TableCell>
                      <TableCell className="text-right">
                        <Button asChild variant="outline" size="sm">
                          <Link href={`/admin/users/${u.userid}`} className="gap-2">
                            <Eye className="h-4 w-4" />
                            Details
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell colSpan={7} className="border-0 p-0">
                      <div ref={observerTarget} className="h-4 w-full" />
                    </TableCell>
                  </TableRow>
                  {loadingMore ? (
                    <TableRow>
                      <TableCell colSpan={7} className="py-4 text-center text-muted-foreground">
                        Loading more...
                      </TableCell>
                    </TableRow>
                  ) : null}
                </>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
