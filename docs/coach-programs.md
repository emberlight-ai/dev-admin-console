# Coach programs: skills with intake, plans, check-ins, and server-driven UI

The "skill hosting with a human face" layer: a DH with a coach skill runs a
structured program instead of open-ended chat — modeled on gstack office-hours
(question list → plan → follow-ups), extended with scheduled check-ins and
rich UI messages the iOS app renders natively.

## The loop

1. **Intake** — on the first conversation, the coach asks the skill's intake
   questions one at a time (never as a list), acknowledging each answer like a
   human coach would.
2. **Plan** — once every question is answered, the coach writes a short
   personal plan (stored as coach state + sent as a `coach_plan` component),
   and immediately demonstrates her tools (caffeine window, lux meter,
   nutrition scanner).
3. **Check-ins** — the skill's cadence schedules future coach messages
   (`dh_coach_checkins` queue, dispatched by cron). Each check-in prompt runs
   through dh-auto-reply's generator with full memory of the plan, so
   follow-ups reference what the user committed to.

## Component messages (server-driven UI)

Same transport as gifts: `messages.type = 'component'`, JSON in `content`:

```json
{ "component": "caffeine_window", "v": 1, "text": "Your caffeine window ☕️", "props": { ... } }
```

`text` is the chat-list preview + old-client fallback. Components v1:

| component          | rendered as                                                        |
| ------------------ | ------------------------------------------------------------------ |
| `caffeine_window`  | Daily-rhythm timeline: wake/sleep, caffeine window pills, a personalized meal rhythm, delay + in-body stats, consumed counter with quick-log |
| `lux_meter`        | Teaser card with animated ticker; tap opens the full camera Lux Meter page (ideal exposure minutes) |
| `nutrition_scan`   | Scanner card with calorie/protein targets; tap opens camera → photo message → coach replies with `nutrition_result` |
| `nutrition_result` | Meal breakdown card: calories, protein/carbs/fat bars, coach note  |
| `coach_plan`       | The personal plan: goal + focus items + schedule                   |

Props schemas live in `Amber/Core/Chat/CoachComponents/CoachComponentModels.swift`
(iOS) and are documented inline in the edge-function component catalog, which
also validates model output before the native client receives it.

### Emission

dh-auto-reply's system prompt (for DHs with a coach skill) documents the
component catalog and allows the model to append blocks:

```
<component>{"component":"caffeine_window", ...}</component>
```

The edge function strips these from the prose reply and inserts them as
separate `type='component'` rows, so one model turn can produce
"here's your morning setup" + two cards, each its own bubble.

## Skill config

Coach behavior is data on four columns of the `skills` row, editable on
`/admin/skills`: `intake_questions`, `plan_prompt`, `demo_checkins`, and
`components`.

```json
{
  "intake_questions": [
    "What's your weight and height?",
    "What's your current goal — gain muscle, lose weight, or something else?",
    "How long have you been working out?",
    "What's your weekly schedule like?",
    "What's your favorite sport or exercise?"
  ],
  "plan_prompt": "Write a 2-week starter plan ...",
  "demo_checkins": [
    { "after_minutes": 3,  "prompt": "Send the caffeine window for today..." },
    { "after_minutes": 10, "prompt": "Morning-light nudge: send the lux meter..." }
  ],
  "components": ["caffeine_window", "lux_meter", "nutrition_scan", "nutrition_result", "coach_plan"]
}
```

## State

`dh_coach_state` (match_id PK, skill_key, phase `intake|active`,
question_index, intake_answers jsonb, plan text, timestamps) — the program
state machine per conversation. `dh_coach_checkins` (id, match_id, checkin_key,
prompt, run_at, status) — the queue, claimed by the dispatch cron like
scheduled_dh_invites.

## Demo notes (YC 1-min)

Melody (6322195f-5c75-4ec1-91dd-b14c34b8c5b2) carries `health_coach` with the
config above; check-in delays are minutes, not days, so the full loop fits a
demo take. The coach chat renders in the athletic dark theme
(HealthCoachChatTheme) so her conversation is visibly her brand.
