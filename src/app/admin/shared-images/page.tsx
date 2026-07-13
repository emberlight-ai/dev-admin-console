"use client"

import * as React from "react"
import Link from "next/link"
import { Folder, ImageIcon } from "lucide-react"

import { Card } from "@/components/ui/card"

// The shared chat-image library, organized into folders. A "folder" maps to a
// dh_image_tier (matching the selfie ladder). Only "casual" exists for now;
// tease/reward folders light up automatically once they hold images.
type FolderMeta = { tier: string; label: string; description: string }

const FOLDERS: FolderMeta[] = [
  { tier: "casual", label: "Casual", description: "Everyday, safe-for-all photos any digital human can send." },
  { tier: "tease", label: "Tease", description: "Flirtier photos, unlocked as a conversation warms up." },
  { tier: "reward", label: "Reward", description: "The most intimate tier, gated behind high intimacy." },
]

export default function SharedImagesPage() {
  const [counts, setCounts] = React.useState<Record<string, number>>({})

  React.useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/admin/shared-images/counts")
        if (res.ok) setCounts((await res.json()).counts ?? {})
      } catch {
        /* counts are decorative; ignore */
      }
    })()
  }, [])

  return (
    <div className="max-w-5xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Chat Images</h1>
        <p className="text-sm text-muted-foreground">
          A shared photo library every digital human draws from. Each user only ever receives a
          given image once — no matter which digital human sends it.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FOLDERS.map((f) => (
          <Link key={f.tier} href={`/admin/shared-images/${f.tier}`}>
            <Card className="group flex h-full flex-col gap-3 p-5 transition-colors hover:border-primary/60">
              <div className="flex items-center justify-between">
                <Folder className="h-8 w-8 text-primary" />
                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs font-semibold">
                  <ImageIcon className="h-3.5 w-3.5" />
                  {counts[f.tier] ?? 0}
                </span>
              </div>
              <div>
                <div className="text-base font-semibold capitalize">{f.label}</div>
                <div className="mt-1 text-xs text-muted-foreground">{f.description}</div>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}
