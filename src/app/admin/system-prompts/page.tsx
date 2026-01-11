'use client'

import * as React from "react"
import { toast } from "sonner"
import Link from "next/link"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { CheckCircle2, Clock } from "lucide-react"
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
type KeyRow = {
  gender: string
  personality: string
  created_at: string
  response_delay: number
  matching_enabled: boolean
  immediate_match_enabled: boolean
  follow_up_message_enabled: boolean
  active_greeting_enabled: boolean
}

export default function SystemPromptsPage() {
  const [genderFilter, setGenderFilter] = React.useState<"all" | Gender>("all")
  const [loading, setLoading] = React.useState(true)
  const [keys, setKeys] = React.useState<KeyRow[]>([])

  const fetchKeys = React.useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(
        `/api/system-prompts/keys?gender=${encodeURIComponent(genderFilter === "all" ? "all" : genderFilter)}`
      )
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
        <h1 className="text-2xl font-semibold tracking-tight">System Prompts</h1>
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

        <div className="flex gap-2">
          <ConfigurationDialog trigger={<Button variant="outline">Global Configuration</Button>} />
          <Link href="/admin/system-prompts/manage">
            <Button>+ System Prompt</Button>
          </Link>
        </div>
      </div>

      {empty ? (
        <Card className="p-10 text-center">
          <div className="text-sm text-muted-foreground">No prompts yet.</div>
        </Card>
      ) : (
        <Card className="p-0">
          <div className="border-b p-4">
            <div className="text-sm font-medium">Latest prompt per key</div>
            <div className="text-xs text-muted-foreground">{loading ? "Loading..." : `${keys.length} personalities`}</div>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Gender</TableHead>
                <TableHead>Personality</TableHead>
                <TableHead>Response Delay</TableHead>
                <TableHead>Matching Enabled</TableHead>
                <TableHead>Immediate Match</TableHead>
                <TableHead>Follow-up</TableHead>
                <TableHead>Greeting</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                    Loading...
                  </TableCell>
                </TableRow>
              ) : keys.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                    No prompts found.
                  </TableCell>
                </TableRow>
              ) : (
                keys.map((k) => (
                  <TableRow key={`${k.gender}::${k.personality}`} className="hover:bg-muted/20">
                    <TableCell>{k.gender}</TableCell>
                    <TableCell className="font-medium">{k.personality}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                        <Clock className="h-4 w-4" />
                        {k.response_delay > 0 ? <span>{k.response_delay}s</span> : <span className="text-muted-foreground/60">Instant</span>}
                      </div>
                    </TableCell>
                    <TableCell>
                      {k.matching_enabled ? (
                        <div className="flex items-center gap-1.5 text-sm">
                          <CheckCircle2 className="h-4 w-4 text-green-600" />
                          <span className="text-muted-foreground">Enabled</span>
                        </div>
                      ) : (
                        <span className="text-sm text-muted-foreground/60">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {k.immediate_match_enabled ? (
                        <div className="flex items-center gap-1.5 text-sm">
                          <CheckCircle2 className="h-4 w-4 text-green-600" />
                          <span className="text-muted-foreground">Enabled</span>
                        </div>
                      ) : (
                        <span className="text-sm text-muted-foreground/60">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {k.follow_up_message_enabled ? (
                        <div className="flex items-center gap-1.5 text-sm">
                          <CheckCircle2 className="h-4 w-4 text-green-600" />
                          <span className="text-muted-foreground">Enabled</span>
                        </div>
                      ) : (
                        <span className="text-sm text-muted-foreground/60">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {k.active_greeting_enabled ? (
                        <div className="flex items-center gap-1.5 text-sm">
                          <CheckCircle2 className="h-4 w-4 text-green-600" />
                          <span className="text-muted-foreground">Enabled</span>
                        </div>
                      ) : (
                        <span className="text-sm text-muted-foreground/60">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Link
                        href={`/admin/system-prompts/manage?gender=${encodeURIComponent(k.gender)}&personality=${encodeURIComponent(k.personality)}`}
                      >
                        <Button variant="outline" size="sm">
                          Edit
                        </Button>
                      </Link>
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

function ConfigurationDialog({ trigger }: { trigger: React.ReactNode }) {
  const [open, setOpen] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [config, setConfig] = React.useState({
    max_invites_per_user: "5",
    invites_per_cron_run: "5",
    accept_rate_percentage: "30",
    active_hour_start: "5",
    active_hour_end: "23",
    enable_digital_human_auto_response: "true",
    enable_digital_human_follow_up: "true",
  })

  React.useEffect(() => {
    if (open) {
      setLoading(true)
      fetch("/api/admin/digital-humans/config")
        .then((res) => res.json())
        .then((json) => {
          if (json.data) {
            setConfig((prev) => ({ ...prev, ...json.data }))
          }
        })
        .catch((err) => toast.error("Failed to load config"))
        .finally(() => setLoading(false))
    }
  }, [open])

  const save = async () => {
    setSaving(true)
    try {
      const res = await fetch("/api/admin/digital-humans/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      })
      if (!res.ok) throw new Error("Failed to save")
      toast.success("Configuration saved")
      setOpen(false)
    } catch (error) {
      toast.error("Failed to save configuration")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogXCloseButton />
        <DialogHeader>
          <DialogTitle>Global Configuration</DialogTitle>
          <DialogDescription>Configure automation settings for all digital humans.</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="p-10 text-center text-muted-foreground">Loading config...</div>
        ) : (
          <div className="grid gap-6 p-4">
            <div className="grid grid-cols-2 gap-4 border-b pb-4">
              <div className="space-y-4">
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="g-auto-reply"
                    className="h-4 w-4 rounded border-gray-300 accent-primary"
                    checked={config.enable_digital_human_auto_response !== "false"}
                    onChange={(e) =>
                      setConfig({ ...config, enable_digital_human_auto_response: e.target.checked ? "true" : "false" })
                    }
                  />
                  <Label htmlFor="g-auto-reply">Enable Auto-Reply</Label>
                </div>
                <p className="text-xs text-muted-foreground ml-6">Digital humans will respond to new user messages automatically.</p>
              </div>
              <div className="space-y-4">
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="g-follow-up"
                    className="h-4 w-4 rounded border-gray-300 accent-primary"
                    checked={config.enable_digital_human_follow_up !== "false"}
                    onChange={(e) =>
                      setConfig({ ...config, enable_digital_human_follow_up: e.target.checked ? "true" : "false" })
                    }
                  />
                  <Label htmlFor="g-follow-up">Enable Follow-ups</Label>
                </div>
                <p className="text-xs text-muted-foreground ml-6">
                  Digital humans will send check-in messages if user is inactive (if enabled per bot).
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Max invites per user</Label>
                <Input
                  type="number"
                  value={config.max_invites_per_user}
                  onChange={(e) => setConfig({ ...config, max_invites_per_user: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">Max invites a real user can receive total.</p>
              </div>
              <div className="space-y-2">
                <Label>Invites per cron run</Label>
                <Input
                  type="number"
                  value={config.invites_per_cron_run}
                  onChange={(e) => setConfig({ ...config, invites_per_cron_run: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">Invites sent every hour.</p>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Accept Rate Percentage (0-100)</Label>
              <Input
                type="number"
                min="0"
                max="100"
                value={config.accept_rate_percentage}
                onChange={(e) => setConfig({ ...config, accept_rate_percentage: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">Likelihood a digital human accepts a user request.</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Active Hour Start (PST)</Label>
                <Input
                  type="number"
                  min="0"
                  max="23"
                  value={config.active_hour_start}
                  onChange={(e) => setConfig({ ...config, active_hour_start: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Active Hour End (PST)</Label>
                <Input
                  type="number"
                  min="0"
                  max="23"
                  value={config.active_hour_end}
                  onChange={(e) => setConfig({ ...config, active_hour_end: e.target.value })}
                />
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

