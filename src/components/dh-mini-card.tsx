"use client"

import * as React from "react"
import { Camera, HeartHandshake, ImageIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"

/**
 * The minimal digital-human card — THE way a DH appears in any list, board or
 * picker (see design.md → Patterns → "DH mini-card"). Always shows: avatar,
 * name, status dots (blue = Featured, orange = Whitelisted), persona · gender,
 * and the three ledger counts (matches, chat images, posts).
 *
 * Purely presentational: drag handlers, selection state and action buttons
 * come from the caller (`actions` renders on the right, extra div props — e.g.
 * draggable/onDragStart — spread onto the root).
 */
export type DhMiniCardData = {
  userid: string
  username: string | null
  gender: string | null
  personality: string | null
  updated_at: string | null
  whitelisted?: boolean
  featured?: boolean
  match_count?: number
  chat_image_count?: number
  post_count?: number
}

export function DhMiniCard({
  dh,
  subtitleSuffix,
  actions,
  className,
  ...divProps
}: {
  dh: DhMiniCardData
  /** Appended to the "persona · gender" line (e.g. " → High effort"). */
  subtitleSuffix?: string
  /** Right-side slot (View button, remove ✕, …). */
  actions?: React.ReactNode
  className?: string
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("group flex items-center gap-3 rounded-lg border bg-card p-2.5", className)}
      {...divProps}
    >
      <Avatar className="h-11 w-11 shrink-0">
        {/* lazy: big boards must not fire one avatar request per roster row. */}
        <AvatarImage
          loading="lazy"
          src={`/api/avatar/${dh.userid}?v=${encodeURIComponent(dh.updated_at || "")}`}
          alt={dh.username ?? ""}
        />
        <AvatarFallback className="text-xs">{(dh.username ?? "?").slice(0, 2).toUpperCase()}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium">{dh.username ?? "Unknown"}</span>
          {dh.featured && (
            <span title="Featured (Explore spotlight)" className="h-2 w-2 shrink-0 rounded-full bg-blue-500" />
          )}
          {dh.whitelisted && (
            <span title="Whitelisted (home swipe deck)" className="h-2 w-2 shrink-0 rounded-full bg-amber-500" />
          )}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {dh.personality ?? "—"}
          {dh.gender ? ` · ${dh.gender}` : ""}
          {subtitleSuffix ?? ""}
        </div>
        <div className="mt-0.5 flex items-center gap-2.5 text-[11px] text-muted-foreground tabular-nums">
          <span className="inline-flex items-center gap-1" title="Matches">
            <HeartHandshake className="h-3 w-3" /> {dh.match_count ?? 0}
          </span>
          <span className="inline-flex items-center gap-1" title="Chat images">
            <ImageIcon className="h-3 w-3" /> {dh.chat_image_count ?? 0}
          </span>
          <span className="inline-flex items-center gap-1" title="Posts">
            <Camera className="h-3 w-3" /> {dh.post_count ?? 0}
          </span>
        </div>
      </div>
      {actions ? <div className="shrink-0">{actions}</div> : null}
    </div>
  )
}
