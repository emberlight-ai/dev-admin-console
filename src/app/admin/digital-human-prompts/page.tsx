'use client'

import * as React from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogXCloseButton,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

type Gender = "Female" | "Male"
type KeyRow = { gender: string; personality: string; created_at: string }

const PLACEHOLDER_RE = /<bot_profile>[\s\r\n]*BOT_PROFILE_DETAILS[\s\r\n]*<\/bot_profile>/i

function toGender(v: string): Gender {
  return v === "Male" ? "Male" : "Female"
}

export default function DigitalHumanPromptsPage() {
  const [genderFilter, setGenderFilter] = React.useState<"all" | Gender>("all")
  const [loading, setLoading] = React.useState(true)
  const [keys, setKeys] = React.useState<KeyRow[]>([])

  const fetchKeys = React.useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/system-prompts/keys?gender=${encodeURIComponent(genderFilter)}`)
      const json = (await res.json()) as { data?: KeyRow[]; error?: string }
      if (!res.ok) throw new Error(json.error || "Failed to load prompts")
      setKeys(json.data ?? [])
    } catch (err: unknown) {
      console.error(err)
      setKeys([])
      toast.error(err instanceof Error ? err.message : "Failed to load prompts")
    } finally {
      setLoading(false)
    }
  }, [genderFilter])

  React.useEffect(() => {
    void fetchKeys()
  }, [fetchKeys])

  const empty = !loading && keys.length === 0

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Digital Human Prompts</h1>
        <p className="text-sm text-muted-foreground">
          Create versioned prompt templates by gender and personality. Each edit creates a new entry.
        </p>
      </div>

      <div className="flex items-center justify-between gap-3">
        <Tabs
          value={genderFilter}
          onValueChange={(v) => {
            if (v === "all" || v === "Female" || v === "Male") setGenderFilter(v)
          }}
        >
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="Female">Female</TabsTrigger>
            <TabsTrigger value="Male">Male</TabsTrigger>
          </TabsList>
        </Tabs>

        <PromptEditorDialog
          mode="create"
          trigger={<Button>+ System Prompt</Button>}
          onSaved={fetchKeys}
        />
      </div>

      {empty ? (
        <Card className="p-10 text-center">
          <div className="text-sm text-muted-foreground">No prompts yet.</div>
        </Card>
      ) : (
        <Card className="p-0">
          <div className="border-b p-4">
            <div className="text-sm font-medium">Latest prompt per key</div>
            <div className="text-xs text-muted-foreground">
              {loading ? "Loading..." : `${keys.length} personalities`}
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Gender</TableHead>
                <TableHead>Personality</TableHead>
                <TableHead>Last updated</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                    Loading...
                  </TableCell>
                </TableRow>
              ) : keys.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                    No prompts found.
                  </TableCell>
                </TableRow>
              ) : (
                keys.map((k) => (
                  <TableRow key={`${k.gender}::${k.personality}`} className="hover:bg-muted/20">
                    <TableCell>{k.gender}</TableCell>
                    <TableCell className="font-medium">{k.personality}</TableCell>
                    <TableCell className="text-muted-foreground">{new Date(k.created_at).toLocaleString()}</TableCell>
                    <TableCell className="text-right">
                      <PromptEditorDialog
                        mode="edit"
                        initialGender={toGender(k.gender)}
                        initialPersonality={k.personality}
                        trigger={<Button variant="outline">Edit</Button>}
                        onSaved={fetchKeys}
                      />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  )
}

function PromptEditorDialog({
  mode,
  initialGender,
  initialPersonality,
  trigger,
  onSaved,
}: {
  mode: "create" | "edit"
  initialGender?: Gender
  initialPersonality?: string
  trigger: React.ReactNode
  onSaved: () => void
}) {
  const [open, setOpen] = React.useState(false)
  const [saving, setSaving] = React.useState(false)

  const [gender, setGender] = React.useState<Gender>(initialGender ?? "Female")
  const [personality, setPersonality] = React.useState(initialPersonality ?? "")
  const [systemPrompt, setSystemPrompt] = React.useState("")

  const title = mode === "create" ? "Create system prompt" : `Edit: ${initialGender} · ${initialPersonality}`

  React.useEffect(() => {
    if (!open) return
    setSaving(false)
    setGender(initialGender ?? "Female")
    setPersonality(initialPersonality ?? "")
    setSystemPrompt("")

    if (mode === "edit" && initialGender && initialPersonality) {
      const run = async () => {
        try {
          const res = await fetch(
            `/api/system-prompts/latest?gender=${encodeURIComponent(initialGender)}&personality=${encodeURIComponent(
              initialPersonality
            )}`
          )
          const json = (await res.json()) as { data?: { system_prompt: string } | null; error?: string }
          if (!res.ok) throw new Error(json.error || "Failed to load latest prompt")
          setSystemPrompt(json.data?.system_prompt ?? "")
        } catch (err: unknown) {
          console.error(err)
          toast.error(err instanceof Error ? err.message : "Failed to load latest prompt")
        }
      }
      void run()
    }
  }, [open, mode, initialGender, initialPersonality])

  const save = async () => {
    const g = gender.trim()
    const p = personality.trim()
    const sp = systemPrompt

    if (!g) return toast.error("Gender is required")
    if (!p) return toast.error("Personality is required")
    if (!sp.trim()) return toast.error("System prompt is required")
    if (!PLACEHOLDER_RE.test(sp)) {
      return toast.error("Prompt must include: <bot_profile> BOT_PROFILE_DETAILS </bot_profile>")
    }

    setSaving(true)
    try {
      const res = await fetch("/api/system-prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gender: g, personality: p, system_prompt: sp }),
      })
      const json = (await res.json()) as { data?: unknown; error?: string }
      if (!res.ok) throw new Error(json.error || "Failed to save prompt")
      toast.success(mode === "create" ? "Prompt created" : "New prompt version created")
      setOpen(false)
      onSaved()
    } catch (err: unknown) {
      console.error(err)
      toast.error(err instanceof Error ? err.message : "Failed to save prompt")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogXCloseButton />
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Templates must include the placeholder block so the app can inject the generated bot profile.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 p-4 pt-0">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Gender</Label>
              <select
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                value={gender}
                onChange={(e) => setGender(e.target.value as Gender)}
                disabled={mode === "edit"}
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
                disabled={mode === "edit"}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>System prompt template</Label>
            <Textarea
              rows={16}
              className="max-h-[420px] overflow-y-auto"
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder={`Include:\n<bot_profile>\nBOT_PROFILE_DETAILS\n</bot_profile>`}
            />
            <div className="text-xs text-muted-foreground">
              Required placeholder: <code className="rounded bg-muted px-1 py-0.5">BOT_PROFILE_DETAILS</code>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}


