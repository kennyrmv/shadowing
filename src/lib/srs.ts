import { SRSEntry, SRSRating, Phrase } from '@/types'

// ─── SM-2 Spaced Repetition Algorithm ─────────────────────────────────────────
//
// SM-2 by Piotr Wozniak (1987). Public domain.
//
// How it works:
//   - Each phrase has an "ease factor" (starts at 2.5)
//   - After each review, you rate it: Hard (1), Good (3), Easy (5)
//   - The algorithm calculates when you should see it next:
//     · Hard → back to tomorrow (interval resets)
//     · Good → interval grows normally
//     · Easy → interval grows faster
//   - easeFactor never drops below 1.3 (prevents ultra-short intervals)

const EASE_FACTOR_MIN = 1.3
const EASE_FACTOR_DEFAULT = 2.5
const STORAGE_KEY = 'shadowing_srs'

// ─── Date helpers ──────────────────────────────────────────────────────────────
function today(): string {
  // Use local date (not UTC) so due dates don't shift for users in UTC-N timezones
  const d = new Date()
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function addDays(dateStr: string, days: number): string {
  // Parse as local date (append T00:00 so JS doesn't shift to UTC)
  const d = new Date(`${dateStr}T00:00:00`)
  d.setDate(d.getDate() + days)
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

// ─── localStorage helpers ──────────────────────────────────────────────────────
function loadAllEntries(): Record<string, SRSEntry> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function saveAllEntries(entries: Record<string, SRSEntry>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  } catch (err) {
    // QuotaExceededError — storage full
    if (err instanceof DOMException && err.name === 'QuotaExceededError') {
      console.warn('[SRS] localStorage full. Export your data to free up space.')
      // Dispatch a custom event so the UI can show a banner
      window.dispatchEvent(new CustomEvent('srs:storage-full'))
    }
  }
}

// ─── SM-2 update ──────────────────────────────────────────────────────────────
export function updateSM2(entry: SRSEntry, quality: SRSRating): SRSEntry {
  let { interval, repetitions, easeFactor } = entry

  if (quality < 3) {
    // Hard — reset: see it again tomorrow
    interval = 1
    repetitions = 0
  } else {
    // Good or Easy
    if (repetitions === 0) interval = 1
    else if (repetitions === 1) interval = 6
    else interval = Math.round(interval * easeFactor)
    repetitions += 1
  }

  // Update ease factor: EF' = EF + (0.1 - (5-q) * (0.08 + (5-q) * 0.02))
  easeFactor = easeFactor + 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)
  easeFactor = Math.max(EASE_FACTOR_MIN, easeFactor)

  return {
    ...entry,
    interval,
    repetitions,
    easeFactor,
    dueDate: addDays(today(), interval),
    lastReviewed: today(),
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Add a phrase to the SRS queue (or reset it if already exists) */
export function addToQueue(phrase: Phrase, videoId: string): void {
  const entries = loadAllEntries()
  if (entries[phrase.id]) return  // already queued, don't overwrite
  entries[phrase.id] = {
    phraseId: phrase.id,
    phraseText: phrase.text,
    videoId,
    interval: 1,
    repetitions: 0,
    easeFactor: EASE_FACTOR_DEFAULT,
    dueDate: today(),
    lastReviewed: '',
  }
  saveAllEntries(entries)
}

/** Rate a phrase after practicing it */
export function ratePhrase(phraseId: string, quality: SRSRating): void {
  const entries = loadAllEntries()
  const entry = entries[phraseId]
  if (!entry) return
  entries[phraseId] = updateSM2(entry, quality)
  saveAllEntries(entries)
}

/** Get all phrases due for review today */
export function getDueToday(): SRSEntry[] {
  const entries = loadAllEntries()
  const todayStr = today()
  return Object.values(entries).filter((e) => e.dueDate <= todayStr)
}

/** Get all queued phrases */
export function getAllQueued(): SRSEntry[] {
  return Object.values(loadAllEntries())
}

/** Check if a phrase is in the queue */
export function isQueued(phraseId: string): boolean {
  return phraseId in loadAllEntries()
}

/** Remove a phrase from the queue */
export function removeFromQueue(phraseId: string): void {
  const entries = loadAllEntries()
  delete entries[phraseId]
  saveAllEntries(entries)
}

/** Export all SRS data as a JSON string (for user backup) */
export function exportData(): string {
  return JSON.stringify(loadAllEntries(), null, 2)
}
