'use client'

import * as React from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { ArrowLeft, Send } from "lucide-react"
import { toast } from "sonner"

import { supabase } from "@/lib/supabase"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { ScrollArea } from "@/components/ui/scroll-area"

interface ChatMessage {
  role: 'user' | 'model';
  parts: { text: string }[];
}

type DbUser = {
  userid: string;
  username: string;
  profession?: string | null;
  avatar?: string | null;
  age?: number | null;
  gender?: string | null;
  zipcode?: string | null;
  bio?: string | null;
  system_prompt?: string | null;
};

type DbPost = {
  id: string;
  userid: string;
  photos: string[] | null;
  description?: string | null;
  created_at: string;
};

export default function DigitalHumanDetail() {
  const { id } = useParams();
  const [user, setUser] = React.useState<DbUser | null>(null)
  const [posts, setPosts] = React.useState<DbPost[]>([])
  const [loading, setLoading] = React.useState(true)
  const [systemPrompt, setSystemPrompt] = React.useState("")
  const [promptEditing, setPromptEditing] = React.useState(false)
  
  // Chat state
  const [chatHistory, setChatHistory] = React.useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = React.useState("")
  const [chatLoading, setChatLoading] = React.useState(false)
  const chatEndRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!id) return;
    void fetchUser();
    void fetchPosts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  React.useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [chatHistory])

  const fetchUser = async () => {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('userid', id)
      .single();

    if (error) {
      toast.error("Failed to fetch user details")
    } else {
      setUser(data);
      setSystemPrompt(data.system_prompt || '');
    }
    setLoading(false);
  };

  const fetchPosts = async () => {
    const { data } = await supabase
      .from('user_posts')
      .select('*')
      .eq('userid', id)
      .order('created_at', { ascending: false });

    if (data) setPosts(data);
  };

  const handleUpdatePrompt = async () => {
    const { error } = await supabase
      .from('users')
      .update({ system_prompt: systemPrompt })
      .eq('userid', id);

    if (error) {
      toast.error("Failed to update system prompt")
    } else {
      toast.success("System prompt updated")
      setPromptEditing(false);
      // Update local user state
      setUser((prev) => (prev ? { ...prev, system_prompt: systemPrompt } : prev));
    }
  };

  const handleSendMessage = async () => {
    if (!chatInput.trim()) return;
    if (!user) return;

    const newMessage: ChatMessage = { role: 'user', parts: [{ text: chatInput }] };
    const updatedHistory = [...chatHistory, newMessage];
    setChatHistory(updatedHistory);
    setChatInput('');
    setChatLoading(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemPrompt: user.system_prompt,
          history: chatHistory, // Send previous history
          message: newMessage.parts[0].text
        }),
      });

      const data = await response.json();

      if (data.response) {
        setChatHistory((prev) => [
          ...prev,
          { role: 'model', parts: [{ text: data.response }] }
        ]);
      } else {
        toast.error("Failed to get response from AI")
      }
    } catch (error) {
      console.error(error);
      toast.error("Error communicating with AI")
    } finally {
      setChatLoading(false);
    }
  };

  if (loading) return <div className="text-sm text-muted-foreground">Loading...</div>
  if (!user) return <div className="text-sm text-muted-foreground">User not found</div>

  return (
    <div className="max-w-6xl space-y-4">
      <Link href="/admin/digital-humans" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to List
      </Link>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left Column: User Info */}
        <div className="space-y-6">
          <Card className="p-6">
            <div className="flex flex-col items-center text-center">
              <Avatar className="h-28 w-28">
                <AvatarImage src={user.avatar ?? undefined} alt={user.username} />
                <AvatarFallback>{user.username.slice(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
              <div className="mt-4">
                <div className="text-xl font-semibold">{user.username}</div>
                <div className="text-sm text-muted-foreground">{user.profession ?? "—"}</div>
              </div>
              <div className="mt-3">
                <Badge>Digital Human</Badge>
              </div>
            </div>
          </Card>

          <Card className="p-6">
            <div className="text-sm font-medium">Details</div>
            <Separator className="my-3" />
            <dl className="space-y-3 text-sm">
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">Age</dt>
                <dd>{user.age ?? "—"}</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">Gender</dt>
                <dd>{user.gender ?? "—"}</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">Location</dt>
                <dd>{user.zipcode ?? "—"}</dd>
              </div>
              <div className="space-y-1">
                <dt className="text-muted-foreground">Bio</dt>
                <dd className="text-sm">{user.bio ?? "—"}</dd>
              </div>
            </dl>
          </Card>
        </div>

        {/* Right Column: Tabs (Chat & Posts) */}
        <div className="lg:col-span-2">
          <Card className="p-6">
            <Tabs defaultValue="chat" className="w-full">
              <TabsList>
                <TabsTrigger value="chat">Chat &amp; Tuning</TabsTrigger>
                <TabsTrigger value="posts">Post History</TabsTrigger>
              </TabsList>

              <TabsContent value="chat" className="mt-4 space-y-4">
                <div className="rounded-lg border bg-card p-4">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-medium">System Prompt</div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => (promptEditing ? handleUpdatePrompt() : setPromptEditing(true))}
                    >
                      {promptEditing ? "Save" : "Edit"}
                    </Button>
                  </div>
                  <Separator className="my-3" />
                  {promptEditing ? (
                    <Textarea
                      value={systemPrompt}
                      onChange={(e) => setSystemPrompt(e.target.value)}
                      rows={6}
                    />
                  ) : (
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                      {user.system_prompt ?? "—"}
                    </p>
                  )}
                </div>

                <div className="rounded-lg border bg-muted/40">
                  <ScrollArea className="h-[420px] p-4">
                    {chatHistory.length === 0 ? (
                      <div className="py-16 text-center text-sm text-muted-foreground">
                        Start a conversation to test the persona...
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {chatHistory.map((m, idx) => (
                          <div
                            key={idx}
                            className={m.role === "user" ? "flex justify-end" : "flex justify-start"}
                          >
                            <div
                              className={
                                m.role === "user"
                                  ? "max-w-[80%] rounded-lg bg-primary/10 px-3 py-2 text-sm"
                                  : "max-w-[80%] rounded-lg bg-card px-3 py-2 text-sm"
                              }
                            >
                              {m.parts[0].text}
                            </div>
                          </div>
                        ))}
                        {chatLoading ? (
                          <div className="text-sm text-muted-foreground">Thinking...</div>
                        ) : null}
                        <div ref={chatEndRef} />
                      </div>
                    )}
                  </ScrollArea>
                </div>

                <div className="flex gap-2">
                  <Input
                    placeholder="Type a message..."
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault()
                        void handleSendMessage()
                      }
                    }}
                    disabled={chatLoading}
                  />
                  <Button onClick={() => void handleSendMessage()} disabled={chatLoading} className="gap-2">
                    <Send className="h-4 w-4" />
                    Send
                  </Button>
                </div>
              </TabsContent>

              <TabsContent value="posts" className="mt-4">
                <div className="rounded-lg border">
                  <div className="p-4 text-sm text-muted-foreground">
                    {posts.length === 0 ? "No posts yet." : null}
                  </div>
                  <Separator />
                  <div className="divide-y">
                    {posts.map((p) => (
                      <div key={p.id} className="p-4">
                        <div className="text-xs text-muted-foreground">
                          {new Date(p.created_at).toLocaleString()}
                        </div>
                        <div className="mt-2 text-sm">{p.description ?? "—"}</div>
                        {p.photos?.length ? (
                          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3">
                            {p.photos.slice(0, 6).map((url) => (
                              <img
                                key={url}
                                src={url}
                                alt="post"
                                className="h-28 w-full rounded-md object-cover"
                              />
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </Card>
        </div>
      </div>
    </div>
  );
}
