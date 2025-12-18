'use client'

import * as React from "react"
import { Send, Settings, RotateCcw } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"
import { composeSystemPromptWithUserProfile, type UserProfileInput } from "@/lib/botProfile"

import type { ChatMessage } from "./types"

const MODEL_OPTIONS = [
  { value: "gemini-3-flash-preview", label: "gemini-3-flash-preview" },
  { value: "gemini-2.5-flash", label: "gemini-2.5-flash" },
  { value: "gemini-2.5-pro", label: "gemini-2.5-pro" },
] as const

export function ChatPanel({
  systemPrompt,
  onEffectiveSystemPromptChange,
}: {
  systemPrompt?: string | null
  onEffectiveSystemPromptChange?: (prompt: string) => void
}) {
  const [chatHistory, setChatHistory] = React.useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = React.useState("")
  const [chatLoading, setChatLoading] = React.useState(false)
  const [model, setModel] = React.useState<(typeof MODEL_OPTIONS)[number]["value"]>("gemini-2.5-flash")
  const chatEndRef = React.useRef<HTMLDivElement>(null)

  const [showTestUserSettings, setShowTestUserSettings] = React.useState(false)
  const [testUserName, setTestUserName] = React.useState("")
  const [testUserAge, setTestUserAge] = React.useState("")
  const [testUserHobbies, setTestUserHobbies] = React.useState<string[]>([])
  const [testUserMoodNeed, setTestUserMoodNeed] = React.useState<string[]>([])

  const STORAGE_KEY = "chat-test-user-profile"

  // Load from localStorage on mount
  React.useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        const parsed = JSON.parse(stored) as {
          name?: string
          age?: string
          hobbies?: string[]
          moodNeed?: string[]
        }
        if (parsed.name) setTestUserName(parsed.name)
        if (parsed.age) setTestUserAge(parsed.age)
        if (Array.isArray(parsed.hobbies)) setTestUserHobbies(parsed.hobbies)
        if (Array.isArray(parsed.moodNeed)) setTestUserMoodNeed(parsed.moodNeed)
      }
    } catch (err) {
      console.error("Failed to load test user profile from localStorage", err)
    }
  }, [])

  // Save to localStorage whenever values change
  React.useEffect(() => {
    try {
      const toStore = {
        name: testUserName,
        age: testUserAge,
        hobbies: testUserHobbies,
        moodNeed: testUserMoodNeed,
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore))
    } catch (err) {
      console.error("Failed to save test user profile to localStorage", err)
    }
  }, [testUserName, testUserAge, testUserHobbies, testUserMoodNeed])

  const effectiveSystemPrompt = React.useMemo(() => {
    return getEffectiveSystemPrompt(
      systemPrompt,
      testUserName,
      testUserAge,
      testUserHobbies,
      testUserMoodNeed
    )
  }, [systemPrompt, testUserName, testUserAge, testUserHobbies, testUserMoodNeed])

  React.useEffect(() => {
    onEffectiveSystemPromptChange?.(effectiveSystemPrompt)
  }, [effectiveSystemPrompt, onEffectiveSystemPromptChange])

  const clearChat = () => {
    setChatHistory([])
    setChatInput("")
  }

  const resetTestUserProfile = () => {
    setTestUserName("")
    setTestUserAge("")
    setTestUserHobbies([])
    setTestUserMoodNeed([])
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch (err) {
      console.error("Failed to clear test user profile from localStorage", err)
    }
  }

  React.useEffect(() => {
    const end = chatEndRef.current
    if (!end) return

    // Radix ScrollArea scroll container is the Viewport element; scrollIntoView can be flaky there,
    // so we scroll the viewport directly when possible.
    const viewport = end.closest('[data-slot="scroll-area-viewport"]') as HTMLElement | null

    const doScroll = () => {
      if (viewport) {
        viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" })
      } else {
        end.scrollIntoView({ behavior: "smooth" })
      }
    }

    // Wait a tick so layout updates (new message / "Thinking...") are committed.
    requestAnimationFrame(() => requestAnimationFrame(doScroll))
  }, [chatHistory, chatLoading])

  const handleSendMessage = async () => {
    if (!chatInput.trim()) return

    const newMessage: ChatMessage = { role: "user", parts: [{ text: chatInput }] }
    const updatedHistory = [...chatHistory, newMessage]
    setChatHistory(updatedHistory)
    setChatInput("")
    setChatLoading(true)

    try {
      const effectiveSystemPrompt = getEffectiveSystemPrompt(
        systemPrompt,
        testUserName,
        testUserAge,
        testUserHobbies,
        testUserMoodNeed
      )

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemPrompt: effectiveSystemPrompt,
          history: chatHistory, // keep behavior consistent with previous implementation
          message: newMessage.parts[0].text,
          model,
        }),
      })

      const data = await response.json()
      if (data.response) {
        setChatHistory((prev) => [...prev, { role: "model", parts: [{ text: data.response }] }])
      } else {
        toast.error("Failed to get response from AI")
      }
    } catch (error) {
      console.error(error)
      toast.error("Error communicating with AI")
    } finally {
      setChatLoading(false)
    }
  }

  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <Label>Model</Label>
          <select
            className="h-10 w-full rounded-md border bg-background px-3 text-sm sm:w-[260px]"
            value={model}
            onChange={(e) => setModel(e.target.value as (typeof MODEL_OPTIONS)[number]["value"])}
            disabled={chatLoading}
          >
            {MODEL_OPTIONS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={clearChat}
            disabled={chatLoading || chatHistory.length === 0}
            className="gap-2"
          >
            <RotateCcw className="h-4 w-4" />
            Refresh Chat
          </Button>

          <Button
            type="button"
            variant="outline"
            onClick={() => setShowTestUserSettings((v) => !v)}
            disabled={chatLoading}
            className="gap-2"
          >
            <Settings className="h-4 w-4" />
            Edit User Profile
          </Button>
        </div>
      </div>

      {showTestUserSettings ? (
        <div className="rounded-lg border bg-muted/20 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-medium">Test user profile</div>
            <Button type="button" variant="outline" size="sm" onClick={resetTestUserProfile} disabled={chatLoading}>
              Reset
            </Button>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>User name</Label>
              <Input
                value={testUserName}
                onChange={(e) => setTestUserName(e.target.value)}
                placeholder="e.g. Mike"
              />
            </div>
            <div className="space-y-2">
              <Label>User age</Label>
              <Input
                type="number"
                min={0}
                value={testUserAge}
                onChange={(e) => setTestUserAge(e.target.value)}
                placeholder="e.g. 37"
              />
            </div>
            <TagInput
              label="Hobbies/Interests"
              placeholder="Add a hobby and press Enter…"
              value={testUserHobbies}
              onChange={setTestUserHobbies}
            />
            <TagInput
              label="Current Mood/Need"
              placeholder="Add a mood and press Enter…"
              value={testUserMoodNeed}
              onChange={setTestUserMoodNeed}
            />
          </div>
          <div className="mt-2 text-xs text-muted-foreground">
            If your template contains <code className="rounded bg-muted px-1 py-0.5">USER_PROFILE_DETAILS</code>, these
            fields will be injected on send.
          </div>
        </div>
      ) : null}

      <div className="rounded-lg border bg-muted/40">
        <ScrollArea className="h-[420px] p-4">
          {chatHistory.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">
              Start a conversation to test the persona...
            </div>
          ) : (
            <div className="space-y-3">
              {chatHistory.map((m, idx) => (
                <div key={idx} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                  <div
                    className={
                      m.role === "user"
                        ? "max-w-[80%] rounded-lg bg-primary/10 px-3 py-2 text-sm"
                        : "max-w-[80%] rounded-lg bg-card px-3 py-2 text-sm"
                    }
                  >
                    {m.parts[0].text}
                  </div>
                </div>
              ))}
              {chatLoading ? <div className="text-sm text-muted-foreground">Thinking...</div> : null}
              <div ref={chatEndRef} />
            </div>
          )}
        </ScrollArea>
      </div>

      <div className="flex gap-2">
        <Input
          placeholder="Type a message..."
          value={chatInput}
          onChange={(e) => setChatInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              void handleSendMessage()
            }
          }}
          disabled={chatLoading}
        />
        <Button onClick={() => void handleSendMessage()} disabled={chatLoading} className="gap-2">
          <Send className="h-4 w-4" />
          Send
        </Button>
      </div>
    </div>
  )
}

function TagInput({
  label,
  placeholder,
  value,
  onChange,
}: {
  label: string
  placeholder?: string
  value: string[]
  onChange: (next: string[]) => void
}) {
  const [draft, setDraft] = React.useState("")

  const add = React.useCallback(
    (raw: string) => {
      const v = raw.replace(/\s+/g, " ").trim()
      if (!v) return
      if (value.includes(v)) return
      onChange([...value, v])
    },
    [onChange, value]
  )

  const remove = React.useCallback(
    (t: string) => {
      onChange(value.filter((x) => x !== t))
    },
    [onChange, value]
  )

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex flex-wrap items-center gap-2 rounded-md border bg-background p-2">
        {value.map((t) => (
          <Badge key={t} variant="outline" className="gap-1">
            {t}
            <button
              type="button"
              className="ml-1 rounded px-1 text-muted-foreground hover:text-foreground"
              onClick={() => remove(t)}
              aria-label={`Remove ${t}`}
            >
              ×
            </button>
          </Badge>
        ))}
        <input
          className="h-8 min-w-[160px] flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault()
              add(draft)
              setDraft("")
            }
            if (e.key === "Backspace" && !draft && value.length) {
              remove(value[value.length - 1])
            }
          }}
        />
      </div>
    </div>
  )
}

function getEffectiveSystemPrompt(
  systemPrompt: string | null | undefined,
  testUserName: string,
  testUserAge: string,
  testUserHobbies: string[],
  testUserMoodNeed: string[]
) {
  const userProfile: UserProfileInput = {
    name: testUserName.trim() || null,
    age: testUserAge.trim() ? Number(testUserAge) : null,
    hobbiesInterests: testUserHobbies,
    currentMoodNeed: testUserMoodNeed,
  }
  return composeSystemPromptWithUserProfile(systemPrompt ?? "", userProfile)
}


