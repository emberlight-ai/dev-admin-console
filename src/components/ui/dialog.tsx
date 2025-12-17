"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { XIcon } from "lucide-react"

import { cn } from "@/lib/utils"

function Dialog(props: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger(props: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal(props: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose(props: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
        className
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          "fixed left-[50%] top-[50%] z-50 w-full max-w-[min(92vw,980px)] translate-x-[-50%] translate-y-[-50%] rounded-lg border bg-background p-0 shadow-lg",
          "data-[state=open]:animate-in data-[state=closed]:animate-out",
          "data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
          "data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95",
          className
        )}
        {...props}
      />
    </DialogPortal>
  )
}

function DialogHeader(props: React.ComponentProps<"div">) {
  const { className, ...rest } = props
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-1.5 p-4 text-center sm:text-left", className)}
      {...rest}
    />
  )
}

function DialogFooter(props: React.ComponentProps<"div">) {
  const { className, ...rest } = props
  return (
    <div
      data-slot="dialog-footer"
      className={cn("flex flex-col-reverse gap-2 p-4 sm:flex-row sm:justify-end", className)}
      {...rest}
    />
  )
}

function DialogTitle(props: React.ComponentProps<typeof DialogPrimitive.Title>) {
  const { className, ...rest } = props
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-lg font-semibold leading-none tracking-tight", className)}
      {...rest}
    />
  )
}

function DialogDescription(
  props: React.ComponentProps<typeof DialogPrimitive.Description>
) {
  const { className, ...rest } = props
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...rest}
    />
  )
}

function DialogXCloseButton() {
  return (
    <DialogClose className="absolute right-3 top-3 rounded-md p-2 opacity-80 transition hover:opacity-100 focus:outline-hidden focus:ring-2 focus:ring-ring">
      <XIcon className="h-4 w-4" />
      <span className="sr-only">Close</span>
    </DialogClose>
  )
}

export {
  Dialog,
  DialogTrigger,
  DialogPortal,
  DialogOverlay,
  DialogContent,
  DialogClose,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  DialogXCloseButton,
}


