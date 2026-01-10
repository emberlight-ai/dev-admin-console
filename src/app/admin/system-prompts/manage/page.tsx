'use client'

import * as React from "react"
import { Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { ChevronLeft } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

const PLACEHOLDER_RE = /<bot_profile>[\s\r\n]*BOT_PROFILE_DETAILS[\s\r\n]*<\/bot_profile>/i

function ManagePromptPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const editGender = searchParams.get("gender")
  const editPersonality = searchParams.get("personality")

  const isEdit = !!(editGender && editPersonality)

  const [saving, setSaving] = React.useState(false)
  const [loading, setLoading] = React.useState(isEdit)

  const [gender, setGender] = React.useState(editGender ?? "Female")
  const [personality, setPersonality] = React.useState(editPersonality ?? "")
  const [systemPrompt, setSystemPrompt] = React.useState("")
  const [responseDelay, setResponseDelay] = React.useState<number>(0)

  // New Fields
  const [immediateMatchEnabled, setImmediateMatchEnabled] = React.useState(false)
  const [followUpEnabled, setFollowUpEnabled] = React.useState(false)
  const [followUpPrompt, setFollowUpPrompt] = React.useState("")
  const [followUpDelay, setFollowUpDelay] = React.useState<number>(86400) // 24 hours
  const [maxFollowUps, setMaxFollowUps] = React.useState<number>(3)
  const [activeGreetingEnabled, setActiveGreetingEnabled] = React.useState(false)
  const [activeGreetingPrompt, setActiveGreetingPrompt] = React.useState("")

  React.useEffect(() => {
    if (isEdit) {
      setLoading(true)
      fetch(`/api/system-prompts/latest?gender=${encodeURIComponent(editGender)}&personality=${encodeURIComponent(editPersonality)}`)
        .then((res) => res.json())
        .then((json) => {
          if (json.data) {
            setSystemPrompt(json.data.system_prompt ?? "")
            setResponseDelay(json.data.response_delay ?? 0)
            setImmediateMatchEnabled(json.data.immediate_match_enabled ?? false)
            setFollowUpEnabled(json.data.follow_up_message_enabled ?? false)
            setFollowUpPrompt(json.data.follow_up_message_prompt ?? "")
            setFollowUpDelay(json.data.follow_up_delay ?? 86400)
            setMaxFollowUps(json.data.max_follow_ups ?? 3)
            setActiveGreetingEnabled(json.data.active_greeting_enabled ?? false)
            setActiveGreetingPrompt(json.data.active_greeting_prompt ?? "")
          }
        })
        .catch((err) => toast.error("Failed to load prompt"))
        .finally(() => setLoading(false))
    }
  }, [isEdit, editGender, editPersonality])

  const save = async () => {
    const g = gender.trim()
    const p = personality.trim()
    const sp = systemPrompt
    const rd = Number(responseDelay)
    const imm = Boolean(immediateMatchEnabled)
    const fued = Boolean(followUpEnabled)
    const fup = followUpPrompt
    const fud = Number(followUpDelay)
    const mfu = Number(maxFollowUps)
    const age = Boolean(activeGreetingEnabled)
    const agp = activeGreetingPrompt

    if (!g) return toast.error("Gender is required")
    if (!p) return toast.error("Personality is required")
    if (!sp.trim()) return toast.error("System prompt is required")
    if (!PLACEHOLDER_RE.test(sp)) {
      return toast.error("Prompt must include: <bot_profile> BOT_PROFILE_DETAILS </bot_profile>")
    }
    if (isNaN(rd) || rd < 0 || rd > 86400) {
      return toast.error("Response delay must be between 0 and 86400 seconds")
    }

    if (age && !agp.trim()) {
      return toast.error("Greeting prompt is required when active greeting is enabled")
    }

    if (fued) {
      if (!fup.trim()) return toast.error("Follow-up prompt is required when enabled")
      if (isNaN(fud) || fud <= 0) return toast.error("Follow-up delay must be positive")
    }

    setSaving(true)
    try {
      const res = await fetch("/api/system-prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gender: g,
          personality: p,
          system_prompt: sp,
          response_delay: rd,
          immediate_match_enabled: imm,
          follow_up_message_enabled: fued,
          follow_up_message_prompt: fup,
          follow_up_delay: fud,
          max_follow_ups: mfu,
          active_greeting_enabled: age,
          active_greeting_prompt: agp,
        }),
      })
      const json = (await res.json()) as { data?: unknown; error?: string }
      if (!res.ok) throw new Error(json.error || "Failed to save prompt")
      toast.success(isEdit ? "New prompt version created" : "Prompt created")
      router.push("/admin/system-prompts")
    } catch (err: unknown) {
      console.error(err)
      toast.error(err instanceof Error ? err.message : "Failed to save prompt")
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="p-10 text-center">Loading...</div>

  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-20">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ChevronLeft className="w-5 h-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{isEdit ? `Edit Prompt: ${gender} - ${personality}` : "Create Prompt"}</h1>
          <p className="text-sm text-muted-foreground">Define how the digital human behaves and automated responses.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="p-6 space-y-4 h-fit">
          <h3 className="font-medium border-b pb-2">Core Identity</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Gender</Label>
              <select
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                value={gender}
                onChange={(e) => setGender(e.target.value)}
                disabled={isEdit}
              >
                <option value="Female">Female</option>
                <option value="Male">Male</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label>Personality</Label>
              <Input
                value={personality}
                onChange={(e) => setPersonality(e.target.value)}
                placeholder="e.g. calm_playboy"
                disabled={isEdit}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Initial Response Delay (seconds)</Label>
            <Input
              type="number"
              min={0}
              max={86400}
              value={responseDelay}
              onChange={(e) => setResponseDelay(Number(e.target.value))}
            />
            <p className="text-xs text-muted-foreground">Artificial delay before replying to user message (0-86400).</p>
          </div>

          <div className="border-t pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">Immediate Match</div>
                <div className="text-xs text-muted-foreground">If enabled, matching this digital human creates a match instantly (no request).</div>
              </div>
              <input
                type="checkbox"
                id="enable-imm"
                className="h-4 w-4 rounded border-gray-300 accent-primary"
                checked={immediateMatchEnabled}
                onChange={(e) => setImmediateMatchEnabled(e.target.checked)}
              />
            </div>
          </div>
        </Card>

        <Card className="p-6 space-y-4 h-fit">
          <h3 className="font-medium border-b pb-2 flex items-center justify-between">
            <span>Follow-up Automation</span>
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="enable-fu"
                className="h-4 w-4 rounded border-gray-300 accent-primary"
                checked={followUpEnabled}
                onChange={(e) => setFollowUpEnabled(e.target.checked)}
              />
              <label htmlFor="enable-fu" className="text-sm cursor-pointer select-none">
                Enable
              </label>
            </div>
          </h3>

          {followUpEnabled ? (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Wait Time (seconds)</Label>
                  <Input type="number" min={60} value={followUpDelay} onChange={(e) => setFollowUpDelay(Number(e.target.value))} />
                </div>
                <div className="space-y-2">
                  <Label>Max Follow-ups</Label>
                  <Input
                    type="number"
                    min={1}
                    max={10}
                    value={maxFollowUps}
                    onChange={(e) => setMaxFollowUps(Number(e.target.value))}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Follow-up Instruction Prompt</Label>
                <Textarea
                  rows={4}
                  value={followUpPrompt}
                  onChange={(e) => setFollowUpPrompt(e.target.value)}
                  placeholder="e.g. The user hasn't replied. Send a playful message to get their attention."
                />
                <p className="text-xs text-muted-foreground">Instruction given to the AI to generate the follow-up.</p>
              </div>
            </>
          ) : (
            <div className="text-sm text-muted-foreground py-8 text-center italic">Follow-ups are disabled for this persona.</div>
          )}
        </Card>
      </div>

      <Card className="p-6 space-y-4">
        <h3 className="font-medium border-b pb-2 flex items-center justify-between">
          <span>Active Greeting</span>
          <div className="flex items-center space-x-2">
            <input
              type="checkbox"
              id="enable-greeting"
              className="h-4 w-4 rounded border-gray-300 accent-primary"
              checked={activeGreetingEnabled}
              onChange={(e) => setActiveGreetingEnabled(e.target.checked)}
            />
            <label htmlFor="enable-greeting" className="text-sm cursor-pointer select-none">
              Enable
            </label>
          </div>
        </h3>

        {activeGreetingEnabled ? (
          <div className="space-y-2">
            <Label>Greeting Instruction Prompt</Label>
            <Textarea
              rows={4}
              value={activeGreetingPrompt}
              onChange={(e) => setActiveGreetingPrompt(e.target.value)}
              placeholder="e.g. When a match is created, send a warm, casual first message to break the ice."
            />
            <p className="text-xs text-muted-foreground">
              Instruction given to the AI to generate the first message without the user prompting.
            </p>
          </div>
        ) : (
          <div className="text-sm text-muted-foreground py-6 text-center italic">Active greetings are disabled for this persona.</div>
        )}
      </Card>

      <Card className="p-6 space-y-4">
        <div className="space-y-2">
          <Label>System Prompt Template</Label>
          <Textarea
            rows={20}
            className="font-mono text-sm max-h-[600px]"
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            placeholder={`Include:\n<bot_profile>\nBOT_PROFILE_DETAILS\n</bot_profile>`}
          />
          <div className="text-xs text-muted-foreground">
            Required placeholder: <code className="rounded bg-muted px-1 py-0.5">BOT_PROFILE_DETAILS</code>
          </div>
        </div>
      </Card>

      <div className="flex justify-end gap-3 pt-6">
        <Button variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button onClick={save} disabled={saving}>
          {saving ? "Saving..." : "Save Changes"}
        </Button>
      </div>
    </div>
  )
}

export default function ManagePromptPage() {
  return (
    <Suspense fallback={<div className="p-10 text-center">Loading...</div>}>
      <ManagePromptPageContent />
    </Suspense>
  )
}

