// @ts-nocheck
// The single relationship axis: intimacy_score (0-100), banded once here and
// read by every policy gate (check-ins, follow-up cold-stop, future gates).
// Selfie tiers keep their own finer config thresholds — bands are the coarse
// vocabulary, not a replacement.
//
// Also home of the DETERMINISTIC delta clamp: the critic's warmup guidance is
// instruction-only (the model can return any 0-100), so the engine enforces
// the per-turn ceiling in code before the score is stored. Gift bumps ride
// under the same ceiling via their own RPC; this clamp covers the critic path.
import type { IntimacyWarmupRate } from './store.ts';

export type IntimacyBand = 'cold' | 'warming' | 'close' | 'intimate';

export function bandFor(score: number | null | undefined): IntimacyBand {
  const s = typeof score === 'number' && Number.isFinite(score) ? score : 0;
  if (s < 25) return 'cold';
  if (s < 50) return 'warming';
  if (s < 75) return 'close';
  return 'intimate';
}

// Per-turn max upward movement by warmup rate — mirrors the upper bounds the
// critic instructions already promise ("use 26-35 only for very explicit…").
const MAX_DELTA_UP: Record<IntimacyWarmupRate, number> = {
  very_low: 4,
  low: 8,
  normal: 12,
  high: 18,
  very_high: 25,
  extreme: 35,
};
// Cooling can be faster than warming (a bad turn lands harder than a good one),
// but still no cliffs.
const MAX_DELTA_DOWN_FACTOR = 1.5;

export function clampIntimacy(
  previous: number | null | undefined,
  proposed: number,
  rate: IntimacyWarmupRate
): number {
  const next = Math.max(0, Math.min(100, proposed));
  if (previous == null || !Number.isFinite(previous)) return next;
  const up = MAX_DELTA_UP[rate] ?? MAX_DELTA_UP.normal;
  const down = up * MAX_DELTA_DOWN_FACTOR;
  return Math.max(previous - down, Math.min(previous + up, next));
}
