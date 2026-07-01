'use client';

import * as React from 'react';
import { createClient } from '@supabase/supabase-js';
import { Send, Loader2, X, Minus, Bot, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Supabase env vars missing');
  return createClient(url, key);
}

interface Message {
  id: string;
  match_id: string;
  sender_id: string;
  content: string | null;
  media_url?: string | null;
  created_at: string;
}

interface UserLite {
  userid: string;
  username: string;
  avatar: string | null;
  is_digital_human: boolean;
}

interface TakeoverDockProps {
  matchId: string;
  /** The two people in this match; the dock resolves which is the digital human. */
  participantIds: string[];
  onClose: () => void;
}

function initials(name: string) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function fmtTime(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(d);
}

const MESSAGE_PAGE_SIZE = 100;
const MAX_MESSAGE_PAGES = 50;

export function TakeoverDock({ matchId, participantIds, onClose }: TakeoverDockProps) {
  const [dh, setDh] = React.useState<UserLite | null>(null);
  const [real, setReal] = React.useState<UserLite | null>(null);
  const [resolving, setResolving] = React.useState(true);
  const [notDhChat, setNotDhChat] = React.useState(false);

  const [messages, setMessages] = React.useState<Message[]>([]);
  const [loadingMsgs, setLoadingMsgs] = React.useState(true);
  const [inputText, setInputText] = React.useState('');
  const [sending, setSending] = React.useState(false);

  const [takeover, setTakeover] = React.useState(false);
  const [togglingTakeover, setTogglingTakeover] = React.useState(false);
  const [minimized, setMinimized] = React.useState(false);

  const scrollRef = React.useRef<HTMLDivElement>(null);
  // Typing indicator plumbing. dhIdRef mirrors `dh` so stable callbacks can read
  // it without a stale closure; the other two throttle outgoing "typing" pings.
  const dhIdRef = React.useRef<string | null>(null);
  const takeoverRef = React.useRef(false);
  const lastTypingAtRef = React.useRef<number>(0);
  const typingStopRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Resolve the DH/real sides + current takeover state, then auto-engage takeover.
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      setResolving(true);
      try {
        const supabase = getSupabase();
        const [{ data: users, error: usersErr }, stateRes] = await Promise.all([
          supabase
            .from('users')
            .select('userid, username, avatar, is_digital_human')
            .in('userid', participantIds),
          fetch(`/api/admin/chat/takeover?match_id=${encodeURIComponent(matchId)}`),
        ]);
        if (usersErr) throw usersErr;
        const stateJson = (await stateRes.json()) as {
          state?: { human_takeover: boolean; dh_user_id: string; real_user_id: string } | null;
          error?: string;
        };
        if (cancelled) return;

        const byId = new Map<string, UserLite>(
          (users ?? []).map((u) => [
            u.userid,
            {
              userid: u.userid,
              username: u.username,
              avatar: u.avatar ?? null,
              is_digital_human: Boolean(u.is_digital_human),
            },
          ])
        );

        // Prefer the authoritative ids from ai_state; fall back to the is_digital_human flag.
        let dhId = stateJson.state?.dh_user_id ?? null;
        let realId = stateJson.state?.real_user_id ?? null;
        if (!dhId || !realId) {
          const dhUser = [...byId.values()].find((u) => u.is_digital_human) ?? null;
          const realUser = [...byId.values()].find((u) => !u.is_digital_human) ?? null;
          dhId = dhUser?.userid ?? null;
          realId = realUser?.userid ?? null;
        }

        if (!dhId || !realId) {
          setNotDhChat(true);
          return;
        }

        setDh(byId.get(dhId) ?? null);
        setReal(byId.get(realId) ?? null);

        const already = Boolean(stateJson.state?.human_takeover);
        setTakeover(already);
        // Engaging takeover on open is the whole point: pause the bot so the
        // operator can speak for the DH without being talked over.
        if (!already && stateJson.state) {
          void setTakeoverState(true);
        }
      } catch (err: unknown) {
        if (!cancelled) toast.error(err instanceof Error ? err.message : 'Failed to open takeover');
      } finally {
        if (!cancelled) setResolving(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId]);

  // Load history (newest-first pages, flipped for chronological display).
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingMsgs(true);
      const supabase = getSupabase();
      const all: Message[] = [];
      try {
        for (let page = 0; page < MAX_MESSAGE_PAGES; page += 1) {
          const { data, error } = await supabase.rpc('rpc_get_messages', {
            match_id: matchId,
            start_index: page * MESSAGE_PAGE_SIZE,
            limit_count: MESSAGE_PAGE_SIZE,
          });
          if (error) throw error;
          const pageMessages = (data ?? []) as Message[];
          all.push(...pageMessages);
          if (pageMessages.length < MESSAGE_PAGE_SIZE) break;
        }
        if (!cancelled) setMessages(all.reverse());
      } catch (err: unknown) {
        if (!cancelled) toast.error(err instanceof Error ? err.message : 'Failed to load messages');
      } finally {
        if (!cancelled) setLoadingMsgs(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [matchId]);

  // Realtime: append incoming messages (the real user's replies land here live).
  React.useEffect(() => {
    const supabase = getSupabase();
    const channel = supabase
      .channel(`takeover:${matchId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `match_id=eq.${matchId}` },
        (payload) => {
          const m = payload.new as Message;
          setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [matchId]);

  React.useEffect(() => {
    if (!minimized) scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, minimized]);

  React.useEffect(() => {
    dhIdRef.current = dh?.userid ?? null;
  }, [dh]);

  React.useEffect(() => {
    takeoverRef.current = takeover;
  }, [takeover]);

  // On close (unmount): hand control back to the AI and clear the typing
  // indicator, so closing the dock resumes the bot. Raw fire-and-forget fetches
  // (no setState) so they still land after the component is gone.
  React.useEffect(() => {
    return () => {
      if (typingStopRef.current) clearTimeout(typingStopRef.current);
      if (dhIdRef.current) {
        void fetch('/api/admin/chat/typing', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ match_id: matchId, dh_user_id: dhIdRef.current, typing: false }),
        }).catch(() => {});
      }
      if (takeoverRef.current) {
        void fetch('/api/admin/chat/takeover', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ match_id: matchId, active: false }),
        }).catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Safety net for tab-close / navigation, where the unmount cleanup may not run:
  // release takeover via sendBeacon so a match is never left silently paused.
  React.useEffect(() => {
    const onBeforeUnload = () => {
      if (!takeoverRef.current) return;
      const blob = new Blob([JSON.stringify({ match_id: matchId, active: false })], {
        type: 'application/json',
      });
      navigator.sendBeacon('/api/admin/chat/takeover', blob);
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function setTakeoverState(active: boolean) {
    setTogglingTakeover(true);
    try {
      const res = await fetch('/api/admin/chat/takeover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ match_id: matchId, active }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(json.error || 'Failed to update takeover');
      setTakeover(active);
      // Handing control back to the AI should also clear any lingering "Typing…".
      if (!active) stopTyping();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to update takeover');
    } finally {
      setTogglingTakeover(false);
    }
  }

  function sendTyping(typing: boolean) {
    const dhId = dhIdRef.current;
    if (!dhId) return;
    void fetch('/api/admin/chat/typing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ match_id: matchId, dh_user_id: dhId, typing }),
    }).catch(() => {});
  }

  function stopTyping() {
    if (typingStopRef.current) {
      clearTimeout(typingStopRef.current);
      typingStopRef.current = null;
    }
    if (lastTypingAtRef.current) {
      lastTypingAtRef.current = 0;
      sendTyping(false);
    }
  }

  // Called on each keystroke. Broadcasts "typing=true" at most once per 2s (which
  // doubles as the heartbeat that keeps the app's indicator alive) and schedules a
  // "typing=false" after a short idle gap. Only while you actually hold control.
  function handleTypingActivity() {
    if (!takeover || !canSend) return;
    const now = Date.now();
    if (now - lastTypingAtRef.current >= 2000) {
      sendTyping(true);
      lastTypingAtRef.current = now;
    }
    if (typingStopRef.current) clearTimeout(typingStopRef.current);
    typingStopRef.current = setTimeout(() => {
      typingStopRef.current = null;
      lastTypingAtRef.current = 0;
      sendTyping(false);
    }, 4000);
  }

  async function handleSend() {
    const text = inputText.trim();
    if (!text || !dh || !real || sending) return;
    setSending(true);
    try {
      const supabase = getSupabase();
      const { data, error } = await supabase.rpc('rpc_send_message', {
        match_id: matchId,
        content: text,
        media_url: null,
        sender_id: dh.userid,
        receiver_id: real.userid,
      });
      if (error) throw error;
      const newMsg = data as Message;
      setMessages((prev) => (prev.some((m) => m.id === newMsg.id) ? prev : [...prev, newMsg]));
      setInputText('');
      stopTyping();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to send message');
    } finally {
      setSending(false);
    }
  }

  const canSend = Boolean(dh && real) && !notDhChat;

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[380px] max-w-[calc(100vw-2rem)] rounded-xl border bg-background shadow-xl flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-2">
        <Avatar className="h-8 w-8 shrink-0">
          <AvatarImage src={dh?.avatar ?? undefined} alt={dh?.username ?? 'DH'} />
          <AvatarFallback className="text-xs">{initials(dh?.username ?? 'DH')}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-sm font-medium truncate">
            <Bot className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            {dh?.username ?? (resolving ? 'Loading…' : 'Digital human')}
          </div>
          <div className="text-[11px] text-muted-foreground truncate">
            replying to {real?.username ?? '—'}
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          title={minimized ? 'Expand' : 'Minimize'}
          onClick={() => setMinimized((v) => !v)}
        >
          <Minus className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          title="Close"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {!minimized && (
        <>
          {/* Takeover status bar */}
          <div className="flex items-center justify-between gap-2 border-b bg-background px-3 py-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <ShieldCheck className={cn('h-3.5 w-3.5 shrink-0', takeover ? 'text-emerald-600' : 'text-muted-foreground')} />
              <Badge variant={takeover ? 'default' : 'secondary'} className="text-[10px]">
                {takeover ? 'AI paused — you have control' : 'AI active'}
              </Badge>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              disabled={togglingTakeover || notDhChat}
              onClick={() => void setTakeoverState(!takeover)}
            >
              {togglingTakeover ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : takeover ? (
                'Hand back to AI'
              ) : (
                'Take over'
              )}
            </Button>
          </div>

          {/* Messages */}
          <ScrollArea className="h-[360px]">
            <div className="flex flex-col gap-2 p-3">
              {notDhChat ? (
                <div className="py-10 text-center text-xs text-muted-foreground">
                  Takeover is only available for chats that include a digital human.
                </div>
              ) : loadingMsgs ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : messages.length === 0 ? (
                <div className="py-10 text-center text-xs text-muted-foreground">No messages yet.</div>
              ) : (
                messages.map((msg) => {
                  const mine = dh ? msg.sender_id === dh.userid : false;
                  return (
                    <div key={msg.id} className={cn('flex w-full', mine ? 'justify-end' : 'justify-start')}>
                      <div
                        className={cn(
                          'max-w-[82%] rounded-2xl px-3 py-1.5 text-sm break-words',
                          mine ? 'bg-primary text-primary-foreground rounded-br-sm' : 'bg-muted text-foreground rounded-bl-sm'
                        )}
                      >
                        {msg.media_url && (
                          <a href={msg.media_url} target="_blank" rel="noreferrer">
                            <img src={msg.media_url} alt="attachment" className="mb-1 max-h-40 max-w-full rounded-md object-cover" />
                          </a>
                        )}
                        {msg.content && <div>{msg.content}</div>}
                        <div className={cn('mt-0.5 text-[10px] leading-none', mine ? 'text-primary-foreground/70' : 'text-muted-foreground')}>
                          {fmtTime(msg.created_at)}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={scrollRef} />
            </div>
          </ScrollArea>

          {/* Composer */}
          <div className="flex items-center gap-2 border-t bg-background p-2">
            <Input
              value={inputText}
              onChange={(e) => {
                setInputText(e.target.value);
                handleTypingActivity();
              }}
              placeholder={canSend ? `Message as ${dh?.username ?? 'the DH'}…` : 'Unavailable'}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void handleSend();
                }
              }}
              disabled={!canSend || sending}
            />
            <Button
              type="button"
              size="icon"
              className="shrink-0"
              disabled={!canSend || sending || !inputText.trim()}
              onClick={() => void handleSend()}
              title="Send"
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
          {takeover && (
            <div className="px-3 pb-2 text-[10px] text-muted-foreground">
              AI paused while you have control — closing this chat hands it back.
            </div>
          )}
        </>
      )}
    </div>
  );
}
