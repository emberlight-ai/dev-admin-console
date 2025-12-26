'use client';

import * as React from 'react';
import { createClient } from '@supabase/supabase-js';

// Helper to get a client that definitely has the keys from the env
function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Supabase env vars missing');
  return createClient(url, key);
}
import { UserCombobox, type PickUser } from '@/components/matching/user-combobox';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Send, Loader2, ArrowRightLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface Message {
  id: string;
  match_id: string;
  sender_id: string;
  receiver_id?: string | null;
  content: string;
  created_at: string;
}

interface ChatProps {
  matchId: string;
  currentUser: PickUser;
  onSwitchUser: () => void;
}

function ChatInterface({ matchId, currentUser, onSwitchUser }: ChatProps) {
  const [messages, setMessages] = React.useState<Message[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [inputText, setInputText] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  // Fetch initial 
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
    if (!inputText.trim()) return;
    setSending(true);

    // In a real app, you'd send as the authenticated user.
    // For admin tool, we can't easily impersonate for RLS inserts without service role,
    // but here we assume the admin IS the authenticated user or we use a workaround.
    // However, the RPC rpc_send_message checks auth.uid().
    // LIMITATION: Admin can only chat if they are one of the participants.
    // If the admin is NOT userA or userB, this will fail RLS.
    // To fix for ADMIN testing: Admin should ideally log in as that user, OR we use a backdoor RPC.
    // For now, we'll try to use the standard RPC and warn if it fails.

    try {
      const supabase = getSupabase();
      const { data, error } = await supabase.rpc('rpc_send_message', {
        match_id: matchId,
        content: inputText,
        sender_id: currentUser.userid, // Pass explicitly for Admin tool
      });

      if (error) throw error;
      
      // Optimistically add message
      setMessages(prev => [...prev, data as Message]);
      
      setInputText('');
    } catch (err: unknown) {
      toast.error('Failed to send message. Are you logged in as a participant?');
      console.error(err);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col h-[600px] border rounded-md">
      <div className="p-3 border-b bg-muted/30 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <span className="font-medium text-sm">
            Chatting as <span className="text-primary">{currentUser.username}</span>
          </span>
          <Button 
            variant="outline" 
            size="sm" 
            className="h-7 text-xs gap-1"
            onClick={onSwitchUser}
          >
            <ArrowRightLeft className="h-3 w-3" />
            Switch
          </Button>
        </div>
        <span className="text-xs text-muted-foreground">Match ID: {matchId.slice(0, 8)}...</span>
      </div>
      
      <ScrollArea className="flex-1 min-h-0">
        <div className="space-y-4 p-4">
          {loading ? (
            <div className="flex justify-center p-4">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : messages.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-10">
              No messages yet. Say hello!
            </div>
          ) : (
            messages.map((msg) => {
              const isMe = msg.sender_id === currentUser.userid;
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
                      'max-w-[80%] rounded-lg px-3 py-2 text-sm break-words',
                      isMe
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-foreground'
                    )}
                  >
                    {msg.content}
                  </div>
                </div>
              );
            })
          )}
          <div ref={scrollRef} />
        </div>
      </ScrollArea>

      <div className="p-3 border-t bg-background flex gap-2">
        <Input
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="Type a message..."
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
        />
        <Button size="icon" onClick={handleSend} disabled={sending || !inputText.trim()}>
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

export default function AdminChatPage() {
  const [userA, setUserA] = React.useState<PickUser | null>(null);
  const [userB, setUserB] = React.useState<PickUser | null>(null);
  const [currentUser, setCurrentUser] = React.useState<PickUser | null>(null);
  const [matchId, setMatchId] = React.useState<string | null>(null);
  const [checking, setChecking] = React.useState(false);

  // Initialize currentUser when userA is selected
  React.useEffect(() => {
    if (userA && !currentUser) {
      setCurrentUser(userA);
    }
  }, [userA, currentUser]);

  // If selection changes and currentUser is no longer one of them, reset or default to A
  React.useEffect(() => {
    if (userA && userB && currentUser) {
      if (currentUser.userid !== userA.userid && currentUser.userid !== userB.userid) {
        setCurrentUser(userA);
      }
    }
  }, [userA, userB, currentUser]);

  // Check if match exists between A and B
  React.useEffect(() => {
    if (!userA || !userB) {
      setMatchId(null);
      return;
    }

    const checkMatch = async () => {
      setChecking(true);
      const supabase = getSupabase();
      
      // We need to find if there is a match row
      // We also check for 'match_requests' if they are still pending? No, only confirmed matches for chat.
      
      const { data, error } = await supabase
        .from('user_matches')
        .select('id')
        .or(`and(user_a.eq.${userA.userid},user_b.eq.${userB.userid}),and(user_a.eq.${userB.userid},user_b.eq.${userA.userid})`)
        .single();


      if (data) {
        setMatchId(data.id);
      } else {
        setMatchId(null);
        if (error && error.code !== 'PGRST116') { // 116 is no rows found
           console.error('Error checking match:', error);
        }
      }
      setChecking(false);
    };

    checkMatch();
  }, [userA, userB]);

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Chat Debugger</h1>
        <p className="text-muted-foreground">
          Select two users to verify their match status and view their chat.
          <br />
          <span className="text-xs text-yellow-600">
            Note: Admin privileges required.
          </span>
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>User A</CardTitle>
          </CardHeader>
          <CardContent>
            <UserCombobox value={userA} onChange={setUserA} placeholder="Select first user" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>User B</CardTitle>
          </CardHeader>
          <CardContent>
            <UserCombobox value={userB} onChange={setUserB} placeholder="Select second user" />
          </CardContent>
        </Card>
      </div>

      {userA && userB && (
        <Card>
          <CardHeader>
            <CardTitle>Conversation Status</CardTitle>
          </CardHeader>
          <CardContent>
            {checking ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Checking match status...
              </div>
            ) : matchId ? (
              <div className="space-y-4">
                <div className="p-3 bg-green-500/10 text-green-600 rounded-md text-sm border border-green-500/20">
                  Match Active (ID: {matchId})
                </div>
                {/* 
                  Since we are simulating, we pick "User A" as the sender for the UI demo.
                  In reality, the Supabase client uses the logged-in session.
                */}
                <ChatInterface 
                  matchId={matchId} 
                  currentUser={currentUser || userA}
                  onSwitchUser={() => {
                    const next = currentUser?.userid === userA.userid ? userB : userA;
                    setCurrentUser(next);
                  }}
                />
              </div>
            ) : (
              <div className="p-3 bg-destructive/10 text-destructive rounded-md text-sm border border-destructive/20">
                No match found between these users (or you do not have permission to view it).
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

