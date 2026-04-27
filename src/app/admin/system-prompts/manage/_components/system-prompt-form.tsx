'use client'

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { CheckCircle2, ChevronLeft, FileText, Settings, XCircle } from "lucide-react"
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Node,
  type NodeTypes,
  type NodeProps,
} from "@xyflow/react"

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

import { composeSystemPromptFromTemplate } from "@/lib/botProfile"
import { ChatPanel } from "./chat-panel"

const PLACEHOLDER_RE = /<bot_profile>[\s\r\n]*BOT_PROFILE_DETAILS[\s\r\n]*<\/bot_profile>/i

export type SystemPromptLatest = {
  system_prompt: string
  created_at: string
  response_delay: number
  matching_enabled: boolean
  immediate_match_enabled: boolean
  follow_up_message_enabled: boolean
  follow_up_message_prompt: string
  follow_up_delay: number
  max_follow_ups: number
  active_greeting_enabled: boolean
  active_greeting_prompt: string
}

type WorkflowNodeData = Record<string, unknown> & {
  title: string
  description?: string
  children: React.ReactNode
  onOpenSettings?: () => void
}
type WorkflowGraphNode = Node<WorkflowNodeData>
type PendingNavigation =
  | { type: "back" }
  | { type: "cancel" }
  | { type: "href"; href: string }

function WorkflowNode({ data }: NodeProps<WorkflowGraphNode>) {
  const onSettings = data.onOpenSettings
  return (
    <Card className="w-[320px] p-4 shadow-sm">
      <Handle type="target" position={Position.Left} />
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">{data.title}</div>
            {data.description ? (
              <div className="text-xs text-muted-foreground">{data.description}</div>
            ) : null}
          </div>
          {onSettings ? (
            <button
              type="button"
              className="nodrag inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border bg-background p-0 leading-none hover:bg-muted"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                onSettings()
              }}
              aria-label="Open settings"
              title="Edit"
            >
              <Settings className="h-4 w-4" />
            </button>
          ) : null}
        </div>
        <div>{data.children}</div>
      </div>
      <Handle type="source" position={Position.Right} />
    </Card>
  )
}

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
  const [responseDelay, setResponseDelay] = React.useState<number>(0)

  const [matchingEnabled, setMatchingEnabled] = React.useState(true)
  const [immediateMatchEnabled, setImmediateMatchEnabled] = React.useState(false)
  const [followUpEnabled, setFollowUpEnabled] = React.useState(false)
  const [followUpPrompt, setFollowUpPrompt] = React.useState("")
  const [followUpDelay, setFollowUpDelay] = React.useState<number>(86400)
  const [maxFollowUps, setMaxFollowUps] = React.useState<number>(3)
  const [activeGreetingEnabled, setActiveGreetingEnabled] = React.useState(false)
  const [activeGreetingPrompt, setActiveGreetingPrompt] = React.useState("")

  type PromptSnapshot = {
    gender: string
    personality: string
    systemPrompt: string
    responseDelay: number
    matchingEnabled: boolean
    immediateMatchEnabled: boolean
    followUpEnabled: boolean
    followUpPrompt: string
    followUpDelay: number
    maxFollowUps: number
    activeGreetingEnabled: boolean
    activeGreetingPrompt: string
  }

  const [initialSnapshot, setInitialSnapshot] = React.useState<PromptSnapshot | null>(null)

  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const [settingsNodeId, setSettingsNodeId] = React.useState<
    "identity" | "matching" | "greeting" | "reply" | "followup" | null
  >(null)
  const [pendingNavigation, setPendingNavigation] = React.useState<PendingNavigation | null>(null)
  const allowNavigationRef = React.useRef(false)

  const currentSnapshot = React.useCallback(
    (): PromptSnapshot => ({
      gender: gender.trim(),
      personality: personality.trim(),
      systemPrompt,
      responseDelay,
      matchingEnabled,
      immediateMatchEnabled,
      followUpEnabled,
      followUpPrompt,
      followUpDelay,
      maxFollowUps,
      activeGreetingEnabled,
      activeGreetingPrompt,
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
      responseDelay,
      systemPrompt,
    ]
  )

  const openSettings = React.useCallback(
    (id: "identity" | "matching" | "greeting" | "reply" | "followup") => {
      setSettingsNodeId(id)
      setSettingsOpen(true)
    },
    []
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
          setResponseDelay(d.response_delay ?? 0)
          setMatchingEnabled(d.matching_enabled ?? true)
          setImmediateMatchEnabled(d.immediate_match_enabled ?? false)
          setFollowUpEnabled(d.follow_up_message_enabled ?? false)
          setFollowUpPrompt(d.follow_up_message_prompt ?? "")
          setFollowUpDelay(d.follow_up_delay ?? 86400)
          setMaxFollowUps(d.max_follow_ups ?? 3)
          setActiveGreetingEnabled(d.active_greeting_enabled ?? false)
          setActiveGreetingPrompt(d.active_greeting_prompt ?? "")
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
    const rd = Number(responseDelay)
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
      return false
    }
    if (!sp.trim()) {
      toast.error("System prompt is required")
      return false
    }
    if (!PLACEHOLDER_RE.test(sp)) {
      toast.error("Prompt must include: <bot_profile> BOT_PROFILE_DETAILS </bot_profile>")
      return false
    }
    if (isNaN(rd) || rd < 0 || rd > 86400) {
      toast.error("Response delay must be between 0 and 86400 seconds")
      return false
    }
    if (age && !agp.trim()) {
      toast.error("Greeting prompt is required when active greeting is enabled")
      return false
    }
    if (fued) {
      if (!fup.trim()) {
        toast.error("Follow-up prompt is required when enabled")
        return false
      }
      if (isNaN(fud) || fud <= 0) {
        toast.error("Follow-up delay must be positive")
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
          response_delay: rd,
          matching_enabled: me,
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

  const closeSettingsAfterSave = async () => {
    if (saving) return
    if (isDirty) {
      const saved = await save({ navigateAfterSave: false })
      if (!saved) return
    }
    setSettingsOpen(false)
    setSettingsNodeId(null)
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

  const nodeTypes = React.useMemo<NodeTypes>(() => {
    return { workflow: WorkflowNode }
  }, [])

  const nodes = React.useMemo<WorkflowGraphNode[]>(() => {
    const systemPromptPreview = systemPrompt.trim()
      ? systemPrompt.trim().split(/\r?\n/).slice(0, 3).join("\n")
      : "—"
    const greetingPreview = activeGreetingPrompt.trim()
      ? activeGreetingPrompt.trim().split(/\r?\n/).slice(0, 2).join("\n")
      : "—"
    const followUpPreview = followUpPrompt.trim()
      ? followUpPrompt.trim().split(/\r?\n/).slice(0, 2).join("\n")
      : "—"

    const StatusIcon = ({ ok }: { ok: boolean }) =>
      ok ? (
        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
      ) : (
        <XCircle className="h-4 w-4 text-muted-foreground" />
      )

    const PromptPreview = ({ text }: { text: string }) => (
      <div className="rounded-md border bg-muted/20 p-2 text-xs whitespace-pre-wrap">
        <div className="mb-1 flex items-center gap-2 text-muted-foreground">
          <FileText className="h-3.5 w-3.5" />
          <span className="font-medium">Preview</span>
        </div>
        {text || "—"}
      </div>
    )

    return [
      {
        id: "matching",
        type: "workflow",
        position: { x: 40, y: 170 },
        data: {
          title: "1) Matching",
          description: "Control whether this persona appears in the feed and whether matches are instant.",
          onOpenSettings: () => openSettings("matching"),
          children: (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">Matching Enabled</div>
                  <div className="text-xs text-muted-foreground">Appears in swipe feed</div>
                </div>
                <StatusIcon ok={matchingEnabled} />
              </div>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">Immediate Match</div>
                  <div className="text-xs text-muted-foreground">No request, auto match</div>
                </div>
                <StatusIcon ok={immediateMatchEnabled} />
              </div>
            </div>
          ),
        },
      },
      {
        id: "greeting",
        type: "workflow",
        position: { x: 420, y: 170 },
        data: {
          title: "2) Greeting",
          description: "Optional first message sent automatically when enabled.",
          onOpenSettings: () => openSettings("greeting"),
          children: (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">Active Greeting</div>
                  <div className="text-xs text-muted-foreground">Send first message on match</div>
                </div>
                <StatusIcon ok={activeGreetingEnabled} />
              </div>

              <PromptPreview text={greetingPreview} />
            </div>
          ),
        },
      },
      {
        id: "reply",
        type: "workflow",
        position: { x: 800, y: 170 },
        data: {
          title: "3) Reply",
          description: "Core response behavior: delay + system prompt template.",
          onOpenSettings: () => openSettings("reply"),
          children: (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">Response Delay</div>
                  <div className="text-xs text-muted-foreground">Seconds</div>
                </div>
                <div className="text-sm font-semibold tabular-nums">{responseDelay}</div>
              </div>
              <PromptPreview text={systemPromptPreview} />
            </div>
          ),
        },
      },
      {
        id: "followup",
        type: "workflow",
        position: { x: 1180, y: 170 },
        data: {
          title: "4) Follow Up Reply",
          description: "Automated follow-ups when the user doesn’t respond.",
          onOpenSettings: () => openSettings("followup"),
          children: (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">Enable Follow-ups</div>
                  <div className="text-xs text-muted-foreground">Schedule extra nudges</div>
                </div>
                <StatusIcon ok={followUpEnabled} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-md border bg-muted/20 p-2">
                  <div className="text-xs text-muted-foreground">Wait (sec)</div>
                  <div className="text-sm font-semibold tabular-nums">{followUpDelay}</div>
                </div>
                <div className="rounded-md border bg-muted/20 p-2">
                  <div className="text-xs text-muted-foreground">Max</div>
                  <div className="text-sm font-semibold tabular-nums">{maxFollowUps}</div>
                </div>
              </div>

              <PromptPreview text={followUpPreview} />
            </div>
          ),
        },
      },
    ]
  }, [
    activeGreetingEnabled,
    activeGreetingPrompt,
    followUpDelay,
    followUpEnabled,
    followUpPrompt,
    openSettings,
    immediateMatchEnabled,
    matchingEnabled,
    maxFollowUps,
    responseDelay,
    systemPrompt,
  ])

  const edges = React.useMemo(() => {
    return [
      { id: "e1", source: "matching", target: "greeting", animated: true },
      { id: "e2", source: "greeting", target: "reply", animated: true },
      { id: "e3", source: "reply", target: "followup", animated: true },
    ]
  }, [])

  if (loading) return <div className="p-10 text-center">Loading...</div>

  return (
    <div className={variant === "page" ? "space-y-6 w-full pb-20" : "space-y-6"}>
      {variant === "page" ? (
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => requestNavigation({ type: "back" })}>
              <ChevronLeft className="w-5 h-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">
                {isEdit ? `Edit Prompt: ${gender} - ${personality}` : "Create Prompt"}
              </h1>
              <p className="text-sm text-muted-foreground">Define how the digital human behaves and automated responses.</p>
            </div>
          </div>

          <div className="flex items-center gap-3 pt-1">
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => openSettings("identity")}
              disabled={saving}
            >
              <Settings className="h-4 w-4" />
              Identity
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                requestNavigation({ type: "cancel" })
              }}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button onClick={() => void save()} disabled={saving || loading || !isDirty}>
              {saving ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </div>
      ) : null}

      <div className="flex flex-col xl:flex-row gap-6">
        <Card className="p-0 overflow-hidden flex-1">
          <div className="p-4 border-b">
            <div className="text-sm font-medium">Behavior Workflow</div>
            <div className="text-xs text-muted-foreground">Matching → Greeting → Reply → Follow Up</div>
          </div>
          <div className="system-prompt-flow h-[520px] w-full">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              fitView
              nodesDraggable
              nodesConnectable={false}
              elementsSelectable
              proOptions={{ hideAttribution: true }}
            >
              <Background gap={18} size={1} />
              <Controls />
            </ReactFlow>
          </div>
        </Card>

        <Card className="p-4 w-full xl:w-[450px] shrink-0">
          <div className="mb-4">
            <div className="text-sm font-medium">Test & Tuning</div>
            <div className="text-xs text-muted-foreground">
              Test the prompt with a random bot profile (Gender: {gender}, Personality: {personality}).
            </div>
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
      </div>

      {/* Make ReactFlow controls visible in dark mode (and consistent with shadcn theme). */}
      <style jsx global>{`
        .system-prompt-flow .react-flow__controls {
          box-shadow: none;
        }
        .system-prompt-flow .react-flow__controls button {
          background: hsl(var(--background));
          border: 1px solid hsl(var(--border));
          color: hsl(var(--foreground));
        }
        .system-prompt-flow .react-flow__controls button:hover {
          background: hsl(var(--muted));
        }
        .system-prompt-flow .react-flow__controls button svg {
          fill: currentColor;
          stroke: currentColor;
        }
      `}</style>

      {variant !== "page" ? (
        <div className="flex items-center justify-end gap-3 pt-2">
          <Button
            variant="outline"
            onClick={() => requestNavigation({ type: "cancel" })}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={saving || loading || !isDirty}>
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      ) : null}

      <Dialog
        open={settingsOpen}
        onOpenChange={(open) => {
          if (open) {
            setSettingsOpen(true)
            return
          }
          void closeSettingsAfterSave()
        }}
      >
        <DialogContent className="max-w-3xl p-0">
          <DialogHeader>
            <div className="p-6 pb-4">
              <DialogTitle>
                {settingsNodeId === "identity"
                  ? "Core Identity"
                  : settingsNodeId === "matching"
                    ? "Matching Settings"
                    : settingsNodeId === "greeting"
                      ? "Greeting Settings"
                      : settingsNodeId === "reply"
                        ? "Reply Settings"
                        : settingsNodeId === "followup"
                          ? "Follow-up Settings"
                          : "Settings"}
              </DialogTitle>
            </div>
          </DialogHeader>

          <div className="max-h-[75vh] overflow-auto px-6 pb-6">
            {settingsNodeId === "identity" ? (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Gender</Label>
                    <select
                      className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                      value={gender}
                      onChange={(e) => setGender(e.target.value)}
                      disabled={disableKeyEdit}
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
                      disabled={disableKeyEdit}
                    />
                  </div>
                </div>
                <div className="text-xs text-muted-foreground">
                  These keys control which prompt template you are editing/creating.
                </div>
              </div>
            ) : null}

            {settingsNodeId === "matching" ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium">Matching Enabled</div>
                    <div className="text-xs text-muted-foreground">Appears in the matching feed</div>
                  </div>
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-gray-300 accent-primary"
                    checked={matchingEnabled}
                    onChange={(e) => setMatchingEnabled(e.target.checked)}
                  />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium">Immediate Match</div>
                    <div className="text-xs text-muted-foreground">Create match instantly</div>
                  </div>
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-gray-300 accent-primary"
                    checked={immediateMatchEnabled}
                    onChange={(e) => setImmediateMatchEnabled(e.target.checked)}
                  />
                </div>
              </div>
            ) : null}

            {settingsNodeId === "greeting" ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium">Active Greeting</div>
                    <div className="text-xs text-muted-foreground">Send first message on match</div>
                  </div>
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-gray-300 accent-primary"
                    checked={activeGreetingEnabled}
                    onChange={(e) => setActiveGreetingEnabled(e.target.checked)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Greeting Prompt</Label>
                  <Textarea
                    rows={10}
                    className="max-h-[45vh] overflow-auto"
                    value={activeGreetingPrompt}
                    onChange={(e) => setActiveGreetingPrompt(e.target.value)}
                    placeholder="e.g. When a match is created, send a warm, casual first message to break the ice."
                    disabled={!activeGreetingEnabled}
                  />
                </div>
              </div>
            ) : null}

            {settingsNodeId === "reply" ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Initial Response Delay (seconds)</Label>
                  <Input
                    type="number"
                    min={0}
                    max={86400}
                    value={responseDelay}
                    onChange={(e) => setResponseDelay(Number(e.target.value))}
                  />
                  <div className="text-xs text-muted-foreground">0–86400 seconds</div>
                </div>
                <div className="space-y-2">
                  <Label>System Prompt Template</Label>
                  <Textarea
                    rows={variant === "dialog" ? 12 : 16}
                    className="font-mono text-sm max-h-[45vh] overflow-auto"
                    value={systemPrompt}
                    onChange={(e) => setSystemPrompt(e.target.value)}
                    placeholder={`Include:\n<bot_profile>\nBOT_PROFILE_DETAILS\n</bot_profile>`}
                  />
                  <div className="text-xs text-muted-foreground">
                    Required placeholder: <code className="rounded bg-muted px-1 py-0.5">BOT_PROFILE_DETAILS</code>
                  </div>
                </div>
              </div>
            ) : null}

            {settingsNodeId === "followup" ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium">Enable Follow-ups</div>
                    <div className="text-xs text-muted-foreground">Schedule extra nudges</div>
                  </div>
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-gray-300 accent-primary"
                    checked={followUpEnabled}
                    onChange={(e) => setFollowUpEnabled(e.target.checked)}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Wait Time (seconds)</Label>
                    <Input
                      type="number"
                      min={60}
                      value={followUpDelay}
                      onChange={(e) => setFollowUpDelay(Number(e.target.value))}
                      disabled={!followUpEnabled}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Max Follow-ups</Label>
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
                  <Label>Follow-up Instruction Prompt</Label>
                  <Textarea
                    rows={10}
                    className="max-h-[45vh] overflow-auto"
                    value={followUpPrompt}
                    onChange={(e) => setFollowUpPrompt(e.target.value)}
                    placeholder="e.g. The user hasn't replied. Send a playful message to get their attention."
                    disabled={!followUpEnabled}
                  />
                </div>
              </div>
            ) : null}

            <DialogFooter className="pt-6">
              <Button onClick={() => void closeSettingsAfterSave()} disabled={saving}>
                {saving ? "Saving..." : isDirty ? "Save & Done" : "Done"}
              </Button>
            </DialogFooter>
          </div>
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

