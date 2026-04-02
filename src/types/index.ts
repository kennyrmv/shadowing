// ─── Core data types for the shadowing platform ───────────────────────────────

/** A single phrase/sentence extracted from a YouTube video transcript */
export interface Phrase {
  id: string            // hash of videoId:startTime (e.g. "abc123:134")
  text: string          // the spoken words
  startTime: number     // seconds from the start of the video
  duration: number      // how long this phrase lasts (seconds)
  wordCount: number     // number of words (used for WPM scoring)
  difficulty?: DifficultyScore
}

/** Difficulty score for a phrase */
export interface DifficultyScore {
  wpm: number           // words per minute speaking speed
  vocabScore: number    // 0–1, based on CEFR word frequency
  phonemeScore: number  // 0–1, syllables per second
  overall: 'easy' | 'medium' | 'hard'
  normalized: number    // 0–1 final weighted score
}

/** The full result of loading a YouTube video's transcript */
export interface VideoTranscript {
  videoId: string
  title?: string
  phrases: Phrase[]
}

/** Spaced repetition data for a single phrase (SM-2 algorithm) */
export interface SRSEntry {
  phraseId: string
  phraseText: string
  videoId: string
  interval: number      // days until next review
  repetitions: number   // how many times reviewed successfully
  easeFactor: number    // SM-2 ease factor (min 1.3)
  dueDate: string       // ISO date string (YYYY-MM-DD)
  lastReviewed: string  // ISO date string
}

/** A single practice session record */
export interface SessionRecord {
  date: string          // ISO date string (YYYY-MM-DD)
  phrasesCount: number  // how many phrases drilled
  videosUsed: string[]  // videoIds accessed
}

/** All user progress stored in localStorage */
export interface ProgressData {
  sessions: SessionRecord[]
  streak: number
  lastActiveDate: string | null
}

/** SM-2 quality rating (maps to button labels) */
export type SRSRating = 1 | 3 | 5  // Hard | Good | Easy

/** Loop state for the player */
export type LoopState = 'idle' | 'playing' | 'paused'
