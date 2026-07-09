'use client';

import * as React from 'react';
import { createClient } from '@supabase/supabase-js';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Send, Loader2, Copy, Image as ImageIcon, LogIn, X, Volume2, VolumeX } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { TakeoverDock } from '@/components/matching/takeover-dock';

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
  /** Only digital humans can be "operated" by the admin. When false (a real
   *  user), the chat composer is read-only so we never message on their behalf. */
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

function ChatInterface({ matchId, currentUserId, canSend }: { matchId: string, currentUserId: string, canSend: boolean }) {
  const [messages, setMessages] = React.useState<Message[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [inputText, setInputText] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [imageFile, setImageFile] = React.useState<File | null>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await downsampleImage(file);
      setImageFile(compressed);
    } catch (err) {
      toast.error('Failed to process image');
      console.error(err);
    }
    e.target.value = '';
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
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `match_id=eq.${matchId}`,
        },
        (payload) => {
          const newMsg = payload.new as Message;
          setMessages((prev) => {
            if (prev.some((msg) => msg.id === newMsg.id)) {
              return prev;
            }
            return [...prev, newMsg];
          });
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
    // Guard: never send as a real user (only digital humans can be operated by
    // the admin). The UI also disables the controls, but this protects against
    // the Enter-key path too.
    if (!canSend) return;
    if (!inputText.trim() && !imageFile) return;
    setSending(true);

    try {
      let mediaUrl = null;
      if (imageFile) {
        const formData = new FormData();
        formData.append("files", imageFile);
        formData.append("match_id", matchId);

        const res = await fetch("/api/admin/chat/media", {
          method: "POST",
          body: formData
        });

        if (!res.ok) {
           const errJson = await res.json();
           throw new Error(errJson.error || "Failed to upload image");
        }
        const json = await res.json();
        mediaUrl = json.media_url;
      }

      const supabase = getSupabase();
      const { data, error } = await supabase.rpc('rpc_send_message', {
        match_id: matchId,
        content: inputText.trim() || null,
        media_url: mediaUrl,
        sender_id: currentUserId,
      });

      if (error) throw error;

      // Optimistically add message
      setMessages(prev => {
        const newMsg = data as Message;
        if (prev.some((msg) => msg.id === newMsg.id)) {
          return prev;
        }
        return [...prev, newMsg];
      });

      setInputText('');
      setImageFile(null);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to send message.');
      console.error(err);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col h-[760px] border rounded-md">
      <div className="p-3 border-b bg-muted/30 flex items-center justify-between">
        <span className="font-medium text-sm">
          Chatting with <span className="text-primary">{/* We might want to pass username here if needed */}Partner</span>
        </span>
        <span className="text-xs text-muted-foreground flex items-center gap-1">
          Match ID
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="ml-1 w-5 h-5"
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

      <ScrollArea className="flex-1 min-h-0">
        <div className="space-y-4 p-4">
          {loading ? (
            <div className="flex justify-center p-4">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : messages.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-10">
              No messages yet.
            </div>
          ) : (
            messages.map((msg) => {
              const isMe = msg.sender_id === currentUserId;
              const intimacyScore = formatIntimacyScore(msg.intimacy_score);
              const timestamp = formatMessageTimestamp(msg.created_at);
              return (
                <div
                  key={msg.id}
                  className={cn(
                    'flex w-full',
                    isMe ? 'justify-end' : 'justify-start'
                  )}
                >
                  <div
                    className={cn(
                      'max-w-[80%] rounded-lg px-3 py-2 text-sm break-words flex flex-col gap-2',
                      isMe
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-foreground'
                    )}
                  >
                    {msg.media_url && (
                      <a href={msg.media_url} target="_blank" rel="noreferrer">
                        <img src={msg.media_url} alt="attachment" className="rounded-md max-w-full max-h-48 object-cover" />
                      </a>
                    )}
                    {msg.content && <div>{msg.content}</div>}
                    <div className="flex flex-wrap items-center gap-1.5">
                      {timestamp && (
                        <span
                          className={cn(
                            'text-[10px] leading-none',
                            isMe ? 'text-primary-foreground/70' : 'text-muted-foreground'
                          )}
                        >
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

      <div className="p-3 border-t bg-background flex flex-col gap-2 relative">
        {imageFile && (
          <div className="flex items-center gap-2 overflow-hidden rounded-md border p-2 w-max bg-muted/50 relative">
            <img 
              src={URL.createObjectURL(imageFile)} 
              alt="Preview" 
              className="h-10 w-10 object-cover rounded"
            />
            <span className="text-xs text-muted-foreground truncate max-w-[120px]">{imageFile.name}</span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-6 w-6 ml-2 rounded-full hover:bg-destructive/10 hover:text-destructive absolute right-1 top-1"
              onClick={() => setImageFile(null)}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        )}
        {!canSend && (
          <div className="text-xs text-muted-foreground">
            Read-only — you can only send messages on behalf of a digital human, not a real user.
          </div>
        )}
        <div className="flex gap-2 w-full">
          <input
            type="file"
            accept="image/*"
            className="hidden"
            ref={fileInputRef}
            onChange={handleFileChange}
          />
          <Button
            variant="outline"
            size="icon"
            type="button"
            disabled={sending || !canSend}
            title={canSend ? "Attach image" : "Sending is disabled for real users"}
            onClick={() => fileInputRef.current?.click()}
          >
            <ImageIcon className="h-4 w-4" />
          </Button>
          <Input
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder={canSend ? "Type a message..." : "Read-only (real user)"}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            disabled={sending || !canSend}
          />
          <Button size="icon" onClick={handleSend} disabled={sending || !canSend || (!inputText.trim() && !imageFile)}>
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

  // When set, the Messenger-style takeover dock is open for the selected partner.
  const [takeoverOpen, setTakeoverOpen] = React.useState(false);

  // One service-role query server-side (rpc_admin_user_conversations) returns the
  // partner list WITH per-conversation message counts + mute flags, sorted by
  // count — the previous client-side match/user fan-out couldn't rank or count.
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
  // dh-auto-reply skips muted matches). Optimistic-free: apply on success only,
  // so the dot/toggle never lies about what the engine will do.
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
    return <div className="text-sm text-muted-foreground p-4">Loading conversations...</div>;
  }

  if (conversations.length === 0) {
    return <div className="text-sm text-muted-foreground p-4">No matches found for this user.</div>;
  }

  const selected = conversations.find((c) => c.match_id === selectedMatchId) ?? null;
  const cooldownActive = Boolean(cooldown?.active);
  // "Take over" opens an in-place chat dock where the admin speaks AS the digital
  // human toward the real user and pauses the bot for that conversation. Requires a
  // digital human on one side of the match (the page user or the selected partner).
  const canTakeOver = Boolean(selected && (currentUserIsDigitalHuman || selected.is_digital_human));

  return (
    <div className="space-y-3">
      {cooldownActive ? (
        <div className="flex items-center gap-2 rounded-md border border-sky-500/30 bg-sky-500/5 px-3 py-2 text-sm">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          <span>
            User is in <span className="font-medium">cooldown</span> — only digital humans marked
            with a green dot still reply. Use the toggles to change who chats.
          </span>
        </div>
      ) : null}

      <div className="flex gap-4">
        {/* Conversation rail: every match, busiest first. */}
        <div className="flex w-72 shrink-0 flex-col rounded-md border">
          <div className="border-b bg-muted/30 px-3 py-2 text-xs font-medium text-muted-foreground">
            Conversations · {conversations.length}
          </div>
          <ScrollArea className="h-[720px]">
            <div className="p-1.5">
              {conversations.map((conv) => {
                const isSelected = conv.match_id === selectedMatchId;
                const chatting = cooldownActive && conv.is_digital_human && !conv.dh_muted;
                return (
                  <div
                    key={conv.match_id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedMatchId(conv.match_id)}
                    onKeyDown={(e) => e.key === 'Enter' && setSelectedMatchId(conv.match_id)}
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
                          className="absolute -right-0.5 -bottom-0.5 h-3 w-3 rounded-full border-2 border-background bg-emerald-500"
                          title="Still chatting with this user during cooldown"
                        />
                      ) : null}
                    </div>
                    <div className="min-w-0 flex-1">
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
        <div className="min-w-0 flex-1 space-y-2">
          {selected ? (
            <>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-medium">{selected.username || 'Unknown User'}</span>
                  {selected.is_digital_human ? <Badge variant="outline">DH</Badge> : null}
                  {selected.dh_muted ? <Badge variant="secondary">Muted</Badge> : null}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  disabled={!canTakeOver}
                  title={
                    canTakeOver
                      ? 'Chat as the digital human and pause the bot for this conversation'
                      : 'Takeover needs a digital human on one side of the match'
                  }
                  onClick={() => setTakeoverOpen(true)}
                >
                  <LogIn className="h-4 w-4 mr-1" />
                  Take over
                </Button>
              </div>
              <ChatInterface
                matchId={selected.match_id}
                currentUserId={currentUserId}
                canSend={currentUserIsDigitalHuman}
              />
            </>
          ) : null}
        </div>
      </div>

      {takeoverOpen && selected && (
        <TakeoverDock
          matchId={selected.match_id}
          participantIds={[currentUserId, selected.partner_id]}
          onClose={() => setTakeoverOpen(false)}
        />
      )}
    </div>
  );
}
