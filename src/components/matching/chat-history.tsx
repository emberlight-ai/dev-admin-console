'use client';

import * as React from 'react';
import { createClient } from '@supabase/supabase-js';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Send,
  Loader2,
  Copy,
  Image as ImageIcon,
  X,
  Volume2,
  VolumeX,
  Bot,
  ChevronLeft,
  ExternalLink,
  ImagePlus,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

// Helper to get a client that definitely has the keys from the env
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
  receiver_id?: string | null;
  content: string;
  media_url?: string | null;
  intimacy_score?: number | null;
  created_at: string;
}

interface ChatHistoryProps {
  currentUserId: string;
  /** Whether the profile this page belongs to is a digital human. */
  currentUserIsDigitalHuman?: boolean;
}

/** One row from rpc_admin_user_conversations, already sorted by message count. */
interface Conversation {
  match_id: string;
  partner_id: string;
  username: string | null;
  avatar: string | null;
  is_digital_human: boolean;
  message_count: number;
  dh_muted: boolean;
}

interface CooldownStatus {
  active: boolean;
  reason: string;
  entered_at: string;
}

interface SelfieInventoryItem {
  id: string;
  public_url: string;
  ordinal: number;
  image_tier: 'casual' | 'tease' | 'reward' | 'unspecified';
  caption: string | null;
  already_sent: boolean;
}

/** Detail page for a partner: DHs have their own console section. */
function partnerHref(partner: Pick<Conversation, 'partner_id' | 'is_digital_human'>) {
  return partner.is_digital_human
    ? `/admin/digital-humans/${partner.partner_id}`
    : `/admin/users/${partner.partner_id}`;
}

function formatIntimacyScore(score?: number | null) {
  if (typeof score !== 'number' || !Number.isFinite(score)) return null;
  return Math.abs(score) < 10 ? score.toFixed(2) : score.toFixed(0);
}

function formatMessageTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

const MESSAGE_PAGE_SIZE = 100;
const MAX_MESSAGE_PAGES = 50;

const downsampleImage = (file: File, maxWidth = 1200): Promise<File> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject('Canvas ctx null');
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob((blob) => {
          if (!blob) return reject('Blob null');
          const newFile = new File([blob], file.name, {
            type: 'image/jpeg',
            lastModified: Date.now(),
          });
          resolve(newFile);
        }, 'image/jpeg', 0.7);
      };
      img.onerror = reject;
      img.src = e.target?.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

const TIER_BADGE_CLASS: Record<SelfieInventoryItem['image_tier'], string> = {
  casual: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
  tease: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30',
  reward: 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30',
  unspecified: 'bg-muted text-muted-foreground border-border',
};

// ── Send-image picker: the DH's preserved selfies for this conversation ────────
function SelfiePickerDialog({
  open,
  onOpenChange,
  matchId,
  dhName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  matchId: string;
  dhName: string;
}) {
  const [images, setImages] = React.useState<SelfieInventoryItem[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [sending, setSending] = React.useState(false);
  const [tierFilter, setTierFilter] = React.useState<'all' | SelfieInventoryItem['image_tier']>('all');

  React.useEffect(() => {
    if (!open) return;
    setSelectedId(null);
    setTierFilter('all');
    setLoading(true);
    fetch(`/api/admin/chat/selfie?match_id=${encodeURIComponent(matchId)}`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Failed to load images');
        setImages((json.images ?? []) as SelfieInventoryItem[]);
      })
      .catch((err: unknown) => {
        toast.error(err instanceof Error ? err.message : 'Failed to load images');
        setImages([]);
      })
      .finally(() => setLoading(false));
  }, [open, matchId]);

  const visible = images.filter((img) => tierFilter === 'all' || img.image_tier === tierFilter);
  const selected = images.find((img) => img.id === selectedId) ?? null;

  const handleSend = async () => {
    if (!selected) return;
    setSending(true);
    try {
      const res = await fetch('/api/admin/chat/selfie', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ match_id: matchId, image_id: selected.id }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to send image');
      toast.success(`Photo sent as ${dhName}`);
      onOpenChange(false);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to send image');
    }
    setSending(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Send a photo as {dhName}</DialogTitle>
          <DialogDescription>
            {dhName}&apos;s preserved selfies. Photos already sent in this conversation are marked —
            sending records the ledger, so the bot never re-sends them either.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-1.5">
          {(['all', 'casual', 'tease', 'reward', 'unspecified'] as const).map((tier) => (
            <button
              key={tier}
              type="button"
              onClick={() => setTierFilter(tier)}
              className={cn(
                'rounded-full border px-2.5 py-0.5 text-xs capitalize transition-colors',
                tierFilter === tier ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground hover:bg-muted'
              )}
            >
              {tier}
            </button>
          ))}
        </div>

        <ScrollArea className="h-[46dvh]">
          {loading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : visible.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">
              No {tierFilter === 'all' ? '' : `${tierFilter} `}photos in this digital human&apos;s inventory.
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 p-1 sm:grid-cols-3">
              {visible.map((img) => (
                <button
                  key={img.id}
                  type="button"
                  onClick={() => setSelectedId(img.id === selectedId ? null : img.id)}
                  className={cn(
                    'group relative overflow-hidden rounded-md border text-left transition-shadow',
                    selectedId === img.id && 'ring-2 ring-primary'
                  )}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.public_url}
                    alt={img.caption ?? `pic ${img.ordinal}`}
                    className={cn('aspect-square w-full object-cover', img.already_sent && 'opacity-45')}
                  />
                  <div className="absolute left-1.5 top-1.5 flex gap-1">
                    <Badge variant="outline" className={cn('border text-[10px] capitalize backdrop-blur', TIER_BADGE_CLASS[img.image_tier])}>
                      {img.image_tier}
                    </Badge>
                  </div>
                  {img.already_sent && (
                    <div className="absolute right-1.5 top-1.5">
                      <Badge variant="secondary" className="text-[10px]">Sent</Badge>
                    </div>
                  )}
                  {img.caption ? (
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-1.5 pt-4 text-[10px] leading-tight text-white line-clamp-2">
                      {img.caption}
                    </div>
                  ) : null}
                </button>
              ))}
            </div>
          )}
        </ScrollArea>

        <DialogFooter className="items-center gap-2 sm:justify-between">
          <div className="text-xs text-muted-foreground">
            {selected
              ? selected.already_sent
                ? 'Heads up: this photo was already sent in this conversation.'
                : `Sending a ${selected.image_tier} photo.`
              : 'Pick a photo to send.'}
          </div>
          <Button type="button" disabled={!selected || sending} onClick={() => void handleSend()}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
            Send photo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── The conversation pane: history + takeover-aware composer ───────────────────
function ChatInterface({
  matchId,
  pageUserId,
  pageUserIsDh,
  partner,
}: {
  matchId: string;
  pageUserId: string;
  pageUserIsDh: boolean;
  partner: Conversation;
}) {
  const [messages, setMessages] = React.useState<Message[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [inputText, setInputText] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [imageFile, setImageFile] = React.useState<File | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const dragDepthRef = React.useRef(0);

  // Which side of the match do we operate? Always the digital human. On a DH's
  // own page that's the page user; on a real user's page it's the DH partner.
  const dhSideId = pageUserIsDh ? pageUserId : partner.is_digital_human ? partner.partner_id : null;
  const receiverId = pageUserIsDh ? partner.partner_id : pageUserId;
  const dhSideName = pageUserIsDh ? 'this digital human' : partner.username ?? 'the digital human';
  const canSend = Boolean(dhSideId);

  // Takeover: focusing the composer pauses the bot (human_takeover) so it never
  // talks over the operator; leaving the conversation hands control back.
  const [takeover, setTakeover] = React.useState(false);
  const [togglingTakeover, setTogglingTakeover] = React.useState(false);
  const takeoverRef = React.useRef(false);
  const lastTypingAtRef = React.useRef(0);
  const typingStopRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    takeoverRef.current = takeover;
  }, [takeover]);

  // Reflect any takeover already engaged elsewhere (another admin/tab).
  React.useEffect(() => {
    if (!canSend) return;
    fetch(`/api/admin/chat/takeover?match_id=${encodeURIComponent(matchId)}`)
      .then(async (res) => {
        const json = await res.json();
        if (res.ok) setTakeover(Boolean(json.state?.human_takeover));
      })
      .catch(() => {});
  }, [matchId, canSend]);

  const sendTyping = React.useCallback(
    (typing: boolean) => {
      if (!dhSideId) return;
      void fetch('/api/admin/chat/typing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ match_id: matchId, dh_user_id: dhSideId, typing }),
      }).catch(() => {});
    },
    [matchId, dhSideId]
  );

  const stopTyping = React.useCallback(() => {
    if (typingStopRef.current) {
      clearTimeout(typingStopRef.current);
      typingStopRef.current = null;
    }
    if (lastTypingAtRef.current) {
      lastTypingAtRef.current = 0;
      sendTyping(false);
    }
  }, [sendTyping]);

  const setTakeoverState = React.useCallback(
    async (active: boolean) => {
      if (!canSend) return;
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
        if (!active) stopTyping();
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : 'Failed to update takeover');
      } finally {
        setTogglingTakeover(false);
      }
    },
    [matchId, canSend, stopTyping]
  );

  // Leaving the conversation (switch/unmount) hands control back to the AI and
  // clears any lingering typing indicator. Fire-and-forget: must land after
  // unmount. beforeunload covers tab close, where cleanup never runs.
  React.useEffect(() => {
    const release = () => {
      if (!takeoverRef.current) return;
      const blob = new Blob([JSON.stringify({ match_id: matchId, active: false })], {
        type: 'application/json',
      });
      navigator.sendBeacon('/api/admin/chat/takeover', blob);
    };
    window.addEventListener('beforeunload', release);
    return () => {
      window.removeEventListener('beforeunload', release);
      if (typingStopRef.current) clearTimeout(typingStopRef.current);
      release();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId]);

  // Keystroke → throttled "typing" heartbeat (only while holding control).
  const handleTypingActivity = () => {
    if (!takeoverRef.current || !canSend) return;
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
  };

  const acceptImageFile = async (file: File | undefined | null) => {
    if (!file || !file.type.startsWith('image/')) return;
    try {
      const compressed = await downsampleImage(file);
      setImageFile(compressed);
      if (!takeoverRef.current && canSend) void setTakeoverState(true);
    } catch (err) {
      toast.error('Failed to process image');
      console.error(err);
    }
  };

  // Fetch the full history. The RPC returns newest-first pages capped at 100,
  // so page through all rows and flip once for chronological display.
  React.useEffect(() => {
    const fetchMessages = async () => {
      setLoading(true);
      const supabase = getSupabase();
      const allMessages: Message[] = [];
      try {
        for (let page = 0; page < MAX_MESSAGE_PAGES; page += 1) {
          const { data, error } = await supabase.rpc('rpc_get_messages', {
            match_id: matchId,
            start_index: page * MESSAGE_PAGE_SIZE,
            limit_count: MESSAGE_PAGE_SIZE,
          });
          if (error) throw error;
          const pageMessages = (data ?? []) as Message[];
          allMessages.push(...pageMessages);
          if (pageMessages.length < MESSAGE_PAGE_SIZE) break;
        }
        setMessages(allMessages.reverse());
      } catch (err: unknown) {
        toast.error('Failed to load messages');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchMessages();
  }, [matchId]);

  // Subscribe to Realtime
  React.useEffect(() => {
    const supabase = getSupabase();
    const channel = supabase
      .channel(`chat:${matchId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `match_id=eq.${matchId}` },
        (payload) => {
          const newMsg = payload.new as Message;
          setMessages((prev) => (prev.some((msg) => msg.id === newMsg.id) ? prev : [...prev, newMsg]));
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [matchId]);

  // Auto-scroll to bottom
  React.useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  const handleSend = async () => {
    if (!canSend || !dhSideId) return;
    if (!inputText.trim() && !imageFile) return;
    setSending(true);
    try {
      let mediaUrl = null;
      if (imageFile) {
        const formData = new FormData();
        formData.append('files', imageFile);
        formData.append('match_id', matchId);
        const res = await fetch('/api/admin/chat/media', { method: 'POST', body: formData });
        if (!res.ok) {
          const errJson = await res.json();
          throw new Error(errJson.error || 'Failed to upload image');
        }
        const json = await res.json();
        mediaUrl = json.media_url;
      }

      const supabase = getSupabase();
      const { data, error } = await supabase.rpc('rpc_send_message', {
        match_id: matchId,
        content: inputText.trim() || null,
        media_url: mediaUrl,
        sender_id: dhSideId,
        receiver_id: receiverId,
      });
      if (error) throw error;

      setMessages((prev) => {
        const newMsg = data as Message;
        return prev.some((msg) => msg.id === newMsg.id) ? prev : [...prev, newMsg];
      });
      setInputText('');
      setImageFile(null);
      stopTyping();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to send message.');
      console.error(err);
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className="relative flex h-[70dvh] flex-col rounded-md border lg:h-[720px]"
      onDragEnter={(e) => {
        if (!canSend || !e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        dragDepthRef.current += 1;
        setDragging(true);
      }}
      onDragOver={(e) => {
        if (!canSend) return;
        e.preventDefault();
      }}
      onDragLeave={() => {
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
        if (dragDepthRef.current === 0) setDragging(false);
      }}
      onDrop={(e) => {
        if (!canSend) return;
        e.preventDefault();
        dragDepthRef.current = 0;
        setDragging(false);
        void acceptImageFile(e.dataTransfer.files?.[0]);
      }}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-md border-2 border-dashed border-primary bg-background/80">
          <div className="flex items-center gap-2 text-sm font-medium">
            <ImageIcon className="h-5 w-5" />
            Drop image to attach — it sends as {dhSideName}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between border-b bg-muted/30 p-3">
        <span className="text-sm font-medium">
          Chatting with <span className="text-primary">{partner.username || 'Partner'}</span>
        </span>
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          Match ID
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="ml-1 h-5 w-5"
            title="Copy Match ID"
            onClick={() => {
              navigator.clipboard.writeText(matchId);
              toast.success('Copied Match ID!');
            }}
          >
            <Copy className="h-3 w-3 text-muted-foreground" />
          </Button>
        </span>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 p-4">
          {loading ? (
            <div className="flex justify-center p-4">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : messages.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">No messages yet.</div>
          ) : (
            messages.map((msg) => {
              const isMe = msg.sender_id === pageUserId;
              const intimacyScore = formatIntimacyScore(msg.intimacy_score);
              const timestamp = formatMessageTimestamp(msg.created_at);
              return (
                <div key={msg.id} className={cn('flex w-full', isMe ? 'justify-end' : 'justify-start')}>
                  <div
                    className={cn(
                      'flex max-w-[80%] flex-col gap-2 break-words rounded-lg px-3 py-2 text-sm',
                      isMe ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'
                    )}
                  >
                    {msg.media_url && (
                      <a href={msg.media_url} target="_blank" rel="noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={msg.media_url} alt="attachment" className="max-h-48 max-w-full rounded-md object-cover" />
                      </a>
                    )}
                    {msg.content && <div>{msg.content}</div>}
                    <div className="flex flex-wrap items-center gap-1.5">
                      {timestamp && (
                        <span className={cn('text-[10px] leading-none', isMe ? 'text-primary-foreground/70' : 'text-muted-foreground')}>
                          {timestamp}
                        </span>
                      )}
                      {intimacyScore && (
                        <span
                          className={cn(
                            'w-max rounded border px-1.5 py-0.5 text-[10px] font-medium leading-none',
                            isMe
                              ? 'border-primary-foreground/30 text-primary-foreground/80'
                              : 'border-border bg-background/70 text-muted-foreground'
                          )}
                          title="Intimacy score captured when this message was sent"
                        >
                          Intimacy {intimacyScore}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
          <div ref={scrollRef} />
        </div>
      </ScrollArea>

      <div className="flex flex-col gap-2 border-t bg-background p-3">
        {imageFile && (
          <div className="relative flex w-max items-center gap-2 overflow-hidden rounded-md border bg-muted/50 p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={URL.createObjectURL(imageFile)} alt="Preview" className="h-10 w-10 rounded object-cover" />
            <span className="max-w-[120px] truncate text-xs text-muted-foreground">{imageFile.name}</span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-1 top-1 ml-2 h-6 w-6 rounded-full hover:bg-destructive/10 hover:text-destructive"
              onClick={() => setImageFile(null)}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        )}

        {canSend ? (
          <button
            type="button"
            disabled={togglingTakeover}
            onClick={() => void setTakeoverState(!takeover)}
            className={cn(
              'flex w-max items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors',
              takeover
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                : 'text-muted-foreground hover:bg-muted'
            )}
            title={
              takeover
                ? 'The bot is paused for this conversation — click to hand control back'
                : 'Pause the bot and chat as the digital human'
            }
          >
            {togglingTakeover ? <Loader2 className="h-3 w-3 animate-spin" /> : <Bot className="h-3 w-3" />}
            {takeover ? `AI paused — you're chatting as ${dhSideName} · hand back` : `Take over as ${dhSideName}`}
          </button>
        ) : (
          <div className="text-xs text-muted-foreground">
            Read-only — takeover needs a digital human on one side of the match.
          </div>
        )}

        <div className="flex w-full gap-2">
          <input
            type="file"
            accept="image/*"
            className="hidden"
            ref={fileInputRef}
            onChange={(e) => {
              void acceptImageFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <Button
            variant="outline"
            size="icon"
            type="button"
            className="shrink-0"
            disabled={sending || !canSend}
            title={canSend ? 'Attach image (or drag & drop / paste)' : 'Unavailable'}
            onClick={() => fileInputRef.current?.click()}
          >
            <ImageIcon className="h-4 w-4" />
          </Button>
          <Input
            value={inputText}
            onChange={(e) => {
              setInputText(e.target.value);
              handleTypingActivity();
            }}
            onFocus={() => {
              // Touching the composer = intent to speak for the DH: engage
              // takeover so the bot can't answer over you mid-conversation.
              if (canSend && !takeoverRef.current && !togglingTakeover) void setTakeoverState(true);
            }}
            onPaste={(e) => {
              const file = Array.from(e.clipboardData.files ?? []).find((f) => f.type.startsWith('image/'));
              if (file) {
                e.preventDefault();
                void acceptImageFile(file);
              }
            }}
            placeholder={canSend ? `Message as ${dhSideName}…` : 'Read-only'}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            disabled={sending || !canSend}
          />
          <Button
            size="icon"
            className="shrink-0"
            onClick={handleSend}
            disabled={sending || !canSend || (!inputText.trim() && !imageFile)}
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function ChatHistory({ currentUserId, currentUserIsDigitalHuman = false }: ChatHistoryProps) {
  const [conversations, setConversations] = React.useState<Conversation[]>([]);
  const [cooldown, setCooldown] = React.useState<CooldownStatus | null>(null);
  const [selectedMatchId, setSelectedMatchId] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [togglingMatchId, setTogglingMatchId] = React.useState<string | null>(null);
  const [selfieOpen, setSelfieOpen] = React.useState(false);
  // Mobile master-detail: list OR chat below lg, side-by-side at lg+.
  const [mobileView, setMobileView] = React.useState<'list' | 'chat'>('list');

  // One service-role query server-side (rpc_admin_user_conversations) returns the
  // partner list WITH per-conversation message counts + mute flags, sorted by count.
  const fetchConversations = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(currentUserId)}/conversations`);
      const json = (await res.json()) as {
        conversations?: Conversation[];
        cooldown?: CooldownStatus | null;
        error?: string;
      };
      if (!res.ok) throw new Error(json.error || 'Failed to fetch conversations');
      const convs = json.conversations ?? [];
      setConversations(convs);
      setCooldown(json.cooldown ?? null);
      setSelectedMatchId((prev) =>
        prev && convs.some((c) => c.match_id === prev) ? prev : convs[0]?.match_id ?? null
      );
    } catch (err: unknown) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : 'Failed to fetch conversations');
      setConversations([]);
      setCooldown(null);
    }
    setLoading(false);
  }, [currentUserId]);

  React.useEffect(() => {
    if (currentUserId) void fetchConversations();
  }, [currentUserId, fetchConversations]);

  // Mute/unmute the DH for one conversation (user_match_ai_state.dh_muted —
  // dh-auto-reply skips muted matches). Applied on success only, so the
  // dot/toggle never lies about what the engine will do.
  const toggleMute = async (conv: Conversation) => {
    setTogglingMatchId(conv.match_id);
    try {
      const res = await fetch('/api/admin/chat/mute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ match_id: conv.match_id, muted: !conv.dh_muted }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to update');
      setConversations((prev) =>
        prev.map((c) => (c.match_id === conv.match_id ? { ...c, dh_muted: !conv.dh_muted } : c))
      );
      toast.success(
        !conv.dh_muted
          ? `${conv.username ?? 'DH'} muted — she will stop replying to this user`
          : `${conv.username ?? 'DH'} unmuted — she can chat with this user again`
      );
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to update mute');
    }
    setTogglingMatchId(null);
  };

  if (loading) {
    return <div className="p-4 text-sm text-muted-foreground">Loading conversations...</div>;
  }

  if (conversations.length === 0) {
    return <div className="p-4 text-sm text-muted-foreground">No matches found for this user.</div>;
  }

  const selected = conversations.find((c) => c.match_id === selectedMatchId) ?? null;
  const cooldownActive = Boolean(cooldown?.active);
  const selectedIsDh = Boolean(selected?.is_digital_human) || currentUserIsDigitalHuman;

  return (
    <div className="space-y-3">
      {cooldownActive ? (
        <div className="flex items-center gap-2 rounded-md border border-sky-500/30 bg-sky-500/5 px-3 py-2 text-sm">
          <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
          <span>
            User is in <span className="font-medium">cooldown</span> — only digital humans marked
            with a green dot still reply. Use the toggles to change who chats.
          </span>
        </div>
      ) : null}

      <div className="flex flex-col gap-4 lg:flex-row">
        {/* Conversation rail: every match, busiest first. On mobile it IS the page
            until a conversation is opened. */}
        <div
          className={cn(
            'w-full shrink-0 flex-col rounded-md border lg:flex lg:w-72',
            mobileView === 'chat' ? 'hidden lg:flex' : 'flex'
          )}
        >
          <div className="border-b bg-muted/30 px-3 py-2 text-xs font-medium text-muted-foreground">
            Conversations · {conversations.length}
          </div>
          {/* The Radix ScrollArea viewport wraps content in a `display:table;
              min-width:100%` div that grows to the widest row's max-content
              (a long DH username with `truncate`/nowrap), overflowing the rail
              and pushing the mute toggle out of view. Force that wrapper to
              `block` so it stays viewport-width and the toggle stays reachable. */}
          <ScrollArea className="h-[70dvh] lg:h-[720px] [&>[data-slot=scroll-area-viewport]>div]:!block">
            <div className="p-1.5">
              {conversations.map((conv) => {
                const isSelected = conv.match_id === selectedMatchId;
                const chatting = cooldownActive && conv.is_digital_human && !conv.dh_muted;
                return (
                  <div
                    key={conv.match_id}
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      setSelectedMatchId(conv.match_id);
                      setMobileView('chat');
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        setSelectedMatchId(conv.match_id);
                        setMobileView('chat');
                      }
                    }}
                    className={cn(
                      'flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors',
                      isSelected ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/60',
                      conv.dh_muted && 'opacity-60'
                    )}
                  >
                    <div className="relative shrink-0">
                      <Avatar className="h-9 w-9">
                        <AvatarImage src={`/api/avatar/${conv.partner_id}`} alt={conv.username ?? ''} />
                        <AvatarFallback>{(conv.username ?? '??').slice(0, 2).toUpperCase()}</AvatarFallback>
                      </Avatar>
                      {chatting ? (
                        <span
                          className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-background bg-emerald-500"
                          title="Still chatting with this user during cooldown"
                        />
                      ) : null}
                    </div>
                    <div className="min-w-0 flex-1">
                      {/* Plain text on purpose: a link here is too easy to hit when
                          tapping the row — the chat header carries the profile link. */}
                      <div className="truncate text-sm font-medium">
                        {conv.username || 'Unknown User'}
                      </div>
                      <div className="text-xs text-muted-foreground tabular-nums">
                        {conv.message_count.toLocaleString()} message{conv.message_count === 1 ? '' : 's'}
                        {!conv.is_digital_human ? ' · real user' : ''}
                      </div>
                    </div>
                    {conv.is_digital_human ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0"
                        disabled={togglingMatchId === conv.match_id}
                        title={
                          conv.dh_muted
                            ? 'Muted — click to let this digital human chat with the user'
                            : 'Chatting — click to stop this digital human from replying'
                        }
                        onClick={(e) => {
                          e.stopPropagation();
                          void toggleMute(conv);
                        }}
                      >
                        {togglingMatchId === conv.match_id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : conv.dh_muted ? (
                          <VolumeX className="h-3.5 w-3.5 text-muted-foreground" />
                        ) : (
                          <Volume2 className="h-3.5 w-3.5 text-emerald-600" />
                        )}
                      </Button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </div>

        {/* Selected conversation. */}
        <div
          className={cn(
            'min-w-0 flex-1 space-y-2 lg:block',
            mobileView === 'list' ? 'hidden lg:block' : 'block'
          )}
        >
          {selected ? (
            <>
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2 text-sm">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0 lg:hidden"
                    title="Back to conversations"
                    onClick={() => setMobileView('list')}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <a
                    href={partnerHref(selected)}
                    target="_blank"
                    rel="noreferrer"
                    className="flex min-w-0 items-center gap-1 font-medium hover:underline"
                    title={`Open ${selected.username ?? 'profile'} in a new tab`}
                  >
                    <span className="truncate">{selected.username || 'Unknown User'}</span>
                    <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
                  </a>
                  {selected.is_digital_human ? <Badge variant="outline">DH</Badge> : null}
                  {selected.dh_muted ? <Badge variant="secondary">Muted</Badge> : null}
                </div>
                {selectedIsDh ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    title="Send one of the digital human's preserved photos"
                    onClick={() => setSelfieOpen(true)}
                  >
                    <ImagePlus className="h-4 w-4" />
                    <span className="hidden sm:inline">Send image</span>
                  </Button>
                ) : null}
              </div>
              <ChatInterface
                key={selected.match_id}
                matchId={selected.match_id}
                pageUserId={currentUserId}
                pageUserIsDh={currentUserIsDigitalHuman}
                partner={selected}
              />
              <SelfiePickerDialog
                open={selfieOpen}
                onOpenChange={setSelfieOpen}
                matchId={selected.match_id}
                dhName={
                  currentUserIsDigitalHuman
                    ? 'this digital human'
                    : selected.username ?? 'the digital human'
                }
              />
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
