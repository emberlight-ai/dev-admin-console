'use client'

import * as React from "react"

import { Dialog, DialogContent, DialogTitle, DialogXCloseButton } from "@/components/ui/dialog"

export function ImageZoomDialog({
  src,
  onClose,
}: {
  src: string | null
  onClose: () => void
}) {
  if (!src) return null

  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent className="border-0 bg-transparent p-0 shadow-none" onClick={onClose}>
        <DialogTitle className="sr-only">Image preview</DialogTitle>
        <DialogXCloseButton />
        <div className="flex items-center justify-center p-4">
          <div
            className="max-h-[90vh] max-w-[94vw] overflow-hidden rounded-xl border bg-background/10 backdrop-blur"
            onClick={(e) => e.stopPropagation()}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt="full" className="max-h-[90vh] max-w-[94vw] object-contain" />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}


