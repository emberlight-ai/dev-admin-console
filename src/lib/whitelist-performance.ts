// Shared DH swipe-performance analysis for the matching/whitelist admin page.
// Used by both the read-only "Performance review" API and the "Sync suggested"
// API so the displayed suggestions and the applied changes always match.
//
// Performance = real-user swipes targeting a DH: right swipe = "like",
// left swipe = "dislike". like_rate = likes / (likes + dislikes).

export type PerfRow = {
  userid: string;
  username: string | null;
  gender: string | null;
  personality: string | null;
  whitelisted: boolean;
  likes: number;
  dislikes: number;
  total: number;
};

export type Verdict = 'great' | 'ok' | 'poor' | 'low data';

export type ScoredRow = PerfRow & {
  likeRate: number | null; // 0..1, null when no swipes
  verdict: Verdict;
};

export type CandidateRow = ScoredRow & { tier: 'proven' | 'promising' };

export const PERF_THRESHOLDS = {
  // A whitelisted DH is suggested for removal when it has enough volume to judge
  // and a clearly poor like rate.
  demoteMinSwipes: 30,
  demoteMaxLikeRate: 0.4,
  // A non-whitelisted DH is suggested for promotion when proven at decent volume.
  promoteMinSwipes: 10,
  promoteMinLikeRate: 0.55,
  // Non-whitelisted DHs shown as candidates (lower bar than auto-promote).
  candidateMinSwipes: 5,
  // Verdict labels for the whitelisted table.
  verdictMinSwipes: 8,
  greatLikeRate: 0.55,
  okLikeRate: 0.35,
} as const;

export function scoreRow(r: PerfRow): ScoredRow {
  const total = r.total ?? 0;
  const likeRate = total > 0 ? r.likes / total : null;
  let verdict: Verdict;
  if (total < PERF_THRESHOLDS.verdictMinSwipes || likeRate == null) verdict = 'low data';
  else if (likeRate >= PERF_THRESHOLDS.greatLikeRate) verdict = 'great';
  else if (likeRate >= PERF_THRESHOLDS.okLikeRate) verdict = 'ok';
  else verdict = 'poor';
  return { ...r, likeRate, verdict };
}

const byRateDesc = (a: ScoredRow, b: ScoredRow) =>
  (b.likeRate ?? -1) - (a.likeRate ?? -1) || b.total - a.total;

const hasSignal = (r: ScoredRow) => (r.total >= PERF_THRESHOLDS.verdictMinSwipes ? 1 : 0);

export type PerformanceAnalysis = {
  whitelisted: ScoredRow[];
  candidates: CandidateRow[];
  suggestions: { demote: ScoredRow[]; promote: ScoredRow[] };
};

export function analyzePerformance(rows: PerfRow[]): PerformanceAnalysis {
  const scored = rows.map(scoreRow);

  const whitelisted = scored
    .filter((r) => r.whitelisted)
    .sort((a, b) => hasSignal(b) - hasSignal(a) || byRateDesc(a, b));

  const candidates: CandidateRow[] = scored
    .filter((r) => !r.whitelisted && r.total >= PERF_THRESHOLDS.candidateMinSwipes)
    .sort(byRateDesc)
    .map((r) => ({
      ...r,
      tier: r.total >= PERF_THRESHOLDS.promoteMinSwipes ? 'proven' : 'promising',
    }));

  const demote = whitelisted.filter(
    (r) => r.total >= PERF_THRESHOLDS.demoteMinSwipes && (r.likeRate ?? 1) < PERF_THRESHOLDS.demoteMaxLikeRate
  );
  const promote = scored
    .filter(
      (r) =>
        !r.whitelisted &&
        r.total >= PERF_THRESHOLDS.promoteMinSwipes &&
        (r.likeRate ?? 0) >= PERF_THRESHOLDS.promoteMinLikeRate
    )
    .sort(byRateDesc);

  return { whitelisted, candidates, suggestions: { demote, promote } };
}

// Coerce a raw rpc_admin_dh_swipe_performance() row (bigint counts arrive as
// strings over PostgREST) into a typed PerfRow.
export function normalizePerfRow(raw: Record<string, unknown>): PerfRow {
  return {
    userid: String(raw.userid),
    username: (raw.username as string | null) ?? null,
    gender: (raw.gender as string | null) ?? null,
    personality: (raw.personality as string | null) ?? null,
    whitelisted: raw.whitelisted === true,
    likes: Number(raw.likes ?? 0),
    dislikes: Number(raw.dislikes ?? 0),
    total: Number(raw.total ?? 0),
  };
}
