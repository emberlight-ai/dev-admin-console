# Digital Human Conversation Engines — v1 vs L5

Two engines coexist, gated per-DH by `users.dh_engine` (`'v1'` default, `'l5'`).
Flip a DH between engines on **/admin/l5-persona** (or `update users set dh_engine='l5' where userid=…`).
Rollback is instant and safe: revert the column, the DH is back on v1 behavior with no data loss.

**Pilots on L5 since 2026-07-01:** Xier (`dd4f41ea-…`), Rafael (`13f9d9d1-…`).

**Top-10 rollout 2026-07-02:** the 10 all-time-favorite whitelisted DHs (ranked by
distinct real users engaged, likes received, messages, peak intimacy) now run L5
with hand-seeded persona kernels: Rafael, Xier, Samantha, Autumn-Rose, Elisa,
Jay, Gemini, Maria, Lori, Dream. Engine additions with this rollout: selfie tier
FALLBACK (incl. previously-unsendable 'unspecified' photos), caption backfill on
first send + "[You sent a photo of yourself: …]" in the transcript, L5 photo-
inventory awareness (never promise a photo she can't send), and a match-his-length
craft rule (short user ⇒ one short bubble).

## What changed for EVERY DH (v1 included)

These shipped as mechanical fixes to `supabase/functions/dh-auto-reply/index.ts` and apply regardless of engine:

| Change | What it fixes |
|---|---|
| **Conversation-craft rules** (`CRAFT_RULES`, appended after the persona template) | The prompt used to command "match his length / mirror low effort" → interrogation death-spiral with low-effort users. Now: carry the conversation, share-first, ≤1 question per turn. |
| **Multi-bubble replies** (JSON array of 1–3 bubbles, sent with per-bubble typing pacing) | DHs always sent exactly one bubble; real texting has reaction + build + hook shapes. |
| **Inbound burst debounce** (7–11s wait + supersede check) | The webhook answered the *first* message of a burst before the user finished typing. |
| **Dropped-message fix** (`reprocessNewestIfMissed` + self-reinvoke) | A message arriving mid-generation hit the lock, returned `Locked`, and was **never answered** until the user spoke again. Real production bug. |

## L5-only components

| Component | Storage | Runtime |
|---|---|---|
| **Persona kernel** — tastes/boundaries/opinions, texting fingerprint, schedule, OKR | `dh_persona` | Injected as `<persona_kernel>` into every reply |
| **Match memory** — facts about him, open loops, inside jokes | `dh_match_memory` | Injected as `<what_you_remember_about_him>`; updated async after each reply (flash-lite) |
| **Diary** — mood + daily micro-events + news talking points | `dh_diary` | Injected as `<your_day_today>`; written nightly for the next day |
| **Director** — engagement score + beat plan (share/ask/tease/deepen/repair), callback pick, bubble count | (stateless) | Extra fields on the existing intimacy-referee call; steers the actor prompt |
| **Nightly debrief ("the Loop")** — reviews yesterday's transcripts + metrics vs OKR, checks news headlines (tool call), writes coach notes for tomorrow | `dh_debrief` | `dh-nightly-debrief` edge function, pg_cron `10 9 * * *` UTC (~1–2am PT); coach notes injected as `<coach_notes>` |

Admin surface: **/admin/l5-persona** (sidebar → Users and Bots → L5 Persona): roster with engine
badges, promote/revert, persona kernel editor, OKR, living timeline (debriefs + diaries), image
inventory, "Run debrief now".

## Old vs new, mechanism by mechanism

| Mechanism | v1 (old) | L5 (new) | Old one deletable? |
|---|---|---|---|
| Reply trigger | webhook per message | same + debounce + missed-message reinvoke | n/a (shared, already upgraded) |
| Reply shape | 1 bubble, free text | 1–3 bubbles, director-planned | n/a (shared) |
| Persona | `SystemPrompts` template + `users.storyline` | same **plus** `dh_persona` kernel | **Keep** — L5 layers on top; templates still carry the base role |
| Memory | last 50 messages only | + `dh_match_memory` extraction | n/a (additive) |
| "Her life" | static storyline text | `dh_diary` daily events + news topics | Storyline stays as backstory; diary is the "present tense" |
| Self-improvement | none (manual prompt edits) | `dh_debrief` coach notes, nightly | Manual prompt editing stays for base templates |
| Re-engagement | `dh-followup` cron (≥1h, momentum-scaled) | unchanged (still v1 for all) | **Candidate for L5 v2**: diary-driven initiations should replace generic follow-ups |
| Images | 3-cue selfie gate in dh-auto-reply | unchanged | **Known gaps documented** in review: text/image decoupling, no tier fallback, captions not in transcript — L5 v2 scope |

## When to delete v1

Promote more DHs and compare on the L5 page + these queries (payer-relevant metrics, ~2 weeks):

- reply rate: distinct users replying / users messaged (per engine cohort)
- depth: avg user-sent messages per active match
- peak intimacy distribution (payers historically peak ~74 vs ~16 for non-payers)
- % of matches reaching the paywall thresholds

If L5 cohort clearly wins: flip the default (`alter column dh_engine set default 'l5'`), migrate
remaining DHs, then delete the v1-only branches in `dh-auto-reply` (the non-L5 referee prompt and
the engine check). **Do not delete** `SystemPrompts`, `dh-followup`, or the selfie system — they are
shared infrastructure both engines use; they get *upgraded*, not removed.

## OKR / tipping

`dh_persona.okr` holds targets (conversations/day, reply rate, intimacy target, north star). The
nightly debrief grades actuals against it and adapts tactics. **Tipping does not exist in the app
yet** — when it ships, add a `tips` metric to the debrief's `collectMetrics` and to the OKR so the
loop optimizes for it directly.

## Ops

- Deploy: `supabase functions deploy dh-auto-reply dh-nightly-debrief --no-verify-jwt --project-ref wvcwvjlmnjnvyblrycxj`
- Debrief on demand: L5 page → "Run debrief now", or `POST /functions/v1/dh-nightly-debrief {"dh_user_id": "…"}`
- Cost: +1 flash-lite call per reply (memory writer, L5 only) + 1 pro call per DH per night (debrief)
- The nightly cron sends **no** auth header; the function is deployed `--no-verify-jwt` like the other DH functions (keeps the service-role JWT out of cron SQL — the older jobs still embed it and should be rotated/migrated to Vault)
