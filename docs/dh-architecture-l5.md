# Digital Human Conversation Engine — v2 (agentic turn loop)

> Supersedes the v1/L5 split. The L5 experiment (persona kernels, match memory,
> diary, nightly debrief) was retired on 2026-07-08 — engagement fell for the L5
> cohort and the stacked-prompt architecture was fighting itself. All DHs run ONE
> engine now. The persona kernels were snapshotted to
> `docs/archive/dh-persona-snapshot-2026-07-08.json` before the tables were dropped.
> `users.dh_engine` still exists as a legacy column; no code reads it.

## Three layers, never mixed

| Layer | Owner | What lives here |
|---|---|---|
| **Mechanics** | deterministic code | webhook gate, burst debounce (7–11s), optimistic lock, typing/`dh_status` heartbeats, paced bubble delivery, missed-message reinvoke |
| **Cognition** | one model turn (Gemini function calling, ≤3 iterations) | what to say, whether to send a photo, whether to look something up |
| **Policy** | code that can refuse the model | selfie cooldown/tier ceiling/no-repeat ledger, bubble caps (shortUser ⇒ 1), result truncation + timeouts |

The model decides **what**; the harness decides **whether and how**.

```
webhook → GATE (debounce/lock/takeover)
        → ASSEMBLE (buildSystemPrompt composer — no regex placeholders)
        → AGENT LOOP (model ⇄ tools, ≤3 iterations)   ‖ intimacy critic (parallel)
        → DELIVER (typing heartbeat + paced bubbles)
        → REFLECT (state + intimacy momentum, reprocess check)
```

## Tool surface at runtime

| Tool | Source | Offered when |
|---|---|---|
| `send_selfie(tier, reason)` | local (`_shared/selfie.ts`) | selfies enabled + DH has photos |
| `get_my_details(topic: storyline\|photos)` | local | every turn (cheap, rare) |
| `get_user_info` | `agent_tools` registry | grounding turns only |
| `get_local_weather` / `get_local_news` / `get_sports_news` / `get_trending_topics` | registry | grounding turns only |

- **`send_selfie` is how photos happen now.** The executor enforces policy —
  ledger no-repeat, tier fallback chain, cooldown (short gap on strong cue),
  tier-never-downgrades, intimacy tier ceiling from the critic — and can refuse
  with a reason (`no_photo_available`, `cooldown`, `tier_locked`). On success
  the image goes out immediately and the model gets `{sent, caption}` so it
  weaves the photo into its text. This kills promise-then-ghost and
  photos-out-of-nowhere.
- **Registry tools** come from the `agent_tools` table (admin `/admin/tools`).
  `user_id` params are stripped from the model-visible declaration and injected
  by the harness — the model never guesses UUIDs. `builtin` tools run
  in-process in Deno; `http` is a direct fetch; `js` proxies to Vercel
  `POST /api/tools/execute` with the service-role key (needs `APP_BASE_URL`
  secret if a js tool is ever enabled).
- **Grounding turns** = ≤2 user messages, OR DH silent >6h, OR
  `user_match_ai_state.last_grounding_at` >24h. Everything else is tool-light:
  one model call, near-zero tool tokens.

## Shared core (`supabase/functions/_shared/`)

`clients.ts` (supabase + Vertex models w/ pro→flash-lite fallback) · `store.ts`
(cached SystemPrompts/users/config/selfie-config) · `context.ts` (prompt
composer + transcript + ONE texting brief) · `critic.ts` (referee-only
intimacy + Adam momentum + user-image describe) · `selfie.ts` (policy executor)
· `tools.ts` (registry loader, declarations, builtin ports) · `actor.ts`
(agent loop) · `pacing.ts` (heartbeats, rpc_send_message wrapper, paced sends).

`dh-auto-reply/index.ts` is a ~430-line orchestrator. Kept from the July fixes:
craft rules (now merged into one brief), multi-bubble with pacing, burst
debounce, skip-reply ("human silence"), dropped-message reinvoke, selfie tier
fallback + caption backfill, DH-photo captions in the transcript.

**Not yet migrated:** `dh-greeting` and `dh-followup` still run their own
legacy prompt assembly (no L5 code in them; they work as before). Migrating
them onto `_shared/` is the natural next pass.

## Retired with L5 (2026-07-08)

- Tables `dh_persona`, `dh_match_memory`, `dh_diary`, `dh_debrief` (dropped)
- `dh-nightly-debrief` edge function + its pg_cron job (`10 9 * * *`)
- Director mode on the critic (beat plans / engagement / bubble counts)
- Per-reply memory-writer call, `/admin/l5-persona` page + `/api/admin/l5/*`

## Ops

- Deploy: `npm run functions:deploy` (or `supabase functions deploy dh-auto-reply --no-verify-jwt --project-ref wvcwvjlmnjnvyblrycxj`)
- **Migration required before deploy:** `user_match_ai_state.last_grounding_at`
  (see `supabase/database/schema.sql`; applied manually per the usual workflow)
- Turn telemetry: each reply logs one JSON line
  `{match, grounding, tools_used, bubbles, selfie_sent, intimacy, ms_total}` —
  grep the function logs for `"] turn"`.
- Cost per turn: 1 critic call (flash-lite, parallel) + 1–3 actor calls
  (pro-preview; 1 on non-grounding turns).
