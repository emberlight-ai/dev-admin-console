"use client"

import * as React from "react"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"

export type FileDropzoneProps = {
  label: string
  helper?: string
  multiple?: boolean
  accept?: string
  filesCount?: number
  preview?: React.ReactNode
  disabled?: boolean
  onPickFiles: (files: File[]) => void
  onClear?: () => void
  className?: string
}

export function FileDropzone({
  label,
  helper,
  multiple,
  accept,
  filesCount = 0,
  preview,
  disabled,
  onPickFiles,
  onClear,
  className,
}: FileDropzoneProps) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = React.useState(false)

  return (
    <div className={className}>
      <div className="space-y-2">
        <Label>{label}</Label>
        <div
          className={
            "rounded-lg border border-dashed p-4 transition-colors " +
            (dragOver ? "border-primary bg-primary/5" : "bg-muted/30") +
            (disabled ? " pointer-events-none opacity-60" : "")
          }
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragOver(false)
            onPickFiles(Array.from(e.dataTransfer.files ?? []))
          }}
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault()
              inputRef.current?.click()
            }
          }}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <div className="text-sm font-medium">
                {filesCount > 0
                  ? `${filesCount} file${filesCount === 1 ? "" : "s"} selected`
                  : "Drop files here"}
              </div>
              {helper ? <div className="text-xs text-muted-foreground">{helper}</div> : null}
            </div>
            <div className="flex items-center gap-2">
              {onClear ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation()
                    onClear()
                  }}
                  disabled={disabled}
                >
                  Clear
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation()
                  inputRef.current?.click()
                }}
                disabled={disabled}
              >
                Choose files
              </Button>
            </div>
          </div>

          {preview ? <div className="mt-4">{preview}</div> : null}

          <input
            ref={inputRef}
            type="file"
            accept={accept}
            multiple={multiple}
            className="hidden"
            onChange={(e) => onPickFiles(Array.from(e.target.files ?? []))}
            disabled={disabled}
          />
        </div>
      </div>
    </div>
  )
}


