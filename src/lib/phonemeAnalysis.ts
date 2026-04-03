import type { ScoreRecord } from '@/store/useAppStore'

// ─── Phoneme / Word Weakness Analysis ─────────────────────────────────────────
//
// Aggregates per-word accuracy scores across all pronunciation assessment records
// to identify words you consistently struggle with.
//
// Only tracks words that were actually attempted (errorType None or
// Mispronunciation). Omissions (word not said) and Insertions (extra word) are
// excluded — their accuracy of 0 would be noise, not a pronunciation signal.
//
// Trend: compares last-5-attempts avg vs previous-5-attempts avg.
//   improving  → recent avg is 5+ points higher
//   declining  → recent avg is 5+ points lower
//   stable     → within ±5 points (or fewer than 6 total attempts)

export interface WeakWord {
  word: string           // lowercase, normalized
  avgAccuracy: number    // 0-100, all-time average
  attempts: number       // total assessed attempts
  trend: 'improving' | 'stable' | 'declining'
  recentAvg: number      // average of last 5 attempts
}

/**
 * Compute the weakest words from pronunciation history.
 *
 * @param history   - All score records from the store
 * @param minAttempts - Minimum attempts before a word is considered (default 3)
 * @param threshold   - Accuracy below this is considered "weak" (default 75)
 * @param maxWords    - How many weak words to return (default 10)
 */
export function getWeakWords(
  history: ScoreRecord[],
  minAttempts = 3,
  threshold = 75,
  maxWords = 10
): WeakWord[] {
  // Map: normalizedWord → list of accuracy scores (chronological)
  const wordScores: Record<string, number[]> = {}

  for (const record of history) {
    for (const w of record.words) {
      // Skip omissions (word not said) and insertions (not in reference)
      if (w.errorType === 'Omission' || w.errorType === 'Insertion') continue

      // Normalize: lowercase, strip punctuation except apostrophe
      const key = w.word.toLowerCase().replace(/[^a-z']/g, '').trim()
      if (!key) continue

      if (!wordScores[key]) wordScores[key] = []
      wordScores[key].push(w.accuracy)
    }
  }

  const result: WeakWord[] = []

  for (const [word, scores] of Object.entries(wordScores)) {
    if (scores.length < minAttempts) continue

    const avgAccuracy = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
    if (avgAccuracy >= threshold) continue   // good enough — not a weak spot

    // Trend: last 5 vs previous 5
    const recent = scores.slice(-5)
    const older  = scores.slice(-10, -5)

    const recentAvg = Math.round(recent.reduce((a, b) => a + b, 0) / recent.length)
    const olderAvg  = older.length > 0
      ? Math.round(older.reduce((a, b) => a + b, 0) / older.length)
      : recentAvg

    let trend: WeakWord['trend'] = 'stable'
    // Only show a directional trend when there's enough history to compare
    if (older.length >= 3) {
      if (recentAvg >= olderAvg + 5)  trend = 'improving'
      if (recentAvg <= olderAvg - 5)  trend = 'declining'
    }

    result.push({ word, avgAccuracy, attempts: scores.length, trend, recentAvg })
  }

  // Sort worst first, limit to maxWords
  return result
    .sort((a, b) => a.avgAccuracy - b.avgAccuracy)
    .slice(0, maxWords)
}
