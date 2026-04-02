import { Phrase } from '@/types'

interface RawCaption {
  text: string
  offset: number   // milliseconds
  duration: number // milliseconds
}

function makePhraseId(videoId: string, startSec: number, index: number): string {
  return `${videoId}:${Math.round(startSec * 10)}-${index}`
}

// Target phrase length for comfortable shadowing
const MIN_DURATION_MS = 3500   // never flush below 3.5 seconds
const TARGET_DURATION_MS = 6000 // prefer to flush around 6 seconds
const MAX_DURATION_MS = 12000   // always flush at 12 seconds
const MAX_WORDS = 30

const ABBREV_RE = /(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|vs|etc|e\.g|i\.e|U\.S|U\.K|approx)\.$/i

// ─── Deduplicate rolling YouTube captions ─────────────────────────────────────
function deduplicateCaptions(captions: RawCaption[]): RawCaption[] {
  if (captions.length <= 1) return captions
  const result: RawCaption[] = [captions[0]]
  for (let i = 1; i < captions.length; i++) {
    const prev = result[result.length - 1]
    const curr = captions[i]
    const prevWords = prev.text.trim().split(/\s+/)
    const currWords = curr.text.trim().split(/\s+/)
    let overlapLen = 0
    const maxCheck = Math.min(prevWords.length, currWords.length, 12)
    for (let n = maxCheck; n >= 1; n--) {
      if (prevWords.slice(-n).join(' ').toLowerCase() === currWords.slice(0, n).join(' ').toLowerCase()) {
        overlapLen = n
        break
      }
    }
    if (overlapLen > 0) {
      const newText = currWords.slice(overlapLen).join(' ').trim()
      if (newText) result.push({ ...curr, text: newText })
    } else {
      result.push(curr)
    }
  }
  return result
}

function endsWithSentence(text: string): boolean {
  const trimmed = text.trimEnd()
  if (!/[.!?]$/.test(trimmed)) return false
  // Don't count abbreviations as sentence ends
  const lastWord = trimmed.split(/\s+/).pop() ?? ''
  return !ABBREV_RE.test(lastWord)
}

// ─── Main segmentation ────────────────────────────────────────────────────────
//
// Strategy: accumulate captions into a buffer until we reach a good stopping
// point. A "good stopping point" is:
//   1. The buffer duration >= TARGET_DURATION and the last caption ends a sentence
//   2. The buffer duration >= MAX_DURATION (force-flush regardless)
//   3. The buffer word count >= MAX_WORDS (force-flush regardless)
//
// This produces consistently sized phrases (5-10s) that are always complete
// thoughts, avoiding both 3-word fragments and 30-second walls of text.
export function segmentPhrases(captions: RawCaption[], videoId: string): Phrase[] {
  if (!captions.length) return []

  const clean = deduplicateCaptions(captions)
    .map((c) => ({ ...c, text: c.text.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim() }))
    .filter((c) => c.text.length > 0)

  if (!clean.length) return []

  const phrases: Phrase[] = []
  let buffer: typeof clean = []
  let phraseIndex = 0

  function flush() {
    if (!buffer.length) return
    const text = buffer.map((c) => c.text).join(' ').trim()
    if (!text) { buffer = []; return }
    const startSec = buffer[0].offset / 1000
    const endMs = buffer[buffer.length - 1].offset + buffer[buffer.length - 1].duration
    const duration = Math.max((endMs - buffer[0].offset) / 1000, 0.5)
    phrases.push({
      id: makePhraseId(videoId, startSec, phraseIndex++),
      text,
      startTime: startSec,
      duration,
      wordCount: text.split(/\s+/).filter(Boolean).length,
    })
    buffer = []
  }

  for (const cap of clean) {
    buffer.push(cap)

    const bufferStartMs = buffer[0].offset
    const bufferEndMs = cap.offset + cap.duration
    const durationMs = bufferEndMs - bufferStartMs
    const wordCount = buffer.map((c) => c.text).join(' ').split(/\s+/).filter(Boolean).length
    const text = buffer.map((c) => c.text).join(' ')

    if (durationMs >= MAX_DURATION_MS || wordCount >= MAX_WORDS) {
      // Hard limit — flush regardless
      flush()
    } else if (durationMs >= TARGET_DURATION_MS && endsWithSentence(text)) {
      // Good natural break point
      flush()
    } else if (durationMs >= MIN_DURATION_MS && endsWithSentence(text) && durationMs >= TARGET_DURATION_MS * 0.75) {
      // Slightly below target but ends cleanly — flush
      flush()
    }
    // Otherwise keep accumulating
  }

  // Flush any remaining captions
  flush()

  // Merge any remaining very short phrases into the previous
  const merged: Phrase[] = []
  for (const phrase of phrases) {
    if (phrase.duration < 2 && merged.length > 0) {
      const prev = merged[merged.length - 1]
      prev.text += ' ' + phrase.text
      prev.wordCount += phrase.wordCount
      prev.duration = phrase.startTime + phrase.duration - prev.startTime
    } else {
      merged.push(phrase)
    }
  }

  // Trim each phrase to end exactly where the next one starts.
  // This eliminates audio overlap between consecutive phrases.
  for (let i = 0; i < merged.length - 1; i++) {
    const gap = merged[i + 1].startTime - merged[i].startTime
    if (gap > 0) merged[i].duration = gap
  }

  return merged
}
