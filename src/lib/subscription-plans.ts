/**
 * Single source of truth for plan id, duration, and price.
 * Used for: recording purchase amount, granting premium (duration → expires_at).
 */
export type PlanConfig = {
  planId: string;
  /** Price in USD (display/store in cents in DB). */
  priceUsd: number;
  /** Duration in months; null = lifetime (no expiry). */
  durationMonths: number | null;
};

export const PLAN_CONFIGS: PlanConfig[] = [
  { planId: 'monthly', priceUsd: 29.99, durationMonths: 1 },
  { planId: 'yearly', priceUsd: 69.99, durationMonths: 12 },
  { planId: 'lifetime', priceUsd: 89.99, durationMonths: null },
];

const planMap = new Map<string, PlanConfig>(
  PLAN_CONFIGS.map((p) => [p.planId.toLowerCase().trim(), p])
);

export function getPlanConfig(planId: string): PlanConfig | null {
  return planMap.get(planId.toLowerCase().trim()) ?? null;
}

/** Price in cents (for DB and recording purchase). */
export function getPlanPriceCents(planId: string): number | null {
  const config = getPlanConfig(planId);
  return config ? Math.round(config.priceUsd * 100) : null;
}

/** expires_at for premium grant: null = lifetime, else now + durationMonths. */
export function getPlanExpiresAt(planId: string): Date | null {
  const config = getPlanConfig(planId);
  if (!config) return null;
  if (config.durationMonths == null) return null; // lifetime
  const d = new Date();
  d.setMonth(d.getMonth() + config.durationMonths);
  return d;
}
