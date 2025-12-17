'use client'

import * as React from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { toast } from "sonner"

import { supabase } from "@/lib/supabase"
import { Card } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

import { ImageZoomDialog } from "./_components/image-zoom-dialog"
import { ProfileCard } from "./_components/profile-card"
import { ProfileEditSheet } from "./_components/profile-edit-sheet"
import { ChatPanel } from "./_components/chat-panel"
import { PostsPanel } from "./_components/posts-panel"
import type { DbUser } from "./_components/types"

export default function DigitalHumanDetail() {
  const { id } = useParams();
  const [user, setUser] = React.useState<DbUser | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [zoomSrc, setZoomSrc] = React.useState<string | null>(null)
  const [profileOpen, setProfileOpen] = React.useState(false)

  // (FileDropzone extracted to src/components/file-dropzone.tsx)

  React.useEffect(() => {
    if (!id) return;
    void fetchUser();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

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

  if (loading) return <div className="text-sm text-muted-foreground">Loading...</div>
  if (!user) return <div className="text-sm text-muted-foreground">User not found</div>

  const avatarV = user.updated_at || user.created_at || ""
  const avatarSrc = `/api/avatar/${user.userid}${avatarV ? `?v=${encodeURIComponent(avatarV)}` : ""}`

  return (
    <div className="max-w-6xl space-y-4">
      <Link href="/admin/digital-humans" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to List
      </Link>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left Column: User Info */}
        <div>
          <ProfileCard
            user={user}
            avatarSrc={avatarSrc}
            onEdit={() => setProfileOpen(true)}
            onZoomAvatar={() => setZoomSrc(avatarSrc)}
          />
        </div>

        {/* Right Column: Tabs (Chat & Posts) */}
        <div className="lg:col-span-2">
          <Card className="p-6">
            <Tabs defaultValue="posts" className="w-full">
              <TabsList>
              <TabsTrigger value="posts">Post History</TabsTrigger>
                <TabsTrigger value="chat">Chat &amp; Tuning</TabsTrigger>
              </TabsList>

              <TabsContent value="chat">
                <ChatPanel systemPrompt={user.system_prompt} />
              </TabsContent>

              <TabsContent value="posts" className="mt-4">
                <PostsPanel userid={user.userid} onZoom={(src) => setZoomSrc(src)} />
              </TabsContent>
            </Tabs>
          </Card>
        </div>
      </div>

      <ProfileEditSheet
        open={profileOpen}
        onOpenChange={setProfileOpen}
        user={user}
        avatarSrc={avatarSrc}
        onSaved={(updates) => setUser((prev) => (prev ? { ...prev, ...updates } : prev))}
      />

      <ImageZoomDialog src={zoomSrc} onClose={() => setZoomSrc(null)} />
    </div>
  );
}
