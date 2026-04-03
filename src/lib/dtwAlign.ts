// ─── Dynamic Time Warping alignment ──────────────────────────────────────────
//
// Aligns two time series of different lengths/speeds (the user will almost
// certainly speak at a different pace than the native speaker).
//
// Uses Sakoe-Chiba band constraint to limit warping to ±20% of sequence
// length, preventing pathological alignments and reducing complexity.

/** Alignment result */
export interface DTWResult {
  /** Pairs of aligned indices: [nativeIdx, userIdx] */
  path: [number, number][]
  /** Total accumulated distance */
  totalDistance: number
  /** Distance normalized by path length */
  normalizedDistance: number
}

/** Cost for aligning a null (unvoiced) frame with a voiced one */
const UNVOICED_PENALTY = 3.0  // semitones equivalent

/**
 * Align two pitch/energy curves using Dynamic Time Warping.
 * Handles null values (unvoiced frames) with a fixed penalty.
 *
 * @param a - Native speaker's sequence
 * @param b - User's sequence
 * @param bandWidth - Sakoe-Chiba band as fraction of sequence length (default 0.2 = ±20%)
 */
export function dtwAlign(
  a: (number | null)[],
  b: (number | null)[],
  bandWidth = 0.2
): DTWResult {
  const n = a.length
  const m = b.length
  const w = Math.max(Math.round(Math.max(n, m) * bandWidth), 1)

  // Cost matrix (initialized to Infinity)
  const cost: number[][] = Array.from({ length: n + 1 }, () =>
    new Array(m + 1).fill(Infinity)
  )
  cost[0][0] = 0

  for (let i = 1; i <= n; i++) {
    const jMin = Math.max(1, Math.round((i * m) / n) - w)
    const jMax = Math.min(m, Math.round((i * m) / n) + w)

    for (let j = jMin; j <= jMax; j++) {
      const d = pointDistance(a[i - 1], b[j - 1])
      cost[i][j] = d + Math.min(
        cost[i - 1][j],     // insertion
        cost[i][j - 1],     // deletion
        cost[i - 1][j - 1]  // match
      )
    }
  }

  // Backtrack to find optimal path
  const path: [number, number][] = []
  let i = n
  let j = m

  while (i > 0 && j > 0) {
    path.push([i - 1, j - 1])
    const options = [
      { di: -1, dj: -1, cost: cost[i - 1][j - 1] },
      { di: -1, dj: 0, cost: cost[i - 1][j] },
      { di: 0, dj: -1, cost: cost[i][j - 1] },
    ]
    const best = options.reduce((a, b) => (a.cost <= b.cost ? a : b))
    i += best.di
    j += best.dj
  }

  path.reverse()

  const totalDistance = cost[n][m]
  const normalizedDistance = path.length > 0 ? totalDistance / path.length : 0

  return { path, totalDistance, normalizedDistance }
}

/** Distance between two points, handling null (unvoiced) */
function pointDistance(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0
  if (a === null || b === null) return UNVOICED_PENALTY
  return Math.abs(a - b)
}

/**
 * Extract aligned values from two sequences using a DTW path.
 * Returns only the pairs where both values are non-null (voiced).
 */
export function getAlignedValues(
  a: (number | null)[],
  b: (number | null)[],
  path: [number, number][]
): { aValues: number[]; bValues: number[] } {
  const aValues: number[] = []
  const bValues: number[] = []

  for (const [ai, bi] of path) {
    if (a[ai] !== null && b[bi] !== null) {
      aValues.push(a[ai] as number)
      bValues.push(b[bi] as number)
    }
  }

  return { aValues, bValues }
}
