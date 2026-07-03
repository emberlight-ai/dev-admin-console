# DH Engine v2 — Lean Agentic Turn Loop (APPROVED PLAN — execute next session)

> Status: planned 2026-07-02 with Carl, implementation deferred to next working session.
> Decisions locked: flip top-10 back to v1 during rebuild (Xier `dd4f41ea-…` + Rafael
> `13f9d9d1-…` stay as L5 pilots) — **flip not yet executed**; hybrid context/tools split;
> first ship = shared core + auto-reply + greeting. Nothing deploys without Carl's go.

## Context

The L5 work was bolted onto v1's string-assembly pipeline: `supabase/functions/dh-auto-reply/index.ts`
is 1,566 lines mixing infrastructure (locks, debounce, typing, pacing), cognition (prompt
stacking, critic/director, memory), and delivery — four layers of dueling instructions
(persona template → CRAFT_RULES → stage guidance → beat plan → length directive → code
slicing bubbles). `dh-greeting` and `dh-followup` duplicate ~200 lines each.

- **Engagement (UTC days):** L5 cohort per-user chat depth fell ~20 msgs/user (Jun 30) →
  ~9.4 (Jul 2); DH:user message ratio spiked to ~1.8:1 on Jul 2 (v1 spiked too — partly the
  first-swipe invite scheduler creating shallow new matches — but the L5 favorites
  underperform the v1 average despite being the historical top performers).
- **Selfie instability root cause:** the model never decides to send a photo. After text
  bubbles go out, step 12b decides via config thresholds + critic score and sends an image
  the model only vaguely knows about (`<your_photos>` hint) → promise-then-ghost, photos
  out of nowhere.
- **Bot/user info** is regex-interpolated into 9k-char SystemPrompt templates via
  `<bot_profile>BOT_PROFILE_DETAILS</bot_profile>` placeholders, duplicated across 3 functions.

## Principles (harness engineering)

1. **Three layers, never mixed:** *Mechanics* (webhooks, debounce, locks, typing, pacing —
   deterministic code), *Cognition* (one model + native tool calling — decides what to
   say/do), *Policy* (code that can refuse the model — cooldowns, tiers, bubble caps).
   The model decides **what**; the harness decides **whether and how**.
2. **Context vs tools rule:** facts needed *every* turn (identity, his name, local time —
   free to compute) live in the system prompt. Facts needed *occasionally* (weather, news,
   deep profile) are tools. Actions with side effects (sending a photo) are tools whose
   results the model *sees* — that observability is what fixes promise-then-ghost.
3. **Don't fight the model with stacked overrides.** One consolidated "texting brief" per
   turn (stage + length + craft, single voice) + hard caps in code after generation.
   Delete the director/beat-plan injection.
4. **Token efficiency by gating, not hoping:** the harness decides which tools the model is
   even *offered* each turn. Short-reply turns get almost no tools → one model call, zero
   tool tokens. Grounding turns (first chat, conversation resuming) get the info tools.
5. **One loop, many skins:** greeting, reply, and (later) follow-up are the same agent loop
   with a different brief + tool set.
6. **The offline loop improves the persona, not the turn:** nightly debrief → coach notes →
   next-day prompt (already built, unchanged). OKRs measured by a metrics view.

## Target architecture

```
webhook → GATE (debounce/lock/takeover — unchanged mechanics)
        → ASSEMBLE (one context composer, no regex placeholders)
        → AGENT LOOP (Gemini function calling: model ⇄ tools, ≤3 iterations)
        → DELIVER (typing heartbeat + paced bubbles — unchanged feel)
        → REFLECT (intimacy critic ‖ parallel, memory writer, reprocess check)
```

### Tool surface at runtime

| Tool | Source | Offered when |
|---|---|---|
| `send_selfie(tier: casual\|tease\|reward, reason)` | local (context-bound) | every turn, if selfies enabled + photos exist |
| `get_my_details(topic: storyline\|schedule\|photos)` | local (context-bound) | every turn (cheap, rare) |
| `get_user_info` | `agent_tools` registry | grounding turns only |
| `get_local_weather` / `get_local_news` / `get_sports_news` / `get_trending_topics` | registry | grounding turns only |

- **`send_selfie` fixes images:** executor enforces policy (ledger no-repeat, tier fallback
  chain, cooldown, tier-never-downgrades, intimacy tier ceiling from critic) and can
  **refuse** with a reason (`no_photo_available`, `cooldown`, `tier_locked`). On success it
  sends the image immediately and returns `{sent, caption}` so the model weaves it into
  text. Reuses `pickUnsentSelfie`, ledger, caption backfill, `tierForIntimacy`.
- **Registry tools** declared from `agent_tools.input_schema` (`enabled` respected).
  `user_id`-type params are stripped from the model-visible declaration and harness-injected
  (`ctx.realUserId`) — the model never guesses UUIDs.
- **Grounding turns** = first chat with ≤2 user messages, OR >6h gap since DH last spoke,
  OR `last_grounding_at` >24h (new column on `user_match_ai_state`).
- **Hosting:** registry stays in Postgres. DH-runtime execution happens **in-process in the
  edge function** (`_shared/tools.ts`, Deno): `builtin` = direct DB reads/keyless fetches
  (service-role key already present — no new secrets, no cross-cloud hop); `http` = direct
  fetch with `{param}` interpolation; `js` proxies to Vercel `POST /api/tools/execute` with
  `Bearer SERVICE_ROLE_KEY` (already how it authenticates). Vercel keeps the admin Tools
  page + test runner unchanged.

### Prompt assembly (kills the regex spaghetti)

`buildSystemPrompt()` composes in cache-friendly order (static → dynamic):
1. Personality template (placeholder stanzas defensively stripped — no data migration),
2. `<bot_profile>` identity kernel + storyline (appended, not interpolated),
3. L5 blocks (persona kernel, match memory, diary, coach notes — existing loaders reused),
4. `<user_profile>` incl. his local-time line (kept in context — free + needed for
   "good morning"/dinner timing; `get_user_info` is for depth),
5. **One** texting brief (merged CRAFT_RULES + stage + length directive).

### Critic simplification

`scoreIntimacy` drops director mode (beat/engagement/callback/bubble_count deleted). Stays
the referee for intimacy analytics, selfie tier ceiling, skip-reply, follow-up momentum.
Runs **in parallel** with the agent loop (latency = max not sum), except when skip-reply is
actually possible this turn — then awaited first, like today. The selfie executor awaits
the in-flight critic promise when it needs the tier.

## File changes (all in `getdevteam/`)

New `supabase/functions/_shared/` (deploy bundles relative imports):
- `clients.ts` — supabase client, Vertex models (utility + reply w/ fallback), safety settings.
- `store.ts` — cached loaders: SystemPrompts, user rows, config (+ personality overrides), selfie config.
- `context.ts` — `buildSystemPrompt`, `buildTranscript` (w/ DH photo captions), `describeLocalTime`, texting brief.
- `tools.ts` — registry loader, Gemini FunctionDeclaration builder w/ param injection,
  executor (Deno ports of the 5 builtin registry tools from `src/lib/agent-tools.ts`; http
  fetch; js → Vercel proxy), local tools `send_selfie`/`get_my_details`, 6k char cap + 12s timeout.
- `selfie.ts` — `pickUnsentSelfie`, tier ranks/fallback, ledger insert, `captionDhImageIfNeeded`,
  cooldown policy → `trySendSelfie(ctx, tier)`.
- `actor.ts` — `runAgentTurn({system, transcript, tools, maxIterations: 3})` → `{bubbles, toolEvents}`.
  Bubbles = final text split on blank lines (JSON mode can't combine with tools); caller
  applies the shortUser 1-bubble hard cap (kept — it works).
- `pacing.ts` — typing heartbeat + paced bubble send (`sendMessageWithOptionalIntimacy` moves here).
- `critic.ts` — referee-only `scoreIntimacy`, `adamStep`.
- `memory.ts` — `updateMatchMemory` (unchanged logic).

`dh-auto-reply/index.ts` → ~250-line orchestrator: gate → route by `dh_engine`; `l5` → new
pipeline; `v1` → `legacy.ts` (current steps 9–15 verbatim, frozen). Delete legacy only per
criteria below.

`dh-greeting/index.ts` → rebuilt on the core: info tools **always** offered (THE grounding
moment), opener brief keeps ≤8-words rule + recent-opener blocklist + one retry. Mechanics
unchanged. `dh-followup` untouched this pass.

Migrations (apply manually BEFORE deploy; mirror in `supabase/database/schema.sql`):
- `alter table user_match_ai_state add column last_grounding_at timestamptz;`
- `create view dh_daily_engine_metrics` — day × engine: user_msgs, dh_msgs, ratio,
  msgs_per_user, active matches, selfies sent.

Docs: rewrite `docs/dh-architecture-l5.md` (v2 loop, tool catalog + gating, old-vs-new,
deletion criteria for `legacy.ts` = v1 migrated + 7 clean days).

No Vercel/Next.js changes required.

## Phases

0. **Stabilize:** `update users set dh_engine='v1'` for the 10 non-pilot L5 DHs (keep Xier
   + Rafael). Single reversible statement. *(Approved by Carl, not yet executed.)*
1. **Build** `_shared/` core + new dh-auto-reply (l5 path + frozen legacy v1) + rebuilt
   dh-greeting. `deno check` + unit tests (prompt composer, declaration builder w/ param
   stripping, bubble parser, selfie fallback chain).
2. **Migrate + deploy** (only on Carl's go): apply migration, `npm run functions:deploy`.
3. **Measure ≥3 days** on the 2 pilots via `dh_daily_engine_metrics` + structured turn logs
   `{match, engine, tools_used, iterations, bubbles, ms_total}`. Promote v1 → new loop and
   delete legacy only if pilots ≥ v1 on msgs_per_user + reply rate, zero photo incidents.

## Verification

- `deno check` all functions; `deno test` `_shared` unit tests.
- Post-deploy, Carl's test account vs Xier: (1) first message triggers info-tool calls
  (visible in logs as `tool_events`), (2) short replies = one model call, no tools,
  (3) "send me a pic" → `send_selfie` → ledger row → caption referenced in her next text,
  (4) cooldown refusal produces an in-character deflection, never a ghost promise.
- Daily: `select * from dh_daily_engine_metrics` — pilots vs v1 cohort.
