'use client'

// ─── PracticePhaseView ─────────────────────────────────────────────────────────
//
// Multi-phase practice loop for a single phrase:
//
//   Phase 1 · Listen         — just hear the rhythm once (text hidden)
//   Phase 2 · Shadow         — shadow without text, 2 loops
//   Phase 3 · Shadow + text  — shadow with text visible, 2 loops
//   Phase 4 · Assess         — record via PronunciationAssessor + SRS rating
//
// Review phrases (isReview=true) start at Phase 3.
// New phrases start at Phase 1.
//
// Loop counting: polling every 100ms checks currentTime >= phrase.endTime.
// After target loops: "Next phase →" button appears (user-controlled advance).
// Text visibility transitions with CSS opacity (text stays in DOM but invisible).
// Phase guard: check phaseRef (not reactive state) inside interval callback.

import { useState, useRef, useEffect, useCallback } from 'react'
import YouTubePlayer from './YouTubePlayer'
import type { YouTubePlayerRef } from './YouTubePlayer'
import PronunciationAssessor from './PronunciationAssessor'
import { azureToSRS, compositeScore } from '@/lib/autoRate'
import type { AzureScores } from '@/lib/autoRate'
import type { SRSRating } from '@/types'

// ─── Types (exported so DailyPractice can use the same shape) ──────────────────

export interface PracticeItem {
  phraseId: string
  phraseText: string
  videoId: string
  startTime: number
  duration: number
  isReview: boolean
}

interface Props {
  item: PracticeItem
  onComplete: (rating: SRSRating, scores?: AzureScores) => void
  onSkip: () => void
}

// ─── Phase config ─────────────────────────────────────────────────────────────

type Phase = 'listen' | 'shadow-no-text' | 'shadow-with-text' | 'assess'

const PHASES: Phase[] = ['listen', 'shadow-no-text', 'shadow-with-text', 'assess']

const PHASE_CONFIG: Record<Phase, {
  label: string
  subLabel: string
  targetLoops: number
  showText: boolean
}> = {
  'listen':           { label: 'Listen',          subLabel: 'Just listen — focus on rhythm and intonation', targetLoops: 1, showText: false },
  'shadow-no-text':   { label: 'Shadow',           subLabel: 'Speak along without reading',                  targetLoops: 2, showText: false },
  'shadow-with-text': { label: 'Shadow with text', subLabel: 'Read and speak at the same time',              targetLoops: 2, showText: true  },
  'assess':           { label: 'Assess',           subLabel: 'Record yourself and get pronunciation feedback', targetLoops: 0, showText: true  },
}

// ─── SRS rating buttons ───────────────────────────────────────────────────────

const RATINGS = [
  { rating: 1 as SRSRating, label: 'Hard', ghost: 'bg-error-light text-error hover:bg-red-200',          active: 'bg-error text-white' },
  { rating: 3 as SRSRating, label: 'Good', ghost: 'bg-warning-light text-warning hover:bg-yellow-200', active: 'bg-warning text-white' },
  { rating: 5 as SRSRating, label: 'Easy', ghost: 'bg-success-light text-success hover:bg-green-200',    active: 'bg-success text-white' },
] as const

const RATING_LABELS: Record<SRSRating, string> = { 1: 'Hard', 3: 'Good', 5: 'Easy' }

// ─── Component ────────────────────────────────────────────────────────────────

export default function PracticePhaseView({ item, onComplete, onSkip }: Props) {
  const startPhase: Phase = item.isReview ? 'shadow-with-text' : 'listen'
  const startIdx = PHASES.indexOf(startPhase)

  const [phase, setPhase] = useState<Phase>(startPhase)
  const [loopCount, setLoopCount] = useState(0)
  const [playerReady, setPlayerReady] = useState(false)
  const [lastAzureScores, setLastAzureScores] = useState<AzureScores | null>(null)

  const playerRef  = useRef<YouTubePlayerRef>(null)
  const phaseRef   = useRef<Phase>(startPhase)
  const loopFired  = useRef(false)
  const intervalId = useRef<ReturnType<typeof setInterval> | null>(null)

  // Keep phaseRef in sync so the interval closure always has the current phase
  useEffect(() => { phaseRef.current = phase }, [phase])

  // Start/stop loop polling based on phase and player readiness
  useEffect(() => {
    if (!playerReady || phase === 'assess') {
      if (intervalId.current) { clearInterval(intervalId.current); intervalId.current = null }
      return
    }

    const endTime = item.startTime + item.duration
    loopFired.current = false

    if (intervalId.current) clearInterval(intervalId.current)

    intervalId.current = setInterval(() => {
      // Guard: stop if we've moved to assess (phaseRef is updated synchronously)
      if (phaseRef.current === 'assess') return

      const current = playerRef.current?.getCurrentTime() ?? 0

      // Reset guard once player has seeked back past the midpoint
      if (loopFired.current && current < endTime - 0.5) {
        loopFired.current = false
      }

      if (current >= endTime - 0.1 && !loopFired.current) {
        loopFired.current = true
        setLoopCount((n) => n + 1)
        // Short visual gap before seeking back
        setTimeout(() => {
          if (phaseRef.current !== 'assess') {
            playerRef.current?.seekTo(item.startTime)
          }
        }, 350)
      }
    }, 100)

    return () => {
      if (intervalId.current) { clearInterval(intervalId.current); intervalId.current = null }
    }
  }, [playerReady, phase, item.startTime, item.duration])

  // When player is ready: seek to phrase start and begin playing
  const handlePlayerReady = useCallback(() => {
    setPlayerReady(true)
    playerRef.current?.seekTo(item.startTime)   // seekTo also calls playVideo internally
  }, [item.startTime])

  // Advance to the next phase in sequence
  const advancePhase = useCallback(() => {
    const currentIdx = PHASES.indexOf(phaseRef.current)
    const nextPhase  = PHASES[currentIdx + 1]
    if (!nextPhase) return

    setPhase(nextPhase)
    phaseRef.current = nextPhase
    setLoopCount(0)
    loopFired.current = false

    if (nextPhase === 'assess') {
      playerRef.current?.pause()
    } else {
      playerRef.current?.seekTo(item.startTime)
    }
  }, [item.startTime])

  // Jump straight to assess (skip remaining loop phases)
  const skipToAssess = useCallback(() => {
    setPhase('assess')
    phaseRef.current = 'assess'
    setLoopCount(0)
    loopFired.current = false
    playerRef.current?.pause()
  }, [])

  // ─── Derived display values ──────────────────────────────────────────────────

  const config       = PHASE_CONFIG[phase]
  const currentIdx   = PHASES.indexOf(phase)
  const loopsReady   = config.targetLoops > 0 && loopCount >= config.targetLoops
  const visiblePhases = PHASES.slice(startIdx)          // dot indicators

  const suggestedRating = lastAzureScores ? azureToSRS(lastAzureScores) : undefined
  const composite       = lastAzureScores ? compositeScore(lastAzureScores) : undefined

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="bg-bg border border-border rounded-[12px] overflow-hidden">

      {/* ── Phase indicator bar ── */}
      <div className="px-5 py-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          {visiblePhases.map((p, i) => {
            const absIdx = startIdx + i
            const done   = absIdx < currentIdx
            const active = absIdx === currentIdx
            return (
              <div
                key={p}
                className={`w-2 h-2 rounded-full transition-colors duration-300 ${
                  done ? 'bg-primary/40' : active ? 'bg-primary' : 'bg-border'
                }`}
              />
            )
          })}
          <span className="text-xs font-medium text-text-secondary ml-1">{config.label}</span>
        </div>
        <button
          onClick={onSkip}
          className="text-xs text-text-muted hover:text-text-secondary transition-colors"
        >
          Skip phrase
        </button>
      </div>

      <div className="p-5 space-y-4">

        {/* ── Video player ── */}
        {item.videoId && (
          <YouTubePlayer
            ref={playerRef}
            videoId={item.videoId}
            onReady={handlePlayerReady}
          />
        )}

        {/* ── Sub-label ── */}
        <p className="text-xs text-text-muted">{config.subLabel}</p>

        {/* ── Phrase text — CSS opacity fade, stays in DOM ── */}
        <p
          aria-hidden={!config.showText}
          className={`text-text text-lg leading-relaxed transition-opacity duration-500 select-none ${
            config.showText ? 'opacity-100' : 'opacity-0'
          }`}
        >
          {item.phraseText}
        </p>

        {/* ── Loop progress dots (phases with 2 target loops) ── */}
        {phase !== 'assess' && config.targetLoops > 1 && (
          <div className="flex items-center gap-2">
            {Array.from({ length: config.targetLoops }).map((_, i) => (
              <div
                key={i}
                className={`w-2.5 h-2.5 rounded-full transition-colors ${
                  i < loopCount ? 'bg-primary' : 'bg-border'
                }`}
              />
            ))}
            <span className="text-xs text-text-muted">
              {loopsReady ? 'Ready!' : `${Math.min(loopCount, config.targetLoops)}/${config.targetLoops} loops`}
            </span>
          </div>
        )}

        {/* ── Phase action buttons (phases 1-3) ── */}
        {phase !== 'assess' && (
          <div className="flex gap-2">
            {loopsReady ? (
              <button
                onClick={advancePhase}
                className="flex-1 py-2.5 bg-primary text-white rounded-[12px] text-sm font-semibold hover:bg-primary-dark transition-colors"
              >
                Next phase →
              </button>
            ) : (
              <button
                onClick={skipToAssess}
                className="flex-1 py-2.5 bg-surface text-text-secondary rounded-[12px] text-sm hover:bg-surface transition-colors"
              >
                Skip to assess →
              </button>
            )}
          </div>
        )}

        {/* ── Assess phase ── */}
        {phase === 'assess' && (
          <div className="space-y-4">
            <PronunciationAssessor
              phraseText={item.phraseText}
              phraseId={item.phraseId}
              videoId={item.videoId}
              onScoreReady={setLastAzureScores}
            />

            {/* SRS rating */}
            <div className="border-t border-border pt-3 space-y-2">
              {suggestedRating !== undefined ? (
                <p className="text-xs text-text-secondary">
                  Score: {composite} →{' '}
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
                    onClick={() => onComplete(rating, lastAzureScores ?? undefined)}
                    className={`flex-1 py-2.5 rounded-[12px] text-sm font-medium transition-colors ${
                      suggestedRating === rating ? active : ghost
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-text-muted text-center">
                This updates your spaced repetition schedule
              </p>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
