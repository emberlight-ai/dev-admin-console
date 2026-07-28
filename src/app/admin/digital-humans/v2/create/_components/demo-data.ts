import type { LucideIcon } from "lucide-react"
import {
  Activity,
  Brain,
  Coffee,
  Dumbbell,
  Flame,
  Moon,
  Snowflake,
  Sun,
  Timer,
  UtensilsCrossed,
  Waves,
  Wind,
} from "lucide-react"

// ═══════════════════════════════════════════════════════════════════════════
// Fixtures for the creator demo. Nothing here calls a real API — the flow is
// choreographed so the story lands in under a minute on camera. The content is
// deliberately specific (real Huberman protocol vocabulary) because generic
// placeholders are what make demos feel fake.
// ═══════════════════════════════════════════════════════════════════════════

export type Skill = {
  id: string
  name: string
  summary: string
  sources: number
  icon: LucideIcon
}

export type Tool = {
  id: string
  name: string
  subtitle: string
  icon: LucideIcon
  /** Tailwind text color for the icon + accents. */
  tint: string
  /** Tailwind background for the icon well. */
  well: string
}

export type RoutineSlot = {
  id: string
  time: string
  label: string
  hint: string
  icon: LucideIcon
  /** Tool ids the creator has dropped here. */
  toolIds: string[]
  /** Pre-filled by the parser so the canvas is never empty. */
  suggested?: string
}

export const SKILLS: Skill[] = [
  {
    id: "sleep",
    name: "Sleep & Circadian",
    summary: "Light timing, temperature minimum, sleep debt recovery",
    sources: 34,
    icon: Moon,
  },
  {
    id: "focus",
    name: "Focus & Dopamine",
    summary: "Ultradian work blocks, NSDR, dopamine baseline management",
    sources: 28,
    icon: Brain,
  },
  {
    id: "fitness",
    name: "Fitness & Recovery",
    summary: "Zone 2, hypertrophy protocols, deload timing",
    sources: 41,
    icon: Dumbbell,
  },
  {
    id: "nutrition",
    name: "Nutrition & Fasting",
    summary: "Protein thresholds, feeding windows, supplementation",
    sources: 37,
    icon: UtensilsCrossed,
  },
  {
    id: "stress",
    name: "Stress & Breathwork",
    summary: "Physiological sigh, cyclic hyperventilation, cold exposure",
    sources: 22,
    icon: Wind,
  },
  {
    id: "light",
    name: "Light & Vision",
    summary: "Morning lux targets, evening light hygiene, screen distance",
    sources: 19,
    icon: Sun,
  },
]

export const TOOLS: Tool[] = [
  {
    id: "lux",
    name: "Lux Calculator",
    subtitle: "Camera → light intensity",
    icon: Sun,
    tint: "text-amber-500",
    well: "bg-amber-500/12",
  },
  {
    id: "food",
    name: "Food Analyzer",
    subtitle: "Photo → macros",
    icon: UtensilsCrossed,
    tint: "text-emerald-500",
    well: "bg-emerald-500/12",
  },
  {
    id: "caffeine",
    name: "Caffeine Window",
    subtitle: "Wake → cutoff timing",
    icon: Coffee,
    tint: "text-orange-500",
    well: "bg-orange-500/12",
  },
  {
    id: "sleep-debt",
    name: "Sleep Debt",
    subtitle: "Rolling 14-day balance",
    icon: Moon,
    tint: "text-indigo-500",
    well: "bg-indigo-500/12",
  },
  {
    id: "nsdr",
    name: "NSDR Timer",
    subtitle: "Guided 10-min reset",
    icon: Timer,
    tint: "text-violet-500",
    well: "bg-violet-500/12",
  },
  {
    id: "zone2",
    name: "Zone 2 Tracker",
    subtitle: "Weekly aerobic minutes",
    icon: Activity,
    tint: "text-rose-500",
    well: "bg-rose-500/12",
  },
  {
    id: "cold",
    name: "Cold Plunge Log",
    subtitle: "Temp × duration",
    icon: Snowflake,
    tint: "text-sky-500",
    well: "bg-sky-500/12",
  },
  {
    id: "breath",
    name: "Breath Protocol",
    subtitle: "Physiological sigh",
    icon: Waves,
    tint: "text-teal-500",
    well: "bg-teal-500/12",
  },
]

export const ROUTINE: RoutineSlot[] = [
  {
    id: "wake",
    time: "6:30",
    label: "Wake",
    hint: "Same time daily — the anchor",
    icon: Sun,
    toolIds: [],
  },
  {
    id: "light",
    time: "6:45",
    label: "Morning light",
    hint: "10–30 min outside, within an hour of waking",
    icon: Sun,
    toolIds: [],
    suggested: "lux",
  },
  {
    id: "caffeine",
    time: "8:00",
    label: "First caffeine",
    hint: "~90 min after waking, avoids the crash",
    icon: Coffee,
    toolIds: [],
    suggested: "caffeine",
  },
  {
    id: "focus",
    time: "9:00",
    label: "Deep work",
    hint: "90-minute ultradian block",
    icon: Brain,
    toolIds: [],
  },
  {
    id: "lunch",
    time: "12:30",
    label: "Lunch",
    hint: "Protein-forward, keeps the afternoon clean",
    icon: UtensilsCrossed,
    toolIds: [],
  },
  {
    id: "dip",
    time: "13:30",
    label: "Afternoon dip",
    hint: "NSDR instead of more caffeine",
    icon: Timer,
    toolIds: [],
  },
  {
    id: "train",
    time: "16:30",
    label: "Train",
    hint: "Body temperature peak — strength window",
    icon: Flame,
    toolIds: [],
  },
  {
    id: "winddown",
    time: "21:30",
    label: "Wind down",
    hint: "Dim lights, screens away",
    icon: Moon,
    toolIds: [],
  },
]

/** The Claude-Code-style build log. Durations sum to ~5s. */
export const BUILD_STEPS: {
  id: string
  label: string
  detail: string
  ms: number
  /** Tools start flying in during this step. */
  spawnsTools?: boolean
}[] = [
  { id: "read", label: "Reading hubermanlab.com/topics", detail: "42 topic pages", ms: 700 },
  { id: "crawl", label: "Following linked episodes", detail: "196 transcripts", ms: 700 },
  { id: "images", label: "Reading images & diagrams", detail: "88 figures", ms: 600 },
  { id: "analyze", label: "Analyzing text", detail: "extracting protocols", ms: 800 },
  { id: "voice", label: "Modeling voice & cadence", detail: "direct, mechanistic, warm", ms: 600 },
  { id: "skills", label: "Building skills", detail: "6 skills", ms: 800 },
  { id: "tools", label: "Building tools", detail: "8 interactive tools", ms: 1400, spawnsTools: true },
]

export const TOTAL_BUILD_MS = BUILD_STEPS.reduce((sum, s) => sum + s.ms, 0)
