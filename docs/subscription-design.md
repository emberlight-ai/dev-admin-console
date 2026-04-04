# Subscription and Usage Refactor

This design replaces balance counters with explicit subscription lifecycle, plan catalog, Apple purchase history, and swipe events.

## 1. Table schema

### `subscription_catalog` (plan catalog / App Store product mapping)

This table only defines subscription products and quotas. It does not store user entitlement state.


| Column                                  | Notes                                                     |
| --------------------------------------- | --------------------------------------------------------- |
| `id`                                    | PK (uuid)                                                 |
| `apple_product_id`                      | StoreKit product id (unique)                              |
| `name`                                  | Display or internal plan name                             |
| `price_cents`, `currency`               | Price snapshot (Apple remains billing source of truth)    |
| `billing_period`                        | e.g. `monthly`, `yearly`                                  |
| `swipes_per_day` or `swipes_per_period` | Pick one model; `swipes_per_day` matches current behavior |
| `messages_per_day`                      | Daily message cap (`null` can mean unlimited)             |
| `metadata`                              | jsonb for plan-specific flags                             |
| `created_at`, `updated_at`              | Audit timestamps                                          |


### `subscription` (lifecycle / status state machine)

Represents one user subscription lifecycle. Recommended: one row per `original_transaction_id` after Apple identifies the subscription line.


| Column                                       | Notes                                                       |
| -------------------------------------------- | ----------------------------------------------------------- |
| `id`                                         | PK                                                          |
| `user_id`                                    | FK -> users                                                 |
| `subscription_catalog_id`                    | FK -> subscription_catalog                                  |
| `status`                                     | `CREATED` -> `PURCHASING` -> `ACTIVE` -> `EXPIRED`          |
| `original_transaction_id`                    | Nullable before Apple returns it; unique with `environment` |
| `environment`                                | `Sandbox` / `Production`                                    |
| `current_period_start`, `current_period_end` | Current billing period boundaries                           |
| `auto_renew_status`                          | Apple auto-renew signal                                     |
| `status_changed_at`                          | Last status transition timestamp                            |
| `created_at`, `updated_at`                   | Audit timestamps                                            |


#### Status transition chart


| Status       | Meaning                                                         |
| ------------ | --------------------------------------------------------------- |
| `CREATED`    | iOS/backend recorded first purchase intent.                     |
| `PURCHASING` | StoreKit / Apple purchase flow is in progress.                  |
| `ACTIVE`     | Apple confirms entitlement is active.                           |
| `EXPIRED`    | Apple RTDN indicates expiration, or subscription period lapsed. |


### `apple_purchase` (every Apple transaction record)

Append-only record of Apple transactions (initial purchase, renewal, restore, refund/revoke events if modeled).


| Column                          | Notes                                                                     |
| ------------------------------- | ------------------------------------------------------------------------- |
| `id`                            | PK                                                                        |
| `user_id`                       | FK                                                                        |
| `subscription_id`               | FK -> subscription (nullable until linked)                                |
| `transaction_id`                | Transaction instance id (unique per event/charge)                         |
| `original_transaction_id`       | Stable chain id across renewals for the same subscription line            |
| `product_id`                    | Apple product id                                                          |
| `environment`                   | `Sandbox` / `Production`                                                  |
| `purchase_date`, `expires_date` | Apple timestamps                                                          |
| `quantity`, `type`              | Usually `1`, `auto_renewable`                                             |
| `raw_payload`                   | Raw Apple payload/JWS body stored for audit, replay safety, and debugging |
| `created_at`                    | Ingest timestamp                                                          |


`transaction_id` vs `original_transaction_id`:

- `transaction_id`: unique id of one specific transaction event (initial buy or each renewal).
- `original_transaction_id`: stable root id that groups all renewals belonging to one subscription lifecycle.

Idempotency key recommendation: unique index on (`environment`, `transaction_id`).

### `swipe` (event table)


| Column           | Notes                       |
| ---------------- | --------------------------- |
| `id`             | PK                          |
| `swiper_user_id` | Who performed the swipe     |
| `target_user_id` | Who was swiped              |
| `reaction`       | `like` or `dislike`         |
| `created_at`     | timestamptz default `now()` |




## 2. End-to-end workflows

### A. User login / app open (fetch remaining swipes/messages)

1. Resolve entitlement by loading active `subscription` for the user and joining `subscription_catalog`.
2. Count today usage from event tables:
  - `swipes_used_today` from `swipe`
  - `messages_used_today` from message events
3. Return (e.g. `GET /api/ios/me/entitlement`):
  - `remaining_swipes = max(0, quota - used)` (UTC day)
  - `remaining_messages = max(0, quota - used)` or `null` when unlimited
  - subscription status info (`status`, `current_period_end`, plan name)

### B. User sends message or swipes

1. Frontend enforces quota and blocks the action when limit is reached.
2. If action is allowed, API records the event row (`swipe` or message) in the database.
3. API returns action success/failure only; it does not need to return remaining counts.

### C. Premium purchase flow (RTDN/webhook-driven server update)

1. Client calls API to create purchase intent (`subscription.status = CREATED`).
2. Client performs StoreKit purchase.
3. Backend receives RTDN/webhook callback from Apple (or your RTDN processor), validates payload, and upserts:
  - `apple_purchase` transaction row
  - `subscription` transition `PURCHASING` -> `ACTIVE` (or `EXPIRED` based on event)
  - `original_transaction_id`, period dates, `auto_renew_status`
4. Client long-polls subscription status endpoint until terminal status (`ACTIVE`, `EXPIRED`, or failed/cancelled if modeled).

