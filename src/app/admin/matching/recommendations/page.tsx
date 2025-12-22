'use client';

import * as React from 'react';
import { Shuffle } from 'lucide-react';

import { UserCombobox, type PickUser } from '@/components/matching/user-combobox';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

type DigitalHumanRow = {
  userid: string;
  username: string;
  avatar?: string | null;
  profession?: string | null;
  gender?: string | null;
  personality?: string | null;
};

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0] ?? '?';
  const b = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (a + b).toUpperCase();
}

function hashToSeed(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function shuffleSeeded<T>(arr: T[], seed: number) {
  // xorshift32
  let x = (seed | 0) || 1;
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    const j = Math.abs(x) % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export default function MatchingRecommendationsPage() {
  const [user, setUser] = React.useState<PickUser | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [allDh, setAllDh] = React.useState<DigitalHumanRow[]>([]);
  const [nonce, setNonce] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);

  const loadDh = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/matching/digital-humans?limit=200');
      const json = (await res.json()) as { data?: DigitalHumanRow[]; error?: string };
      if (!res.ok) throw new Error(json.error || 'Failed to load digital humans');
      setAllDh(json.data ?? []);
    } catch (err) {
      console.error(err);
      setAllDh([]);
      setError(err instanceof Error ? err.message : 'Failed to load digital humans');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    // lazy load once; list is reused across user selections
    loadDh();
  }, [loadDh]);

  const recommended = React.useMemo(() => {
    if (!user) return [];
    const seed = hashToSeed(`${user.userid}:${nonce}`);
    const shuffled = shuffleSeeded(allDh, seed);
    return shuffled.slice(0, 12);
  }, [user, allDh, nonce]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-2xl font-semibold tracking-tight">Recommendations</div>
          <div className="mt-1 text-sm text-muted-foreground">
            Pick a real user, then we’ll generate a minimal MVP set of recommended Digital Humans (randomized).
          </div>
        </div>
        <Button
          variant="outline"
          onClick={() => setNonce((n) => n + 1)}
          disabled={!user || loading}
        >
          <Shuffle className="mr-2 h-4 w-4" />
          Shuffle
        </Button>
      </div>

      <Card className="p-4">
        <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-center">
          <div>
            <div className="text-sm font-medium">Select a real user</div>
            <div className="mt-2">
              <UserCombobox value={user} onChange={setUser} placeholder="Search real users…" />
            </div>
          </div>
          <div className="text-sm text-muted-foreground md:text-right">
            {loading ? 'Loading…' : `${allDh.length} digital humans loaded`}
          </div>
        </div>
      </Card>

      {error ? (
        <Card className="p-4">
          <div className="text-sm text-destructive">{error}</div>
        </Card>
      ) : null}

      {user ? (
        <div className="space-y-3">
          <div className="text-sm font-medium">
            Recommended for <span className="font-semibold">{user.username}</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {recommended.map((dh) => (
              <Card key={dh.userid} className="p-4">
                <div className="flex items-start gap-3">
                  <Avatar className="h-10 w-10">
                    <AvatarImage src={dh.avatar ?? undefined} alt={dh.username} />
                    <AvatarFallback>{initials(dh.username)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{dh.username}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {dh.profession ? <Badge variant="secondary">{dh.profession}</Badge> : null}
                      {dh.gender ? <Badge variant="outline">{dh.gender}</Badge> : null}
                      {dh.personality ? (
                        <Badge variant="outline" className={cn('opacity-80')}>
                          {dh.personality}
                        </Badge>
                      ) : null}
                    </div>
                    <div className="mt-2 truncate text-xs text-muted-foreground">{dh.userid}</div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      ) : (
        <Card className="p-6">
          <div className="text-sm text-muted-foreground">
            Select a user to see recommended digital humans.
          </div>
        </Card>
      )}
    </div>
  );
}


