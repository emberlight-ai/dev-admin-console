'use client';

import * as React from 'react';
import { createClient } from '@supabase/supabase-js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Send, Loader2, ArrowRightLeft, Copy, Image as ImageIcon, X, KeyRound } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

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
  created_at: string;
}

interface ChatHistoryProps {
  currentUserId: string;
}

interface MatchedUser {
  userid: string;
  username: string;
}

type UserSearchResult = {
  userid: string;
  username: string;
  avatar?: string | null;
  is_digital_human?: boolean;
};

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

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

function ChatInterface({ matchId, matchPartnerId, currentUserId }: { matchId: string, matchPartnerId: string, currentUserId: string }) {
  const [messages, setMessages] = React.useState<Message[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [inputText, setInputText] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [imageFile, setImageFile] = React.useState<File | null>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // Auth Prompt for image token
  const [authPromptOpen, setAuthPromptOpen] = React.useState(false);
  const [testPassword, setTestPassword] = React.useState('');
  const [tokenLoading, setTokenLoading] = React.useState(false);
  const [tokenError, setTokenError] = React.useState('');
  const [customToken, setCustomToken] = React.useState('');

  const runImageAuth = async () => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
    if (!testPassword) {
      setTokenError('Password is required.');
      return;
    }
    setTokenLoading(true);
    setTokenError('');
    try {
      const res = await fetch(`${supabaseUrl.replace(/\/$/, '')}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { apikey: anonKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@emberlightai.com', password: testPassword }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error_description || json.msg || json.error || 'Login failed');
      setCustomToken(json.access_token);
      setAuthPromptOpen(false);
      setTestPassword('');
      // Need a slight delay before triggering the click to let the dialog close
      setTimeout(() => fileInputRef.current?.click(), 100);
    } catch (err: unknown) {
      setTokenError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setTokenLoading(false);
    }
  };

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

  // Fetch initial messages
  React.useEffect(() => {
    const fetchMessages = async () => {
      setLoading(true);
      const supabase = getSupabase();
      const { data, error } = await supabase.rpc('rpc_get_messages', {
        match_id: matchId,
        start_index: 0,
        limit_count: 50,
      });

      if (error) {
        toast.error('Failed to load messages');
        console.error(error);
      } else {
        // Reverse so newest is at bottom
        setMessages((data as Message[]).reverse());
      }
      setLoading(false);
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
    if (!inputText.trim() && !imageFile) return;
    setSending(true);

    try {
      let mediaUrl = null;
      if (imageFile) {
        const supabase = getSupabase();
        let token = customToken;
        if (!token) {
          const { data: sessionData } = await supabase.auth.getSession();
          token = sessionData.session?.access_token || "";
        }
        if (!token) throw new Error("No session token to upload image. Generate one via Test Login.");

        const formData = new FormData();
        formData.append("files", imageFile);
        formData.append("match_id", matchId);

        const res = await fetch("/api/ios/chat/media", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${token}`
          },
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
    <div className="flex flex-col h-[600px] border rounded-md">
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
                  </div>
                </div>
              );
            })
          )}
          <div ref={scrollRef} />
        </div>
      </ScrollArea>

      <div className="p-3 border-t bg-background flex flex-col gap-2 relative">
        <Dialog open={authPromptOpen} onOpenChange={setAuthPromptOpen}>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>Admin Authorization</DialogTitle>
              <DialogDescription>
                Image uploads require a valid session. Please sign in as admin@emberlightai.com.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="space-y-2">
                <Label>Password</Label>
                <Input 
                  type="password" 
                  value={testPassword} 
                  onChange={(e) => setTestPassword(e.target.value)} 
                  onKeyDown={(e) => e.key === 'Enter' && runImageAuth()}
                />
              </div>
              {tokenError && <p className="text-xs text-rose-600">{tokenError}</p>}
            </div>
            <div className="flex justify-end">
              <Button onClick={runImageAuth} disabled={tokenLoading}>
                {tokenLoading ? 'Signing in...' : 'Sign In'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

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
        <div className="flex gap-2 w-full">
          <input 
            type="file" 
            accept="image/*" 
            className="hidden" 
            ref={fileInputRef} 
            onChange={handleFileChange} 
          />
          {currentUserId === 'c3072d80-331d-4a5a-b93f-d1d5d5912fec' && (
            <Button 
              variant="outline" 
              size="icon" 
              type="button" 
              disabled={sending}
              onClick={() => {
                if (customToken) {
                  fileInputRef.current?.click();
                } else {
                  setAuthPromptOpen(true);
                }
              }}
            >
              <ImageIcon className="h-4 w-4" />
            </Button>
          )}
          <Input
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Type a message..."
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            disabled={sending}
          />
          <Button size="icon" onClick={handleSend} disabled={sending || (!inputText.trim() && !imageFile)}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function ChatHistory({ currentUserId }: ChatHistoryProps) {
  const [matchedUsers, setMatchedUsers] = React.useState<MatchedUser[]>([]);
  const [selectedPartnerId, setSelectedPartnerId] = React.useState<string | null>(null);
  const [matches, setMatches] = React.useState<Record<string, string>>({}); // partnerId -> matchId
  const [loading, setLoading] = React.useState(true);

  const [searchQuery, setSearchQuery] = React.useState('');
  const [searching, setSearching] = React.useState(false);
  const [searchResults, setSearchResults] = React.useState<UserSearchResult[]>([]);
  const [selectedSearchUserId, setSelectedSearchUserId] = React.useState<string | null>(null);
  const [sendingMatchRequest, setSendingMatchRequest] = React.useState(false);

  const fetchMatches = React.useCallback(async () => {
    setLoading(true);
    const supabase = getSupabase();

    // Fetch matches where current user is A or B
    const { data: matchesData, error: matchesError } = await supabase
      .from('user_matches')
      .select('id, user_a, user_b')
      .or(`user_a.eq.${currentUserId},user_b.eq.${currentUserId}`);

    if (matchesError) {
      console.error('Error fetching matches:', matchesError);
      toast.error('Failed to fetch matches');
      setLoading(false);
      return;
    }

    if (!matchesData || matchesData.length === 0) {
      setLoading(false);
      return;
    }

    const partnerIds: string[] = [];
    const matchesMap: Record<string, string> = {};

    matchesData.forEach(match => {
      const partnerId = match.user_a === currentUserId ? match.user_b : match.user_a;
      partnerIds.push(partnerId);
      matchesMap[partnerId] = match.id;
    });

    setMatches(matchesMap);

    // Fetch user details for partners
    if (partnerIds.length > 0) {
      const { data: usersData, error: usersError } = await supabase
        .from('users')
        .select('userid, username')
        .in('userid', partnerIds);

      if (usersError) {
        console.error('Error fetching matched users:', usersError);
        toast.error('Failed to fetch matched users details');
      } else {
        setMatchedUsers(usersData as MatchedUser[] || []);
        // Select first match by default if available
        if (usersData && usersData.length > 0) {
          setSelectedPartnerId(usersData[0].userid);
        }
      }
    }
    setLoading(false);
  }, [currentUserId]);

  React.useEffect(() => {
    if (currentUserId) {
      void fetchMatches();
    }
  }, [currentUserId, fetchMatches]);

  // Debounced search effect
  React.useEffect(() => {
    const q = searchQuery.trim();
    if (!q) {
      setSearchResults([]);
      setSelectedSearchUserId(null);
      return;
    }
    // Clear selected user when search query changes
    setSelectedSearchUserId(null);

    const timeoutId = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(
          `/api/admin/users?mode=search&q=${encodeURIComponent(q)}&is_digital_human=false&limit=20`
        );
        const json = (await res.json()) as { data?: UserSearchResult[]; error?: string };
        if (!res.ok) throw new Error(json.error || 'Failed to search users');
        const results = (json.data ?? []).filter((u) => u.userid !== currentUserId);
        setSearchResults(results);
        // Don't auto-select - let user choose
      } catch (err: unknown) {
        console.error(err);
        toast.error(err instanceof Error ? err.message : 'Failed to search users');
        setSearchResults([]);
        setSelectedSearchUserId(null);
      } finally {
        setSearching(false);
      }
    }, 1000); // 1 second debounce

    return () => clearTimeout(timeoutId);
  }, [searchQuery, currentUserId]);

  const searchUsers = async () => {
    const q = searchQuery.trim();
    if (!q) {
      setSearchResults([]);
      setSelectedSearchUserId(null);
      return;
    }
    setSearching(true);
    try {
      const res = await fetch(
        `/api/admin/users?mode=search&q=${encodeURIComponent(q)}&is_digital_human=false&limit=20`
      );
      const json = (await res.json()) as { data?: UserSearchResult[]; error?: string };
      if (!res.ok) throw new Error(json.error || 'Failed to search users');
      const results = (json.data ?? []).filter((u) => u.userid !== currentUserId);
      setSearchResults(results);
      // Don't auto-select - let user choose
    } catch (err: unknown) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : 'Failed to search users');
      setSearchResults([]);
      setSelectedSearchUserId(null);
    } finally {
      setSearching(false);
    }
  };

  const sendMatchRequest = React.useCallback(async (userId: string) => {
    if (!userId) return;
    setSendingMatchRequest(true);
    try {
      const res = await fetch('/api/admin/matching/send-match-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from_user_id: currentUserId,
          target_user_id: userId,
        }),
      });
      const json = (await res.json()) as { type?: 'match' | 'request'; id?: string; error?: string };
      if (!res.ok) throw new Error(json.error || 'Failed to send match request');

      if (json.type === 'match') {
        toast.success(`Match created: ${json.id}`);
        await fetchMatches();
      } else {
        toast.success(`Match request sent: ${json.id}`);
      }
      // Clear search after successful invite
      setSearchQuery('');
      setSearchResults([]);
      setSelectedSearchUserId(null);
    } catch (err: unknown) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : 'Failed to send match request');
    } finally {
      setSendingMatchRequest(false);
    }
  }, [currentUserId, fetchMatches]);


  if (loading) {
    return <div className="text-sm text-muted-foreground p-4">Loading matches...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border p-3">
        <div className="text-sm font-medium">Send Match Request</div>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="flex-1 relative">
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
            {searchResults.length > 0 && (
              <div className="absolute z-50 w-full mt-1 bg-popover border rounded-md shadow-md max-h-60 overflow-auto">
                {searchResults.map((u) => (
                  <button
                    key={u.userid}
                    type="button"
                    className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent rounded-md"
                    onClick={() => {
                      setSelectedSearchUserId(u.userid);
                      setSearchQuery(u.username || u.userid);
                      setSearchResults([]);
                    }}
                  >
                    <Avatar className="h-6 w-6 shrink-0">
                      <AvatarImage src={u.avatar ?? undefined} alt={u.username} />
                      <AvatarFallback className="text-xs">{initials(u.username || u.userid)}</AvatarFallback>
                    </Avatar>
                    <span className="truncate">{u.username || u.userid}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              if (selectedSearchUserId) {
                void sendMatchRequest(selectedSearchUserId);
              } else {
                void searchUsers();
              }
            }}
            disabled={searching || (!searchQuery.trim() && !selectedSearchUserId) || sendingMatchRequest}
          >
            {sendingMatchRequest ? 'Inviting…' : 'Invite Match'}
          </Button>
        </div>
      </div>

      {matchedUsers.length > 0 ? (
        <>
          <div className="w-full max-w-xs">
            <label className="text-sm font-medium mb-1 block">Select Partner</label>
            <Select value={selectedPartnerId || ''} onValueChange={setSelectedPartnerId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a matched user" />
              </SelectTrigger>
              <SelectContent>
                {matchedUsers.map((user) => (
                  <SelectItem key={user.userid} value={user.userid}>
                    {user.username || 'Unknown User'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedPartnerId && matches[selectedPartnerId] && (
            <ChatInterface
              matchId={matches[selectedPartnerId]}
              matchPartnerId={selectedPartnerId}
              currentUserId={currentUserId}
            />
          )}
        </>
      ) : (
        <div className="text-sm text-muted-foreground p-4">No matches found for this user.</div>
      )}
    </div>
  );
}

