'use client'

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  ChevronLeft,
  ChevronRight,
  FlaskConical,
  Hand,
  History,
  MessageSquare,
  Pencil,
  Repeat,
  Users,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"

import { composeSystemPromptFromTemplate } from "@/lib/botProfile"
import { ChatPanel } from "./chat-panel"

const PLACEHOLDER_RE = /<bot_profile>[\s\r\n]*BOT_PROFILE_DETAILS[\s\r\n]*<\/bot_profile>/i

export type SystemPromptLatest = {
  system_prompt: string
  created_at: string
  matching_enabled: boolean
  immediate_match_enabled: boolean
  follow_up_message_enabled: boolean
  follow_up_message_prompt: string
  follow_up_delay: number
  max_follow_ups: number
  active_greeting_enabled: boolean
  active_greeting_prompt: string
  reply_min_delay_seconds: number
  reply_max_delay_seconds: number
  reply_chars_per_second: number
  skip_reply_enabled: boolean
  skip_reply_base_chance: number
  skip_reply_intimacy_drop_chance: number
  skip_reply_intimacy_drop_delta: number
  skip_reply_max_consecutive: number
}

/// A previously-saved version of this personality (one row per save). Only the
/// per-section prompt fields are needed for the rollback UI.
type SystemPromptVersion = {
  id: string
  created_at: string
  system_prompt: string | null
  active_greeting_prompt: string | null
  follow_up_message_prompt: string | null
}

type StageId = "matching" | "greeting" | "reply" | "followup"
type PendingNavigation =
  | { type: "back" }
  | { type: "cancel" }
  | { type: "href"; href: string }

export function SystemPromptForm({
  initialGender,
  initialPersonality,
  disableKeyEdit,
  variant,
  onSaved,
  onCancel,
}: {
  initialGender: string
  initialPersonality: string
  disableKeyEdit: boolean
  variant: "page" | "dialog"
  onSaved?: () => void
  onCancel?: () => void
}) {
  const router = useRouter()
  const isEdit = disableKeyEdit

  const [saving, setSaving] = React.useState(false)
  const [loading, setLoading] = React.useState(isEdit)

  const [gender, setGender] = React.useState(initialGender || "Female")
  const [personality, setPersonality] = React.useState(initialPersonality || "")
  const [systemPrompt, setSystemPrompt] = React.useState("")

  const [matchingEnabled, setMatchingEnabled] = React.useState(true)
  const [immediateMatchEnabled, setImmediateMatchEnabled] = React.useState(false)
  const [followUpEnabled, setFollowUpEnabled] = React.useState(false)
  const [followUpPrompt, setFollowUpPrompt] = React.useState("")
  const [followUpDelay, setFollowUpDelay] = React.useState<number>(86400)
  const [maxFollowUps, setMaxFollowUps] = React.useState<number>(3)
  const [activeGreetingEnabled, setActiveGreetingEnabled] = React.useState(false)
  const [activeGreetingPrompt, setActiveGreetingPrompt] = React.useState("")

  // Reply pacing + human-like silence (read by the dh-auto-reply edge function).
  const [replyMinDelay, setReplyMinDelay] = React.useState<number>(2)
  const [replyMaxDelay, setReplyMaxDelay] = React.useState<number>(18)
  const [replyCharsPerSecond, setReplyCharsPerSecond] = React.useState<number>(15)
  const [skipReplyEnabled, setSkipReplyEnabled] = React.useState(false)
  const [skipBaseChance, setSkipBaseChance] = React.useState<number>(0.1)
  const [skipDropChance, setSkipDropChance] = React.useState<number>(0.5)
  const [skipDropDelta, setSkipDropDelta] = React.useState<number>(5)
  const [skipMaxConsecutive, setSkipMaxConsecutive] = React.useState<number>(1)

  type PromptSnapshot = {
    gender: string
    personality: string
    systemPrompt: string
    matchingEnabled: boolean
    immediateMatchEnabled: boolean
    followUpEnabled: boolean
    followUpPrompt: string
    followUpDelay: number
    maxFollowUps: number
    activeGreetingEnabled: boolean
    activeGreetingPrompt: string
    replyMinDelay: number
    replyMaxDelay: number
    replyCharsPerSecond: number
    skipReplyEnabled: boolean
    skipBaseChance: number
    skipDropChance: number
    skipDropDelta: number
    skipMaxConsecutive: number
  }

  const [initialSnapshot, setInitialSnapshot] = React.useState<PromptSnapshot | null>(null)

  // Version history for the per-section rollback UI (loaded lazily on first open).
  const [versions, setVersions] = React.useState<SystemPromptVersion[]>([])
  const [versionsLoading, setVersionsLoading] = React.useState(false)

  const fetchVersions = React.useCallback(async () => {
    const g = gender.trim()
    const p = personality.trim()
    if (!g || !p) return
    setVersionsLoading(true)
    try {
      const res = await fetch(
        `/api/system-prompts/versions?gender=${encodeURIComponent(g)}&personality=${encodeURIComponent(p)}`
      )
      const json = (await res.json()) as { data?: SystemPromptVersion[]; error?: string }
      if (!res.ok) throw new Error(json.error || "Failed to load versions")
      setVersions(json.data ?? [])
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to load versions")
    } finally {
      setVersionsLoading(false)
    }
  }, [gender, personality])

  const [activeStage, setActiveStage] = React.useState<StageId>("reply")
  const [testOpen, setTestOpen] = React.useState(false)
  const [pendingNavigation, setPendingNavigation] = React.useState<PendingNavigation | null>(null)
  const allowNavigationRef = React.useRef(false)

  // Identity / rename dialog state.
  const [identityOpen, setIdentityOpen] = React.useState(false)
  const [renameValue, setRenameValue] = React.useState("")
  const [renaming, setRenaming] = React.useState(false)
  const [existingNames, setExistingNames] = React.useState<Set<string>>(new Set())

  const currentSnapshot = React.useCallback(
    (): PromptSnapshot => ({
      gender: gender.trim(),
      personality: personality.trim(),
      systemPrompt,
      matchingEnabled,
      immediateMatchEnabled,
      followUpEnabled,
      followUpPrompt,
      followUpDelay,
      maxFollowUps,
      activeGreetingEnabled,
      activeGreetingPrompt,
      replyMinDelay,
      replyMaxDelay,
      replyCharsPerSecond,
      skipReplyEnabled,
      skipBaseChance,
      skipDropChance,
      skipDropDelta,
      skipMaxConsecutive,
    }),
    [
      activeGreetingEnabled,
      activeGreetingPrompt,
      followUpDelay,
      followUpEnabled,
      followUpPrompt,
      gender,
      immediateMatchEnabled,
      matchingEnabled,
      maxFollowUps,
      personality,
      systemPrompt,
      replyMinDelay,
      replyMaxDelay,
      replyCharsPerSecond,
      skipReplyEnabled,
      skipBaseChance,
      skipDropChance,
      skipDropDelta,
      skipMaxConsecutive,
    ]
  )

  React.useEffect(() => {
    if (!isEdit) return
    const g = (gender || "").trim()
    const p = (personality || "").trim()
    if (!g || !p) return

    setLoading(true)
    fetch(`/api/system-prompts/latest?gender=${encodeURIComponent(g)}&personality=${encodeURIComponent(p)}`)
      .then((res) => res.json())
      .then((json) => {
        if (json.data) {
          const d = json.data as Partial<SystemPromptLatest>
          setSystemPrompt(d.system_prompt ?? "")
          setMatchingEnabled(d.matching_enabled ?? true)
          setImmediateMatchEnabled(d.immediate_match_enabled ?? false)
          setFollowUpEnabled(d.follow_up_message_enabled ?? false)
          setFollowUpPrompt(d.follow_up_message_prompt ?? "")
          setFollowUpDelay(d.follow_up_delay ?? 86400)
          setMaxFollowUps(d.max_follow_ups ?? 3)
          setActiveGreetingEnabled(d.active_greeting_enabled ?? false)
          setActiveGreetingPrompt(d.active_greeting_prompt ?? "")
          setReplyMinDelay(d.reply_min_delay_seconds ?? 2)
          setReplyMaxDelay(d.reply_max_delay_seconds ?? 18)
          setReplyCharsPerSecond(d.reply_chars_per_second ?? 15)
          setSkipReplyEnabled(d.skip_reply_enabled ?? false)
          setSkipBaseChance(d.skip_reply_base_chance ?? 0.1)
          setSkipDropChance(d.skip_reply_intimacy_drop_chance ?? 0.5)
          setSkipDropDelta(d.skip_reply_intimacy_drop_delta ?? 5)
          setSkipMaxConsecutive(d.skip_reply_max_consecutive ?? 1)
        }
      })
      .catch(() => toast.error("Failed to load prompt"))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEdit])

  // Establish baseline for dirty-check once initial values are loaded (edit) or on first render (create).
  React.useEffect(() => {
    if (loading) return
    if (initialSnapshot) return
    setInitialSnapshot(currentSnapshot())
  }, [
    initialSnapshot,
    loading,
    currentSnapshot,
  ])

  const isDirty = React.useMemo(() => {
    if (!initialSnapshot) return false
    const curr = currentSnapshot()
    return Object.keys(curr).some((k) => {
      const key = k as keyof PromptSnapshot
      return curr[key] !== initialSnapshot[key]
    })
  }, [currentSnapshot, initialSnapshot])

  const performNavigation = React.useCallback(
    (navigation: PendingNavigation) => {
      allowNavigationRef.current = true

      if (navigation.type === "href") {
        const targetUrl = new URL(navigation.href, window.location.href)
        if (targetUrl.origin === window.location.origin) {
          router.push(`${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`)
        } else {
          window.location.href = targetUrl.href
        }
        return
      }

      if (navigation.type === "cancel" && variant !== "page") {
        onCancel?.()
        return
      }

      router.back()
    },
    [onCancel, router, variant]
  )

  const requestNavigation = React.useCallback(
    (navigation: PendingNavigation) => {
      if (saving) return
      if (isDirty) {
        setPendingNavigation(navigation)
        return
      }
      performNavigation(navigation)
    },
    [isDirty, performNavigation, saving]
  )

  React.useEffect(() => {
    if (!isDirty) return

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (allowNavigationRef.current) return
      event.preventDefault()
      event.returnValue = ""
    }

    window.addEventListener("beforeunload", onBeforeUnload)
    return () => window.removeEventListener("beforeunload", onBeforeUnload)
  }, [isDirty])

  React.useEffect(() => {
    if (!isDirty) return

    const onDocumentClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return
      }

      const target = event.target instanceof Element ? event.target.closest("a[href]") : null
      if (!target) return

      const href = target.getAttribute("href")
      if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) {
        return
      }

      event.preventDefault()
      requestNavigation({ type: "href", href })
    }

    document.addEventListener("click", onDocumentClick, true)
    return () => document.removeEventListener("click", onDocumentClick, true)
  }, [isDirty, requestNavigation])

  const testSystemPrompt = React.useMemo(() => {
    if (!systemPrompt) return ""
    // Generate a dummy bot profile for testing
    return composeSystemPromptFromTemplate(
      systemPrompt,
      {
        name: "Test Bot",
        age: 25,
        archetype: "Virtual Companion",
        bio: `A ${gender.toLowerCase()} ${personality.toLowerCase()} digital companion.`,
      },
      `${gender}:${personality}` // seed for consistency
    )
  }, [systemPrompt, gender, personality])

  const save = async ({ navigateAfterSave = true } = {}): Promise<boolean> => {
    const g = gender.trim()
    const p = personality.trim()
    const sp = systemPrompt
    const me = Boolean(matchingEnabled)
    const imm = Boolean(immediateMatchEnabled)
    const fued = Boolean(followUpEnabled)
    const fup = followUpPrompt
    const fud = Number(followUpDelay)
    const mfu = Number(maxFollowUps)
    const age = Boolean(activeGreetingEnabled)
    const agp = activeGreetingPrompt

    if (!g) {
      toast.error("Gender is required")
      return false
    }
    if (!p) {
      toast.error("Personality is required")
      setIdentityOpen(true)
      return false
    }
    if (!sp.trim()) {
      toast.error("System prompt is required")
      setActiveStage("reply")
      return false
    }
    if (!PLACEHOLDER_RE.test(sp)) {
      toast.error("Prompt must include: <bot_profile> BOT_PROFILE_DETAILS </bot_profile>")
      setActiveStage("reply")
      return false
    }
    if (age && !agp.trim()) {
      toast.error("Greeting prompt is required when active greeting is enabled")
      setActiveStage("greeting")
      return false
    }
    if (fued) {
      if (!fup.trim()) {
        toast.error("Follow-up prompt is required when enabled")
        setActiveStage("followup")
        return false
      }
      if (isNaN(fud) || fud <= 0) {
        toast.error("Follow-up delay must be positive")
        setActiveStage("followup")
        return false
      }
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
          matching_enabled: me,
          immediate_match_enabled: imm,
          follow_up_message_enabled: fued,
          follow_up_message_prompt: fup,
          follow_up_delay: fud,
          max_follow_ups: mfu,
          active_greeting_enabled: age,
          active_greeting_prompt: agp,
          reply_min_delay_seconds: Number(replyMinDelay),
          reply_max_delay_seconds: Number(replyMaxDelay),
          reply_chars_per_second: Number(replyCharsPerSecond),
          skip_reply_enabled: Boolean(skipReplyEnabled),
          skip_reply_base_chance: Number(skipBaseChance),
          skip_reply_intimacy_drop_chance: Number(skipDropChance),
          skip_reply_intimacy_drop_delta: Number(skipDropDelta),
          skip_reply_max_consecutive: Number(skipMaxConsecutive),
        }),
      })
      const json = (await res.json()) as { data?: unknown; error?: string }
      if (!res.ok) throw new Error(json.error || "Failed to save prompt")
      setInitialSnapshot(currentSnapshot())
      toast.success(isEdit ? "New prompt version created" : "Prompt created")
      if (navigateAfterSave && variant === "page") {
        router.push("/admin/system-prompts")
      } else if (navigateAfterSave) {
        onSaved?.()
      }
      return true
    } catch (err: unknown) {
      console.error(err)
      toast.error(err instanceof Error ? err.message : "Failed to save prompt")
      return false
    } finally {
      setSaving(false)
    }
  }

  const saveAndContinueNavigation = async () => {
    if (!pendingNavigation) return
    const navigation = pendingNavigation
    const saved = await save({ navigateAfterSave: false })
    if (!saved) return
    setPendingNavigation(null)
    performNavigation(navigation)
  }

  const leaveWithoutSaving = () => {
    if (!pendingNavigation) return
    const navigation = pendingNavigation
    setPendingNavigation(null)
    performNavigation(navigation)
  }

  // Identity / rename. In edit mode this renames the personality everywhere it's
  // used (prompt versions, live digital humans, config overrides). In create mode
  // it simply edits the gender + personality keys locally before the first save.
  const openIdentity = React.useCallback(() => {
    setRenameValue(personality)
    setIdentityOpen(true)
    if (!isEdit) return
    const g = gender.trim()
    if (!g) return
    fetch(`/api/system-prompts/personalities?gender=${encodeURIComponent(g)}`)
      .then((r) => r.json())
      .then((j) => {
        const names = Array.isArray(j.data) ? (j.data as string[]) : []
        setExistingNames(new Set(names.map((n) => n.trim().toLowerCase())))
      })
      .catch(() => setExistingNames(new Set()))
  }, [gender, isEdit, personality])

  const renameTrimmed = renameValue.trim()
  const renameUnchanged = renameTrimmed.toLowerCase() === personality.trim().toLowerCase()
  const renameTaken = !renameUnchanged && existingNames.has(renameTrimmed.toLowerCase())
  const renameValid = renameTrimmed.length > 0 && !renameUnchanged && !renameTaken

  const submitRename = async () => {
    if (!renameValid || renaming) return
    setRenaming(true)
    try {
      const res = await fetch("/api/system-prompts/rename", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gender,
          old_personality: personality,
          new_personality: renameTrimmed,
        }),
      })
      const json = (await res.json()) as {
        data?: { digital_humans_updated?: number; config_overrides_updated?: number; prompts_updated?: number }
        error?: string
      }
      if (!res.ok) throw new Error(json.error || "Failed to rename")

      const d = json.data ?? {}
      const oldName = personality
      setPersonality(renameTrimmed)
      setInitialSnapshot((prev) => (prev ? { ...prev, personality: renameTrimmed } : prev))
      // Update the URL in place (no router navigation) so the editor keeps its
      // state and any unsaved edits, then tell the secondary sidebar to refresh.
      window.history.replaceState(
        null,
        "",
        `/admin/system-prompts/manage?gender=${encodeURIComponent(gender)}&personality=${encodeURIComponent(renameTrimmed)}`
      )
      window.dispatchEvent(
        new CustomEvent("personality-renamed", {
          detail: { gender, oldName, newName: renameTrimmed },
        })
      )
      setIdentityOpen(false)

      const extras: string[] = []
      const dh = d.digital_humans_updated ?? 0
      const cfg = d.config_overrides_updated ?? 0
      if (dh) extras.push(`${dh} digital human${dh === 1 ? "" : "s"}`)
      if (cfg) extras.push(`${cfg} override${cfg === 1 ? "" : "s"}`)
      toast.success(
        `Renamed to "${renameTrimmed}"${extras.length ? ` · also updated ${extras.join(" and ")}` : ""}`
      )
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to rename")
    } finally {
      setRenaming(false)
    }
  }

  const stages: { id: StageId; label: string; icon: React.ComponentType<{ className?: string }>; on: boolean; summary: string }[] = [
    {
      id: "matching",
      label: "Matching",
      icon: Users,
      on: matchingEnabled,
      summary: matchingEnabled
        ? immediateMatchEnabled
          ? "In feed · instant"
          : "In feed · manual"
        : "Hidden from feed",
    },
    {
      id: "greeting",
      label: "Greeting",
      icon: Hand,
      on: activeGreetingEnabled,
      summary: activeGreetingEnabled ? "Sends first message" : "No auto greeting",
    },
    {
      id: "reply",
      label: "Reply",
      icon: MessageSquare,
      on: true,
      summary: `${replyMinDelay}–${replyMaxDelay}s · ${Math.round(replyCharsPerSecond * 12)} wpm${skipReplyEnabled ? " · silence on" : ""}`,
    },
    {
      id: "followup",
      label: "Follow-up",
      icon: Repeat,
      on: followUpEnabled,
      summary: followUpEnabled ? `Wait ${followUpDelay}s · max ${maxFollowUps}` : "Off",
    },
  ]

  if (loading) return <div className="p-10 text-center">Loading...</div>

  const actions = (
    <>
      <Button variant="outline" className="gap-2" onClick={() => setTestOpen(true)} disabled={saving}>
        <FlaskConical className="h-4 w-4" />
        Test &amp; tune
      </Button>
      <Button onClick={() => void save()} disabled={saving || loading || !isDirty}>
        {saving ? "Saving..." : "Save changes"}
      </Button>
    </>
  )

  return (
    <div className={variant === "page" ? "space-y-6 w-full pb-20" : "space-y-6"}>
      {variant === "page" ? (
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Button variant="ghost" size="icon" onClick={() => requestNavigation({ type: "back" })}>
              <ChevronLeft className="w-5 h-5" />
            </Button>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-semibold tracking-tight truncate">
                  {personality || "New personality"}
                </h1>
                <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                  {gender}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  onClick={openIdentity}
                  disabled={saving}
                  title={isEdit ? "Rename personality" : "Edit identity"}
                  aria-label={isEdit ? "Rename personality" : "Edit identity"}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">
                Define how this digital human behaves and responds.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 pt-1 shrink-0">{actions}</div>
        </div>
      ) : null}

      {/* Glanceable pipeline that doubles as the section tabs. */}
      <div className="flex items-stretch gap-1">
        {stages.map((s, i) => {
          const Icon = s.icon
          const active = activeStage === s.id
          return (
            <React.Fragment key={s.id}>
              <button
                type="button"
                onClick={() => setActiveStage(s.id)}
                aria-current={active}
                className={cn(
                  "flex-1 rounded-xl border p-3 text-left transition-colors",
                  active
                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                    : "hover:bg-muted/40"
                )}
              >
                <div className="flex items-center gap-2">
                  <Icon className={cn("h-4 w-4", active ? "text-primary" : "text-muted-foreground")} />
                  <span className={cn("text-sm font-medium", active && "text-primary")}>{s.label}</span>
                </div>
                <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span
                    className={cn(
                      "inline-block h-1.5 w-1.5 shrink-0 rounded-full",
                      s.on ? "bg-emerald-500" : "bg-muted-foreground/40"
                    )}
                  />
                  <span className="truncate">{s.summary}</span>
                </div>
              </button>
              {i < stages.length - 1 ? (
                <div className="flex items-center px-0.5 text-muted-foreground/40">
                  <ChevronRight className="h-4 w-4" />
                </div>
              ) : null}
            </React.Fragment>
          )
        })}
      </div>

      {/* Inline editor for the selected stage. */}
      <Card className="p-5 md:p-6">
        {activeStage === "matching" ? (
          <div className="space-y-4">
            <StageHeading
              title="Matching"
              description="How this personality shows up in matching and what happens when a real user invites it."
            />
            <ToggleRow
              title="Matching enabled"
              description="Appears in the swipe feed and on the map, and can send / accept requests. Off = hidden from discovery."
              checked={matchingEnabled}
              onChange={setMatchingEnabled}
            />
            <ToggleRow
              title="Immediate match"
              description="When a real user invites this personality (swipe or map), skip the pending request and create the match instantly. Off = the user's invite waits as a request."
              checked={immediateMatchEnabled}
              onChange={setImmediateMatchEnabled}
            />
          </div>
        ) : null}

        {activeStage === "greeting" ? (
          <div className="space-y-4">
            <StageHeading
              title="Greeting / outreach (the 'say hi')"
              description="This single switch controls whether the personality initiates: it proactively reaches out to nearby real users on the map (nearby invitations) AND sends the first message when a match is created. Off = it never initiates; it only replies."
            />
            <ToggleRow
              title="Active greeting & nearby outreach"
              description="ON: this personality says hi first — reaches out to nearby users and opens new matches. OFF: no nearby outreach, no auto first message."
              checked={activeGreetingEnabled}
              onChange={setActiveGreetingEnabled}
            />
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label>Greeting prompt (nearby opener)</Label>
                {isEdit ? (
                  <PromptHistoryButton
                    title="Greeting prompt"
                    versions={versions}
                    loading={versionsLoading}
                    onOpen={fetchVersions}
                    extract={(v) => v.active_greeting_prompt ?? ""}
                    onRestore={setActiveGreetingPrompt}
                  />
                ) : null}
              </div>
              <Textarea
                rows={10}
                value={activeGreetingPrompt}
                onChange={(e) => setActiveGreetingPrompt(e.target.value)}
                placeholder="e.g. Notice you're nearby and send a short, warm 'say hi' opener to start the conversation."
                disabled={!activeGreetingEnabled}
              />
              <div className="text-xs text-muted-foreground">
                Used by nearby invitations (find-nearby-people → dh-nearby-dispatch) to generate each &quot;say hi&quot; opener.
              </div>
            </div>
          </div>
        ) : null}

        {activeStage === "reply" ? (
          <div className="space-y-5">
            <StageHeading
              title="Reply"
              description="Core response behavior: the prompt, send pacing, and human-like silence."
            />
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label>System prompt template</Label>
                {isEdit ? (
                  <PromptHistoryButton
                    title="Reply prompt"
                    versions={versions}
                    loading={versionsLoading}
                    onOpen={fetchVersions}
                    extract={(v) => v.system_prompt ?? ""}
                    onRestore={setSystemPrompt}
                    mono
                  />
                ) : null}
              </div>
              <Textarea
                rows={variant === "dialog" ? 12 : 16}
                className="font-mono text-sm"
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder={`Include:\n<bot_profile>\nBOT_PROFILE_DETAILS\n</bot_profile>`}
              />
              <div className="text-xs text-muted-foreground">
                Required placeholder: <code className="rounded bg-muted px-1 py-0.5">BOT_PROFILE_DETAILS</code>
              </div>
            </div>

            {/* Reply timing — how long a reply "takes" to send, scaled by length. */}
            <div className="space-y-3 rounded-lg border p-4">
              <div>
                <div className="text-sm font-medium">Reply timing</div>
                <div className="text-xs text-muted-foreground">
                  Longer replies send slower. Time spent generating counts toward the delay; the floor keeps it from
                  ever sending instantly.
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label>Min delay (seconds)</Label>
                  <Input
                    type="number"
                    min={0}
                    max={60}
                    value={replyMinDelay}
                    onChange={(e) => setReplyMinDelay(Number(e.target.value))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Max delay (seconds)</Label>
                  <Input
                    type="number"
                    min={0}
                    max={60}
                    value={replyMaxDelay}
                    onChange={(e) => setReplyMaxDelay(Number(e.target.value))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Typing speed (chars/sec)</Label>
                  <Input
                    type="number"
                    min={1}
                    max={100}
                    value={replyCharsPerSecond}
                    onChange={(e) => setReplyCharsPerSecond(Number(e.target.value))}
                  />
                  <div className="text-xs text-muted-foreground">
                    Lower = slower for long replies. ≈ {Math.round(replyCharsPerSecond * 12)} wpm.
                  </div>
                </div>
              </div>
            </div>

            {/* Human-like silence — sometimes don't reply at all. */}
            <div className="space-y-3 rounded-lg border p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">Human-like silence</div>
                  <div className="text-xs text-muted-foreground">
                    Real people don&apos;t answer every text, and go quiet when you say something off-putting. When
                    on, the digital human sometimes stays silent — more often when the user&apos;s message dropped
                    the intimacy score.
                  </div>
                </div>
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-gray-300 accent-primary"
                  checked={skipReplyEnabled}
                  onChange={(e) => setSkipReplyEnabled(e.target.checked)}
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Base skip chance (%)</Label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={Math.round(skipBaseChance * 100)}
                    onChange={(e) => setSkipBaseChance(Math.max(0, Math.min(100, Number(e.target.value))) / 100)}
                    disabled={!skipReplyEnabled}
                  />
                  <div className="text-xs text-muted-foreground">Chance of staying silent on any message.</div>
                </div>
                <div className="space-y-2">
                  <Label>Skip chance on intimacy drop (%)</Label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={Math.round(skipDropChance * 100)}
                    onChange={(e) => setSkipDropChance(Math.max(0, Math.min(100, Number(e.target.value))) / 100)}
                    disabled={!skipReplyEnabled}
                  />
                  <div className="text-xs text-muted-foreground">Used when the user cooled things off.</div>
                </div>
                <div className="space-y-2">
                  <Label>Intimacy drop threshold (points)</Label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={skipDropDelta}
                    onChange={(e) => setSkipDropDelta(Number(e.target.value))}
                    disabled={!skipReplyEnabled}
                  />
                  <div className="text-xs text-muted-foreground">How big a drop counts as &quot;said something wrong&quot;.</div>
                </div>
                <div className="space-y-2">
                  <Label>Max skips in a row</Label>
                  <Input
                    type="number"
                    min={0}
                    max={10}
                    value={skipMaxConsecutive}
                    onChange={(e) => setSkipMaxConsecutive(Number(e.target.value))}
                    disabled={!skipReplyEnabled}
                  />
                  <div className="text-xs text-muted-foreground">
                    Always replies once the user double-texts past this, so chats never die. The opener always gets a
                    reply.
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {activeStage === "followup" ? (
          <div className="space-y-4">
            <StageHeading
              title="Follow-up"
              description="Automated nudges when the user doesn’t respond."
            />
            <ToggleRow
              title="Enable follow-ups"
              description="Schedule extra nudges"
              checked={followUpEnabled}
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
              <div className="flex items-center justify-between gap-2">
                <Label>Follow-up instruction prompt</Label>
                {isEdit ? (
                  <PromptHistoryButton
                    title="Follow-up prompt"
                    versions={versions}
                    loading={versionsLoading}
                    onOpen={fetchVersions}
                    extract={(v) => v.follow_up_message_prompt ?? ""}
                    onRestore={setFollowUpPrompt}
                  />
                ) : null}
              </div>
              <Textarea
                rows={10}
                value={followUpPrompt}
                onChange={(e) => setFollowUpPrompt(e.target.value)}
                placeholder="e.g. The user hasn't replied. Send a playful message to get their attention."
                disabled={!followUpEnabled}
              />
            </div>
          </div>
        ) : null}
      </Card>

      {variant !== "page" ? (
        <div className="flex items-center justify-between gap-3 pt-2">
          <Button variant="outline" className="gap-2" onClick={() => setTestOpen(true)} disabled={saving}>
            <FlaskConical className="h-4 w-4" />
            Test &amp; tune
          </Button>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              onClick={() => requestNavigation({ type: "cancel" })}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button onClick={() => void save()} disabled={saving || loading || !isDirty}>
              {saving ? "Saving..." : "Save changes"}
            </Button>
          </div>
        </div>
      ) : null}

      {/* Test & tune — slides in from the right, called from the button next to Save. */}
      <Sheet open={testOpen} onOpenChange={setTestOpen}>
        <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-xl">
          <SheetHeader className="border-b">
            <SheetTitle>Test &amp; tune</SheetTitle>
            <SheetDescription>
              Test the prompt with a random bot profile ({gender}
              {personality ? ` · ${personality}` : ""}).
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-auto px-4 pb-6">
            <ChatPanel
              systemPrompt={testSystemPrompt}
              activeGreetingEnabled={activeGreetingEnabled}
              activeGreetingPrompt={activeGreetingPrompt}
              followUpEnabled={followUpEnabled}
              followUpPrompt={followUpPrompt}
              followUpDelay={followUpDelay}
              maxFollowUps={maxFollowUps}
            />
          </div>
        </SheetContent>
      </Sheet>

      {/* Identity / rename personality. */}
      <Dialog open={identityOpen} onOpenChange={(open) => !renaming && setIdentityOpen(open)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{isEdit ? "Rename personality" : "Identity"}</DialogTitle>
          </DialogHeader>

          {isEdit ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Renames every version of this prompt and reassigns the {gender.toLowerCase()} digital humans using
                it. The name must be unique for {gender}.
              </p>
              <div className="space-y-2">
                <Label>Personality name</Label>
                <Input
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && renameValid) {
                      e.preventDefault()
                      void submitRename()
                    }
                  }}
                  placeholder="e.g. calm_playboy"
                  autoFocus
                />
                <div className="min-h-[1rem] text-xs">
                  {renameTaken ? (
                    <span className="text-destructive">Taken — another {gender} personality uses this name.</span>
                  ) : renameTrimmed && !renameUnchanged ? (
                    <span className="text-emerald-600">Available.</span>
                  ) : (
                    <span className="text-muted-foreground">
                      Changing the join key — existing chats keep working under the new name.
                    </span>
                  )}
                </div>
              </div>
              <DialogFooter className="gap-2 sm:justify-end">
                <Button variant="outline" onClick={() => setIdentityOpen(false)} disabled={renaming}>
                  Cancel
                </Button>
                <Button onClick={() => void submitRename()} disabled={!renameValid || renaming}>
                  {renaming ? "Renaming..." : "Rename"}
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
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
                  <Label>Personality</Label>
                  <Input
                    value={personality}
                    onChange={(e) => setPersonality(e.target.value)}
                    placeholder="e.g. calm_playboy"
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                These keys control which prompt template you are creating.
              </p>
              <DialogFooter>
                <Button onClick={() => setIdentityOpen(false)}>Done</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={pendingNavigation !== null} onOpenChange={(open) => {
        if (!open && !saving) setPendingNavigation(null)
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Save prompt changes?</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>
              You have unsaved prompt changes. Save them before leaving, discard them, or keep editing.
            </p>
            <p>
              Refreshing or closing the tab will also show a browser warning while changes are unsaved.
            </p>
          </div>
          <DialogFooter className="gap-2 sm:justify-end">
            <Button
              variant="outline"
              onClick={() => setPendingNavigation(null)}
              disabled={saving}
            >
              Keep Editing
            </Button>
            <Button
              variant="destructive"
              onClick={leaveWithoutSaving}
              disabled={saving}
            >
              Leave Without Saving
            </Button>
            <Button
              onClick={() => void saveAndContinueNavigation()}
              disabled={saving}
            >
              {saving ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/// Per-section rollback: lists previous saved versions by date/time, previews the
/// selected one, and restores its prompt into the form (the user then Saves, which
/// commits it as a new version — non-destructive, matching the versioned model).
function PromptHistoryButton({
  title,
  versions,
  loading,
  onOpen,
  extract,
  onRestore,
  mono = false,
}: {
  title: string
  versions: SystemPromptVersion[]
  loading: boolean
  onOpen: () => void
  extract: (v: SystemPromptVersion) => string
  onRestore: (value: string) => void
  mono?: boolean
}) {
  const [open, setOpen] = React.useState(false)
  const [selectedId, setSelectedId] = React.useState<string | null>(null)

  // Only versions that actually had content for this section, newest first.
  const items = React.useMemo(
    () => versions.filter((v) => extract(v).trim().length > 0),
    [versions, extract]
  )
  const selected = items.find((v) => v.id === selectedId) ?? items[0] ?? null

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 gap-1.5 text-xs text-muted-foreground"
        onClick={() => {
          onOpen()
          setSelectedId(null)
          setOpen(true)
        }}
      >
        <History className="h-3.5 w-3.5" />
        History
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{title} — version history</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-[210px_1fr] gap-4">
            <ScrollArea className="h-[55vh] rounded-md border">
              <div className="p-1">
                {loading ? (
                  <div className="p-4 text-sm text-muted-foreground">Loading…</div>
                ) : items.length === 0 ? (
                  <div className="p-4 text-sm text-muted-foreground">No saved versions yet.</div>
                ) : (
                  items.map((v, i) => (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => setSelectedId(v.id)}
                      className={cn(
                        "flex w-full flex-col items-start gap-0.5 rounded px-3 py-2 text-left text-sm transition-colors hover:bg-muted",
                        selected?.id === v.id && "bg-muted"
                      )}
                    >
                      <span className="font-medium">{new Date(v.created_at).toLocaleString()}</span>
                      <span className="text-xs text-muted-foreground">
                        {i === 0 ? "Latest (current)" : `${i} newer version${i === 1 ? "" : "s"}`}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </ScrollArea>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">
                {selected ? `Preview · ${new Date(selected.created_at).toLocaleString()}` : "Preview"}
              </Label>
              <Textarea
                readOnly
                rows={18}
                className={cn("resize-none", mono && "font-mono text-sm")}
                value={selected ? extract(selected) : ""}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!selected}
              onClick={() => {
                if (!selected) return
                onRestore(extract(selected))
                toast.success(
                  `Restored ${title.toLowerCase()} from ${new Date(
                    selected.created_at
                  ).toLocaleString()}. Review and Save to apply.`
                )
                setOpen(false)
              }}
            >
              Restore this version
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function StageHeading({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <div className="text-base font-semibold">{title}</div>
      <div className="text-sm text-muted-foreground">{description}</div>
    </div>
  )
}

function ToggleRow({
  title,
  description,
  checked,
  onChange,
}: {
  title: string
  description: string
  checked: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border p-4">
      <div>
        <div className="text-sm font-medium">{title}</div>
        <div className="text-xs text-muted-foreground">{description}</div>
      </div>
      <input
        type="checkbox"
        className="h-4 w-4 rounded border-gray-300 accent-primary"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  )
}
