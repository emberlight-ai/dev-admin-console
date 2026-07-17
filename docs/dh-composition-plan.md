# Digital Human Composition — Persona / Character / Skill / Strategy

*2026-07-14 · design plan v4 — external review verified & folded in; implementation started.*

> **v4 corrections (all verified against code):**
> 1. `matching_enabled` / `immediate_match_enabled` are **ALIVE** — read by
>    `rpc_get_matching_candidates` (candidate pool) and the match RPC (instant DH
>    match) in `matches.sql`. v3's "verified dead" only searched TypeScript. They
>    stay on the persona as its **Availability policy** (prose + 2 toggles +
>    default strategy = the persona's whole surface); no SQL call-path migration.
> 2. `scheduled_response_at` is written by the chat-state trigger (`chat.sql`) —
>    trigger updates first, column drop after (Phase 4).
> 3. The critic does **NOT** rate-limit the score by construction — warmup is
>    instruction-only and the stored value accepts any 0–100. A **deterministic
>    delta clamp** (per warmup rate, mirroring the instruction ranges' caps)
>    lands in code before the score is stored. Gifts→intimacy stays (Carl's
>    deliberate economy design), rides under the same clamp ceiling per turn.
> 4. Opener ledger gets a **lifecycle**: `status reserved|sent|failed` + reservation
>    TTL (expired/failed reservations are reusable), structural validation of the
>    generated text against its claimed signature, and an exhaustion rule (all 36
>    combos used → oldest `sent` older than 60 days is reusable).
> 5. `dh-outbound` gets an **idempotent event ledger** (`dh_outbound_events`) —
>    reservation rows enforce the check-in daily cap (recipient-local day bucket),
>    follow-up counts, unanswered-stop, and cross-run exclusivity.
> 6. Character continuity ("Westworld gap"): the storyline generator template
>    includes a **"current beat"** section (place, situation, running threads) —
>    curated text, no memory writer; `emotional_companionship` prose must not
>    promise remembering beyond the transcript window.
> 7. Rename becomes `SystemPrompts` → **`persona_versions`** + a `personas` view
>    (latest row per gender:personality) — the table is version history and
>    naming it `personas` would lie.
> 8. Rollout safety: git rollback can't unsend messages — a **temporary
>    `composition_cohort` config key** gates the new composition path to listed
>    DH ids ('all' = everyone) during migration; removed at Phase 4.
> 9. Cron setup SQL **contains the service-role JWT** — rotate the key, rewrite
>    setup to Supabase Vault, purge from history; setup also still re-registers
>    `dh-nightly-debrief` (remove).
> 10. Table count: **six** new tables, and `strategies` now actually carries the
>    warmup/eagerness knobs it was assigned (`intimacy_warmup_rate`).

The goal: a **Westworld backlot**. Writers (ops) build hosts from a small set of
clean parts, and no part knows about the others' internals. Today one DH's
behavior is smeared across six surfaces; this plan reduces it to **four layers
with one owner each**, mostly by *reassigning columns that already exist*, not
by building new machinery.

---

## 1 · Where the spaghetti actually is (audited)

| Surface | What it holds today | The problem |
|---|---|---|
| `SystemPrompts` (12 personas, 460 versions) | Persona prose **plus 17 behavior columns**: greeting prompt/toggle, follow-up prompt/delay/max, matching toggles, reply pacing ×3, skip-reply ×5 | Persona and behavior welded together. Tuning "how chatty is she" means editing a *persona*, which versions the prose too. The 1,300-line editor form is this table's UI. |
| `users` (574 DHs) | `personality` join key, `storyline`, bio/age/profession | **1 of 574 DHs has a storyline.** The instance layer exists but is economically dead — no one hand-writes 574 backstories. |
| `digital_human_config` (38 keys) | Global switches: selfie thresholds, cooldowns, warmup, invites | Behavior hiding in a kv junk drawer. |
| `digital_human_personality_config` (8 keys) | Per-persona overrides of the same | A second, shadow strategy system. |
| `agent_tools` (5 tools, all enabled) | Global tool registry | Every DH gets every tool, **and the executor will run any enabled tool the model names** — gating is prompt-side only. No notion of "this DH reads tarot." |
| `user_interests` | Explore/matching tags | **Never enters the conversation.** A DH tagged Gothic chats like everyone else. Zero references in edge functions. |

Runtime (the v2 engine in `_shared/`) is *not* the problem — its
mechanics/cognition/policy split is exactly right, and `buildSystemPrompt()` is
already a composer. It just composes from tangled sources. (Side finding:
`dh-greeting` and `dh-followup` carry their own duplicated prompt-cache loaders
instead of using `_shared/store.ts` — they die with the outbound unification, §2.)

---

## 2 · Target model

Java analogy → data model (no actual inheritance needed; it's composition):

```
Persona   (abstract class)   →  personas (renamed SystemPrompts), PROSE ONLY: voice, worldview
Character (instance)         →  users row: persona + storyline + interests + profile
Skill     (decorator)        →  NEW skills table: prompt block + AUTHORIZED tools + optional opener
Strategy  (effort dial)      →  NEW strategies table: min → ultra effort presets
```

One sentence each, in ops language:

- **Persona** — *how she talks.* Nothing else. Greeting/follow-up/matching move out.
  Keyed by `gender:personality` as today (decided: keep the composite key).
- **Character** — *who she is.* One DH = persona + backstory + interests. Storyline
  becomes cheap via a **generator button** (persona + profile + interests →
  **first-person** draft — "I grew up in…" — ops edits, saves). This is what
  makes the layer real for all 574.
- **Skill** — *what she can do, and the ONLY way she gets tools.* A prompt block,
  an optional opener, and an authorized tool set (§ authorization below).
  Launch set of four: `fortune_telling` (opener: offers a one-card pull),
  `riddle` (opener: opens with a riddle), `roleplay` (block only),
  `emotional_companionship` (block only: gently explores his dating past,
  validates, remembers).
- **Strategy** — *how hard she pursues.* A Claude-style effort slider, one preset
  per notch: `min_effort · medium_effort · high_effort · max_effort · ultra_effort`.
  Each preset owns the full outbound cadence: reply pacing, skip-reply,
  **follow-ups** (delay × max count — ultra: every 30 min, max 3), **check-ins**
  (proactive time-of-day pings — "what'd you have for lunch", "whatcha up to" —
  max N per day, ultra-tier behavior), and **outbound reach** (nearby invites).

### One engine, one outbound scheduler (function consolidation)

`users.dh_engine` is **dropped** — one engine version at a time, no v1/L5.
Rollout = deploying the rebuilt functions for everyone; rollback = redeploying
the previous git tag. No per-DH flag.

The three proactive functions collapse into one:

| End state | Absorbs | Trigger |
|---|---|---|
| `dh-auto-reply` | — | message webhook (reply turns) |
| `dh-greeting` | — | match created (opener, ledger-guarded §below) |
| **`dh-outbound`** | `dh-followup` + `dh-nearby-dispatch` | cron; one scheduler that walks strategies and emits **follow-ups** (silence-triggered), **check-ins** (local-time-of-day-triggered, only matches where he has replied at least once, not muted/cooldown), and **nearby invites** (`outbound_enabled` tiers) |
| `dh-matching` | — | unchanged (gates on its global config key) |
| *(deleted)* | `dh-nightly-debrief` remote remnant (cron already dead) | — |

One scheduler = one place for pacing, one prompt loader (`_shared/store.ts`),
and the duplicated loaders in `dh-followup`/`dh-greeting` die with the fold.

### Skills are an authorization boundary (not a suggestion)

`tool_names text[]` is replaced by a real M2M with FKs, and enforcement moves
to **execution time**:

- Tool resolution per turn: `allowed = engine locals (send_selfie, get_my_details)
  ∪ core info tools (agent_tools.is_core, grounding turns only) ∪ tools of the
  DH's assigned skills` (via `skill_tools`).
- The **declarations** offered to the model come from `allowed` — and the
  **executor rejects** any call outside `allowed` with
  `{ok:false, error:"tool not available"}` + a log line, instead of running
  whatever is enabled in the registry. Model hallucinating a tool name ≠ access.
- `agent_tools.enabled=false` remains a global kill switch that trumps everything.

### Deterministic composition rules (no ambiguity)

- **Skill order**: `skills.sort_order` (global, per skill — no per-DH ordering).
  Prompt blocks concatenate in that order.
- **Opener conflict**: *lowest `sort_order` active skill with an `opener_prompt`
  wins; all other openers are ignored for that match.* Greeting falls back to
  the global template when the DH has no opener skill.

### Prompt assembly (cache-friendly, static → dynamic)

```
[persona prose]  [skill blocks]  [bot_profile + interests]  [storyline]  |  [user_profile]  [texting brief]
        static per persona            static per character              per-turn tail
```

`buildSystemPrompt()` gains two inputs (skill blocks, interests line). That's
the entire engine change for cognition. **Interests injected into `bot_profile`
must filter `admin_only`** — `whitelist`/`featured` are ops tags, not identity.

### Greeting variety: an atomic ledger, not an instruction

Per-persona greeting/follow-up prose retires. The replacement requirement —
**a user matched with several DHs never receives near-identical openers** — is
enforced in the database, not in the prompt:

- Every opener carries a **signature** `{anchor_type, structure}` from two small
  enums — anchor: `my_storyline | my_interest | his_bio | his_location |
  his_time | skill_opener`; structure: `question | observation | tease |
  playful_challenge | riddle | two_part` (36 combos per recipient).
- `dh_opener_ledger` has PK `(real_user_id, anchor_type, structure)`. Before
  sending, the sender **reserves the signature with an atomic INSERT**; a
  conflict (including a concurrent greeting from another DH — the insert is the
  lock) means regenerate with the taken combos injected as constraints, retry ≤2,
  then deterministically pick an unused combo and generate against it.
- The greeting turn needs no tools, so it can use JSON response mode and return
  `{anchor_type, structure, bubbles}` in one call — no second classify call.
- **All openers go through the ledger**: `dh-greeting` AND nearby-invite openers
  in `dh-outbound`. The static `hey 👋` fallback is deleted; the fallback path is
  the deterministic unused-combo generation above.
- The ledger doubles as the "what did other DHs already send him" record — no
  message-table scans.

### Runtime state: intimacy_score IS the decision tree

`user_match_ai_state` is the fifth layer — per-match runtime — and it slims down
to **one relationship axis plus mechanics**:

- **`intimacy_score` (0–100) is the single axis.** The critic already
  rate-limits it (warmup rate caps each turn's delta against the previous
  score), so the stored score is stable *by construction*. The Adam machinery —
  `intimacy_m`, `intimacy_v`, and the generated `intimacy_drive = m/√v` — exists
  solely to feed one gate: dh-followup's "momentum hot enough for proactive
  outreach" threshold. All three columns die, along with the
  `proactive_intimacy_drive_threshold` config key + admin slider. The gate's
  replacement is a band rule (below). `scheduled_response_at` also dies —
  zero code references.
- **Bands, defined once** in `_shared/intimacy.ts` and read by every gate:
  `cold < 25 ≤ warming < 50 ≤ close < 75 ≤ intimate`. The decision tree:

  | Gate | Rule |
  |---|---|
  | check-ins (`dh-outbound`) | only `warming+` matches (plus: he replied ≥1, not muted/cooldown) |
  | proactive follow-up pacing | strategy cadence, but **stop early on `cold` matches** (replaces the drive gate) |
  | photo tiers (`send_selfie` policy) | keeps its existing finer config thresholds (casual/tease/reward ≈ 45/55/75, ops-tunable) — bands don't replace them |
  | skip-reply modulation | unchanged (already reads score drops only) |
  | texting brief stage | stays message-count based for now (a stranger who love-bombs to warming in 3 messages is still a stranger) |

- **Gifts stay an economy input**: `rpc_send_gift` bumps the score, the tree
  reacts — no new plumbing.

### Photos: a policy-gated tool, NOT a skill

The rule that keeps skills clean: **a skill is opt-in persona flavor; a policy
capability is universal behavior with safety/economics gates.** Photo sending is
core dating behavior every DH should have — wrapping it in a skill means ops
must remember to assign it 574 times, and forgetting silently mutes photos.

So `send_selfie` stays an **engine-local tool**: the model decides *when/why*
(tool call with tier + reason), the policy executor decides *whether*
(intimacy thresholds, cooldown, reciprocation) and *which photo*. One upgrade
lands here: **inventory becomes `dh_chat_images` (her own) ∪ the shared
library** (`shared_chat_images` via `rpc_pick_shared_image` — built, currently
unwired), with the per-user dedup ledger guaranteeing no user ever sees the
same library photo twice, even from different DHs. Availability stays natural:
no inventory ⇒ no tool offered.

**"When does she send a photo?" — the four levers, coarse → fine:**

| Lever | Question it answers | Where ops controls it |
|---|---|---|
| Inventory | *Can she send anything at all?* | Chat Images library + her own photos on the DH page. Empty ⇒ tool never offered. |
| Policy rails (global) | *Is it allowed right now?* | Configuration page: tier thresholds (tease ≥45 / casual ≥55 / reward ≥75), cooldown, reciprocation, early-casual — the hard envelope, same for everyone. |
| Strategy (eagerness) | *How fast does a match reach those thresholds?* | The effort tier: warmup rate + early-casual folds into the strategy row (Phase 4). Ultra warms in an evening; min takes a week — so effort indirectly sets photo timing. |
| The model (impulse) | *This exact moment?* | Nobody — deliberately. Persona voice + conversation decide, inside the rails. That unpredictability is what reads as human. |

Today the per-persona eagerness overrides live in `digital_human_personality_config`
**with no admin UI at all** — moving them into the strategy row is what makes
this lever visible to ops for the first time.

### What each function reads afterwards

| Function | Reads |
|---|---|
| `dh-auto-reply` | persona prose + character + skill blocks + `skill_tools` allowlist + strategy (pacing, skip) + intimacy (critic → score only) |
| `dh-greeting` | strategy (`active_greeting_enabled`) + winning skill opener + **opener ledger** |
| `dh-outbound` | strategy (follow-up delay/max, check-ins/day, `outbound_enabled`) + **intimacy bands** + opener ledger for invites |
| selfie policy | intimacy thresholds (`digital_human_config` globals) + unified inventory (own + shared library); per-persona overrides fold into strategy at Phase 4 |

---

## 3 · Schema (6 new tables, 3 new columns, 1 rename, column drops in Phase 4)

```sql
create table strategies (
  key text primary key,            -- min_effort … ultra_effort
  name text not null, description text,
  active_greeting_enabled bool not null default true,
  follow_up_delay int not null default 86400,      -- seconds between follow-ups
  max_follow_ups int not null default 3,           -- 0 = never follows up
  check_ins_per_day int not null default 0,        -- proactive time-of-day pings
  reply_min_delay_seconds int not null default 2,
  reply_max_delay_seconds int not null default 18,
  reply_chars_per_second numeric not null default 15,
  skip_reply_enabled bool not null default false,
  skip_reply_base_chance numeric not null default 0.1,
  skip_reply_intimacy_drop_chance numeric not null default 0.5,
  skip_reply_intimacy_drop_delta numeric not null default 5,
  skip_reply_max_consecutive int not null default 1,
  outbound_enabled bool not null default false,
  intimacy_warmup_rate text not null default 'normal'   -- eagerness: how fast closeness grows
);

create table dh_outbound_events (              -- idempotent proactive-send ledger
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null,
  dh_user_id uuid not null,
  real_user_id uuid not null,
  kind text not null check (kind in ('follow_up','check_in','invite')),
  local_day date not null,                     -- recipient-local day bucket (caps)
  seq int not null default 1,                  -- nth event of this kind that day
  status text not null default 'reserved'
    check (status in ('reserved','sent','skipped','failed')),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (match_id, kind, local_day, seq)      -- the reservation IS the lock
);

create table skills (
  key text primary key, name text not null, description text,
  prompt_block text not null,
  opener_prompt text,                         -- greeting override
  sort_order int not null default 100,        -- block order + opener tiebreak
  active bool not null default true
);
create table dh_skills (
  user_id uuid references users(userid) on delete cascade,
  skill_key text references skills(key) on delete cascade,
  primary key (user_id, skill_key)
);
create table skill_tools (                    -- the authorization boundary
  skill_key text references skills(key) on delete cascade,
  tool_id uuid references agent_tools(id) on delete cascade,
  primary key (skill_key, tool_id)
);

create table dh_opener_ledger (               -- atomic opener-variety reservation
  real_user_id uuid not null references users(userid) on delete cascade,
  anchor_type text not null,
  structure text not null,
  dh_user_id uuid not null,
  match_id uuid,
  opener_text text,
  status text not null default 'reserved' check (status in ('reserved','sent','failed')),
  created_at timestamptz not null default now(),
  primary key (real_user_id, anchor_type, structure)
);
-- Lifecycle: INSERT = reservation (the lock). 'failed' or 'reserved' older than
-- 10 min is reclaimable (UPDATE … WHERE status/age, still atomic). Exhaustion:
-- all 36 taken → oldest 'sent' > 60 days is reusable. The engine validates the
-- generated text against its claimed structure (question ⇒ '?', riddle ⇒ from
-- the riddle skill, …) before marking 'sent'.

alter table agent_tools add column is_core bool not null default false;  -- grounding info tools
alter table users add column strategy_key text references strategies(key);          -- null → persona default
alter table users drop column dh_engine;                                            -- one engine, period
alter table "SystemPrompts" add column default_strategy_key text references strategies(key);
-- Phase 4: alter table "SystemPrompts" rename to persona_versions;    -- it IS version history
--          create view personas as select distinct on (gender, personality) …
--          order by gender, personality, created_at desc;             -- stable identity view
--          create view "SystemPrompts" as select * from persona_versions;  -- until readers migrate
```

**Shared-image dedup goes atomic**: `rpc_pick_shared_image` (STABLE, read-only)
+ a separate record step lets two DHs pick the same image for one user
concurrently. New `rpc_claim_shared_image` picks AND inserts the
`shared_image_sends` row in one transaction (`ON CONFLICT` ⇒ walk to the next
candidate); the send path then only backfills `message_id`.

Resolution order: `users.strategy_key → persona default_strategy_key → 'medium_effort'`.

### Seed preset matrix (ops-editable on the Strategies page — starting values)

| knob | min | medium | high | max | ultra |
|---|---|---|---|---|---|
| speaks first (greeting) | ✗ | ✓ | ✓ | ✓ | ✓ |
| reply delay (s) | 8–45 | 4–30 | 2–18 | 2–12 | 1–8 |
| typing chars/sec | 8 | 12 | 15 | 18 | 22 |
| follow-ups (max × delay) | 0 | 1 × 48 h | 3 × 24 h | 5 × 12 h | **3 × 30 min** |
| check-ins / day | 0 | 0 | 0 | 1 | 3 |
| skip-reply (base) | 30 % | 15 % | 8 % | off | off |
| outbound reach | ✗ | ✗ | ✗ | ✓ | ✓ |

### What gets deleted / renamed (end state)

| Object | Fate |
|---|---|
| `users.dh_engine` | **Dropped** (Phase 1) — single engine, deploy = cutover |
| `SystemPrompts` | **Renamed `persona_versions`** + `personas` latest-per-key view; keeps `id, gender, personality, system_prompt, created_at, default_strategy_key` **+ the 2 availability toggles** (`matching_enabled`, `immediate_match_enabled` — read by `matches.sql`, they stay) — the other 13 behavior columns **dropped** |
| `digital_human_personality_config` | **Dropped entirely** — its 8 keys fold into strategy (cadence-like) or stay global (selfie) |
| `digital_human_config` | **Shrinks ~38 → ~15 keys** — cadence/outbound keys retire into strategies; kill-switches + selfie globals stay |
| `user_match_ai_state` | **Drops 4 columns**: `intimacy_m`, `intimacy_v`, `intimacy_drive` (generated), `scheduled_response_at` (write-only — the chat-state trigger must stop writing it FIRST, then the column drops). Keeps: score+updated_at, locks/checkpoints, `ai_state` funnel (0 fresh · 1 greeted · 2 sent · 4 follow-up — dh-outbound's selector), follow-up count, greeting/grounding/selfie timestamps, takeover, muted |
| cron setup (`cron/setup.sql`) | **Service-role JWT purged** (rewrite to Vault + ROTATE the key — treat as exposed); `dh-nightly-debrief` schedule block removed |
| `proactive_intimacy_drive_threshold` | Config key + admin slider **dropped** (replaced by the band rule) |
| `dh-followup`, `dh-nearby-dispatch` functions | **Folded into `dh-outbound`**, dirs deleted |
| `dh-nightly-debrief` (deployed remnant) | **`supabase functions delete`** — cron already dead |
| `agent_tools` | Stays (gains `is_core`); admin page gains a "used by skill X" badge |
| everything else | Untouched (`user_interests`, invites queue/ledger tables…) |

\* v4 correction: `matching_enabled` / `immediate_match_enabled` looked dead from
TypeScript but are read by `matches.sql` (candidate pool + instant DH match).
They stay on the persona as its **Availability policy**.

**Explicitly rejected** (overcomplication guards):
- ❌ Persona inheritance trees / skill parameters / per-skill config jsonb — YAGNI.
- ❌ Per-DH knob overrides or per-DH skill ordering. A special DH = a new preset.
- ❌ Migrating selfie config into strategy now — it works; own pass later.
- ❌ New prompt-template DSL. Composition stays "append blocks in fixed order".
- ❌ Keeping a second engine or per-DH engine flags. One deployed version, git tags are the rollback.

---

## 4 · Ops experience after (the point of all this)

**Build a host = 4 decisions on ONE page** (digital-humans/[id]):

1. **Persona** — dropdown (12 options).
2. **Story** — one textarea + ✨ *Generate* (first-person draft from persona +
   profile + interests; ops edits, saves). Batch-generate backfills the other 573.
3. **Skills** — chips (fortune telling · riddle · roleplay · emotional companionship).
4. **Effort** — the 5-notch slider (min → ultra), defaulted from the persona.

- Persona editor shrinks to **prose + default effort** (the 1,300-line form
  drops to a fraction).
- New tiny pages: **Strategies** (5 preset cards), **Skills** (block + opener + authorized tools).
- Interests keep their current admin (kanban) — they now also shape the chat for free.

---

## 5 · Migration path (each phase shippable alone, no big bang)

| Phase | What | Risk |
|---|---|---|
| **0 — Connect what exists** | Inject interests (non-admin) into `bot_profile`; nothing else. | Trivial |
| **1 — Strategy extraction** | Create `strategies` (5 presets); map each persona's current values to the nearest preset; engine reads presets (old columns stop being read); drop `users.dh_engine`; single prompt loader in `_shared/store.ts`. | Low: mapped from existing values |
| **2 — Skills + authorization + ledger** | `skills`/`dh_skills`/`skill_tools` + `is_core`; executor-level allowlist rejection; greeting honors winning opener + **opener ledger** (JSON-mode signature); `send_selfie` inventory gains the shared library (picker RPC + dedup, already built). Ship the 4 launch skills. | Medium: new surfaces, all additive |
| **3 — Outbound unification + intimacy simplification + storyline** | `dh-outbound` absorbs follow-ups (new delay×max semantics), adds check-ins (band-gated), absorbs nearby dispatch (ledger-guarded invites, `hey 👋` deleted); **band rule replaces the drive gate, auto-reply stops writing m/v** (must land together — stopping the writes earlier would freeze `intimacy_drive` while dh-followup still gates on it); first-person storyline generator + batch backfill. | Medium: replaces two crons with one |
| **4 — Cleanup & rename** | Rename `SystemPrompts` → `personas` behind a compat view; drop the 15 behavior columns; drop `digital_human_personality_config`; drop the 4 `user_match_ai_state` columns + drive-threshold config; retire config keys; slim the form; delete dead function dirs + deployed `dh-nightly-debrief`. | Only after 1–3 soak |

---

## 6 · Skills v2 — data-collecting skills (designed 2026-07-17, not built)

Driver: "Health Coach" (meal-time prompts in the user's local time, food-photo
calorie tracking) — and generally, DHs that ELICIT AND TRACK declared
datapoints. Verdict on v1: chassis right (tools/authorization/outbound/vision
all reusable), missing exactly three things:

1. **Declared datapoints** — `skill_datapoints (skill_key, key, value_schema
   jsonb, cadence)` + append-only `user_datapoints (user_id, dh_id, skill_key,
   key, value jsonb, observed_at, source_message_id)`. Ops declares fields;
   the engine elicits, extracts, stores. Scales to any coach-type skill with
   zero per-skill engine code.
2. **Extractor referee** — the intimacy-critic pattern reused: a parallel cheap
   model call per turn with a JSON schema assembled from the DH's declared
   datapoints, scanning the user message + skill-directed photo analysis
   (skills gain `image_analysis_prompt`; vision runs it instead of generic
   "describe" and the result feeds both the actor and the extractor). The
   actor chats; the referee records — never trust mid-flirt tool-call
   discipline for data capture.
3. **Skill-owned scheduling + computed context** — skills gain optional
   `check_in_slots` + per-slot prompts; dh-outbound Pass B consults the DH's
   skills before the strategy default. `buildSystemPrompt` gains a computed
   (not generated) per-skill state block: "Today: breakfast 420 kcal, lunch
   missing — ask when natural." Deterministic totals, never model arithmetic.

Guard rails: this is BOUNDED memory — ops-declared fields only (the opposite
of the rejected L5 diary); the "no per-skill config" rule relaxes for exactly
these three declarative fields; per-DH overrides stay forbidden. Health
framing: calorie estimates are motivational-companion content, NEVER medical
advice (App Store risk).

## 6b · Decisions log (Carl)

**2026-07-14 (round 1):** effort-slider strategies (5 notches, full config each) ·
launch skills incl. riddle + emotional companionship · first-person storylines ·
keep `gender:personality` key · greeting prose retired, variety required ·
opener conflict = lowest `sort_order` wins · outbound is strategy-gated.

**2026-07-14 (round 2):** drop `users.dh_engine` (one engine at a time) ·
follow-ups get delay × max (ultra = 30 min × 3) · check-ins as strategy knob
(ultra-tier "what's for lunch" pings) · skills = real authorization boundary
(`skill_tools` FKs + executor-level rejection, not prompt-side omission) ·
opener variety = atomic per-recipient signature ledger (covers concurrent
greetings AND nearby invites; static `hey 👋` fallback deleted) · consolidate
functions (`dh-outbound` absorbs followup + nearby-dispatch; delete debrief remnant).

**2026-07-14 (round 4 — persona goes PROSE-ONLY):** Carl rejected keeping
Availability on the persona: ALL interaction toggles move to Strategy.
Verified against prod: the 13 personas' (matching, instant, greeting) values
cluster into exactly 4 escalating profiles (hidden ×4 → quiet ×3 → greets ×3 →
greets+instant ×3) — an effort ladder, not identity. Target:
- `personas` = gender:personality + system_prompt + default_strategy_key. Nothing else.
- `strategies` gains `matching_enabled` + `immediate_match_enabled`
  (`active_greeting_enabled` is already there); a new **`dormant`** preset
  (matching off, everything off) absorbs the 4 hidden personas' DHs.
- Seeds: instant-match on max/ultra (eager = no pending request); greeting off
  only on min/dormant.
- `matches.sql` rewires: candidate pool + instant-match join
  `users.strategy_key → strategies` (body-only changes, no signature change)
  instead of the SystemPrompts lateral join.
- Greeting prose column DIES (round-1 decision executed): dh-greeting migrates
  to `_shared/store` + strategy gate + ONE global opener instruction composed
  with persona voice/storyline/interests — natural moment to add the variety
  ledger. dh-nearby-dispatch's greeting-prompt read goes with the outbound fold.
- Persona form then shrinks to prose + default effort (Availability and
  Greeting stages deleted); persona behavior columns drop.

**2026-07-14 (round 3):** `intimacy_score` is the single relationship axis —
drop `intimacy_m`/`intimacy_v`/`intimacy_drive` + the drive-threshold config
(verified: their only job is dh-followup's proactive gate; the critic already
rate-limits the score itself) · bands (`cold/warming/close/intimate`) defined
once, drive check-ins + follow-up cold-stop · photos stay a **policy-gated
engine tool, not a skill** (skill = opt-in flavor; universal capability =
policy) · `send_selfie` inventory unified with the shared image library
(picker + per-user dedup, built but unwired) · `scheduled_response_at` dead, drop.
