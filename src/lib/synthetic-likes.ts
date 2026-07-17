// Synthetic social proof for DIGITAL HUMAN posts — one recipe, used by the
// profile-posts endpoint, the category feed, and the profile stats so every
// surface shows the SAME number for the same post.
//
//   likes(post) = matches × (0.4 .. 2.0)   — the multiplier is a deterministic
//   FNV-1a hash of (postId + dhId), so counts are stable across visits and
//   pagination, scale with real popularity, and vary naturally per post.

export function hash01(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 0) % 10000) / 10000;
}

export function syntheticLikes(postId: string, dhId: string, matches: number): number {
  if (matches <= 0) return 0;
  return Math.floor(matches * (0.4 + 1.6 * hash01(postId + dhId)));
}
