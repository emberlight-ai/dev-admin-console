'use client'

import * as React from "react"
import { Send, Settings, RotateCcw } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  composeSystemPromptWithUserProfile,
  injectLastMessageIntoSystemPrompt,
  type UserProfileInput,
} from "@/lib/botProfile"

export interface ChatMessage {
  role: "user" | "model"
  parts: { text: string }[]
}

const MODEL_OPTIONS = [
  { value: "gemini-3-flash-preview", label: "gemini-3-flash-preview" },
  { value: "gemini-2.5-flash", label: "gemini-2.5-flash" },
  { value: "gemini-3-pro-preview", label: "gemini-3-pro-preview" },
  { value: "gemini-pro-latest", label: "gemini-pro-latest" },
] as const

export function ChatPanel({
  systemPrompt,
  onEffectiveSystemPromptChange,
  activeGreetingEnabled,
  activeGreetingPrompt,
  followUpEnabled,
  followUpPrompt,
  followUpDelay = 86400,
  maxFollowUps = 3,
}: {
  systemPrompt?: string | null
  onEffectiveSystemPromptChange?: (prompt: string) => void
  activeGreetingEnabled?: boolean
  activeGreetingPrompt?: string
  followUpEnabled?: boolean
  followUpPrompt?: string
  followUpDelay?: number
  maxFollowUps?: number
}) {
  const [chatHistory, setChatHistory] = React.useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = React.useState("")
  const [chatImage, setChatImage] = React.useState("")
  const [chatLoading, setChatLoading] = React.useState(false)
  const [autoFollowUpCount, setAutoFollowUpCount] = React.useState(0)
  const [autoFollowUpArmed, setAutoFollowUpArmed] = React.useState(false)
  const [model, setModel] = React.useState<string>("gemini-3-flash-preview")
  const chatEndRef = React.useRef<HTMLDivElement>(null)
  const followUpTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const chatHistoryRef = React.useRef<ChatMessage[]>([])

  const [showTestUserSettings, setShowTestUserSettings] = React.useState(false)
  const [testUserName, setTestUserName] = React.useState("")
  const [testUserAge, setTestUserAge] = React.useState("")
  const [testUserZipcode, setTestUserZipcode] = React.useState("")
  const [testUserBio, setTestUserBio] = React.useState("")
  const [testUserProfession, setTestUserProfession] = React.useState("")

  const STORAGE_KEY = "chat-test-user-profile"

  // Load from localStorage on mount
  React.useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        const parsed = JSON.parse(stored) as {
          name?: string
          age?: string
          zipcode?: string
          bio?: string
          profession?: string
        }
        if (parsed.name) setTestUserName(parsed.name)
        if (parsed.age) setTestUserAge(parsed.age)
        if (parsed.zipcode) setTestUserZipcode(parsed.zipcode)
        if (parsed.bio) setTestUserBio(parsed.bio)
        if (parsed.profession) setTestUserProfession(parsed.profession)
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
        zipcode: testUserZipcode,
        bio: testUserBio,
        profession: testUserProfession,
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore))
    } catch (err) {
      console.error("Failed to save test user profile to localStorage", err)
    }
  }, [testUserName, testUserAge, testUserZipcode, testUserBio, testUserProfession])

  const effectiveSystemPrompt = React.useMemo(() => {
    return getEffectiveSystemPrompt(
      systemPrompt,
      testUserName,
      testUserAge,
      testUserZipcode,
      testUserBio,
      testUserProfession
    )
  }, [systemPrompt, testUserName, testUserAge, testUserZipcode, testUserBio, testUserProfession])

  React.useEffect(() => {
    onEffectiveSystemPromptChange?.(effectiveSystemPrompt)
  }, [effectiveSystemPrompt, onEffectiveSystemPromptChange])

  React.useEffect(() => {
    chatHistoryRef.current = chatHistory
  }, [chatHistory])

  const clearFollowUpTimer = React.useCallback(() => {
    if (followUpTimerRef.current) {
      clearTimeout(followUpTimerRef.current)
      followUpTimerRef.current = null
    }
  }, [])

  const stopAutoFollowUps = React.useCallback(() => {
    clearFollowUpTimer()
    setAutoFollowUpArmed(false)
    setAutoFollowUpCount(0)
  }, [clearFollowUpTimer])

  React.useEffect(() => {
    if (!followUpEnabled) {
      stopAutoFollowUps()
    }
  }, [followUpEnabled, stopAutoFollowUps])

  React.useEffect(() => {
    return () => clearFollowUpTimer()
  }, [clearFollowUpTimer])

  const clearChat = () => {
    stopAutoFollowUps()
    setChatHistory([])
    setChatInput("")
  }

  const resetTestUserProfile = () => {
    setTestUserName("")
    setTestUserAge("")
    setTestUserZipcode("")
    setTestUserBio("")
    setTestUserProfession("")
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

  const triggerFollowUpMessage = React.useCallback(
    async (nextCount: number) => {
      if (!followUpEnabled) return
      if (!followUpPrompt?.trim()) return
      if (nextCount > Math.max(0, maxFollowUps)) return
      if (chatHistoryRef.current.length === 0) return

      setChatLoading(true)
      try {
        const effectiveSystemPrompt = getEffectiveSystemPrompt(
          systemPrompt,
          testUserName,
          testUserAge,
          testUserZipcode,
          testUserBio,
          testUserProfession
        )

        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemPrompt: effectiveSystemPrompt,
            history: chatHistoryRef.current,
            message: "",
            model,
            mode: "followup",
            instruction: followUpPrompt,
          }),
        })

        const data = await response.json()
        if (!data.response) {
          toast.error("Failed to generate follow-up")
          setAutoFollowUpArmed(false)
          return
        }

        setChatHistory((prev) => [...prev, { role: "model", parts: [{ text: data.response }] }])
        setAutoFollowUpCount(nextCount)

        const maxCount = Math.max(0, maxFollowUps)
        if (nextCount >= maxCount) {
          setAutoFollowUpArmed(false)
          return
        }

        const waitMs = Math.max(1, followUpDelay) * 1000
        setAutoFollowUpArmed(true)
        clearFollowUpTimer()
        followUpTimerRef.current = setTimeout(() => {
          void triggerFollowUpMessage(nextCount + 1)
        }, waitMs)
      } catch (error) {
        console.error(error)
        toast.error("Error generating follow-up")
        setAutoFollowUpArmed(false)
      } finally {
        setChatLoading(false)
      }
    },
    [
      clearFollowUpTimer,
      followUpDelay,
      followUpEnabled,
      followUpPrompt,
      maxFollowUps,
      model,
      systemPrompt,
      testUserAge,
      testUserBio,
      testUserName,
      testUserProfession,
      testUserZipcode,
    ]
  )

  const handleSendMessage = async () => {
    if (!chatInput.trim() && !chatImage.trim()) return

    stopAutoFollowUps()

    // Show image in history if provided (simulated for now as a text line or just implied)
    const userParts = [{ text: chatInput }]
    if (chatImage.trim()) {
      userParts.push({ text: `[Image: ${chatImage}]` })
    }

    const newMessage: ChatMessage = { role: "user", parts: [{ text: chatInput + (chatImage ? `\n[Image Provided]` : "") }] }
    const updatedHistory = [...chatHistory, newMessage]
    setChatHistory(updatedHistory)
    setChatInput("")
    const currentImage = chatImage
    setChatImage("") // Clear image immediately
    setChatLoading(true)

    try {
      let effectiveSystemPrompt = getEffectiveSystemPrompt(
        systemPrompt,
        testUserName,
        testUserAge,
        testUserZipcode,
        testUserBio,
        testUserProfession
      )

      effectiveSystemPrompt = injectLastMessageIntoSystemPrompt(
        effectiveSystemPrompt,
        newMessage.parts[0].text
      )

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemPrompt: effectiveSystemPrompt,
          history: chatHistory, // keep behavior consistent with previous implementation
          message: newMessage.parts[0].text, // We send the text message here
          image: currentImage, // Send the image URL separately
          model,
        }),
      })

      const data = await response.json()
      if (data.response) {
        setChatHistory((prev) => [...prev, { role: "model", parts: [{ text: data.response }] }])
        if (followUpEnabled && followUpPrompt?.trim() && maxFollowUps > 0) {
          const waitMs = Math.max(1, followUpDelay) * 1000
          setAutoFollowUpArmed(true)
          clearFollowUpTimer()
          followUpTimerRef.current = setTimeout(() => {
            void triggerFollowUpMessage(1)
          }, waitMs)
        }
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

  const handleSendGreeting = async () => {
    if (!activeGreetingEnabled) return

    setChatLoading(true)
    // Clear history for a fresh greeting test
    setChatHistory([])
    setChatInput("")

    try {
      const effectiveSystemPrompt = getEffectiveSystemPrompt(
        systemPrompt,
        testUserName,
        testUserAge,
        testUserZipcode,
        testUserBio,
        testUserProfession
      )

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemPrompt: effectiveSystemPrompt,
          history: [],
          message: "", // No user message for greeting
          model,
          mode: "greeting",
          instruction: activeGreetingPrompt,
        }),
      })

      const data = await response.json()
      if (data.response) {
        setChatHistory([{ role: "model", parts: [{ text: data.response }] }])
      } else {
        toast.error("Failed to generate greeting")
      }
    } catch (error) {
      console.error(error)
      toast.error("Error generating greeting")
    } finally {
      setChatLoading(false)
    }
  }

  return (
    <div className="mt-4 space-y-4">
      <div className="flex items-center justify-end">
        <div className="flex flex-wrap items-center justify-end gap-2">
          {activeGreetingEnabled && (
            <Button
              variant="secondary"
              size="sm"
              onClick={handleSendGreeting}
              disabled={chatLoading}
            >
              Test Greeting
            </Button>
          )}
          {followUpEnabled ? (
            <div className="inline-flex items-center rounded-md border px-2 py-1 text-xs text-muted-foreground">
              Auto follow-up: wait {followUpDelay}s • max {maxFollowUps}
              {autoFollowUpArmed ? ` • scheduled (${autoFollowUpCount}/${maxFollowUps})` : ""}
            </div>
          ) : null}

          <Button
            type="button"
            variant="outline"
            onClick={clearChat}
            disabled={chatLoading || chatHistory.length === 0}
            className="gap-2"
          >
            <RotateCcw className="h-4 w-4" />
          </Button>

          <Button
            type="button"
            variant="outline"
            onClick={() => setShowTestUserSettings((v) => !v)}
            disabled={chatLoading}
            className="gap-2"
          >
            <Settings className="h-4 w-4" />
          </Button>

          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            disabled={chatLoading}
          >
            {MODEL_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
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
            <div className="space-y-2">
              <Label>Zipcode</Label>
              <Input
                value={testUserZipcode}
                onChange={(e) => setTestUserZipcode(e.target.value)}
                placeholder="e.g. 90210"
              />
            </div>
            <div className="space-y-2">
              <Label>Bio</Label>
              <Input
                value={testUserBio}
                onChange={(e) => setTestUserBio(e.target.value)}
                placeholder="e.g. Love hiking and coffee"
              />
            </div>
            <div className="space-y-2">
              <Label>Profession</Label>
              <Input
                value={testUserProfession}
                onChange={(e) => setTestUserProfession(e.target.value)}
                placeholder="e.g. Software Engineer"
              />
            </div>
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
              {chatLoading ? <div className="text-sm text-muted-foreground">Typing...</div> : null}
              <div ref={chatEndRef} />
            </div>
          )}
        </ScrollArea>
      </div>

      <div className="flex flex-col gap-2">
        <Input
          placeholder="Image URL (optional)..."
          value={chatImage}
          onChange={(e) => setChatImage(e.target.value)}
          className="text-xs"
        />
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
          />
          <Button onClick={() => void handleSendMessage()} className="gap-2">
            <Send className="h-4 w-4" />
            Send
          </Button>
        </div>
      </div>
    </div>
  )
}

function getEffectiveSystemPrompt(
  systemPrompt: string | null | undefined,
  testUserName: string,
  testUserAge: string,
  testUserZipcode: string,
  testUserBio: string,
  testUserProfession: string
) {
  const userProfile: UserProfileInput = {
    username: testUserName.trim() || null,
    age: testUserAge.trim() ? Number(testUserAge) : null,
    zipcode: testUserZipcode.trim() || null,
    bio: testUserBio.trim() || null,
    profession: testUserProfession.trim() || null,
  }
  return composeSystemPromptWithUserProfile(systemPrompt ?? "", userProfile)
}
