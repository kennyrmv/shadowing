'use client'

// ─── PhraseRecorder ────────────────────────────────────────────────────────────
//
// Shows two actions for the active phrase:
//   1. Add to drill queue (SRS)
//   2. Rate it (Hard / Good / Easy) — highlighted automatically when Azure
//      has assessed the phrase (suggestedRating prop); otherwise shows
//      a plain "How did it feel?" prompt for manual self-rating.
//
// Recording was removed: PronunciationAssessor handles audio capture + Azure
// scoring, and its onScoreReady callback flows up to PhrasePlayer which
// passes the suggested rating down here.

import { SRSRating } from '@/types'

interface Props {
  onRate: (rating: SRSRating) => void
  isQueued: boolean
  onAddToQueue: () => void
  suggestedRating?: SRSRating   // auto-filled from Azure assessment
  azureComposite?: number        // shown in the hint label
}

const RATINGS = [
  { rating: 1 as SRSRating, label: 'Hard', ghost: 'bg-red-100 text-red-700 hover:bg-red-200',          active: 'bg-red-500 text-white hover:bg-red-600' },
  { rating: 3 as SRSRating, label: 'Good', ghost: 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200', active: 'bg-yellow-500 text-white hover:bg-yellow-600' },
  { rating: 5 as SRSRating, label: 'Easy', ghost: 'bg-green-100 text-green-700 hover:bg-green-200',    active: 'bg-green-500 text-white hover:bg-green-600' },
] as const

const RATING_LABELS: Record<SRSRating, string> = { 1: 'Hard', 3: 'Good', 5: 'Easy' }

export default function PhraseRecorder({ onRate, isQueued, onAddToQueue, suggestedRating, azureComposite }: Props) {
  return (
    <div className="space-y-3">

      {/* ── Add to drill queue ── */}
      <button
        onClick={onAddToQueue}
        disabled={isQueued}
        className={`
          w-full py-2 rounded-lg text-sm font-medium transition-colors
          ${isQueued
            ? 'bg-green-50 text-green-600 border border-green-200 cursor-default'
            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }
        `}
      >
        {isQueued ? '✓ In drill queue' : '+ Add to drill queue'}
      </button>

      {/* ── SRS rating ── */}
      <div className="space-y-2">
        {suggestedRating !== undefined ? (
          <p className="text-xs text-gray-500">
            Score: {azureComposite} →{' '}
            <span className="font-semibold">{RATING_LABELS[suggestedRating]}</span>
            <span className="text-gray-300 ml-1">(tap to override)</span>
          </p>
        ) : (
          <p className="text-xs text-gray-500">How did it feel?</p>
        )}

        <div className="flex gap-2">
          {RATINGS.map(({ rating, label, ghost, active }) => (
            <button
              key={rating}
              onClick={() => onRate(rating)}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                suggestedRating === rating ? active : ghost
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <p className="text-xs text-gray-300 text-center">
          This tells the app when to show you this phrase again
        </p>
      </div>

    </div>
  )
}
