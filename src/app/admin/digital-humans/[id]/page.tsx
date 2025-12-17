'use client'

import * as React from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { ArrowLeft, Pencil, Plus, RefreshCw, Send } from "lucide-react"
import { toast } from "sonner"

import { supabase } from "@/lib/supabase"
import { upsertBotProfile } from "@/lib/botProfile"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"

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

  // Profile edit sheet
  const [profileOpen, setProfileOpen] = React.useState(false)
  const [profileSaving, setProfileSaving] = React.useState(false)
  const [editUsername, setEditUsername] = React.useState("")
  const [editProfession, setEditProfession] = React.useState("")
  const [editAge, setEditAge] = React.useState<string>("")
  const [editGender, setEditGender] = React.useState("")
  const [editZipcode, setEditZipcode] = React.useState("")
  const [editBio, setEditBio] = React.useState("")
  const [editAvatarFile, setEditAvatarFile] = React.useState<File | null>(null)

  // Post edit sheet
  const [postOpen, setPostOpen] = React.useState(false)
  const [postSaving, setPostSaving] = React.useState(false)
  const [editPost, setEditPost] = React.useState<DbPost | null>(null)
  const [editPostDescription, setEditPostDescription] = React.useState("")
  const [editPostFiles, setEditPostFiles] = React.useState<File[]>([])

  // Add post sheet
  const [addPostOpen, setAddPostOpen] = React.useState(false)
  const [addPostSaving, setAddPostSaving] = React.useState(false)
  const [newPostDescription, setNewPostDescription] = React.useState("")
  const [newPostFiles, setNewPostFiles] = React.useState<File[]>([])

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

  const openProfileEditor = () => {
    if (!user) return
    setEditUsername(user.username ?? "")
    setEditProfession(user.profession ?? "")
    setEditAge(user.age != null ? String(user.age) : "")
    setEditGender(user.gender ?? "")
    setEditZipcode(user.zipcode ?? "")
    setEditBio(user.bio ?? "")
    setEditAvatarFile(null)
    setProfileOpen(true)
  }

  const saveProfile = async () => {
    if (!user) return
    setProfileSaving(true)
    try {
      const updates: Partial<DbUser> & { updated_at?: string | null } = {
        username: editUsername.trim(),
        profession: editProfession.trim() || null,
        age: editAge ? Number(editAge) : null,
        gender: editGender.trim() || null,
        zipcode: editZipcode.trim() || null,
        bio: editBio.trim() || null,
      }

      // Upload avatar.jpg if provided
      let newAvatarUrl: string | null | undefined = undefined
      if (editAvatarFile) {
        const filePath = `${user.userid}/avatar.jpg`
        const { error: uploadError } = await supabase.storage
          .from("images")
          .upload(filePath, editAvatarFile, { upsert: true, contentType: editAvatarFile.type })
        if (uploadError) throw uploadError

        const { data: pub } = supabase.storage.from("images").getPublicUrl(filePath)
        newAvatarUrl = pub.publicUrl
        updates.avatar = newAvatarUrl
      }

      const { error } = await supabase.from("users").update(updates).eq("userid", user.userid)
      if (error) throw error

      toast.success("Profile updated")
      setUser((prev) => (prev ? { ...prev, ...updates } : prev))
      setProfileOpen(false)
    } catch (err: unknown) {
      console.error(err)
      toast.error(err instanceof Error ? err.message : "Failed to update profile")
    } finally {
      setProfileSaving(false)
    }
  }

  const openPostEditor = (p: DbPost) => {
    setEditPost(p)
    setEditPostDescription(p.description ?? "")
    setEditPostFiles([])
    setPostOpen(true)
  }

  const savePost = async () => {
    if (!user || !editPost) return
    setPostSaving(true)
    try {
      let photos = editPost.photos ?? []

      // If user uploaded new photos, overwrite post_1.jpg, post_2.jpg... in the user's folder
      if (editPostFiles.length > 0) {
        const urls: string[] = []
        for (let i = 0; i < editPostFiles.length; i++) {
          const f = editPostFiles[i]
          const filePath = `${user.userid}/post_${i + 1}.jpg`
          const { error: uploadError } = await supabase.storage
            .from("images")
            .upload(filePath, f, { upsert: true, contentType: f.type })
          if (uploadError) throw uploadError
          const { data: pub } = supabase.storage.from("images").getPublicUrl(filePath)
          urls.push(pub.publicUrl)
        }
        photos = urls
      }

      const { error } = await supabase
        .from("user_posts")
        .update({
          description: editPostDescription.trim() || null,
          photos,
        })
        .eq("id", editPost.id)

      if (error) throw error

      toast.success("Post updated")
      setPostOpen(false)
      setEditPost(null)
      void fetchPosts()
    } catch (err: unknown) {
      console.error(err)
      toast.error(err instanceof Error ? err.message : "Failed to update post")
    } finally {
      setPostSaving(false)
    }
  }

  const createPost = async () => {
    if (!user) return
    setAddPostSaving(true)
    try {
      const urls: string[] = []
      if (newPostFiles.length > 0) {
        for (let i = 0; i < newPostFiles.length; i++) {
          const f = newPostFiles[i]
          const filePath = `${user.userid}/post_${i + 1}.jpg`
          const { error: uploadError } = await supabase.storage
            .from("images")
            .upload(filePath, f, { upsert: true, contentType: f.type })
          if (uploadError) throw uploadError
          const { data: pub } = supabase.storage.from("images").getPublicUrl(filePath)
          urls.push(pub.publicUrl)
        }
      }

      const { error } = await supabase.from("user_posts").insert({
        userid: user.userid,
        photos: urls,
        description: newPostDescription.trim() || null,
      })
      if (error) throw error

      toast.success("Post created")
      setAddPostOpen(false)
      setNewPostDescription("")
      setNewPostFiles([])
      void fetchPosts()
    } catch (err: unknown) {
      console.error(err)
      toast.error(err instanceof Error ? err.message : "Failed to create post")
    } finally {
      setAddPostSaving(false)
    }
  }

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

  const handleRefreshBotProfile = () => {
    setSystemPrompt((prev) =>
      upsertBotProfile(prev, {
        name: user.username,
        age: user.age ?? null,
        archetype: user.profession ?? null,
        bio: user.bio ?? null,
      })
    )
    toast.success("Updated <bot_profile> from current user info")
  }

  return (
    <div className="max-w-6xl space-y-4">
      <Link href="/admin/digital-humans" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to List
      </Link>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left Column: User Info */}
        <div className="space-y-6">
          <Card className="p-6">
            <div className="flex items-start justify-between">
              <div className="text-sm font-medium">Profile</div>
              <Button variant="outline" size="sm" className="gap-2" onClick={openProfileEditor}>
                <Pencil className="h-4 w-4" />
                Edit
              </Button>
            </div>
            <Separator className="my-0" />

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

            <Separator className="my-0" />
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

          {/* System Prompt moved to left side */}
          <Card className="p-6">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium">System Prompt</div>
              <div className="flex items-center gap-2">
                {promptEditing ? (
                  <Button variant="outline" size="sm" className="gap-2" onClick={handleRefreshBotProfile}>
                    <RefreshCw className="h-4 w-4" />
                    Refresh
                  </Button>
                ) : null}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => (promptEditing ? handleUpdatePrompt() : setPromptEditing(true))}
                >
                  {promptEditing ? "Save" : "Edit"}
                </Button>
              </div>
            </div>
            {promptEditing ? (
              <Textarea
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                className="max-h-[400px]"
                rows={12}
              />
            ) : (
              <ScrollArea className="h-[400px] rounded-md border bg-muted/20 p-3">
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                {user.system_prompt ?? "—"}
                </p>
              </ScrollArea>
            )}
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
                  <div className="flex items-center justify-between gap-3 p-4">
                    <div className="text-sm text-muted-foreground">
                      {posts.length === 0 ? "No posts yet." : `${posts.length} posts`}
                    </div>
                    <Button variant="outline" size="sm" className="gap-2" onClick={() => setAddPostOpen(true)}>
                      <Plus className="h-4 w-4" />
                      Add post
                    </Button>
                  </div>
                  <Separator />
                  <div className="divide-y">
                    {posts.map((p) => (
                      <div key={p.id} className="p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-xs text-muted-foreground">
                            {new Date(p.created_at).toLocaleString()}
                          </div>
                          <Button variant="outline" size="sm" className="gap-2" onClick={() => openPostEditor(p)}>
                            <Pencil className="h-4 w-4" />
                            Edit
                          </Button>
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

      {/* Profile Edit Sheet */}
      <Sheet open={profileOpen} onOpenChange={setProfileOpen}>
        <SheetContent className="sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>Edit profile</SheetTitle>
            <SheetDescription>Update username, avatar, and details.</SheetDescription>
          </SheetHeader>

          <div className="space-y-4 px-4">
            <div className="space-y-2">
              <Label>Username</Label>
              <Input value={editUsername} onChange={(e) => setEditUsername(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Profession</Label>
              <Input value={editProfession} onChange={(e) => setEditProfession(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Age</Label>
                <Input type="number" min={0} value={editAge} onChange={(e) => setEditAge(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Gender</Label>
                <Input value={editGender} onChange={(e) => setEditGender(e.target.value)} placeholder="e.g. Male" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Zipcode</Label>
              <Input value={editZipcode} onChange={(e) => setEditZipcode(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Bio</Label>
              <Textarea rows={4} value={editBio} onChange={(e) => setEditBio(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Avatar (saved as avatar.jpg)</Label>
              <Input type="file" accept="image/*" onChange={(e) => setEditAvatarFile(e.target.files?.[0] ?? null)} />
            </div>
          </div>

          <SheetFooter>
            <Button variant="outline" onClick={() => setProfileOpen(false)} disabled={profileSaving}>
              Cancel
            </Button>
            <Button onClick={saveProfile} disabled={profileSaving || !editUsername.trim()}>
              {profileSaving ? "Saving..." : "Save changes"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Post Edit Sheet */}
      <Sheet open={postOpen} onOpenChange={setPostOpen}>
        <SheetContent className="sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>Edit post</SheetTitle>
            <SheetDescription>Edit description and optionally replace photos.</SheetDescription>
          </SheetHeader>

          <div className="space-y-4 px-4">
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea rows={4} value={editPostDescription} onChange={(e) => setEditPostDescription(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Replace photos (uploads to post_1.jpg, post_2.jpg...)</Label>
              <Input
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => setEditPostFiles(Array.from(e.target.files ?? []))}
              />
              <p className="text-xs text-muted-foreground">
                If you upload new photos, they will overwrite the existing post images.
              </p>
            </div>
          </div>

          <SheetFooter>
            <Button variant="outline" onClick={() => setPostOpen(false)} disabled={postSaving}>
              Cancel
            </Button>
            <Button onClick={savePost} disabled={postSaving || !editPost}>
              {postSaving ? "Saving..." : "Save post"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Add Post Sheet */}
      <Sheet open={addPostOpen} onOpenChange={setAddPostOpen}>
        <SheetContent className="sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>Add post</SheetTitle>
            <SheetDescription>Create a new post for this digital human.</SheetDescription>
          </SheetHeader>

          <div className="space-y-4 px-4">
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                rows={4}
                value={newPostDescription}
                onChange={(e) => setNewPostDescription(e.target.value)}
                placeholder="Write something..."
              />
            </div>
            <div className="space-y-2">
              <Label>Photos (uploads to post_1.jpg, post_2.jpg...)</Label>
              <Input
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => setNewPostFiles(Array.from(e.target.files ?? []))}
              />
              <p className="text-xs text-muted-foreground">
                Uploading will overwrite existing post_*.jpg files under this user folder.
              </p>
            </div>
          </div>

          <SheetFooter>
            <Button variant="outline" onClick={() => setAddPostOpen(false)} disabled={addPostSaving}>
              Cancel
            </Button>
            <Button onClick={createPost} disabled={addPostSaving}>
              {addPostSaving ? "Creating..." : "Create post"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
