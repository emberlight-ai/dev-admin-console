'use client'

import * as React from "react"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Copy, Pencil } from "lucide-react"

import type { DbUser } from "./types"
import { toast } from "sonner"

export function ProfileCard({
  user,
  avatarSrc,
  onEdit,
  onZoomAvatar,
  computedSystemPrompt,
}: {
  user: DbUser
  avatarSrc?: string
  onEdit: () => void
  onZoomAvatar: () => void
  computedSystemPrompt?: string | null
}) {
  return (
    <div className="space-y-6">
      <Card className="p-6">
        <div className="flex items-start justify-between">
          <div className="text-sm font-medium">Profile</div>
          <Button variant="outline" size="sm" className="gap-2" onClick={onEdit}>
            <Pencil className="h-4 w-4" />
            Edit
          </Button>
        </div>
        <Separator className="my-0" />

        <div className="flex flex-col items-center text-center">
          <button
            type="button"
            className="group rounded-full"
            onClick={onZoomAvatar}
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
            <dt className="text-muted-foreground">Personality</dt>
            <dd>{user.personality ?? "—"}</dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-muted-foreground">Location</dt>
            <dd>{user.zipcode ?? "—"}</dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-muted-foreground">User ID</dt>
            <dd>
              <Button variant="ghost" size="sm" onClick={() => {
                navigator.clipboard.writeText(user.userid)
                toast.success("User ID copied to clipboard")
              }}>
                <Copy className="h-4 w-4" />
                Copy
              </Button>
            </dd>
          </div>
          <div className="space-y-1">
            <dt className="text-muted-foreground">Bio</dt>
            <dd className="text-sm">{user.bio ?? "—"}</dd>
          </div>
        </dl>
      </Card>

      <Card className="p-6">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium">System Prompt</div>
        </div>
        <ScrollArea className="h-[400px] rounded-md border bg-muted/20 p-3">
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">
            {computedSystemPrompt ?? "—"}
          </p>
        </ScrollArea>
        <p className="mt-2 text-xs text-muted-foreground">
          Composed at runtime from the latest template for this gender/personality, plus this digital human’s profile.
        </p>
      </Card>
    </div>
  )
}


