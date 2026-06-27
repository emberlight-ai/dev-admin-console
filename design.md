# Matrix OS — Design System

The design language for the getdevteam admin console. It borrows Vercel
Geist's core discipline — **subtraction, hairline structure, near-zero
chrome** — and expresses it through our actual stack: **shadcn/ui (new-york) +
Radix + Tailwind v4**, with **oklch design tokens** and a **swappable accent**.

The console is documentation that happens to be operational: crisp, exact, and
confident enough to let a single accent color be the only flourish.

> Source of truth for tokens: [`src/app/globals.css`](src/app/globals.css).
> Components: [`src/components/ui/`](src/components/ui). Never hardcode a hex —
> always reference a token (`bg-card`, `text-muted-foreground`, `border`).

---

## Overview

A near-white canvas (`--background`) carries near-black ink (`--foreground`),
and almost nothing else competes. Headings, body, primary buttons, and the
1px hairlines that define every card draw from the same neutral ladder. The one
place color is allowed to exist is the **accent** (`--primary`) — used for
primary actions, active states, and focus rings — and it is **user-swappable**
via the theme picker.

**Key characteristics**

- A single neutral ink (`--foreground`) carries headings, body, and borders on a
  near-white canvas (`--background`). Near-zero chromatic chrome.
- One themeable accent (`--primary`) is the entire color system — primary CTAs,
  active nav, focus rings, toggles. Everything else is neutral.
- **Dark mode is first-class**, not an afterthought — every surface is a token
  that flips under `.dark`. Never hardcode a color that won't flip.
- Hairline-bordered cards (`border` on `bg-card`) in calm grids; depth is a 1px
  border plus, at most, a whisper shadow — never heavy elevation.
- Type does the work: Inter, tight-tracked semibold headings over a quiet
  neutral body ladder. `font-mono` for prompt templates and code.
- The single flourish is the **GlareHover** light-sweep across the wordmark when
  the accent changes ([`glare-hover.tsx`](src/components/glare-hover.tsx)) —
  our equivalent of Vercel's hero gradient, and the only decorative moment.

---

## Colors

All colors are oklch CSS variables on `:root`, overridden under `.dark`, and
exposed to Tailwind as utilities (`bg-*`, `text-*`, `border-*`). The accent
trio (`--primary`, `--ring`, `--sidebar-primary`) is additionally overridden by
the active **affinity** (`data-color` on `<html>`).

### Semantic tokens

| Token | Tailwind | Light (oklch) | Dark (oklch) | Role |
|---|---|---|---|---|
| `--background` | `bg-background` | `1 0 0` (white) | `0.145 0 0` | Page canvas |
| `--foreground` | `text-foreground` | `0.145 0 0` (ink) | `0.985 0 0` | Primary text |
| `--card` | `bg-card` | `1 0 0` | `0.205 0 0` | Card / panel surface |
| `--muted` | `bg-muted` | `0.97 0 0` | `0.269 0 0` | Inset wells, subtle fills |
| `--muted-foreground` | `text-muted-foreground` | `0.556 0 0` | `0.708 0 0` | Captions, secondary copy |
| `--accent` | `bg-accent` | `0.97 0 0` | `0.269 0 0` | Hover fill for nav/items |
| `--primary` | `bg-primary` | `0.205 0 0` * | `0.922 0 0` * | Accent: CTAs, active, focus |
| `--primary-foreground` | `text-primary-foreground` | `0.985 0 0` | `0.205 0 0` | Text on accent |
| `--border` | `border` | `0.922 0 0` | `1 0 0 / 10%` | The 1px hairline — everywhere |
| `--input` | — | `0.922 0 0` | `1 0 0 / 15%` | Field borders |
| `--ring` | `ring-ring` | `0.708 0 0` * | `0.556 0 0` * | Focus ring, active tint base |
| `--destructive` | `text-destructive` | `0.48 0.16 29` | `0.704 0.191 22` | Errors, destructive actions |
| `--sidebar` | `bg-sidebar` | `0.985 0 0` | `0.205 0 0` | Sidebar surface |

\* Overridden by the active affinity (see below).

### Text ladder

Step deliberately, never skip a tier:
`text-foreground` (headings, high-emphasis) →
`text-muted-foreground` (body, captions) →
`text-muted-foreground/60` (lowest-emphasis hints, "—" placeholders).

### Accent affinities

The accent is themeable. [`theme-color.tsx`](src/components/theme-color.tsx)
sets `data-color` on `<html>`, which remaps `--primary` / `--ring` /
`--sidebar-primary`. Eight Elden-Ring-named affinities ship; **Sekura** (sakura
pink) is the default. The accent and light/dark/auto appearance are chosen in the
Settings dialog ([`settings-dialog.tsx`](src/components/settings-dialog.tsx)),
opened from the sidebar — not from the header.

| Affinity | Swatch | Affinity | Swatch |
|---|---|---|---|
| Magic | `hsl(221 92% 56%)` blue | Blood | `hsl(356 88% 52%)` crimson |
| Cold | `hsl(196 92% 55%)` cyan | Dark | `hsl(268 51% 38%)` violet |
| Fire | `#FF5C00` orange | Sekura | `#ec4899` pink |
| Sacred | `hsl(46 98% 56%)` gold | Poison | `#5da500` green |

Because the accent is a moving target, **components must read `--primary` /
`bg-primary` / `text-primary`** — never a literal blue or pink. A button that
hardcodes pink breaks the day someone picks Fire.

---

## Typography

The system runs on **Inter** ([`layout.tsx`](src/app/layout.tsx)), with the
Tailwind default mono stack for code. No third face.

| Role | Classes | Use |
|---|---|---|
| Page title | `text-2xl font-semibold tracking-tight` | Page / editor `h1` |
| Section heading | `text-base font-semibold` | Card / stage headings |
| Strong label | `text-sm font-medium` | Field labels, nav emphasis |
| Eyebrow | `text-xs font-medium tracking-wide text-muted-foreground` | Sidebar group titles |
| Body | `text-sm` | Default prose, table cells |
| Caption | `text-xs text-muted-foreground` | Helper text, metadata |
| Metric | `text-sm font-semibold tabular-nums` | Numeric readouts (delays, counts) |
| Code | `font-mono text-sm` | Prompt templates, code blocks |

**Principles**

- Weight is near-binary: `font-semibold` (600) for headings, `font-medium`
  (500) for labels/buttons, regular (400) for everything else. No light, no
  black, no italic.
- Large headings use `tracking-tight`; body sits at neutral tracking.
- Always `tabular-nums` for numbers that change in place (timers, ranges,
  counts) so they don't jitter.
- `font-mono` is reserved for two roles only: prompt templates / code, and the
  `<code>` chips that name a token or placeholder inline.
- Sentence case everywhere — buttons, headings, labels. "Save changes", not
  "Save Changes".

---

## Layout

### The shell

[`admin-shell.tsx`](src/components/admin-shell.tsx) is the frame:

- **Primary sidebar** — fixed, `w-64`, `bg-sidebar`, right hairline. Grouped nav
  (eyebrow + items), a backend group, and Sign Out pinned to the bottom.
  Contextual lists (e.g. the personalities list while editing a prompt) mount
  *inside* this column so the content area keeps full width.
- **Content** — offset `md:pl-64`, a sticky `h-14` header (theme picker + dark
  toggle, right-aligned), then `<main class="p-4 md:p-6">`.
- Below `md`, the sidebar collapses behind a `Menu` trigger into a left `Sheet`.

### Spacing

Tailwind's 4px base. Common rhythm: `gap-6` between major blocks, `space-y-6`
down a page, card interiors at `p-5`/`p-6`, control gaps at `gap-2`/`gap-3`.
Section bands breathe; card interiors stay tight.

### Grid & width

Content fills the offset area (no fixed max-width — this is a dense console, not
a marketing page). Multi-column forms use `grid-cols-2` / `sm:grid-cols-3`,
collapsing to one column on narrow widths. Always pair `flex-1` with `min-w-0`
so long content (mono textareas, long names) can shrink instead of overflowing.

---

## Elevation & depth

Depth is deliberately minimal — prefer a hairline plus the surface step over a
shadow.

| Level | Treatment | Use |
|---|---|---|
| 0 — Flat | `border` (1px hairline), no shadow | Cards, inputs, dividers, the rail |
| 1 — Whisper | `border` + `shadow-sm` | Lightly raised cards, popovers |
| 2 — Floating | Radix `Dialog` / `Sheet` default shadow + overlay | Modals, side sheets, dropdowns |

At most two floating layers at once; a third means a `Dialog`, not a
popover-on-popover. The accent's `--ring` provides the only "glow" — a focus
ring, never a decorative one.

---

## Shapes

Radius derives from `--radius: 0.625rem` (10px):

| Token | Value | Use |
|---|---|---|
| `rounded-sm` | 6px | — |
| `rounded-md` | 8px | Buttons, inputs, nav items |
| `rounded-lg` | 10px | Inset panels, code blocks |
| `rounded-xl` | 14px | Cards, the stage rail chips |
| `rounded-full` | pill | Badges, segmented toggles, status dots, avatars |

Bimodal, like Vercel: functional controls stay tight (`rounded-md`), content
cards round to `rounded-xl`, and status/segmented elements go full pill.

---

## Components

Built on shadcn/ui (new-york). Reach for the primitive in
[`src/components/ui/`](src/components/ui) before hand-rolling.

### Buttons — [`button.tsx`](src/components/ui/button.tsx)
- `default` — accent fill (`bg-primary`); **one per view**, the main action.
- `outline` — hairline + transparent; the default for secondary actions.
- `ghost` — no border; icon buttons, low-emphasis actions.
- `destructive` — `bg-destructive`; only for irreversible actions.
- Disable the primary action until there's something to do (e.g. Save is
  disabled until the form is dirty). Verb-first labels: "Save changes".

### Cards — [`card.tsx`](src/components/ui/card.tsx)
White `bg-card`, 1px `border`, `rounded-xl`, `p-5`/`p-6`. The workhorse
container. Group related cards with whitespace, not heavier backgrounds.

### Inputs — [`input.tsx`](src/components/ui/input.tsx) · [`textarea.tsx`](src/components/ui/textarea.tsx)
Hairline border, `rounded-md`, focus ring from `--ring`. Pair every field with a
`Label` and, where useful, a `text-xs text-muted-foreground` helper. Mono
textareas for prompt templates.

### Dialog / Sheet — [`dialog.tsx`](src/components/ui/dialog.tsx) · [`sheet.tsx`](src/components/ui/sheet.tsx)
`Dialog` for focused confirms and small forms (rename, unsaved-changes guard).
`Sheet side="right"` for companion panels that shouldn't steal the page (e.g.
**Test & tune**). Widen with `sm:max-w-xl` when the default is too narrow.

### Tabs / segmented — [`tabs.tsx`](src/components/ui/tabs.tsx)
Radix `Tabs` for content switching; a `border` pill with `bg-primary` on the
selected segment for compact binary toggles (Female / Male).

### Sidebar items
`flex items-center gap-2 rounded-md px-3 py-2 text-sm`, `hover:bg-accent`,
active = `.sidebar-active` (a 12% `--ring` tint) + `text-foreground`. Section
headers use the eyebrow style.

### Feedback
Toasts via **sonner** ([`sonner.tsx`](src/components/ui/sonner.tsx)) —
`toast.success` / `toast.error`, message only (no "Error:" prefix, no first
person). Status uses a colored dot, not a heavy badge.

---

## Patterns

- **Glanceable rail as tabs** — a horizontal row of status chips (each: icon,
  label, status dot, one-line summary) doubles as the section switcher. One
  control gives both the overview and the navigation. See the system-prompt
  editor ([`system-prompt-form.tsx`](src/app/admin/system-prompts/manage/_components/system-prompt-form.tsx)).
- **Drill-in sidebar** — entering a sub-context (editing a prompt) slides the
  main nav out and a section list (personalities) in, with a `‹ Back` to the
  parent. The list lives in the primary sidebar, so the editor keeps full width.
  Rows in the parent table are fully clickable — no per-row Edit button.
- **Companion sheet** — long-running side tasks (live prompt testing) live in a
  right `Sheet`, summoned from a button beside the primary action.
- **Dirty-state guard** — destructive navigation while there are unsaved edits
  opens a Save / Discard / Keep-editing dialog, backed by a `beforeunload`
  warning. Primary Save stays disabled until dirty.

---

## Do / Don't

### Do
- Keep the canvas neutral (`--background`) and let ink (`--foreground`) carry
  headings, body, and borders — a black-and-white duet with one accent.
- Read the accent from `--primary` / `bg-primary` so theme affinities work.
- Define cards and inputs with a 1px `border` before reaching for any shadow.
- Step the text ladder: `foreground` → `muted-foreground` → `/60`.
- Test every surface in dark mode before calling it done.
- Use sentence case and verb-first button labels.

### Don't
- Don't hardcode hex colors — they won't flip for dark mode or theme affinities.
- Don't fill large surfaces with the accent; it's for actions, active states,
  and focus, not chrome.
- Don't pile on shadows — depth is a hairline plus, at most, a whisper.
- Don't set body copy in pure black (`#000`); ink is `--foreground` and body
  steps to `--muted-foreground`.
- Don't add a second decorative system — the accent (and the wordmark sweep) is
  the only flourish.
- Don't disable a button without a reason the user can infer (dirty-state Save
  is fine; a mystery-disabled control is not).
