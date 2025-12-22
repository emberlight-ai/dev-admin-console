'use client';

import * as React from 'react';
import { ChevronsUpDown, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

export type PickUser = {
  userid: string;
  username: string;
  avatar?: string | null;
  is_digital_human?: boolean;
};

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0] ?? '?';
  const b = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (a + b).toUpperCase();
}

export function UserCombobox({
  value,
  onChange,
  placeholder = 'Search users…',
  emptyText = 'No users found.',
  searchUrlBase = '/api/admin/matching/users-search',
  className,
}: {
  value: PickUser | null;
  onChange: (user: PickUser | null) => void;
  placeholder?: string;
  emptyText?: string;
  searchUrlBase?: string;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [results, setResults] = React.useState<PickUser[]>([]);
  const abortRef = React.useRef<AbortController | null>(null);

  React.useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }

    const handle = window.setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setLoading(true);
      try {
        const url = new URL(searchUrlBase, window.location.origin);
        url.searchParams.set('q', q);
        url.searchParams.set('limit', '20');
        const res = await fetch(url.toString(), { signal: controller.signal });
        const json = (await res.json()) as { data?: PickUser[]; error?: string };
        if (!res.ok) throw new Error(json.error || 'Failed to search users');
        setResults(json.data ?? []);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        console.error(err);
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => window.clearTimeout(handle);
  }, [open, query, searchUrlBase]);

  const selectedLabel = value?.username?.trim() ? value.username : '';

  return (
    <div className={cn('w-full', className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <div className="flex w-full items-center gap-2">
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className="w-full flex-1 justify-between gap-2"
              aria-label="Select user"
            >
              <div className="flex min-w-0 items-center gap-2">
                {value ? (
                  <Avatar className="h-6 w-6">
                    <AvatarImage src={value.avatar ?? undefined} alt={value.username} />
                    <AvatarFallback>{initials(value.username)}</AvatarFallback>
                  </Avatar>
                ) : null}
                <span className={cn('truncate', !value && 'text-muted-foreground')}>
                  {value ? selectedLabel : placeholder}
                </span>
              </div>

              <ChevronsUpDown className="h-4 w-4 opacity-60" />
            </Button>
          </PopoverTrigger>

          {value ? (
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Clear selected user"
              onClick={() => {
                onChange(null);
                setQuery('');
                setResults([]);
              }}
            >
              <X className="h-4 w-4" />
            </Button>
          ) : null}
        </div>

        <PopoverContent className="w-[420px] p-3" align="start">
          <div className="space-y-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={placeholder}
              autoFocus
            />
            <ScrollArea className="h-72 rounded-md border">
              <div className="p-1">
                {loading ? (
                  <div className="p-3 text-sm text-muted-foreground">Searching…</div>
                ) : results.length ? (
                  results.map((u) => {
                    const active = value?.userid === u.userid;
                    return (
                      <button
                        key={u.userid}
                        type="button"
                        className={cn(
                          'w-full rounded-md px-2 py-2 text-left text-sm hover:bg-accent',
                          active && 'bg-accent'
                        )}
                        onClick={() => {
                          onChange(u);
                          setOpen(false);
                        }}
                      >
                        <div className="flex items-center gap-2">
                          <Avatar className="h-7 w-7">
                            <AvatarImage src={u.avatar ?? undefined} alt={u.username} />
                            <AvatarFallback>{initials(u.username)}</AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <div className="truncate font-medium">{u.username}</div>
                            <div className="truncate text-xs text-muted-foreground">{u.userid}</div>
                          </div>
                        </div>
                      </button>
                    );
                  })
                ) : (
                  <div className="p-3 text-sm text-muted-foreground">{emptyText}</div>
                )}
              </div>
            </ScrollArea>
            <div className="text-xs text-muted-foreground">
              Type at least 2 characters to search.
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}


