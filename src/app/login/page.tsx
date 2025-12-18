'use client';

import React from 'react';
import { toast } from "sonner"
import { login } from '@/actions/auth';

type Line = { kind: "sys" | "prompt" | "echo" | "err"; text: string }
type Stage = "username" | "password" | "submitting"

export default function LoginPage() {
  const [stage, setStage] = React.useState<Stage>("username")
  const [username, setUsername] = React.useState("")
  const [draft, setDraft] = React.useState("")
  const [lines, setLines] = React.useState<Line[]>(() => [
    { kind: "sys", text: "WELCOME TO MATRIX OS" },
    { kind: "sys", text: "ADMIN ACCESS REQUIRED" },
    { kind: "sys", text: "TYPE TO CONTINUE" },
    { kind: "prompt", text: "username:" },
  ])
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const inputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    inputRef.current?.focus()
  }, [stage])

  React.useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [lines, stage])

  const submit = async (u: string, p: string) => {
    setStage("submitting")
    setLines((prev) => [...prev, { kind: "sys", text: "AUTHENTICATING..." }])

    const formData = new FormData()
    formData.append('username', u)
    formData.append('password', p)

    try {
      const result = await login(formData)
      if (result?.error) {
        toast.error(result.error)
        setLines((prev) => [
          ...prev,
          { kind: "err", text: `ACCESS DENIED: ${result.error}` },
          { kind: "prompt", text: "password:" },
        ])
        setDraft("")
        setStage("password")
        return
      }
      // Successful login redirects automatically
      setLines((prev) => [...prev, { kind: "sys", text: "ACCESS GRANTED" }])
    } catch (error) {
      console.error(error)
      toast.error('An error occurred')
      setLines((prev) => [
        ...prev,
        { kind: "err", text: "ERROR: AUTH SERVICE UNAVAILABLE" },
        { kind: "prompt", text: "password:" },
      ])
      setDraft("")
      setStage("password")
    }
  }

  const onEnter = async () => {
    if (stage === "submitting") return

    if (stage === "username") {
      const u = draft.trim()
      if (!u) return
      setUsername(u)
      setLines((prev) => [...prev, { kind: "echo", text: u }, { kind: "prompt", text: "password:" }])
      setDraft("")
      setStage("password")
      return
    }

    // password
    const p = draft
    if (!p) return
    setLines((prev) => [...prev, { kind: "echo", text: "********" }])
    await submit(username, p)
  }

  return (
    <div className="min-h-screen bg-black relative overflow-hidden flex items-center justify-center px-4 py-10">
      {/* Background effect */}
      <div className="absolute inset-0 z-0 opacity-15 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] bg-repeat" />
      <div className="absolute inset-0 z-0 bg-gradient-to-br from-green-900/20 to-black" />

      <div
        className={[
          "relative z-10 w-full max-w-5xl",
          "border-2 border-yellow-300/80 rounded-sm",
          "bg-black/70 backdrop-blur-md",
          "shadow-[0_0_60px_rgba(250,204,21,0.15)]",
          "px-5 py-6 sm:px-8 sm:py-8",
          "font-mono text-yellow-200",
          // scanlines + vignette
          "before:pointer-events-none before:absolute before:inset-0 before:opacity-20",
          "before:bg-[linear-gradient(to_bottom,rgba(255,255,255,0.06)_1px,transparent_1px)] before:bg-[length:100%_3px]",
          "after:pointer-events-none after:absolute after:inset-0 after:opacity-40",
          "after:bg-[radial-gradient(circle_at_center,transparent_35%,rgba(0,0,0,0.85)_100%)]",
        ].join(" ")}
      >
        <div className="mb-5 flex items-center justify-between gap-4">
          <div className="text-xs sm:text-sm tracking-[0.25em] text-yellow-200/80">
            SECURE TERMINAL
          </div>
          <div className="text-xs sm:text-sm tracking-[0.25em] text-yellow-200/60">
            {stage === "submitting" ? "BUSY" : "READY"}
          </div>
        </div>

        <div className="border border-yellow-300/60">
          <div
            ref={scrollRef}
            className="h-[420px] sm:h-[520px] overflow-y-auto px-5 py-4 text-[13px] sm:text-sm leading-relaxed"
          >
            {lines.map((l, idx) => {
              const cls =
                l.kind === "err"
                  ? "text-red-300"
                  : l.kind === "prompt"
                    ? "text-yellow-100"
                    : l.kind === "echo"
                      ? "text-yellow-200"
                      : "text-yellow-200/80"
              const prefix =
                l.kind === "prompt" ? "> " : l.kind === "echo" ? "" : ""
              return (
                <div key={idx} className={cls}>
                  {prefix}
                  {l.text}
                </div>
              )
            })}
          </div>

          <div className="border-t border-yellow-300/60 px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="text-yellow-200/80">{">"}</div>
              <input
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                disabled={stage === "submitting"}
                type={stage === "password" ? "password" : "text"}
                autoCapitalize="none"
                autoComplete="off"
                spellCheck={false}
                className="h-11 w-full bg-transparent outline-none text-yellow-100 placeholder:text-yellow-200/40"
                placeholder={stage === "username" ? "TYPE USERNAME..." : stage === "password" ? "TYPE PASSWORD..." : "…"}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault()
                    setDraft("")
                    return
                  }
                  if (e.key === "Enter") {
                    e.preventDefault()
                    void onEnter()
                  }
                }}
              />
              <button
                type="button"
                disabled={stage === "submitting"}
                onClick={() => void onEnter()}
                className={[
                  "shrink-0 h-11 px-4",
                  "border border-yellow-300/60",
                  "text-yellow-200/90 tracking-widest",
                  "hover:bg-yellow-300/10",
                  "disabled:opacity-50 disabled:pointer-events-none",
                ].join(" ")}
              >
                {stage === "submitting" ? "..." : "ENTER"}
              </button>
            </div>
            <div className="mt-2 text-[11px] text-yellow-200/50 tracking-widest">
              ENTER TO SUBMIT • ESC TO CLEAR LINE
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

