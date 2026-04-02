import { ProgressData, SessionRecord } from '@/types'

// ─── Progress tracking (localStorage) ─────────────────────────────────────────
//
// Tracks:
//   - Sessions (date + phrases drilled + videos used)
//   - Streak (consecutive days with at least one phrase drilled)
//   - Last active date

const STORAGE_KEY = 'shadowing_progress'

function today(): string {
  // Use local date (not UTC) so streaks don't break for users in UTC-N timezones
  const d = new Date()
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function loadProgress(): ProgressData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return { sessions: [], streak: 0, lastActiveDate: null }
}

function saveProgress(data: ProgressData): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch (err) {
    if (err instanceof DOMException && err.name === 'QuotaExceededError') {
      window.dispatchEvent(new CustomEvent('srs:storage-full'))
    }
  }
}

// ─── Streak calculation ────────────────────────────────────────────────────────
//
// Streak = consecutive days with at least one session.
// If last active was today or yesterday → streak is maintained.
// If last active was 2+ days ago → streak resets to 1.

export function calculateStreak(sessions: SessionRecord[]): number {
  if (!sessions.length) return 0

  // Sort sessions by date descending
  const dates = [...new Set(sessions.map((s) => s.date))].sort().reverse()
  if (!dates.length) return 0

  const todayStr = today()

  // If most recent session is older than yesterday, streak is broken
  const mostRecent = dates[0]
  const daysDiff = Math.floor(
    (new Date(todayStr).getTime() - new Date(mostRecent).getTime()) / 86400000
  )
  if (daysDiff > 1) return 0

  // Count consecutive days
  let streak = 1
  for (let i = 0; i < dates.length - 1; i++) {
    const curr = new Date(dates[i])
    const prev = new Date(dates[i + 1])
    const diff = Math.floor((curr.getTime() - prev.getTime()) / 86400000)
    if (diff === 1) streak++
    else break
  }
  return streak
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Record that the user drilled a phrase during this session */
export function recordPhraseSession(videoId: string): void {
  const data = loadProgress()
  const todayStr = today()

  const existingSession = data.sessions.find((s) => s.date === todayStr)
  if (existingSession) {
    existingSession.phrasesCount += 1
    if (!existingSession.videosUsed.includes(videoId)) {
      existingSession.videosUsed.push(videoId)
    }
  } else {
    data.sessions.push({ date: todayStr, phrasesCount: 1, videosUsed: [videoId] })
  }

  data.streak = calculateStreak(data.sessions)
  data.lastActiveDate = todayStr

  saveProgress(data)
}

/** Get current progress data */
export function getProgress(): ProgressData {
  return loadProgress()
}

/** Export progress as JSON */
export function exportProgress(): string {
  return JSON.stringify(loadProgress(), null, 2)
}

/** Get the last 30 days of activity for the heatmap */
export function getLast30Days(): { date: string; count: number }[] {
  const sessions = loadProgress().sessions
  const result: { date: string; count: number }[] = []

  for (let i = 29; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const year = d.getFullYear()
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    const dateStr = `${year}-${month}-${day}`
    const session = sessions.find((s) => s.date === dateStr)
    result.push({ date: dateStr, count: session?.phrasesCount ?? 0 })
  }

  return result
}
