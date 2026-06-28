'use client'

import * as React from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { toast } from "sonner"
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronLeft,
  CircleCheck,
  FileText,
  FlaskConical,
  Hand,
  MessageSquare,
  Repeat,
  Sparkles,
  Users,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

import {
  STATIC_SYSTEM_PROMPT_PREFIX,
  STATIC_SYSTEM_PROMPT_SUFFIX,
  composeSystemPromptFromTemplate,
} from "@/lib/botProfile"
import { ChatPanel } from "./chat-panel"

const PLACEHOLDER_RE = /<bot_profile>[\s\r\n]*BOT_PROFILE_DETAILS[\s\r\n]*<\/bot_profile>/i

// A complete, editable starting point so the required Reply step is never a blank page.
// Keeps every placeholder the runtime expects: BOT_PROFILE_DETAILS, USER_PROFILE_DETAILS,
// and the last-message marker (inside the suffix), so the live chat test works immediately.
const STARTER_TEMPLATE = `${STATIC_SYSTEM_PROMPT_PREFIX.trim()}

<user_profile>
USER_PROFILE_DETAILS
</user_profile>

<bot_profile>
BOT_PROFILE_DETAILS
</bot_profile>

${STATIC_SYSTEM_PROMPT_SUFFIX.trim()}`

type StepKey = "identity" | "reply" | "matching" | "greeting" | "followup" | "review"

const STEPS: { key: StepKey; label: string; icon: React.ComponentType<{ className?: string }>; required?: boolean }[] = [
  { key: "identity", label: "Identity", icon: Sparkles, required: true },
  { key: "reply", label: "Reply behavior", icon: MessageSquare, required: true },
  { key: "matching", label: "Matching", icon: Users },
  { key: "greeting", label: "Greeting", icon: Hand },
  { key: "followup", label: "Follow-up", icon: Repeat },
  { key: "review", label: "Review & test", icon: CircleCheck },
]

function OptionToggle({
  value,
  onChange,
  disabled,
}: {
  value: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
}) {
  return (
    <div className="inline-flex shrink-0 rounded-md border p-0.5">
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(true)}
        className={cn(
          "rounded px-3 py-1 text-sm font-medium transition-colors",
          value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
        )}
      >
        Yes
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(false)}
        className={cn(
          "rounded px-3 py-1 text-sm font-medium transition-colors",
          !value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
        )}
      >
        No
      </button>
    </div>
  )
}

function ToggleRow({
  title,
  description,
  value,
  onChange,
  disabled,
}: {
  title: string
  description: string
  value: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
      <div>
        <div className="text-sm font-medium">{title}</div>
        <div className="text-xs text-muted-foreground">{description}</div>
      </div>
      <OptionToggle value={value} onChange={onChange} disabled={disabled} />
    </div>
  )
}

export function CreatePromptWizard({ initialGender = "Female" }: { initialGender?: string }) {
  const router = useRouter()

  const [stepIndex, setStepIndex] = React.useState(0)
  const [saving, setSaving] = React.useState(false)

  const [gender, setGender] = React.useState(initialGender || "Female")
  const [personality, setPersonality] = React.useState("")
  const [systemPrompt, setSystemPrompt] = React.useState("")

  const [matchingEnabled, setMatchingEnabled] = React.useState(true)
  const [immediateMatchEnabled, setImmediateMatchEnabled] = React.useState(false)
  const [activeGreetingEnabled, setActiveGreetingEnabled] = React.useState(false)
  const [activeGreetingPrompt, setActiveGreetingPrompt] = React.useState("")
  const [followUpEnabled, setFollowUpEnabled] = React.useState(false)
  const [followUpPrompt, setFollowUpPrompt] = React.useState("")
  const [followUpDelay, setFollowUpDelay] = React.useState<number>(86400)
  const [maxFollowUps, setMaxFollowUps] = React.useState<number>(3)

  const [showTest, setShowTest] = React.useState(false)

  // Duplicate detection: existing personalities for the chosen gender.
  const [existing, setExisting] = React.useState<string[]>([])
  const [existingLoading, setExistingLoading] = React.useState(false)

  React.useEffect(() => {
    const g = gender.trim()
    if (!g) return
    setExistingLoading(true)
    fetch(`/api/system-prompts/personalities?gender=${encodeURIComponent(g)}`)
      .then((res) => res.json())
      .then((json) => setExisting(Array.isArray(json.data) ? (json.data as string[]) : []))
      .catch(() => setExisting([]))
      .finally(() => setExistingLoading(false))
  }, [gender])

  const trimmedName = personality.trim()
  const isDuplicate = React.useMemo(
    () => existing.some((p) => p.toLowerCase() === trimmedName.toLowerCase()),
    [existing, trimmedName]
  )

  const hasPlaceholder = PLACEHOLDER_RE.test(systemPrompt)

  // Per-step gating so the user can never reach Save without the required pieces.
  const stepValid = React.useCallback(
    (key: StepKey): boolean => {
      switch (key) {
        case "identity":
          return Boolean(trimmedName) && !isDuplicate
        case "reply":
          return Boolean(systemPrompt.trim()) && hasPlaceholder
        case "greeting":
          return !activeGreetingEnabled || Boolean(activeGreetingPrompt.trim())
        case "followup":
          if (!followUpEnabled) return true
          return Boolean(followUpPrompt.trim()) && followUpDelay > 0 && maxFollowUps >= 1 && maxFollowUps <= 10
        default:
          return true
      }
    },
    [
      activeGreetingEnabled,
      activeGreetingPrompt,
      followUpDelay,
      followUpEnabled,
      followUpPrompt,
      hasPlaceholder,
      isDuplicate,
      maxFollowUps,
      systemPrompt,
      trimmedName,
    ]
  )

  const currentStep = STEPS[stepIndex]
  const isLast = stepIndex === STEPS.length - 1

  const stepError = (key: StepKey): string | null => {
    switch (key) {
      case "identity":
        if (!trimmedName) return "Give the personality a name to continue."
        if (isDuplicate) return `A ${gender} personality named "${trimmedName}" already exists.`
        return null
      case "reply":
        if (!systemPrompt.trim()) return "Add a system prompt, or insert the starter template."
        if (!hasPlaceholder) return "Prompt must include the <bot_profile> BOT_PROFILE_DETAILS </bot_profile> placeholder."
        return null
      case "greeting":
        return activeGreetingEnabled && !activeGreetingPrompt.trim() ? "Add a greeting prompt or turn greeting off." : null
      case "followup":
        if (!followUpEnabled) return null
        if (!followUpPrompt.trim()) return "Add a follow-up prompt or turn follow-ups off."
        if (followUpDelay <= 0) return "Wait time must be greater than 0."
        if (maxFollowUps < 1 || maxFollowUps > 10) return "Max follow-ups must be between 1 and 10."
        return null
      default:
        return null
    }
  }

  const goNext = () => {
    const err = stepError(currentStep.key)
    if (err) {
      toast.error(err)
      return
    }
    setStepIndex((i) => Math.min(i + 1, STEPS.length - 1))
  }

  const goBack = () => setStepIndex((i) => Math.max(i - 1, 0))

  const goToStep = (index: number) => {
    // Allow jumping backward freely; forward only through validated steps.
    if (index <= stepIndex) {
      setStepIndex(index)
      return
    }
    for (let i = stepIndex; i < index; i++) {
      if (!stepValid(STEPS[i].key)) {
        toast.error(stepError(STEPS[i].key) ?? `Finish "${STEPS[i].label}" first.`)
        setStepIndex(i)
        return
      }
    }
    setStepIndex(index)
  }

  const create = async () => {
    // Final guard across every gated step.
    for (const step of STEPS) {
      const err = stepError(step.key)
      if (err) {
        toast.error(err)
        setStepIndex(STEPS.findIndex((s) => s.key === step.key))
        return
      }
    }

    setSaving(true)
    try {
      const res = await fetch("/api/system-prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gender: gender.trim(),
          personality: trimmedName,
          system_prompt: systemPrompt,
          matching_enabled: matchingEnabled,
          immediate_match_enabled: immediateMatchEnabled,
          follow_up_message_enabled: followUpEnabled,
          follow_up_message_prompt: followUpPrompt,
          follow_up_delay: Number(followUpDelay),
          max_follow_ups: Number(maxFollowUps),
          active_greeting_enabled: activeGreetingEnabled,
          active_greeting_prompt: activeGreetingPrompt,
        }),
      })
      const json = (await res.json()) as { data?: unknown; error?: string }
      if (!res.ok) throw new Error(json.error || "Failed to create personality")
      toast.success(`Personality "${trimmedName}" created`)
      router.push("/admin/system-prompts")
    } catch (err: unknown) {
      console.error(err)
      toast.error(err instanceof Error ? err.message : "Failed to create personality")
    } finally {
      setSaving(false)
    }
  }

  const testSystemPrompt = React.useMemo(() => {
    if (!systemPrompt) return ""
    return composeSystemPromptFromTemplate(
      systemPrompt,
      {
        name: "Test Bot",
        age: 25,
        archetype: "Virtual Companion",
        bio: `A ${gender.toLowerCase()} ${trimmedName.toLowerCase() || "companion"} digital companion.`,
      },
      `${gender}:${trimmedName}`
    )
  }, [systemPrompt, gender, trimmedName])

  return (
    <div className="w-full space-y-6 pb-20">
      <div className="flex items-center gap-4">
        <Link href="/admin/system-prompts">
          <Button variant="ghost" size="icon">
            <ChevronLeft className="h-5 w-5" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Create personality</h1>
          <p className="text-sm text-muted-foreground">
            Step {stepIndex + 1} of {STEPS.length} · {currentStep.label}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
        {/* Stepper */}
        <Card className="h-fit p-2">
          <ol className="space-y-1">
            {STEPS.map((step, index) => {
              const StepIcon = step.icon
              const active = index === stepIndex
              const done = index < stepIndex && stepValid(step.key)
              return (
                <li key={step.key}>
                  <button
                    type="button"
                    onClick={() => goToStep(index)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors",
                      active ? "bg-primary/10" : "hover:bg-muted"
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs",
                        active
                          ? "border-primary bg-primary text-primary-foreground"
                          : done
                            ? "border-emerald-600 bg-emerald-600 text-white"
                            : "text-muted-foreground"
                      )}
                    >
                      {done ? <Check className="h-3.5 w-3.5" /> : <StepIcon className="h-3.5 w-3.5" />}
                    </span>
                    <span className={cn("flex-1 text-sm", active ? "font-medium" : "text-muted-foreground")}>
                      {step.label}
                    </span>
                    {step.required ? (
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Req</span>
                    ) : null}
                  </button>
                </li>
              )
            })}
          </ol>
        </Card>

        {/* Step content */}
        <Card className="p-6">
          {currentStep.key === "identity" ? (
            <div className="space-y-5">
              <StepHeading
                title="Who is this personality?"
                description="Name it and pick a gender. This becomes the prompt key and can't be changed later."
              />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-[160px_minmax(0,1fr)]">
                <div className="space-y-2">
                  <Label>Gender</Label>
                  <select
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                    value={gender}
                    onChange={(e) => setGender(e.target.value)}
                  >
                    <option value="Female">Female</option>
                    <option value="Male">Male</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label>Personality name</Label>
                  <Input
                    autoFocus
                    value={personality}
                    onChange={(e) => setPersonality(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault()
                        goNext()
                      }
                    }}
                    placeholder="e.g. calm_playboy"
                  />
                </div>
              </div>

              {trimmedName ? (
                isDuplicate ? (
                  <div className="flex items-center justify-between gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
                    <span>A {gender} personality named “{trimmedName}” already exists.</span>
                    <Link
                      href={`/admin/system-prompts/manage?gender=${encodeURIComponent(gender)}&personality=${encodeURIComponent(trimmedName)}`}
                      className="shrink-0 font-medium underline"
                    >
                      Edit it instead
                    </Link>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400">
                    <Check className="h-4 w-4" />
                    {existingLoading ? "Checking availability…" : `Available — no ${gender} personality named “${trimmedName}” yet.`}
                  </div>
                )
              ) : (
                <p className="text-xs text-muted-foreground">
                  Tip: use a short, lowercase key like <code className="rounded bg-muted px-1 py-0.5">calm_playboy</code> or{" "}
                  <code className="rounded bg-muted px-1 py-0.5">General</code>.
                </p>
              )}
            </div>
          ) : null}

          {currentStep.key === "reply" ? (
            <div className="space-y-4">
              <StepHeading
                title="How should it reply?"
                description="This system prompt drives every response. Start from the template and edit, or paste your own."
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => {
                    setSystemPrompt(STARTER_TEMPLATE)
                    toast.success("Starter template inserted")
                  }}
                >
                  <FileText className="h-4 w-4" />
                  {systemPrompt.trim() ? "Reset to starter template" : "Insert starter template"}
                </Button>
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs",
                    hasPlaceholder
                      ? "border-emerald-500/30 text-emerald-700 dark:text-emerald-400"
                      : "border-amber-500/40 text-amber-700 dark:text-amber-400"
                  )}
                >
                  {hasPlaceholder ? <Check className="h-3.5 w-3.5" /> : null}
                  {hasPlaceholder ? "Placeholder present" : "Needs BOT_PROFILE_DETAILS placeholder"}
                </span>
              </div>
              <Textarea
                rows={18}
                className="max-h-[55vh] overflow-auto font-mono text-sm"
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder={`Include:\n<bot_profile>\nBOT_PROFILE_DETAILS\n</bot_profile>`}
              />
              <p className="text-xs text-muted-foreground">
                The prompt must contain{" "}
                <code className="rounded bg-muted px-1 py-0.5">{"<bot_profile> BOT_PROFILE_DETAILS </bot_profile>"}</code> —
                each personality&apos;s profile is injected there at runtime.
              </p>
            </div>
          ) : null}

          {currentStep.key === "matching" ? (
            <div className="space-y-4">
              <StepHeading
                title="Should it appear in matching?"
                description="Controls whether this personality shows up in the feed and how matches form."
              />
              <ToggleRow
                title="Enable matching"
                description="Personality appears in the swipe feed and on the map, and can send / accept requests."
                value={matchingEnabled}
                onChange={setMatchingEnabled}
              />
              <ToggleRow
                title="Immediate match"
                description="When a real user invites this personality (swipe or map), skip the pending request and create the match instantly."
                value={immediateMatchEnabled}
                onChange={setImmediateMatchEnabled}
                disabled={!matchingEnabled}
              />
              {!matchingEnabled ? (
                <p className="text-xs text-muted-foreground">
                  Matching is off, so this personality won&apos;t appear in the feed. You can still enable greeting, reply and
                  follow-ups for existing matches.
                </p>
              ) : null}
            </div>
          ) : null}

          {currentStep.key === "greeting" ? (
            <div className="space-y-4">
              <StepHeading
                title="Greeting / outreach — the 'say hi'"
                description="One switch: whether this personality initiates. ON = it reaches out to nearby real users on the map (nearby invitations) AND sends the first message on a new match. OFF = it only replies, never initiates."
              />
              <ToggleRow
                title="Active greeting & nearby outreach"
                description="ON: says hi first — nearby outreach + opens new matches. OFF: no nearby outreach, no auto first message."
                value={activeGreetingEnabled}
                onChange={setActiveGreetingEnabled}
              />
              <div className="space-y-2">
                <Label>Greeting prompt (nearby opener)</Label>
                <Textarea
                  rows={8}
                  className="max-h-[40vh] overflow-auto"
                  value={activeGreetingPrompt}
                  onChange={(e) => setActiveGreetingPrompt(e.target.value)}
                  placeholder="e.g. When a match is created, send a warm, casual first message to break the ice."
                  disabled={!activeGreetingEnabled}
                />
                {!activeGreetingEnabled ? (
                  <p className="text-xs text-muted-foreground">Turn greeting on to write its prompt.</p>
                ) : null}
              </div>
            </div>
          ) : null}

          {currentStep.key === "followup" ? (
            <div className="space-y-4">
              <StepHeading
                title="Should it follow up if the user goes quiet?"
                description="When enabled, the personality sends scheduled nudges after the user stops replying."
              />
              <ToggleRow
                title="Enable follow-ups"
                description="Schedule re-engagement messages when the user is inactive."
                value={followUpEnabled}
                onChange={setFollowUpEnabled}
              />
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Wait time (seconds)</Label>
                  <Input
                    type="number"
                    min={60}
                    value={followUpDelay}
                    onChange={(e) => setFollowUpDelay(Number(e.target.value))}
                    disabled={!followUpEnabled}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Max follow-ups</Label>
                  <Input
                    type="number"
                    min={1}
                    max={10}
                    value={maxFollowUps}
                    onChange={(e) => setMaxFollowUps(Number(e.target.value))}
                    disabled={!followUpEnabled}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Follow-up prompt</Label>
                <Textarea
                  rows={8}
                  className="max-h-[40vh] overflow-auto"
                  value={followUpPrompt}
                  onChange={(e) => setFollowUpPrompt(e.target.value)}
                  placeholder="e.g. The user hasn't replied. Send a playful message to get their attention."
                  disabled={!followUpEnabled}
                />
                {!followUpEnabled ? (
                  <p className="text-xs text-muted-foreground">Turn follow-ups on to configure timing and prompt.</p>
                ) : null}
              </div>
            </div>
          ) : null}

          {currentStep.key === "review" ? (
            <div className="space-y-5">
              <StepHeading
                title="Review & create"
                description="Confirm the setup. You can test it live before creating — nothing is saved until you click Create."
              />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <SummaryItem label="Personality" value={`${gender} · ${trimmedName || "—"}`} />
                <SummaryItem label="Reply prompt" value={`${systemPrompt.trim().length} chars`} ok={hasPlaceholder} />
                <SummaryItem
                  label="Matching"
                  value={matchingEnabled ? (immediateMatchEnabled ? "On · immediate" : "On") : "Off"}
                  ok={matchingEnabled}
                />
                <SummaryItem label="Greeting" value={activeGreetingEnabled ? "On" : "Off"} ok={activeGreetingEnabled} />
                <SummaryItem
                  label="Follow-ups"
                  value={followUpEnabled ? `On · ${maxFollowUps} max, ${followUpDelay}s` : "Off"}
                  ok={followUpEnabled}
                />
              </div>

              <div>
                <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => setShowTest((v) => !v)}>
                  <FlaskConical className="h-4 w-4" />
                  {showTest ? "Hide test chat" : "Test before creating"}
                </Button>
              </div>

              {showTest ? (
                <Card className="p-4">
                  <div className="mb-2 text-sm font-medium">Test &amp; tuning</div>
                  <div className="mb-2 text-xs text-muted-foreground">
                    Random bot profile (Gender: {gender}, Personality: {trimmedName || "—"}).
                  </div>
                  <ChatPanel
                    systemPrompt={testSystemPrompt}
                    activeGreetingEnabled={activeGreetingEnabled}
                    activeGreetingPrompt={activeGreetingPrompt}
                    followUpEnabled={followUpEnabled}
                    followUpPrompt={followUpPrompt}
                    followUpDelay={followUpDelay}
                    maxFollowUps={maxFollowUps}
                  />
                </Card>
              ) : null}
            </div>
          ) : null}

          {/* Footer nav */}
          <div className="mt-6 flex items-center justify-between border-t pt-4">
            <Button variant="outline" className="gap-2" onClick={goBack} disabled={stepIndex === 0 || saving}>
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
            {isLast ? (
              <Button className="gap-2" onClick={() => void create()} disabled={saving}>
                {saving ? "Creating…" : "Create personality"}
              </Button>
            ) : (
              <Button className="gap-2" onClick={goNext} disabled={saving}>
                Continue
                <ArrowRight className="h-4 w-4" />
              </Button>
            )}
          </div>
        </Card>
      </div>
    </div>
  )
}

function StepHeading({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <div className="text-lg font-semibold">{title}</div>
      <div className="text-sm text-muted-foreground">{description}</div>
    </div>
  )
}

function SummaryItem({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs text-muted-foreground">{label}</div>
        {ok !== undefined ? (
          ok ? (
            <CircleCheck className="h-4 w-4 text-emerald-600" />
          ) : (
            <span className="text-xs text-muted-foreground/60">off</span>
          )
        ) : null}
      </div>
      <div className="mt-1 text-sm font-medium">{value}</div>
    </div>
  )
}
