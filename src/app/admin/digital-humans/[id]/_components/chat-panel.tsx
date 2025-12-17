'use client'

import * as React from "react"
import { Send } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"

import type { ChatMessage } from "./types"

export function ChatPanel({ systemPrompt }: { systemPrompt?: string | null }) {
  const [chatHistory, setChatHistory] = React.useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = React.useState("")
  const [chatLoading, setChatLoading] = React.useState(false)
  const chatEndRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [chatHistory, chatLoading])

  const handleSendMessage = async () => {
    if (!chatInput.trim()) return

    const newMessage: ChatMessage = { role: "user", parts: [{ text: chatInput }] }
    const updatedHistory = [...chatHistory, newMessage]
    setChatHistory(updatedHistory)
    setChatInput("")
    setChatLoading(true)

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemPrompt,
          history: chatHistory, // keep behavior consistent with previous implementation
          message: newMessage.parts[0].text,
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


