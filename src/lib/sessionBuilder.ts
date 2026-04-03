import { getDueToday, getAllQueued } from '@/lib/srs'
import type { DailySession, SavedVideo } from '@/store/useAppStore'
import type { Phrase } from '@/types'

// ─── Session Builder ───────────────────────────────────────────────────────────
//
// Builds a daily practice session mixing:
//   - Review phrases: due today in SRS (max 8)
//   - New phrases: unpracticed, selected from the saved video library
//
// Target: ~15 minutes per session (1.5 min/phrase estimate)

const MINUTES_PER_PHRASE = 1.5
const MAX_REVIEW = 8

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/**
 * Pick unpracticed phrases from the library at the target difficulty level.
 * Falls back to any unpracticed phrase if not enough match the level.
 */
function selectNewPhrases(
  library: SavedVideo[],
  count: number,
  level: 'easy' | 'medium' | 'hard'
): Phrase[] {
  // Build set of already-practiced phrase IDs (in SRS queue)
  const practiced = new Set(getAllQueued().map((e) => e.phraseId))

  // All phrases from all saved videos that haven't been practiced yet
  const unpracticed = library.flatMap((v) => v.phrases).filter((p) => !practiced.has(p.id))

  // Prefer phrases matching the target difficulty
  const levelMatch = shuffle(unpracticed.filter((p) => p.difficulty?.overall === level))
  const result = levelMatch.slice(0, count)

  // Fill remaining slots with any unpracticed phrase
  if (result.length < count) {
    const others = shuffle(unpracticed.filter((p) => p.difficulty?.overall !== level))
    result.push(...others.slice(0, count - result.length))
  }

  return result
}

/** Build a daily practice session for the given library. */
export function buildDailySession(
  library: SavedVideo[],
  targetMinutes = 15,
  level: 'easy' | 'medium' | 'hard' = 'easy',
): DailySession {
  const due = getDueToday()
  const reviewPhrases = due.slice(0, MAX_REVIEW)

  const reviewMinutes = reviewPhrases.length * MINUTES_PER_PHRASE
  const remainingMinutes = Math.max(0, targetMinutes - reviewMinutes)
  const newCount = Math.max(3, Math.floor(remainingMinutes / MINUTES_PER_PHRASE))

  const newPhrases = selectNewPhrases(library, newCount, level)

  return {
    id: `session-${Date.now()}`,
    date: todayStr(),
    reviewPhrases,
    newPhrases,
    completed: [],
    startedAt: null,
    completedAt: null,
  }
}

/** Estimated session duration in minutes (rounded). */
export function estimateMinutes(session: DailySession): number {
  return Math.round((session.reviewPhrases.length + session.newPhrases.length) * MINUTES_PER_PHRASE)
}
