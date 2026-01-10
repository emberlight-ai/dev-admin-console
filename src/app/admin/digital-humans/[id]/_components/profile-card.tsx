'use client'

import * as React from "react"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Copy, Pencil, Settings2, CheckCircle2, CircleMinus } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogXCloseButton,
} from "@/components/ui/dialog"

import type { DbUser } from "./types"
import { toast } from "sonner"
import { SystemPromptForm } from "@/app/admin/system-prompts/manage/_components/system-prompt-form"

export function ProfileCard({
  user,
  avatarSrc,
  onEdit,
  onZoomAvatar,
  systemPromptMeta,
  onPromptSaved,
}: {
  user: DbUser
  avatarSrc?: string
  onEdit: () => void
  onZoomAvatar: () => void
  systemPromptMeta?: {
    response_delay: number
    immediate_match_enabled: boolean
    follow_up_message_enabled: boolean
    active_greeting_enabled: boolean
    follow_up_delay: number
    max_follow_ups: number
    created_at: string | null
    gender: string
    personality: string
  } | null
  onPromptSaved?: () => void
}) {
  const [configOpen, setConfigOpen] = React.useState(false)

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <div className="flex items-start justify-between">
          <div className="text-sm font-medium">Profile</div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="gap-2" onClick={onEdit}>
              <Pencil className="h-4 w-4" />
              Edit
            </Button>
          </div>
        </div>

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
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-2 min-w-0">
            <div className="text-sm font-medium whitespace-nowrap">
              Personality
            </div>
            {user.personality ? (
              <span className="inline-flex items-center rounded-full border bg-muted/40 px-3 py-1 text-sm font-medium text-foreground truncate max-w-[260px] leading-none">
                {user.personality}
              </span>
            ) : (
              <span className="text-sm text-muted-foreground">—</span>
            )}
          </div>
          <Button
            variant="outline"
            size="icon"
            aria-label="Configure automation settings"
            title="Configure automation settings"
            onClick={() => setConfigOpen(true)}
          >
            <Settings2 className="h-4 w-4" />
          </Button>
        </div>
        <Separator className="my-0" />
        <dl className="space-y-3 text-sm">
          <div className="flex items-center justify-between gap-4">
            <dt className="text-muted-foreground">Response Delay</dt>
            <dd>{(systemPromptMeta?.response_delay ?? 0) > 0 ? `${systemPromptMeta?.response_delay}s` : "Instant"}</dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-muted-foreground">Immediate Match</dt>
            <dd>
              {systemPromptMeta?.immediate_match_enabled ? (
                <CheckCircle2 className="h-4 w-4 text-green-600" />
              ) : (
                <CircleMinus className="h-4 w-4 text-gray-400" />
              )}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-muted-foreground">Follow-up</dt>
            <dd className="flex items-center gap-2">
              {systemPromptMeta?.follow_up_message_enabled ? (
                <>
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  <span className="text-xs text-muted-foreground">
                    (delay {systemPromptMeta.follow_up_delay}s, max {systemPromptMeta.max_follow_ups})
                  </span>
                </>
              ) : (
                <CircleMinus className="h-4 w-4 text-gray-400" />
              )}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-muted-foreground">Greeting</dt>
            <dd>
              {systemPromptMeta?.active_greeting_enabled ? (
                <CheckCircle2 className="h-4 w-4 text-green-600" />
              ) : (
                <CircleMinus className="h-4 w-4 text-gray-400" />
              )}
            </dd>
          </div>
        </dl>
      </Card>

      <Dialog open={configOpen} onOpenChange={setConfigOpen}>
        <DialogContent className="sm:max-w-4xl max-h-[85vh] overflow-y-auto p-6">
          <DialogXCloseButton />
          <DialogHeader>
            <DialogTitle>System Prompt Configuration</DialogTitle>
          </DialogHeader>
          <SystemPromptForm
            initialGender={(systemPromptMeta?.gender || user.gender || "Female") as string}
            initialPersonality={(systemPromptMeta?.personality || user.personality || "General") as string}
            disableKeyEdit={true}
            variant="dialog"
            onCancel={() => setConfigOpen(false)}
            onSaved={() => {
              setConfigOpen(false)
              onPromptSaved?.()
              toast.success("Prompt updated")
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  )
}


