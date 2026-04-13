/** Sentinel StoreKit id for the non-purchasable free plan row in `subscription_catalog`. */
export const DEFAULT_FREE_TIER_APPLE_PRODUCT_ID = 'amber.subscription.free';

export type SubscriptionCatalogRow = {
  id: string;
  apple_product_id: string;
  name: string;
  swipes_per_day: number | null;
  messages_per_day: number | null;
};

export type ActiveSubscriptionRow = {
  id: string;
  status: string;
  current_period_end: string | null;
  subscription_catalog_id: string;
  subscription_catalog: SubscriptionCatalogRow | null;
};

function parsePositiveInt(v: string | undefined, fallback: number): number {
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.trunc(n);
}

/** UTC day bounds for daily quota windows. */
export function utcDayBoundsIso(): { start: string; end: string } {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

/** Override the default sentinel when the free-tier catalog row uses another `apple_product_id`. */
export function freeTierAppleProductId(): string {
  const v = process.env.FREE_TIER_APPLE_PRODUCT_ID?.trim();
  return v || DEFAULT_FREE_TIER_APPLE_PRODUCT_ID;
}

export function isFreeTierCatalogRow(row: Pick<SubscriptionCatalogRow, 'apple_product_id'>): boolean {
  return row.apple_product_id === freeTierAppleProductId();
}

/** Used only when no active plan and no free-tier catalog row was found. */
export function freeTierSwipesPerDay(): number {
  return parsePositiveInt(process.env.FREE_TIER_SWIPES_PER_DAY, 20);
}

/** Used only when no active plan and no free-tier catalog row was found. */
export function freeTierMessagesPerDay(): number {
  return parsePositiveInt(process.env.FREE_TIER_MESSAGES_PER_DAY, 20);
}

export function swipeQuotaForPlan(catalog: SubscriptionCatalogRow | null): number {
  if (catalog?.swipes_per_day != null && catalog.swipes_per_day >= 0) {
    return catalog.swipes_per_day;
  }
  return freeTierSwipesPerDay();
}

/** `null` quota means unlimited (catalog `messages_per_day` is null). */
export function messageQuotaForPlan(catalog: SubscriptionCatalogRow | null): number | null {
  if (catalog == null) return freeTierMessagesPerDay();
  if (catalog.messages_per_day == null) return null;
  return catalog.messages_per_day;
}

export function remainingSwipes(quota: number, used: number): number {
  return Math.max(0, quota - used);
}

export function remainingMessages(quota: number | null, used: number): number | null {
  if (quota === null) return null;
  return Math.max(0, quota - used);
}
