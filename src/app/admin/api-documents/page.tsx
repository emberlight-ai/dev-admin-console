'use client'

import * as React from "react"

import { Card } from "@/components/ui/card"

export default function ApiDocumentsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">API Documents</h1>
        <p className="text-sm text-muted-foreground">
          Backend API reference and integration notes.
        </p>
      </div>

      <Card className="p-6">
        <div className="text-sm text-muted-foreground">
          Coming soon.
        </div>
      </Card>
    </div>
  )
}


