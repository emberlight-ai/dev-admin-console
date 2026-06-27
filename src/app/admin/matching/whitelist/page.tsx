'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Star, ImageIcon, MessageSquare, Plus, BarChart3, RefreshCw, ArrowUp, ArrowDown, ArrowUpDown, Search } from 'lucide-react';
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
  totalMessages: number;
};

type SearchRow = { userid: string; username: string; avatar?: string | null };

type Gender = 'Female' | 'Male';

type SortKey = 'personality' | 'chatImagesCount' | 'matchCount' | 'totalMessages';
const NUMERIC_SORT_KEYS: SortKey[] = ['chatImagesCount', 'matchCount', 'totalMessages'];

function SortableHead({
  label,
  columnKey,
  active,
  dir,
  onSort,
  className,
}: {
  label: string;
  columnKey: SortKey;
  active: boolean;
  dir: 'asc' | 'desc';
  onSort: (key: SortKey) => void;
  className?: string;
}) {
  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={() => onSort(columnKey)}
        className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
      >
        {label}
        {active ? (
          dir === 'asc' ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />
        ) : (
          <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />
        )}
      </button>
    </TableHead>
  );
}

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

// ── Performance review ────────────────────────────────────────────────────────
type Verdict = 'great' | 'ok' | 'poor' | 'low data';
type PerfRow = {
  userid: string;
  username: string | null;
  gender: string | null;
  personality: string | null;
  whitelisted: boolean;
  likes: number;
  dislikes: number;
  total: number;
  likeRate: number | null;
  verdict: Verdict;
};
type CandidateRow = PerfRow & { tier: 'proven' | 'promising' };
type PerfResponse = {
  whitelisted: PerfRow[];
  candidates: CandidateRow[];
  suggestions: { demote: PerfRow[]; promote: PerfRow[] };
};

const pct = (r: number | null) => (r == null ? '—' : `${Math.round(r * 100)}%`);

function VerdictBadge({ verdict }: { verdict: Verdict }) {
  if (verdict === 'great')
    return <Badge className="bg-emerald-600 hover:bg-emerald-600">great</Badge>;
  if (verdict === 'poor')
    return <Badge className="bg-red-600 hover:bg-red-600">poor</Badge>;
  if (verdict === 'ok') return <Badge variant="secondary">ok</Badge>;
  return <Badge variant="outline" className="text-muted-foreground">low data</Badge>;
}

async function runSync(gender: Gender): Promise<{ promoted: number; demoted: number }> {
  const res = await fetch('/api/admin/matching/whitelist/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gender }),
  });
  const json = (await res.json()) as {
    promoted?: unknown[];
    demoted?: unknown[];
    error?: string;
  };
  if (!res.ok) throw new Error(json.error || 'Sync failed');
  return { promoted: json.promoted?.length ?? 0, demoted: json.demoted?.length ?? 0 };
}

function PerformanceReviewDialog({
  onApplied,
  pageGender,
}: {
  onApplied: () => void;
  pageGender: Gender;
}) {
  const [open, setOpen] = React.useState(false);
  const [reviewGender, setReviewGender] = React.useState<Gender>(pageGender);
  const [data, setData] = React.useState<PerfResponse | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [applying, setApplying] = React.useState(false);

  const fetchPerf = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/admin/matching/whitelist/performance?gender=${encodeURIComponent(reviewGender)}`
      );
      const json = (await res.json()) as PerfResponse & { error?: string };
      if (!res.ok) throw new Error(json.error || 'Failed to load performance');
      setData(json);
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : 'Failed to load performance');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [reviewGender]);

  React.useEffect(() => {
    if (open) void fetchPerf();
  }, [open, fetchPerf]);

  const suggestCount =
    (data?.suggestions.promote.length ?? 0) + (data?.suggestions.demote.length ?? 0);

  const apply = async () => {
    setApplying(true);
    try {
      const { promoted, demoted } = await runSync(reviewGender);
      toast.success(`Applied — promoted ${promoted}, demoted ${demoted}`);
      onApplied();
      await fetchPerf();
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setApplying(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setReviewGender(pageGender);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          <BarChart3 className="h-4 w-4" />
          Performance review
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden sm:max-w-3xl">
        <DialogXCloseButton />
        <DialogHeader>
          <DialogTitle>Swipe performance review</DialogTitle>
        </DialogHeader>

        <div className="px-4">
          <Tabs
            value={reviewGender}
            onValueChange={(v) => {
              if (v === 'Female' || v === 'Male') setReviewGender(v);
            }}
          >
            <TabsList>
              <TabsTrigger value="Female">Female</TabsTrigger>
              <TabsTrigger value="Male">Male</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {loading || !data ? (
          <div className="flex min-h-40 items-center justify-center p-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4 pt-0">
            {/* Suggested changes */}
            <div className="rounded-md border bg-muted/20 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">Suggested changes</div>
                  <div className="text-xs text-muted-foreground">
                    Promote {data.suggestions.promote.length} · Demote {data.suggestions.demote.length}
                  </div>
                </div>
                <Button onClick={apply} disabled={applying || suggestCount === 0} className="gap-2">
                  {applying ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                  {suggestCount === 0 ? 'Nothing to apply' : `Apply ${suggestCount} change${suggestCount === 1 ? '' : 's'}`}
                </Button>
              </div>
              {suggestCount > 0 ? (
                <div className="mt-3 grid gap-1.5 text-sm">
                  {data.suggestions.promote.map((r) => (
                    <div key={`p-${r.userid}`} className="flex items-center gap-2 text-emerald-700">
                      <ArrowUp className="h-3.5 w-3.5" /> Promote <span className="font-medium">{r.username}</span>
                      <span className="text-muted-foreground">· {r.personality ?? '—'} · {pct(r.likeRate)} ({r.total})</span>
                    </div>
                  ))}
                  {data.suggestions.demote.map((r) => (
                    <div key={`d-${r.userid}`} className="flex items-center gap-2 text-red-700">
                      <ArrowDown className="h-3.5 w-3.5" /> Demote <span className="font-medium">{r.username}</span>
                      <span className="text-muted-foreground">· {r.personality ?? '—'} · {pct(r.likeRate)} ({r.total})</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-2 text-xs text-muted-foreground">
                  Whitelist is healthy — no DH currently meets the promote/demote thresholds.
                </div>
              )}
            </div>

            {/* Whitelisted ranked */}
            <div>
              <div className="mb-2 text-sm font-medium">Whitelisted, by like-rate ({data.whitelisted.length})</div>
              <div className="overflow-hidden rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-3">DH</TableHead>
                      <TableHead>Personality</TableHead>
                      <TableHead className="text-right">Like rate</TableHead>
                      <TableHead className="text-right">L / D</TableHead>
                      <TableHead className="text-right pr-3">Verdict</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.whitelisted.map((r) => (
                      <TableRow key={r.userid}>
                        <TableCell className="pl-3 font-medium">{r.username}</TableCell>
                        <TableCell className="text-muted-foreground">{r.personality ?? '—'}</TableCell>
                        <TableCell className="text-right tabular-nums">{pct(r.likeRate)}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {r.likes} / {r.dislikes}
                        </TableCell>
                        <TableCell className="pr-3 text-right">
                          <VerdictBadge verdict={r.verdict} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>

            {/* Promotion candidates */}
            <div>
              <div className="mb-2 text-sm font-medium">
                Promotion candidates ({data.candidates.length})
              </div>
              <div className="overflow-hidden rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-3">DH</TableHead>
                      <TableHead>Personality</TableHead>
                      <TableHead className="text-right">Like rate</TableHead>
                      <TableHead className="text-right">Swipes</TableHead>
                      <TableHead className="text-right pr-3">Tier</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.candidates.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                          No non-whitelisted DHs with enough swipes yet.
                        </TableCell>
                      </TableRow>
                    ) : (
                      data.candidates.map((r) => (
                        <TableRow key={r.userid}>
                          <TableCell className="pl-3 font-medium">{r.username}</TableCell>
                          <TableCell className="text-muted-foreground">{r.personality ?? '—'}</TableCell>
                          <TableCell className="text-right tabular-nums">{pct(r.likeRate)}</TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">{r.total}</TableCell>
                          <TableCell className="pr-3 text-right">
                            {r.tier === 'proven' ? (
                              <Badge className="bg-emerald-600 hover:bg-emerald-600">proven</Badge>
                            ) : (
                              <Badge variant="outline">promising</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function MatchingWhitelistPage() {
  const router = useRouter();
  const [rows, setRows] = React.useState<Row[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [removingId, setRemovingId] = React.useState<string | null>(null);
  const [gender, setGender] = React.useState<Gender>('Female');
  const [sortKey, setSortKey] = React.useState<SortKey | null>('matchCount');
  const [sortDir, setSortDir] = React.useState<'asc' | 'desc'>('desc');
  const [query, setQuery] = React.useState('');
  // existingIds spans BOTH genders so the search can't re-offer an already-whitelisted DH.
  const existingIds = React.useMemo(() => new Set(rows.map((r) => r.userid)), [rows]);
  const visibleRows = React.useMemo(
    () => rows.filter((r) => (r.gender ?? '').toLowerCase() === gender.toLowerCase()),
    [rows, gender]
  );

  const sortedRows = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    let arr = q
      ? visibleRows.filter((r) => (r.username ?? '').toLowerCase().includes(q))
      : visibleRows;
    if (sortKey) {
      arr = [...arr].sort((a, b) => {
        const av = a[sortKey];
        const bv = b[sortKey];
        const cmp =
          sortKey === 'personality'
            ? String(av ?? '').localeCompare(String(bv ?? ''))
            : (Number(av) || 0) - (Number(bv) || 0);
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }
    return arr;
  }, [visibleRows, sortKey, sortDir, query]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(key);
    setSortDir(NUMERIC_SORT_KEYS.includes(key) ? 'desc' : 'asc');
  };

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
          <div className="flex items-center gap-3">
            <Tabs
              value={gender}
              onValueChange={(v) => {
                if (v === 'Female' || v === 'Male') setGender(v);
              }}
            >
              <TabsList>
                <TabsTrigger value="Female">Female</TabsTrigger>
                <TabsTrigger value="Male">Male</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="text-sm font-medium text-muted-foreground">
              {loading
                ? 'Loading…'
                : query.trim()
                  ? `${sortedRows.length} of ${visibleRows.length}`
                  : `${visibleRows.length} whitelisted`}
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by name…"
                className="h-9 w-56 pl-8"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <PerformanceReviewDialog onApplied={load} pageGender={gender} />
            <AddToWhitelistDialog existingIds={existingIds} onAdded={load} />
          </div>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Digital Human</TableHead>
              <SortableHead label="Personality" columnKey="personality" active={sortKey === 'personality'} dir={sortDir} onSort={toggleSort} />
              <SortableHead label="Chat Images" columnKey="chatImagesCount" active={sortKey === 'chatImagesCount'} dir={sortDir} onSort={toggleSort} />
              <SortableHead label="Matches" columnKey="matchCount" active={sortKey === 'matchCount'} dir={sortDir} onSort={toggleSort} />
              <SortableHead label="Total Messages" columnKey="totalMessages" active={sortKey === 'totalMessages'} dir={sortDir} onSort={toggleSort} />
              <TableHead className="text-right pr-4">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center">
                  <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
                </TableCell>
              </TableRow>
            ) : sortedRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                  {query.trim()
                    ? `No digital humans match “${query.trim()}”.`
                    : `No whitelisted ${gender.toLowerCase()} digital humans.`}
                </TableCell>
              </TableRow>
            ) : (
              sortedRows.map((r) => (
                <TableRow
                  key={r.userid}
                  className="cursor-pointer hover:bg-muted/20"
                  onClick={() => router.push(`/admin/digital-humans/${r.userid}`)}
                >
                  <TableCell className="pl-4">
                    <div className="flex items-center gap-2">
                      <Avatar className="h-9 w-9">
                        <AvatarImage
                          src={`/api/avatar/${r.userid}?v=${encodeURIComponent(r.updated_at || r.created_at || '')}`}
                          alt={r.username}
                        />
                        <AvatarFallback>{r.username?.slice(0, 2)?.toUpperCase()}</AvatarFallback>
                      </Avatar>
                      <span className="font-medium">{r.username || 'Unknown'}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{r.personality ?? '—'}</TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-1.5 text-muted-foreground tabular-nums">
                      <ImageIcon className="h-3.5 w-3.5" />
                      {r.chatImagesCount}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground tabular-nums">{r.matchCount}</TableCell>
                  <TableCell className="text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5 tabular-nums">
                      <MessageSquare className="h-3.5 w-3.5" />
                      {r.totalMessages}
                    </span>
                  </TableCell>
                  <TableCell className="text-right pr-4">
                    <div className="inline-flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                      {r.chatImagesCount === 0 ? (
                        <Badge variant="outline" className="text-amber-600 border-amber-300">
                          no selfies
                        </Badge>
                      ) : null}
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-destructive border-destructive/30 hover:bg-destructive hover:text-white"
                        onClick={(e) => {
                          e.stopPropagation();
                          remove(r.userid);
                        }}
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
