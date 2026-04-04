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
  { rating: 1 as SRSRating, label: 'Hard', ghost: 'bg-error-light text-error hover:bg-error-light',          active: 'bg-error text-white hover:bg-error' },
  { rating: 3 as SRSRating, label: 'Good', ghost: 'bg-warning-light text-warning hover:bg-warning-light', active: 'bg-warning text-white hover:bg-warning' },
  { rating: 5 as SRSRating, label: 'Easy', ghost: 'bg-success-light text-success hover:bg-success-light',    active: 'bg-success text-white hover:bg-success' },
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
          w-full py-2 rounded-[8px] text-sm font-medium transition-colors
          ${isQueued
            ? 'bg-success-light text-success border border-success/30 cursor-default'
            : 'bg-surface text-text-secondary hover:bg-gray-200'
          }
        `}
      >
        {isQueued ? '✓ In drill queue' : '+ Add to drill queue'}
      </button>

      {/* ── SRS rating ── */}
      <div className="space-y-2">
        {suggestedRating !== undefined ? (
          <p className="text-xs text-text-secondary">
            Score: {azureComposite} →{' '}
            <span className="font-semibold">{RATING_LABELS[suggestedRating]}</span>
            <span className="text-text-muted ml-1">(tap to override)</span>
          </p>
        ) : (
          <p className="text-xs text-text-secondary">How did it feel?</p>
        )}

        <div className="flex gap-2">
          {RATINGS.map(({ rating, label, ghost, active }) => (
            <button
              key={rating}
              onClick={() => onRate(rating)}
              className={`flex-1 py-2 rounded-[8px] text-sm font-medium transition-colors ${
                suggestedRating === rating ? active : ghost
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <p className="text-xs text-text-muted text-center">
          This tells the app when to show you this phrase again
        </p>
      </div>

    </div>
  )
}
