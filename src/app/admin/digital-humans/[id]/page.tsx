'use client'

import * as React from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { ArrowLeft, Pencil, Plus, Send, Trash2, X } from "lucide-react"
import { toast } from "sonner"

import { supabase } from "@/lib/supabase"
import { buildSystemPrompt } from "@/lib/botProfile"
import { FileDropzone } from "@/components/file-dropzone"
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
  Dialog,
  DialogContent,
  DialogXCloseButton,
} from "@/components/ui/dialog"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"

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

const MAX_FILE_BYTES = 5 * 1024 * 1024
const ACCEPTED_MIME = new Set(["image/jpeg", "image/png"])
const ACCEPT_ATTR = "image/jpeg,image/png"

export default function DigitalHumanDetail() {
  const { id } = useParams();
  const [user, setUser] = React.useState<DbUser | null>(null)
  const [posts, setPosts] = React.useState<DbPost[]>([])
  const [loading, setLoading] = React.useState(true)
  const [avatarBust, setAvatarBust] = React.useState<number>(0)
  const [zoomSrc, setZoomSrc] = React.useState<string | null>(null)
  
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
  const [editPostPhotos, setEditPostPhotos] = React.useState<string[]>([])

  // Add post sheet
  const [addPostOpen, setAddPostOpen] = React.useState(false)
  const [addPostSaving, setAddPostSaving] = React.useState(false)
  const [newPostDescription, setNewPostDescription] = React.useState("")
  const [newPostFiles, setNewPostFiles] = React.useState<File[]>([])

  const validateFiles = React.useCallback(
    (files: File[]) => {
      const valid: File[] = []
      const errors: string[] = []
      for (const f of files) {
        if (!ACCEPTED_MIME.has(f.type)) {
          errors.push(`${f.name}: only JPG/PNG supported`)
          continue
        }
        if (f.size > MAX_FILE_BYTES) {
          errors.push(`${f.name}: file must be under 5MB`)
          continue
        }
        valid.push(f)
      }
      return { valid, errors }
    },
    []
  )

  const avatarPreviewUrl = React.useMemo(() => {
    if (!editAvatarFile) return null
    return URL.createObjectURL(editAvatarFile)
  }, [editAvatarFile])

  React.useEffect(() => {
    return () => {
      if (avatarPreviewUrl) URL.revokeObjectURL(avatarPreviewUrl)
    }
  }, [avatarPreviewUrl])

  const editPostPreviewUrls = React.useMemo(
    () => editPostFiles.map((f) => ({ file: f, url: URL.createObjectURL(f) })),
    [editPostFiles]
  )

  React.useEffect(() => {
    return () => {
      editPostPreviewUrls.forEach((p) => URL.revokeObjectURL(p.url))
    }
  }, [editPostPreviewUrls])

  const newPostPreviewUrls = React.useMemo(
    () => newPostFiles.map((f) => ({ file: f, url: URL.createObjectURL(f) })),
    [newPostFiles]
  )

  React.useEffect(() => {
    return () => {
      newPostPreviewUrls.forEach((p) => URL.revokeObjectURL(p.url))
    }
  }, [newPostPreviewUrls])

  // (FileDropzone extracted to src/components/file-dropzone.tsx)

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
    }
    setLoading(false);
  };

  const avatarSrc = React.useMemo(() => {
    if (!user?.userid) return undefined
    const base = `/api/avatar/${user.userid}`
    return avatarBust ? `${base}?v=${avatarBust}` : base
  }, [user?.userid, avatarBust])

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

      // Always (re)generate the system prompt from the latest profile info.
      updates.system_prompt = buildSystemPrompt({
        name: updates.username ?? user.username,
        age: updates.age ?? user.age ?? null,
        archetype: updates.profession ?? user.profession ?? null,
        bio: updates.bio ?? user.bio ?? null,
      })

      // Upload avatar.jpg if provided
      let newAvatarUrl: string | null | undefined = undefined
      if (editAvatarFile) {
        if (!ACCEPTED_MIME.has(editAvatarFile.type)) {
          toast.error("Avatar must be a JPG or PNG under 5MB")
          return
        }
        if (editAvatarFile.size > MAX_FILE_BYTES) {
          toast.error("Avatar must be under 5MB")
          return
        }
        const filePath = `${user.userid}/avatar.jpg`
        const { error: uploadError } = await supabase.storage
          .from("images")
          .upload(filePath, editAvatarFile, { upsert: true, contentType: editAvatarFile.type })
        if (uploadError) throw uploadError

        const { data: pub } = supabase.storage.from("images").getPublicUrl(filePath)
        newAvatarUrl = pub.publicUrl
        updates.avatar = newAvatarUrl
        // Bust browser/CDN cache for this session (same URL path gets cached aggressively)
        setAvatarBust(Date.now())
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
    setEditPostPhotos(p.photos ?? [])
    setPostOpen(true)
  }

  const savePost = async () => {
    if (!user || !editPost) return
    setPostSaving(true)
    try {
      let photos = editPostPhotos ?? []

      // If user uploaded new photos, ADD them (do not replace existing).
      // We save them as /<userid>/post_<postId>/<n>.jpg and append URLs to `photos`.
      if (editPostFiles.length > 0) {
        const remainingSlots = Math.max(0, 9 - photos.length)
        if (remainingSlots === 0) {
          toast.error("Max 9 images per post")
          return
        }

        if (editPostFiles.length > remainingSlots) toast.error("Max 9 images per post")
        const { valid, errors } = validateFiles(editPostFiles.slice(0, remainingSlots))
        if (errors.length) {
          toast.error(errors[0])
          return
        }

        const existingNumbers = (photos ?? [])
          .map((u) => {
            const m = u.match(new RegExp(`/post_${editPost.id}/(\\d+)\\.jpg`, "i"))
            return m ? Number(m[1]) : null
          })
          .filter((n): n is number => typeof n === "number" && Number.isFinite(n))
        const startIndex = (existingNumbers.length ? Math.max(...existingNumbers) : 0) + 1

        const urls: string[] = []
        for (let i = 0; i < valid.length; i++) {
          const f = valid[i]
          const filePath = `${user.userid}/post_${editPost.id}/${startIndex + i}.jpg`
          const { error: uploadError } = await supabase.storage
            .from("images")
            .upload(filePath, f, { upsert: true, contentType: f.type })
          if (uploadError) throw uploadError
          const { data: pub } = supabase.storage.from("images").getPublicUrl(filePath)
          urls.push(pub.publicUrl)
        }
        photos = [...photos, ...urls]
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
      setEditPostPhotos([])
      void fetchPosts()
    } catch (err: unknown) {
      console.error(err)
      toast.error(err instanceof Error ? err.message : "Failed to update post")
    } finally {
      setPostSaving(false)
    }
  }

  const deletePost = async () => {
    if (!editPost) return
    setPostSaving(true)
    try {
      const { error } = await supabase.from("user_posts").delete().eq("id", editPost.id)
      if (error) throw error
      toast.success("Post deleted")
      setPostOpen(false)
      setEditPost(null)
      setEditPostDescription("")
      setEditPostFiles([])
      setEditPostPhotos([])
      void fetchPosts()
    } catch (err: unknown) {
      console.error(err)
      toast.error(err instanceof Error ? err.message : "Failed to delete post")
    } finally {
      setPostSaving(false)
    }
  }

  const createPost = async () => {
    if (!user) return
    setAddPostSaving(true)
    try {
      // Create the row first so we can use the post id as a unique storage folder
      const { data: created, error: createError } = await supabase
        .from("user_posts")
        .insert({
          userid: user.userid,
          photos: [],
          description: newPostDescription.trim() || null,
        })
        .select("id")
        .single()

      if (createError) throw createError

      const urls: string[] = []
      if (newPostFiles.length > 0) {
        const { valid, errors } = validateFiles(newPostFiles.slice(0, 9))
        if (errors.length) {
          toast.error(errors[0])
          return
        }
        if (newPostFiles.length > 9) toast.error("Max 9 images per post")
        for (let i = 0; i < valid.length; i++) {
          const f = valid[i]
          const filePath = `${user.userid}/post_${created.id}/${i + 1}.jpg`
          const { error: uploadError } = await supabase.storage
            .from("images")
            .upload(filePath, f, { upsert: true, contentType: f.type })
          if (uploadError) throw uploadError
          const { data: pub } = supabase.storage.from("images").getPublicUrl(filePath)
          urls.push(pub.publicUrl)
        }
      }

      if (urls.length > 0) {
        const { error: updErr } = await supabase
          .from("user_posts")
          .update({ photos: urls })
          .eq("id", created.id)
        if (updErr) throw updErr
      }

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
            <div className="flex items-start justify-between">
              <div className="text-sm font-medium">Profile</div>
              <Button variant="outline" size="sm" className="gap-2" onClick={openProfileEditor}>
                <Pencil className="h-4 w-4" />
                Edit
              </Button>
            </div>
            <Separator className="my-0" />

            <div className="flex flex-col items-center text-center">
              <button
                type="button"
                className="group rounded-full"
                onClick={() => setZoomSrc(avatarSrc ?? null)}
                aria-label="View avatar"
              >
                <Avatar className="h-28 w-28 overflow-hidden">
                  <AvatarImage
                    src={avatarSrc}
                    alt={user.username}
                    className="transition-transform duration-200 group-hover:scale-[1.06]"
                  />
                  <AvatarFallback>{user.username.slice(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
              </button>
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
            </div>
            <ScrollArea className="h-[400px] rounded-md border bg-muted/20 p-3">
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                {user.system_prompt ?? "—"}
              </p>
            </ScrollArea>
            <p className="mt-2 text-xs text-muted-foreground">
              Auto-generated from profile fields; updates when you save profile changes.
            </p>
          </Card>
        </div>

        {/* Right Column: Tabs (Chat & Posts) */}
        <div className="lg:col-span-2">
          <Card className="p-6">
            <Tabs defaultValue="posts" className="w-full">
              <TabsList>
              <TabsTrigger value="posts">Post History</TabsTrigger>
                <TabsTrigger value="chat">Chat &amp; Tuning</TabsTrigger>
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
                            {new Date(p.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
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
                              /* eslint-disable-next-line @next/next/no-img-element */
                              <img
                                key={url}
                                src={url}
                                alt="post"
                                className="h-28 w-full cursor-zoom-in rounded-md object-cover transition-transform duration-200 hover:scale-[1.03]"
                                onClick={() => setZoomSrc(url)}
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
            <FileDropzone
              label="Avatar"
              helper="JPG/PNG only, max 5MB. Saved as avatar.jpg."
              accept={ACCEPT_ATTR}
              filesCount={editAvatarFile ? 1 : 0}
              onPickFiles={(files) => {
                const { valid, errors } = validateFiles(files)
                if (errors.length) toast.error(errors[0])
                setEditAvatarFile(valid[0] ?? null)
              }}
              onClear={editAvatarFile ? () => setEditAvatarFile(null) : undefined}
              preview={
                <div className="flex items-center gap-3">
                  <div className="h-16 w-16 overflow-hidden rounded-full border bg-muted">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={avatarPreviewUrl ?? avatarSrc ?? ""}
                      alt="avatar preview"
                      className="h-full w-full object-cover"
                    />
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {editAvatarFile ? editAvatarFile.name : "Current avatar"}
                  </div>
                </div>
              }
            />
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
            <FileDropzone
              label="Add photos"
              helper="JPG/PNG only, max 5MB each, up to 9 images total. Adds to this post (does not replace existing)."
              accept={ACCEPT_ATTR}
              multiple
              filesCount={editPostFiles.length}
              onPickFiles={(files) => {
                // Append to existing selection (do not replace)
                const remaining = Math.max(0, 9 - editPostPhotos.length - editPostFiles.length)
                if (remaining === 0) {
                  toast.error("Max 9 images per post")
                  return
                }
                if (files.length > remaining) toast.error("Max 9 images per post")
                const { valid, errors } = validateFiles(files.slice(0, remaining))
                if (errors.length) toast.error(errors[0])
                setEditPostFiles((prev) => [...prev, ...valid])
              }}
              onClear={editPostFiles.length ? () => setEditPostFiles([]) : undefined}
              preview={
                editPostPhotos.length || editPostFiles.length ? (
                  <div className="grid grid-cols-3 gap-2">
                    {editPostPhotos.slice(0, 9).map((url) => (
                      <div key={url} className="relative aspect-square overflow-hidden rounded-md border bg-muted">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={url}
                          alt="existing"
                          className="h-full w-full cursor-zoom-in object-cover transition-transform duration-200 hover:scale-[1.03]"
                          onClick={() => setZoomSrc(url)}
                        />
                        <Button
                          type="button"
                          size="icon"
                          variant="secondary"
                          className="absolute right-1 top-1 h-7 w-7"
                          onClick={(e) => {
                            e.stopPropagation()
                            setEditPostPhotos((prev) => prev.filter((u) => u !== url))
                          }}
                          title="Remove image"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}

                    {editPostPreviewUrls.slice(0, Math.max(0, 9 - editPostPhotos.length)).map((p) => (
                      <div key={p.url} className="relative aspect-square overflow-hidden rounded-md border bg-muted">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={p.url}
                          alt={p.file.name}
                          className="h-full w-full cursor-zoom-in object-cover transition-transform duration-200 hover:scale-[1.03]"
                          onClick={() => setZoomSrc(p.url)}
                        />
                        <Button
                          type="button"
                          size="icon"
                          variant="secondary"
                          className="absolute right-1 top-1 h-7 w-7"
                          onClick={(e) => {
                            e.stopPropagation()
                            setEditPostFiles((prev) => prev.filter((f) => f !== p.file))
                          }}
                          title="Remove pending upload"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : null
              }
            />
          </div>

          <SheetFooter>
            <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" disabled={postSaving || !editPost} className="gap-2">
                    <Trash2 className="h-4 w-4" />
                    Delete post
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete this post?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will permanently delete the post row. (Images in storage are not removed automatically.)
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => void deletePost()}>Delete</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>

              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button variant="outline" onClick={() => setPostOpen(false)} disabled={postSaving}>
                  Cancel
                </Button>
                <Button onClick={savePost} disabled={postSaving || !editPost}>
                  {postSaving ? "Saving..." : "Save post"}
                </Button>
              </div>
            </div>
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
            <FileDropzone
              label="Photos"
              helper="JPG/PNG only, max 5MB each, up to 9 images."
              accept={ACCEPT_ATTR}
              multiple
              filesCount={newPostFiles.length}
              onPickFiles={(files) => {
                if (files.length > 9) toast.error("Max 9 images per post")
                const { valid, errors } = validateFiles(files.slice(0, 9))
                if (errors.length) toast.error(errors[0])
                setNewPostFiles(valid)
              }}
              onClear={newPostFiles.length ? () => setNewPostFiles([]) : undefined}
              preview={
                newPostFiles.length ? (
                  <div className="grid grid-cols-3 gap-2">
                    {newPostPreviewUrls.slice(0, 9).map((p) => (
                      <div key={p.url} className="aspect-square overflow-hidden rounded-md border bg-muted">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={p.url}
                          alt={p.file.name}
                          className="h-full w-full cursor-zoom-in object-cover transition-transform duration-200 hover:scale-[1.03]"
                          onClick={() => setZoomSrc(p.url)}
                        />
                      </div>
                    ))}
                  </div>
                ) : null
              }
            />
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

      {/* Global image zoom dialog */}
      <Dialog open={!!zoomSrc} onOpenChange={(o) => (!o ? setZoomSrc(null) : null)}>
        <DialogContent
          className="border-0 bg-transparent p-0 shadow-none"
          onClick={() => setZoomSrc(null)}
        >
          <DialogXCloseButton />
          <div className="flex items-center justify-center p-4">
            <div
              className="max-h-[90vh] max-w-[94vw] overflow-hidden rounded-xl border bg-background/10 backdrop-blur"
              onClick={(e) => e.stopPropagation()}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={zoomSrc ?? ""}
                alt="full"
                className="max-h-[90vh] max-w-[94vw] object-contain"
              />
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
