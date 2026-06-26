'use client';

import * as React from 'react';
import Link from 'next/link';
import { Eye, Loader2, Star, ImageIcon, Plus, BarChart3, RefreshCw, ArrowUp, ArrowDown } from 'lucide-react';
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
};

type SearchRow = { userid: string; username: string; avatar?: string | null };

type Gender = 'Female' | 'Male';

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
  const [rows, setRows] = React.useState<Row[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [removingId, setRemovingId] = React.useState<string | null>(null);
  const [syncing, setSyncing] = React.useState(false);
  const [gender, setGender] = React.useState<Gender>('Female');
  // existingIds spans BOTH genders so the search can't re-offer an already-whitelisted DH.
  const existingIds = React.useMemo(() => new Set(rows.map((r) => r.userid)), [rows]);
  const visibleRows = React.useMemo(
    () => rows.filter((r) => (r.gender ?? '').toLowerCase() === gender.toLowerCase()),
    [rows, gender]
  );

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

  const syncSuggested = async () => {
    if (
      !window.confirm(
        `Apply the suggested whitelist changes for ${gender} DHs? This promotes proven candidates and demotes underperformers based on real-user swipe rates.`
      )
    )
      return;
    setSyncing(true);
    try {
      const { promoted, demoted } = await runSync(gender);
      if (promoted === 0 && demoted === 0) {
        toast.info('No changes — the whitelist already matches the suggestions.');
      } else {
        toast.success(`Synced — promoted ${promoted}, demoted ${demoted}`);
      }
      await load();
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncing(false);
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
              {loading ? 'Loading…' : `${visibleRows.length} whitelisted`}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <PerformanceReviewDialog onApplied={load} pageGender={gender} />
            <Button variant="outline" className="gap-2" onClick={syncSuggested} disabled={syncing}>
              {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Sync suggested
            </Button>
            <AddToWhitelistDialog existingIds={existingIds} onAdded={load} />
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
            ) : visibleRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                  No whitelisted {gender.toLowerCase()} digital humans.
                </TableCell>
              </TableRow>
            ) : (
              visibleRows.map((r) => (
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
