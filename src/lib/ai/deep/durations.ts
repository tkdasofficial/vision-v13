// Deterministic timeline planning for clip generators that only support fixed clip lengths.

/** Returns a clip-length sequence summing exactly to `total`, or null if impossible.
 *  When `count` is given, exactly that many clips are used. Prefers balanced (longer-first) plans. */
export function planDurations(total: number, allowed: number[], count?: number): number[] | null {
  if (!Number.isInteger(total) || total <= 0 || !allowed.length) return null;
  const opts = [...new Set(allowed)].filter((n) => Number.isInteger(n) && n > 0).sort((a, b) => b - a);
  if (count !== undefined) {
    if (count <= 0 || count > 200) return null;
    // memoised search over (remaining, clipsLeft)
    const memo = new Map<string, number[] | null>();
    const go = (rem: number, left: number): number[] | null => {
      if (left === 0) return rem === 0 ? [] : null;
      if (rem < left * opts[opts.length - 1] || rem > left * opts[0]) return null;
      const key = `${rem}:${left}`;
      if (memo.has(key)) return memo.get(key)!;
      let res: number[] | null = null;
      for (const o of opts) { const r = go(rem - o, left - 1); if (r) { res = [o, ...r]; break; } }
      memo.set(key, res);
      return res;
    };
    return go(total, count);
  }
  // fewest clips (classic coin change)
  const best: (number[] | null)[] = Array(total + 1).fill(null);
  best[0] = [];
  for (let s = 1; s <= total; s++) {
    for (const o of opts) {
      const prev = s - o >= 0 ? best[s - o] : null;
      if (prev && (!best[s] || prev.length + 1 < best[s]!.length)) best[s] = [...prev, o];
    }
  }
  return best[total] ? [...best[total]!].sort((a, b) => b - a) : null;
}

/** Nearest achievable totals below and above `total`. */
export function nearestFeasible(total: number, allowed: number[], count?: number): { below: number | null; above: number | null } {
  let below: number | null = null, above: number | null = null;
  for (let d = 1; d <= 60 && (below === null || above === null); d++) {
    if (below === null && total - d > 0 && planDurations(total - d, allowed, count)) below = total - d;
    if (above === null && planDurations(total + d, allowed, count)) above = total + d;
  }
  return { below, above };
}
