'use client';

import * as React from 'react';
import Link from 'next/link';
import { Check, Heart, Loader2, X as XIcon } from 'lucide-react';
import { toast } from 'sonner';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

type UserLite = {
  userid: string;
  username: string;
  avatar: string | null;
  is_digital_human: boolean;
};

type LeftSwipe = { swipe_id: string; created_at: string | null; target: UserLite | null };

type RightSwipe = {
  swipe_id: string;
  created_at: string | null;
  target: UserLite | null;
  status: 'pending' | 'matched' | 'declined';
  match_request_id: string | null;
  match_id: string | null;
};

type MatchEntry = { match_id: string; created_at: string | null; partner: UserLite | null };

type RelationshipsResponse = {
  left_swipes: LeftSwipe[];
  right_swipes: RightSwipe[];
  matches: MatchEntry[];
};

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0] ?? '?';
  const b = parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : '';
  return (a + b).toUpperCase();
}

function userDetailHref(u: UserLite | null) {
  if (!u) return '#';
  return u.is_digital_human ? `/admin/digital-humans/${u.userid}` : `/admin/users/${u.userid}`;
}

function UserCell({ user }: { user: UserLite | null }) {
  if (!user) return <span className="text-muted-foreground">Unknown user</span>;
  return (
    <Link
      href={userDetailHref(user)}
      className="inline-flex items-center gap-2 hover:underline"
    >
      <Avatar className="h-7 w-7">
        <AvatarImage src={`/api/avatar/${user.userid}`} alt={user.username} />
        <AvatarFallback className="text-xs">
          {initials(user.username || user.userid)}
        </AvatarFallback>
      </Avatar>
      <span className="truncate max-w-[180px]">{user.username || user.userid}</span>
      {user.is_digital_human ? (
        <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
          DH
        </Badge>
      ) : null}
    </Link>
  );
}

function StatusBadge({ status }: { status: RightSwipe['status'] }) {
  if (status === 'matched') {
    return <Badge className="bg-emerald-500 hover:bg-emerald-600">Matched</Badge>;
  }
  if (status === 'pending') {
    return <Badge variant="secondary">Pending</Badge>;
  }
  return (
    <Badge variant="outline" className="text-muted-foreground">
      Declined
    </Badge>
  );
}

interface SectionProps {
  icon: React.ReactNode;
  title: string;
  count: number;
  columns: { label: string; align?: 'left' | 'right' }[];
  empty: string;
  children: React.ReactNode;
}

function Section({ icon, title, count, columns, empty, children }: SectionProps) {
  const isEmpty = React.Children.count(children) === 0;
  return (
    <Card className="p-0">
      <div className="px-4 py-3 border-b flex items-center justify-between bg-muted/20">
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-sm font-medium">{title}</span>
        </div>
        <Badge variant="secondary" className="text-xs">
          {count}
        </Badge>
      </div>
      <div className="max-h-[320px] overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-background border-b z-10">
            <tr>
              {columns.map((c, i) => (
                <th
                  key={i}
                  className={`p-3 font-medium text-muted-foreground ${
                    c.align === 'right' ? 'text-right' : 'text-left'
                  }`}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isEmpty ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="p-6 text-center text-muted-foreground text-sm"
                >
                  {empty}
                </td>
              </tr>
            ) : (
              children
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

interface Props {
  rootUserId: string;
  rootIsDigitalHuman: boolean;
}

export function RelationshipsTable({ rootUserId, rootIsDigitalHuman }: Props) {
  const [data, setData] = React.useState<RelationshipsResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [acceptingId, setAcceptingId] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/admin/users/${encodeURIComponent(rootUserId)}/relationships`
      );
      const json = (await res.json()) as RelationshipsResponse & { error?: string };
      if (!res.ok) throw new Error(json.error ?? 'Failed to load relationships');
      setData({
        left_swipes: json.left_swipes ?? [],
        right_swipes: json.right_swipes ?? [],
        matches: json.matches ?? [],
      });
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : 'Failed to load relationships');
    }
    setLoading(false);
  }, [rootUserId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const handleAccept = async (matchRequestId: string) => {
    setAcceptingId(matchRequestId);
    try {
      const res = await fetch('/api/admin/matching/accept-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ match_request_id: matchRequestId }),
      });
      const json = (await res.json()) as { match_id?: string; error?: string };
      if (!res.ok) throw new Error(json.error ?? 'Failed to accept request');
      toast.success('Matched on behalf of digital human');
      await load();
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : 'Failed to accept request');
    } finally {
      setAcceptingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center p-6 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }
  if (!data) return null;

  return (
    <div className="space-y-4">
      <Section
        icon={<Heart className="h-4 w-4 text-rose-500" />}
        title="Right swipes"
        count={data.right_swipes.length}
        columns={[
          { label: 'User' },
          { label: 'Status' },
          { label: 'When' },
          { label: '', align: 'right' },
        ]}
        empty="No right swipes yet."
      >
        {data.right_swipes.map((r) => {
          const canAccept =
            !rootIsDigitalHuman &&
            !!r.target?.is_digital_human &&
            r.status === 'pending' &&
            !!r.match_request_id;
          return (
            <tr key={r.swipe_id} className="border-b last:border-0 hover:bg-muted/40">
              <td className="p-3">
                <UserCell user={r.target} />
              </td>
              <td className="p-3">
                <StatusBadge status={r.status} />
              </td>
              <td className="p-3 text-xs text-muted-foreground">
                {r.created_at ? new Date(r.created_at).toLocaleString() : '—'}
              </td>
              <td className="p-3 text-right">
                {canAccept ? (
                  <Button
                    size="sm"
                    className="h-7 bg-amber-500 hover:bg-amber-600 text-white"
                    onClick={() => handleAccept(r.match_request_id as string)}
                    disabled={acceptingId === r.match_request_id}
                  >
                    {acceptingId === r.match_request_id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <>
                        <Check className="h-3 w-3 mr-1" />
                        Accept as DH
                      </>
                    )}
                  </Button>
                ) : r.match_id ? (
                  <span className="text-xs text-muted-foreground font-mono">
                    {r.match_id.slice(0, 8)}…
                  </span>
                ) : null}
              </td>
            </tr>
          );
        })}
      </Section>

      <Section
        icon={<Heart className="h-4 w-4 text-emerald-500 fill-emerald-500" />}
        title="Matched"
        count={data.matches.length}
        columns={[
          { label: 'User' },
          { label: 'When' },
          { label: 'Match ID' },
        ]}
        empty="No matches yet."
      >
        {data.matches.map((m) => (
          <tr key={m.match_id} className="border-b last:border-0 hover:bg-muted/40">
            <td className="p-3">
              <UserCell user={m.partner} />
            </td>
            <td className="p-3 text-xs text-muted-foreground">
              {m.created_at ? new Date(m.created_at).toLocaleString() : '—'}
            </td>
            <td className="p-3 text-xs text-muted-foreground font-mono">
              {m.match_id.slice(0, 8)}…
            </td>
          </tr>
        ))}
      </Section>

      <Section
        icon={<XIcon className="h-4 w-4 text-muted-foreground" />}
        title="Left swipes"
        count={data.left_swipes.length}
        columns={[{ label: 'User' }, { label: 'When' }]}
        empty="No left swipes yet."
      >
        {data.left_swipes.map((l) => (
          <tr key={l.swipe_id} className="border-b last:border-0 hover:bg-muted/40">
            <td className="p-3">
              <UserCell user={l.target} />
            </td>
            <td className="p-3 text-xs text-muted-foreground">
              {l.created_at ? new Date(l.created_at).toLocaleString() : '—'}
            </td>
          </tr>
        ))}
      </Section>
    </div>
  );
}
