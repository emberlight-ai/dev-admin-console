'use client'

import * as React from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

import { GreenModeSection } from "./green-mode-section"

// ── Config model ──────────────────────────────────────────────────────────────
const DEFAULT_CONFIG = {
  enable_nearby_invites: "true",
  avg_invites_per_nearby_call: "2",
  max_invites_per_nearby_call: "3",
  max_invites_per_day: "3",
  nearby_invite_cooldown_seconds: "1800",
  nearby_invite_window_min_seconds: "60",
  nearby_invite_window_max_seconds: "180",
  accept_rate_percentage: "30",
  whitelisted_deck_ratio: "90",
  active_hour_start: "5",
  active_hour_end: "23",
  enable_digital_human_matching: "true",
  enable_digital_human_greeting: "true",
  enable_digital_human_auto_response: "true",
  enable_digital_human_follow_up: "true",
  enable_find_nearby_people: "false",
  min_user_age_minutes_for_invites: "10",
  enable_digital_human_selfies: "true",
  selfie_intimacy_threshold: "55",
  selfie_cooldown_hours: "3",
  selfie_cooldown_minutes: "30",
  enable_selfie_reciprocation: "true",
  selfie_reciprocate_gap_minutes: "2",
  selfie_tease_intimacy_threshold: "45",
  selfie_reward_intimacy_threshold: "75",
  selfie_early_casual_after_messages: "2",
  selfie_early_casual_max_intimacy: "45",
  intimacy_warmup_rate: "normal",
  enable_proactive_double_text: "true",
  proactive_intimacy_drive_threshold: "0.3",
  proactive_delay_minutes: "90",
  proactive_extra_followups: "2",
  enable_boost_invites: "true",
  boost_invites_total: "7",
  boost_invite_interval_seconds: "120",
}

type ConfigState = typeof DEFAULT_CONFIG
type ConfigKey = keyof ConfigState
type PersonalityOverrideRow = { personality: string; key: string; value: string }
type PersonalityOverrides = Record<string, Record<string, string>>

const BOOLEAN_CONFIG_KEYS = new Set<string>([
  "enable_nearby_invites",
  "enable_digital_human_matching",
  "enable_digital_human_greeting",
  "enable_digital_human_auto_response",
  "enable_digital_human_follow_up",
  "enable_find_nearby_people",
  "enable_digital_human_selfies",
  "enable_selfie_reciprocation",
  "enable_proactive_double_text",
  "enable_boost_invites",
])

// App-wide only — no per-personality meaning, hidden from the Overrides tab.
const GLOBAL_ONLY_CONFIG_KEYS = new Set<string>([
  "whitelisted_deck_ratio",
  // Boost invites are per-USER bursts; a personality override makes no sense.
  "enable_boost_invites",
  "boost_invites_total",
  "boost_invite_interval_seconds",
])

const WARMUP_RATE_OPTIONS = [
  { value: "very_low", label: "Very low" },
  { value: "low", label: "Low" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
  { value: "very_high", label: "Very high" },
  { value: "extreme", label: "Extreme" },
]

const CONFIG_LABELS: Record<string, string> = {
  enable_nearby_invites: "Enable nearby invitations",
  avg_invites_per_nearby_call: "Avg invitations per map open",
  max_invites_per_nearby_call: "Max invitations per map open",
  max_invites_per_day: "Max invitations per day",
  nearby_invite_cooldown_seconds: "Cooldown between batches (seconds)",
  nearby_invite_window_min_seconds: "Earliest arrival (seconds)",
  nearby_invite_window_max_seconds: "Latest arrival (seconds)",
  accept_rate_percentage: "Accept rate percentage",
  whitelisted_deck_ratio: "Whitelisted DH deck ratio (%)",
  active_hour_start: "Active hour start",
  active_hour_end: "Active hour end",
  enable_digital_human_matching: "Enable matching",
  enable_digital_human_greeting: "Enable greetings",
  enable_digital_human_auto_response: "Enable auto-reply",
  enable_digital_human_follow_up: "Enable follow-ups",
  enable_find_nearby_people: "Enable find nearby people",
  min_user_age_minutes_for_invites: "Minimum user age before invites",
  enable_digital_human_selfies: "Enable selfies",
  selfie_intimacy_threshold: "Selfie intimacy threshold",
  selfie_cooldown_hours: "Legacy selfie cooldown hours",
  selfie_cooldown_minutes: "Selfie cooldown minutes",
  enable_selfie_reciprocation: "Enable photo reciprocation",
  selfie_reciprocate_gap_minutes: "Photo reciprocation gap minutes",
  selfie_tease_intimacy_threshold: "Tease threshold",
  selfie_reward_intimacy_threshold: "Reward threshold",
  selfie_early_casual_after_messages: "Early casual after user messages",
  selfie_early_casual_max_intimacy: "Early casual max intimacy",
  intimacy_warmup_rate: "Relationship warm-up rate",
  enable_proactive_double_text: "Enable proactive double-texting",
  proactive_intimacy_drive_threshold: "Proactive drive threshold",
  proactive_delay_minutes: "Proactive delay minutes",
  proactive_extra_followups: "Proactive extra follow-ups",
  enable_boost_invites: "Enable boost invitations",
  boost_invites_total: "Invitations per boost",
  boost_invite_interval_seconds: "Seconds between invitations",
}

const CONFIG_DESCRIPTIONS: Record<string, string> = {
  enable_nearby_invites: "Master switch — when off, no digital human will reach out after a user opens the nearby map.",
  avg_invites_per_nearby_call: "Average number of nearby people who reach out each map open (fluctuates).",
  max_invites_per_nearby_call: "Hard cap on how many reach out per map open.",
  max_invites_per_day: "Hard cap on total invitations in any rolling 24h (keeps it believable).",
  nearby_invite_cooldown_seconds: "Min gap before another batch is scheduled (stops map-refresh spam).",
  nearby_invite_window_min_seconds: "Soonest a scheduled hello arrives after a map open.",
  nearby_invite_window_max_seconds: "Latest a scheduled hello arrives after a map open.",
  accept_rate_percentage: "Chance that a digital human accepts an incoming match request.",
  whitelisted_deck_ratio: "Share of the swipe deck filled with whitelisted (curated, image-rich) digital humans; the rest are random DHs. 90 = ~9 in 10 cards whitelisted.",
  active_hour_start: "Start hour, in PST, when automation is allowed to run.",
  active_hour_end: "End hour, in PST, when automation is allowed to run.",
  enable_digital_human_matching: "Process incoming user→DH match requests (swipes). Does not control nearby invitations.",
  enable_digital_human_greeting: "Digital humans send a greeting message when a new match is created.",
  enable_digital_human_auto_response: "Digital humans respond automatically after the real user sends a message.",
  enable_digital_human_follow_up: "Scheduled re-engagement messages when the user has not replied.",
  enable_find_nearby_people: "iOS nearby people endpoint returns normal matching results when enabled.",
  min_user_age_minutes_for_invites: "How long a new real user must exist before DH invites can target them.",
  enable_digital_human_selfies: "Allows preserved DH images to be sent by the auto-reply logic.",
  selfie_intimacy_threshold: "Min closeness score before a passive selfie may be sent.",
  selfie_cooldown_minutes: "Min minutes between spontaneous tiered images.",
  enable_selfie_reciprocation: "A DH may answer a user photo with a tiered image of their own.",
  selfie_reciprocate_gap_minutes: "Short anti-spam gap when the user sends or requests a photo.",
  selfie_tease_intimacy_threshold: "At this score, image release moves from casual to tease.",
  selfie_reward_intimacy_threshold: "At this score, image release moves from tease to reward.",
  selfie_early_casual_after_messages: "Cold chats can get one casual image after this many real-user messages.",
  selfie_early_casual_max_intimacy: "Only use the early casual path below this closeness score.",
  intimacy_warmup_rate: "Guides how quickly the judge can raise intimacy each turn.",
  enable_proactive_double_text: "When momentum is hot, digital humans reach out again sooner and a bit more.",
  proactive_intimacy_drive_threshold: "How “hot” momentum must be to trigger proactive outreach (0–1).",
  proactive_delay_minutes: "How soon a hot convo gets a double-text (a 1h floor still applies).",
  proactive_extra_followups: "Extra messages allowed beyond the per-bot max when hot.",
  enable_boost_invites: "While a boost is active, digital humans keep reaching out — one invitation per interval, with a real opener and a push.",
  boost_invites_total: "How many digital humans reach out across the 15-minute boost window.",
  boost_invite_interval_seconds: "Gap between boost invitations. 120 = one like every 2 minutes.",
}

// ── Field helpers ─────────────────────────────────────────────────────────────
function ToggleField({
  label,
  description,
  checked,
  onChange,
}: {
  label: string
  description: string
  checked: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-4">
      <input
        type="checkbox"
        className="mt-0.5 h-4 w-4 rounded border-gray-300 accent-primary"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{description}</div>
      </div>
    </label>
  )
}

function NumberField({
  label,
  description,
  value,
  onChange,
  min,
  max,
  step,
}: {
  label: string
  description?: string
  value: string
  onChange: (v: string) => void
  min?: number
  max?: number
  step?: number
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input type="number" min={min} max={max} step={step} value={value} onChange={(e) => onChange(e.target.value)} />
      {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
    </div>
  )
}

function SliderField({
  label,
  description,
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
}: {
  label: string
  description?: string
  value: string
  onChange: (v: string) => void
  min?: number
  max?: number
  step?: number
}) {
  const n = Number(value)
  const safe = Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min
  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex items-center justify-between gap-3">
        <Label>{label}</Label>
        <span className="rounded-md bg-muted px-2 py-0.5 text-sm font-medium tabular-nums">{value}</span>
      </div>
      <Slider min={min} max={max} step={step} value={[safe]} onValueChange={(v) => onChange(String(v[0]))} />
      {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
    </div>
  )
}

const TAB_CONTENT = "min-h-0 space-y-5 p-5"

export default function DigitalHumanConfigPage() {
  const [config, setConfig] = React.useState<ConfigState>(DEFAULT_CONFIG)
  const [personalityOverrides, setPersonalityOverrides] = React.useState<PersonalityOverrides>({})
  const [personalities, setPersonalities] = React.useState<string[]>([])
  const [selectedPersonality, setSelectedPersonality] = React.useState("")
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)

  const set = (key: ConfigKey, value: string) => setConfig((prev) => ({ ...prev, [key]: value }))
  const bool = (key: ConfigKey) => config[key] === "true"

  React.useEffect(() => {
    setLoading(true)
    Promise.all([
      fetch("/api/admin/digital-humans/config").then((r) => r.json()),
      fetch("/api/system-prompts/keys").then((r) => r.json()),
    ])
      .then(([cfgJson, keysJson]) => {
        if (cfgJson?.data) setConfig((prev) => ({ ...prev, ...cfgJson.data }))
        const overrides: PersonalityOverrides = {}
        for (const row of (cfgJson?.personality_overrides ?? []) as PersonalityOverrideRow[]) {
          if (!row.personality || !row.key) continue
          overrides[row.personality] = { ...(overrides[row.personality] ?? {}), [row.key]: row.value }
        }
        setPersonalityOverrides(overrides)

        const names = Array.from(
          new Set(((keysJson?.data ?? []) as Array<{ personality?: string }>).map((k) => k.personality).filter(Boolean))
        ).sort() as string[]
        setPersonalities(names)
        if (names.length) setSelectedPersonality((p) => p || names[0])
      })
      .catch(() => toast.error("Failed to load configuration"))
      .finally(() => setLoading(false))
  }, [])

  const save = async () => {
    setSaving(true)
    try {
      const res = await fetch("/api/admin/digital-humans/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...config, personality_overrides: personalityOverrides }),
      })
      if (!res.ok) throw new Error("Failed to save")
      toast.success("Configuration saved")
    } catch {
      toast.error("Failed to save configuration")
    } finally {
      setSaving(false)
    }
  }

  const setPersonalityOverride = (key: string, value: string) => {
    if (!selectedPersonality) return
    setPersonalityOverrides((prev) => ({
      ...prev,
      [selectedPersonality]: { ...(prev[selectedPersonality] ?? {}), [key]: value },
    }))
  }

  const configKeys = Object.keys(config) as ConfigKey[]

  return (
    <div className="space-y-6 pb-10">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Digital Human Configuration</h1>
          <p className="text-sm text-muted-foreground">
            Global defaults and personality-specific overrides for digital-human automation.
          </p>
        </div>
        <Button onClick={save} disabled={saving || loading}>
          {saving ? "Saving..." : "Save changes"}
        </Button>
      </div>

      {loading ? (
        <Card className="p-10 text-center text-sm text-muted-foreground">Loading configuration…</Card>
      ) : (
        <Card className="p-0">
          <Tabs defaultValue="automation">
            <div className="overflow-x-auto border-b px-4 pt-3">
              <TabsList>
                <TabsTrigger value="automation">Automation</TabsTrigger>
                <TabsTrigger value="nearby">Nearby invites</TabsTrigger>
                <TabsTrigger value="matching">Matching</TabsTrigger>
                <TabsTrigger value="boost">Boost</TabsTrigger>
                <TabsTrigger value="selfies">Selfies</TabsTrigger>
                <TabsTrigger value="proactive">Proactive</TabsTrigger>
                <TabsTrigger value="overrides">Personality overrides</TabsTrigger>
              </TabsList>
            </div>

            {/* Automation — master switches */}
            <TabsContent value="automation" className={TAB_CONTENT}>
              <div className="grid gap-3 sm:grid-cols-2">
                <ToggleField label="Enable matching" description={CONFIG_DESCRIPTIONS.enable_digital_human_matching} checked={bool("enable_digital_human_matching")} onChange={(b) => set("enable_digital_human_matching", b ? "true" : "false")} />
                <ToggleField label="Enable greetings" description={CONFIG_DESCRIPTIONS.enable_digital_human_greeting} checked={bool("enable_digital_human_greeting")} onChange={(b) => set("enable_digital_human_greeting", b ? "true" : "false")} />
                <ToggleField label="Enable auto-reply" description={CONFIG_DESCRIPTIONS.enable_digital_human_auto_response} checked={bool("enable_digital_human_auto_response")} onChange={(b) => set("enable_digital_human_auto_response", b ? "true" : "false")} />
                <ToggleField label="Enable follow-ups" description={CONFIG_DESCRIPTIONS.enable_digital_human_follow_up} checked={bool("enable_digital_human_follow_up")} onChange={(b) => set("enable_digital_human_follow_up", b ? "true" : "false")} />
                <ToggleField label="Enable nearby invitations" description={CONFIG_DESCRIPTIONS.enable_nearby_invites} checked={bool("enable_nearby_invites")} onChange={(b) => set("enable_nearby_invites", b ? "true" : "false")} />
                <ToggleField label="Enable find nearby people" description={CONFIG_DESCRIPTIONS.enable_find_nearby_people} checked={bool("enable_find_nearby_people")} onChange={(b) => set("enable_find_nearby_people", b ? "true" : "false")} />
              </div>
            </TabsContent>

            {/* Nearby invites — cadence */}
            <TabsContent value="nearby" className={TAB_CONTENT}>
              <div className="grid gap-4 sm:grid-cols-2">
                <NumberField label="Avg invitations per map open" min={0} value={config.avg_invites_per_nearby_call} onChange={(v) => set("avg_invites_per_nearby_call", v)} description={CONFIG_DESCRIPTIONS.avg_invites_per_nearby_call} />
                <NumberField label="Max invitations per map open" min={0} value={config.max_invites_per_nearby_call} onChange={(v) => set("max_invites_per_nearby_call", v)} description={CONFIG_DESCRIPTIONS.max_invites_per_nearby_call} />
                <NumberField label="Max invitations per day" min={0} value={config.max_invites_per_day} onChange={(v) => set("max_invites_per_day", v)} description={CONFIG_DESCRIPTIONS.max_invites_per_day} />
                <NumberField label="Cooldown between batches (seconds)" min={0} value={config.nearby_invite_cooldown_seconds} onChange={(v) => set("nearby_invite_cooldown_seconds", v)} description={CONFIG_DESCRIPTIONS.nearby_invite_cooldown_seconds} />
                <NumberField label="Minimum user age before invites (minutes)" min={0} value={config.min_user_age_minutes_for_invites} onChange={(v) => set("min_user_age_minutes_for_invites", v)} description={CONFIG_DESCRIPTIONS.min_user_age_minutes_for_invites} />
                <NumberField label="Earliest arrival (seconds)" min={1} value={config.nearby_invite_window_min_seconds} onChange={(v) => set("nearby_invite_window_min_seconds", v)} description={CONFIG_DESCRIPTIONS.nearby_invite_window_min_seconds} />
                <NumberField label="Latest arrival (seconds)" min={1} value={config.nearby_invite_window_max_seconds} onChange={(v) => set("nearby_invite_window_max_seconds", v)} description={CONFIG_DESCRIPTIONS.nearby_invite_window_max_seconds} />
              </div>
            </TabsContent>

            {/* Matching — green mode, accept rate, deck ratio, active hours */}
            <TabsContent value="matching" className={TAB_CONTENT}>
              <GreenModeSection />
              <div className="grid gap-4 sm:grid-cols-2">
                <SliderField label="Accept rate (%)" value={config.accept_rate_percentage} onChange={(v) => set("accept_rate_percentage", v)} description={CONFIG_DESCRIPTIONS.accept_rate_percentage} />
                <SliderField label="Whitelisted DH deck ratio (%)" value={config.whitelisted_deck_ratio} onChange={(v) => set("whitelisted_deck_ratio", v)} description={CONFIG_DESCRIPTIONS.whitelisted_deck_ratio} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <NumberField label="Active hour start (PST)" min={0} max={23} value={config.active_hour_start} onChange={(v) => set("active_hour_start", v)} description={CONFIG_DESCRIPTIONS.active_hour_start} />
                <NumberField label="Active hour end (PST)" min={0} max={23} value={config.active_hour_end} onChange={(v) => set("active_hour_end", v)} description={CONFIG_DESCRIPTIONS.active_hour_end} />
              </div>
            </TabsContent>

            {/* Boost — DH invitations while a boost is running */}
            <TabsContent value="boost" className={TAB_CONTENT}>
              <ToggleField
                label={CONFIG_LABELS.enable_boost_invites}
                description={CONFIG_DESCRIPTIONS.enable_boost_invites}
                checked={bool("enable_boost_invites")}
                onChange={(b) => set("enable_boost_invites", b ? "true" : "false")}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <NumberField
                  label={CONFIG_LABELS.boost_invites_total}
                  min={0}
                  value={config.boost_invites_total}
                  onChange={(v) => set("boost_invites_total", v)}
                  description={CONFIG_DESCRIPTIONS.boost_invites_total}
                />
                <NumberField
                  label={CONFIG_LABELS.boost_invite_interval_seconds}
                  min={10}
                  value={config.boost_invite_interval_seconds}
                  onChange={(v) => set("boost_invite_interval_seconds", v)}
                  description={CONFIG_DESCRIPTIONS.boost_invite_interval_seconds}
                />
              </div>
              {(() => {
                const total = Number(config.boost_invites_total)
                const interval = Number(config.boost_invite_interval_seconds)
                if (!Number.isFinite(total) || !Number.isFinite(interval) || total <= 0 || interval <= 0) return null
                const lastAt = total * interval
                const mins = Math.round((lastAt / 60) * 10) / 10
                const overruns = lastAt > 15 * 60
                return (
                  <p className={overruns ? "text-xs font-medium text-amber-600" : "text-xs text-muted-foreground"}>
                    {overruns
                      ? `⚠ The last invitation would land ~${mins} min after activation — beyond the 15-minute boost. Lower the total or the interval.`
                      : `With these values the user receives ${total} invitation${total === 1 ? "" : "s"}, the last ~${mins} min into the 15-minute boost.`}
                  </p>
                )
              })()}
            </TabsContent>

            {/* Selfies */}
            <TabsContent value="selfies" className={TAB_CONTENT}>
              <div className="grid gap-3 sm:grid-cols-2">
                <ToggleField label="Enable selfies" description={CONFIG_DESCRIPTIONS.enable_digital_human_selfies} checked={bool("enable_digital_human_selfies")} onChange={(b) => set("enable_digital_human_selfies", b ? "true" : "false")} />
                <ToggleField label="Enable photo reciprocation" description={CONFIG_DESCRIPTIONS.enable_selfie_reciprocation} checked={bool("enable_selfie_reciprocation")} onChange={(b) => set("enable_selfie_reciprocation", b ? "true" : "false")} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <SliderField label="Selfie intimacy threshold" value={config.selfie_intimacy_threshold} onChange={(v) => set("selfie_intimacy_threshold", v)} description={CONFIG_DESCRIPTIONS.selfie_intimacy_threshold} />
                <SliderField label="Tease threshold" value={config.selfie_tease_intimacy_threshold} onChange={(v) => set("selfie_tease_intimacy_threshold", v)} description={CONFIG_DESCRIPTIONS.selfie_tease_intimacy_threshold} />
                <SliderField label="Reward threshold" value={config.selfie_reward_intimacy_threshold} onChange={(v) => set("selfie_reward_intimacy_threshold", v)} description={CONFIG_DESCRIPTIONS.selfie_reward_intimacy_threshold} />
                <SliderField label="Early casual max intimacy" value={config.selfie_early_casual_max_intimacy} onChange={(v) => set("selfie_early_casual_max_intimacy", v)} description={CONFIG_DESCRIPTIONS.selfie_early_casual_max_intimacy} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <NumberField label="Selfie cooldown (minutes)" min={0} value={config.selfie_cooldown_minutes} onChange={(v) => set("selfie_cooldown_minutes", v)} description={CONFIG_DESCRIPTIONS.selfie_cooldown_minutes} />
                <NumberField label="Photo reciprocation gap (minutes)" min={0} value={config.selfie_reciprocate_gap_minutes} onChange={(v) => set("selfie_reciprocate_gap_minutes", v)} description={CONFIG_DESCRIPTIONS.selfie_reciprocate_gap_minutes} />
                <NumberField label="Early casual after user messages" min={1} value={config.selfie_early_casual_after_messages} onChange={(v) => set("selfie_early_casual_after_messages", v)} description={CONFIG_DESCRIPTIONS.selfie_early_casual_after_messages} />
                <div className="space-y-2">
                  <Label>Relationship warm-up rate</Label>
                  <Select value={config.intimacy_warmup_rate} onValueChange={(v) => set("intimacy_warmup_rate", v)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {WARMUP_RATE_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">{CONFIG_DESCRIPTIONS.intimacy_warmup_rate}</p>
                </div>
              </div>
            </TabsContent>

            {/* Proactive */}
            <TabsContent value="proactive" className={TAB_CONTENT}>
              <ToggleField label="Enable proactive double-texting" description={CONFIG_DESCRIPTIONS.enable_proactive_double_text} checked={bool("enable_proactive_double_text")} onChange={(b) => set("enable_proactive_double_text", b ? "true" : "false")} />
              <div className="grid gap-4 sm:grid-cols-2">
                <SliderField label="Proactive drive threshold" min={0} max={1} step={0.05} value={config.proactive_intimacy_drive_threshold} onChange={(v) => set("proactive_intimacy_drive_threshold", v)} description={CONFIG_DESCRIPTIONS.proactive_intimacy_drive_threshold} />
                <NumberField label="Proactive delay (minutes)" min={0} value={config.proactive_delay_minutes} onChange={(v) => set("proactive_delay_minutes", v)} description={CONFIG_DESCRIPTIONS.proactive_delay_minutes} />
                <NumberField label="Proactive extra follow-ups" min={0} value={config.proactive_extra_followups} onChange={(v) => set("proactive_extra_followups", v)} description={CONFIG_DESCRIPTIONS.proactive_extra_followups} />
              </div>
            </TabsContent>

            {/* Personality overrides */}
            <TabsContent value="overrides" className={TAB_CONTENT}>
              {personalities.length === 0 ? (
                <div className="rounded-md border p-6 text-sm text-muted-foreground">
                  Create a system prompt personality first, then configure overrides here.
                </div>
              ) : (
                <>
                  <div className="grid max-w-sm gap-2">
                    <Label>Personality</Label>
                    <Select value={selectedPersonality} onValueChange={setSelectedPersonality}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {personalities.map((p) => (
                          <SelectItem key={p} value={p}>{p}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Empty fields inherit the global default. Setting a value here only affects this personality.
                    </p>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    {configKeys
                      .filter((key) => !GLOBAL_ONLY_CONFIG_KEYS.has(key) && key !== "selfie_cooldown_hours")
                      .map((key) => {
                        const value = personalityOverrides[selectedPersonality]?.[key] ?? ""
                        const label = CONFIG_LABELS[key] ?? String(key).replace(/_/g, " ")
                        const description = CONFIG_DESCRIPTIONS[key]
                        const globalValue = config[key]

                        return (
                          <div key={key} className="space-y-2 rounded-md border p-3">
                            <div className="flex items-start justify-between gap-3">
                              <Label className="leading-5">{label}</Label>
                              {value !== "" ? (
                                <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => setPersonalityOverride(key, "")}>
                                  Inherit
                                </Button>
                              ) : null}
                            </div>
                            {description ? <p className="text-xs leading-5 text-muted-foreground">{description}</p> : null}
                            {key === "intimacy_warmup_rate" ? (
                              <Select value={value || "__inherit__"} onValueChange={(next) => setPersonalityOverride(key, next === "__inherit__" ? "" : next)}>
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="__inherit__">Inherit global ({globalValue})</SelectItem>
                                  {WARMUP_RATE_OPTIONS.map((o) => (
                                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : BOOLEAN_CONFIG_KEYS.has(key) ? (
                              <Select value={value || "__inherit__"} onValueChange={(next) => setPersonalityOverride(key, next === "__inherit__" ? "" : next)}>
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="__inherit__">Inherit global ({globalValue})</SelectItem>
                                  <SelectItem value="true">True</SelectItem>
                                  <SelectItem value="false">False</SelectItem>
                                </SelectContent>
                              </Select>
                            ) : (
                              <Input value={value} placeholder={`Global: ${globalValue}`} onChange={(e) => setPersonalityOverride(key, e.target.value)} />
                            )}
                            <p className="text-xs text-muted-foreground">
                              {value === "" ? `Inherited: ${globalValue}` : `Override: ${value}`}
                            </p>
                          </div>
                        )
                      })}
                  </div>
                </>
              )}
            </TabsContent>
          </Tabs>
        </Card>
      )}
    </div>
  )
}
