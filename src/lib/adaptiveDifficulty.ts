// ─── Adaptive Difficulty ───────────────────────────────────────────────────────
//
// Analyses the user's score history against their library to:
//   1. Detect which difficulty level they've mostly been practising (last 50 records)
//   2. Compute their average composite score at that level
//   3. Flag when they're ready to level up (avg ≥ 85, min 5 attempts)
//
// Used by DailyPractice to bias session building toward the right difficulty
// and to surface a "ready to level up?" recommendation.

import type { ScoreRecord, SavedVideo } from '@/store/useAppStore'
import { compositeScore } from '@/lib/autoRate'

export type Level = 'easy' | 'medium' | 'hard'

const LEVEL_ORDER: Level[] = ['easy', 'medium', 'hard']

const MIN_ATTEMPTS = 5    // need at least this many assessed phrases
const PASS_THRESHOLD = 85 // avg composite score to be considered "mastered"
const RECENT_WINDOW = 50  // look at the last N assessments

export interface LevelReport {
  /** Difficulty level the user has been practising most in recent history */
  currentLevel: Level
  /** Average composite score for phrases at that level (null = no data yet) */
  avgComposite: number | null
  /** Number of assessed attempts at the current level within the recent window */
  attempts: number
  /** true when avgComposite ≥ 85 and attempts ≥ 5 — time to level up */
  readyToProgress: boolean
  /** Next difficulty tier, or null if already at 'hard' */
  nextLevel: Level | null
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function buildDiffMap(savedVideos: SavedVideo[]): Map<string, Level> {
  const map = new Map<string, Level>()
  for (const v of savedVideos) {
    for (const p of v.phrases) {
      const d = p.difficulty?.overall
      if (d === 'easy' || d === 'medium' || d === 'hard') {
        map.set(p.id, d)
      }
    }
  }
  return map
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Determine the user's current difficulty level and whether they're ready
 * to move up, based on their recent score history and the video library.
 *
 * Returns a stable default (easy, no data) when history is empty.
 */
export function getLevelReport(
  scoreHistory: ScoreRecord[],
  savedVideos: SavedVideo[],
): LevelReport {
  const diffMap = buildDiffMap(savedVideos)

  // Bucket composite scores from the last RECENT_WINDOW assessments by level
  const recent = scoreHistory.slice(-RECENT_WINDOW)
  const byLevel: Record<Level, number[]> = { easy: [], medium: [], hard: [] }

  for (const r of recent) {
    const level = diffMap.get(r.phraseId)
    if (!level) continue
    byLevel[level].push(
      compositeScore({ accuracy: r.accuracy, fluency: r.fluency, completeness: r.completeness }),
    )
  }

  // Dominant level = the one with the most attempts in recent history
  let currentLevel: Level = 'easy'
  let maxAttempts = 0
  for (const level of LEVEL_ORDER) {
    if (byLevel[level].length > maxAttempts) {
      maxAttempts = byLevel[level].length
      currentLevel = level
    }
  }

  const scores = byLevel[currentLevel]
  const avgComposite =
    scores.length > 0
      ? Math.round(scores.reduce((sum, n) => sum + n, 0) / scores.length)
      : null

  const readyToProgress =
    scores.length >= MIN_ATTEMPTS &&
    avgComposite !== null &&
    avgComposite >= PASS_THRESHOLD

  const levelIdx = LEVEL_ORDER.indexOf(currentLevel)
  const nextLevel: Level | null =
    levelIdx < LEVEL_ORDER.length - 1 ? LEVEL_ORDER[levelIdx + 1] : null

  return {
    currentLevel,
    avgComposite,
    attempts: scores.length,
    readyToProgress,
    nextLevel,
  }
}
