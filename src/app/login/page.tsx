'use client'

import * as React from "react"
import { toast } from "sonner"

import { login } from "@/actions/auth"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export default function LoginPage() {
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (pending) return
    setError(null)

    // Real form fields with name + autocomplete, so the browser's password
    // manager can save and autofill — no more retyping credentials.
    const formData = new FormData(e.currentTarget)
    setPending(true)
    try {
      const result = await login(formData)
      if (result?.error) {
        setError(result.error)
        toast.error(result.error)
        setPending(false)
      }
      // Success: the server action redirects to /admin — keep the button busy
      // while the navigation happens.
    } catch (err) {
      console.error(err)
      toast.error("Sign in failed. Try again.")
      setError("Couldn't reach the sign-in service. Try again.")
      setPending(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10 text-foreground">
      <Card className="w-full max-w-sm p-6 sm:p-8">
        <div className="mb-6 space-y-1 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Matrix OS</h1>
          <p className="text-sm text-muted-foreground">Sign in to the admin console</p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="username">Username</Label>
            <Input
              id="username"
              name="username"
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              autoFocus
              required
              placeholder="admin"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              placeholder="••••••••"
            />
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </Card>
    </div>
  )
}
