'use client';

import * as React from 'react';
import { Send, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

type UserSearchResult = {
  userid: string;
  username: string;
  avatar?: string | null;
  is_digital_human?: boolean;
};

type SendResponse = {
  type?: 'match' | 'request' | 'queued';
  id?: string;
  greeting?: string | null;
  error?: string;
};

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/// Admin outreach: send an invitation from this digital human to a real user.
/// Goes through the production nearby-invitation pipeline (Gemini opener +
/// match_request with greeting + push), so what the admin sends is exactly what
/// users receive organically — and it renders properly on the iOS Likes page.
export function SendMatchRequestPanel({ fromUserId }: { fromUserId: string }) {
  const [searchQuery, setSearchQuery] = React.useState('');
  const [searching, setSearching] = React.useState(false);
  const [searchResults, setSearchResults] = React.useState<UserSearchResult[]>([]);
  // Per-row sending state, so multiple invites in flight don't fight over a
  // single boolean and the right button shows the spinner.
  const [pendingInviteUserId, setPendingInviteUserId] = React.useState<string | null>(null);
  /// The last few invitations sent this session, so the admin can see the
  /// generated opener without leaving the page.
  const [sentLog, setSentLog] = React.useState<
    Array<{ username: string; greeting: string | null; queued: boolean }>
  >([]);

  // Debounced search: short delay so typing feels responsive, no extra "Search"
  // button to click. Results land directly in the list below the input.
  React.useEffect(() => {
    const q = searchQuery.trim();
    if (!q) {
      setSearchResults([]);
      return;
    }

    const timeoutId = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(
          `/api/admin/users?mode=search&q=${encodeURIComponent(q)}&is_digital_human=false&limit=20`
        );
        const json = (await res.json()) as { data?: UserSearchResult[]; error?: string };
        if (!res.ok) throw new Error(json.error || 'Failed to search users');
        const results = (json.data ?? []).filter((u) => u.userid !== fromUserId);
        setSearchResults(results);
      } catch (err: unknown) {
        console.error(err);
        toast.error(err instanceof Error ? err.message : 'Failed to search users');
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [searchQuery, fromUserId]);

  const sendMatchRequest = React.useCallback(
    async (target: UserSearchResult) => {
      if (!target.userid) return;
      setPendingInviteUserId(target.userid);
      try {
        const res = await fetch('/api/admin/matching/send-match-request', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from_user_id: fromUserId,
            target_user_id: target.userid,
          }),
        });
        const json = (await res.json()) as SendResponse;
        if (!res.ok) throw new Error(json.error || 'Failed to send match request');

        const name = target.username || target.userid;
        if (json.type === 'match') {
          toast.success(`Already matched with ${name} — opened existing match`);
        } else if (json.type === 'queued') {
          toast.success(`Invitation to ${name} queued — sending within a minute`);
          setSentLog((prev) => [{ username: name, greeting: null, queued: true }, ...prev].slice(0, 8));
        } else {
          toast.success(
            json.greeting ? `Invitation sent: “${json.greeting}”` : `Invitation sent to ${name}`
          );
          setSentLog((prev) =>
            [{ username: name, greeting: json.greeting ?? null, queued: false }, ...prev].slice(0, 8)
          );
        }
        // Drop the just-invited user from the results so the admin can keep
        // inviting others without seeing duplicates. Keep the search query so
        // they can continue down the list.
        setSearchResults((prev) => prev.filter((u) => u.userid !== target.userid));
      } catch (err: unknown) {
        console.error(err);
        toast.error(err instanceof Error ? err.message : 'Failed to send match request');
      } finally {
        setPendingInviteUserId(null);
      }
    },
    [fromUserId]
  );

  return (
    <div className="space-y-4">
      <div>
        <div className="text-sm font-medium">Send an invitation</div>
        <p className="text-xs text-muted-foreground">
          Reaches out as this digital human through the real invitation pipeline: a
          Gemini-written opener plus a push, exactly like an organic nearby invite.
        </p>
      </div>

      <div className="relative">
        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search real user by username prefix…"
        />
        {searching && (
          <div className="absolute right-2 top-1/2 -translate-y-1/2">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        )}
      </div>

      {searchQuery.trim() ? (
        <div className="rounded-md border bg-background overflow-hidden">
          {searchResults.length === 0 && !searching ? (
            <div className="p-3 text-sm text-muted-foreground text-center">No users found.</div>
          ) : (
            <ul className="divide-y max-h-64 overflow-auto">
              {searchResults.map((u) => {
                const isPending = pendingInviteUserId === u.userid;
                return (
                  <li key={u.userid} className="flex items-center justify-between gap-2 px-3 py-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Avatar className="h-7 w-7 shrink-0">
                        <AvatarImage src={u.avatar ?? undefined} alt={u.username} />
                        <AvatarFallback className="text-xs">
                          {initials(u.username || u.userid)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-sm truncate">{u.username || u.userid}</span>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={isPending}
                      onClick={() => void sendMatchRequest(u)}
                    >
                      {isPending ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <>
                          <Send className="h-3 w-3 mr-1" />
                          Send
                        </>
                      )}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}

      {sentLog.length > 0 ? (
        <div className="space-y-2">
          <div className="text-xs font-medium uppercase text-muted-foreground">Sent this session</div>
          <ul className="space-y-1.5">
            {sentLog.map((entry, i) => (
              <li key={i} className="rounded-md border px-3 py-2 text-sm">
                <span className="font-medium">{entry.username}</span>
                <span className="text-muted-foreground">
                  {entry.queued
                    ? ' — queued, sends within a minute'
                    : entry.greeting
                      ? ` — “${entry.greeting}”`
                      : ' — sent'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
