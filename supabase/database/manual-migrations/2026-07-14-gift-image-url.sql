-- ─────────────────────────────────────────────────────────────────────────────
-- Gift art goes remote (2026-07-14)
--
-- gift_catalog.image_url points at a public storage object (bucket `images`,
-- prefix `gifts/`). NULL = the bundled iOS imageset named in `asset` (the six
-- launch gifts). Gifts created from the new /admin/gifts page upload art here
-- and ship WITHOUT an app release; `asset` stays NOT NULL as the fallback that
-- older builds (and image-load failures) render.
--
-- Apply BEFORE deploying the admin/gifts + wallet route changes.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.gift_catalog
  add column if not exists image_url text;

comment on column public.gift_catalog.image_url is
  'Public URL of remote gift art (storage: images/gifts/). NULL = bundled iOS asset only. Clients prefer this over `asset` when present.';
