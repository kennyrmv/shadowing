'use client'

// ─── DailyPractice ─────────────────────────────────────────────────────────────
//
// Auto-generated daily practice session: review phrases due in SRS + new
// phrases from the saved video library.
//
// View states:
//   empty    → library has no videos yet
//   summary  → shows session preview (X review + Y new · ~Z min) + Start button
//   practice → one phrase at a time: text · YouTube link · assess · rate
//   done     → session complete screen

import { useState, useMemo, useCallback, useEffect } from 'react'
import { useAppStore } from '@/store/useAppStore'
import { buildDailySession, estimateMinutes } from '@/lib/sessionBuilder'
import { addToQueue, ratePhrase } from '@/lib/srs'
import { recordPhraseSession } from '@/lib/progress'
import { azureToSRS, compositeScore } from '@/lib/autoRate'
import type { AzureScores } from '@/lib/autoRate'
import PronunciationAssessor from '@/components/PronunciationAssessor'
import type { SRSRating } from '@/types'

// ─── Types ────────────────────────────────────────────────────────────────────

type View = 'empty' | 'summary' | 'practice' | 'done'

type PracticeItem = {
  phraseId: string
  phraseText: string
  videoId: string
  isReview: boolean
}

// ─── Rating button config ────────────────────────────────────────────────────

const RATINGS = [
  { rating: 1 as SRSRating, label: 'Hard', ghost: 'bg-red-100 text-red-700 hover:bg-red-200',     active: 'bg-red-500 text-white' },
  { rating: 3 as SRSRating, label: 'Good', ghost: 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200', active: 'bg-yellow-500 text-white' },
  { rating: 5 as SRSRating, label: 'Easy', ghost: 'bg-green-100 text-green-700 hover:bg-green-200',  active: 'bg-green-500 text-white' },
] as const

const RATING_LABELS: Record<SRSRating, string> = { 1: 'Hard', 3: 'Good', 5: 'Easy' }

// ─── Component ────────────────────────────────────────────────────────────────

export default function DailyPractice() {
  const savedVideos   = useAppStore((s) => s.savedVideos)
  const dailySession  = useAppStore((s) => s.dailySession)
  const setDailySession    = useAppStore((s) => s.setDailySession)
  const markPhraseCompleted = useAppStore((s) => s.markPhraseCompleted)

  const [view, setView]         = useState<View>(savedVideos.length === 0 ? 'empty' : 'summary')
  const [currentIndex, setCurrentIndex] = useState(0)
  const [lastAzureScores, setLastAzureScores] = useState<AzureScores | null>(null)
  const [previewSession, setPreviewSession] = useState(() =>
    savedVideos.length > 0 ? buildDailySession(savedVideos) : null
  )

  // Rebuild preview when library changes (e.g. user adds a video in another tab)
  useEffect(() => {
    if (savedVideos.length > 0) {
      setPreviewSession(buildDailySession(savedVideos))
      if (view === 'empty') setView('summary')
    }
  }, [savedVideos.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // Flat ordered list: review first, then new
  const items = useMemo<PracticeItem[]>(() => {
    if (!dailySession) return []

    const reviewItems: PracticeItem[] = dailySession.reviewPhrases.map((e) => ({
      phraseId: e.phraseId,
      phraseText: e.phraseText,
      videoId: e.videoId,
      isReview: true,
    }))

    const newItems: PracticeItem[] = dailySession.newPhrases.map((p) => {
      const video = savedVideos.find((v) => v.phrases.some((ph) => ph.id === p.id))
      return {
        phraseId: p.id,
        phraseText: p.text,
        videoId: video?.videoId ?? '',
        isReview: false,
      }
    })

    return [...reviewItems, ...newItems]
  }, [dailySession, savedVideos])

  const currentItem = items[currentIndex]
  const total = items.length

  // ─── Actions ────────────────────────────────────────────────────────────────

  function handleStart() {
    const session = buildDailySession(savedVideos)
    session.startedAt = new Date().toISOString()
    setDailySession(session)
    setCurrentIndex(0)
    setLastAzureScores(null)
    setView('practice')
  }

  const advance = useCallback(() => {
    setLastAzureScores(null)
    const next = currentIndex + 1
    if (next >= total) {
      setDailySession({ ...dailySession!, completedAt: new Date().toISOString() })
      setView('done')
    } else {
      setCurrentIndex(next)
    }
  }, [currentIndex, total, dailySession, setDailySession])

  const handleRate = useCallback((rating: SRSRating) => {
    if (!currentItem) return
    const { phraseId, videoId, isReview } = currentItem

    if (!isReview) {
      // New phrase — add to SRS queue first, then apply rating
      const phrase = savedVideos.flatMap((v) => v.phrases).find((p) => p.id === phraseId)
      if (phrase && videoId) addToQueue(phrase, videoId)
    }

    ratePhrase(phraseId, rating)
    if (videoId) recordPhraseSession(videoId)
    markPhraseCompleted(phraseId)
    advance()
  }, [currentItem, savedVideos, markPhraseCompleted, advance])

  const handleSkip = useCallback(() => {
    advance()
  }, [advance])

  // ─── Render ─────────────────────────────────────────────────────────────────

  // ── Empty state ──
  if (view === 'empty') {
    return (
      <div className="bg-white border border-gray-100 rounded-xl p-8 text-center space-y-3">
        <p className="text-3xl">📚</p>
        <p className="text-sm font-medium text-gray-700">Your library is empty</p>
        <p className="text-xs text-gray-400 max-w-xs mx-auto">
          Save videos from the Practice tab to generate a daily practice session.
        </p>
      </div>
    )
  }

  // ── Done state ──
  if (view === 'done') {
    return (
      <div className="bg-white border border-gray-100 rounded-xl p-8 text-center space-y-4">
        <p className="text-3xl">🎉</p>
        <div>
          <p className="text-base font-semibold text-gray-900">Session complete!</p>
          <p className="text-sm text-gray-500 mt-1">
            You practiced {total} phrase{total !== 1 ? 's' : ''} today. Great work.
          </p>
        </div>
        <button
          onClick={() => {
            setDailySession(null)
            setPreviewSession(buildDailySession(savedVideos))
            setView('summary')
          }}
          className="px-5 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          Start new session
        </button>
      </div>
    )
  }

  // ── Summary state ──
  if (view === 'summary') {
    const reviewCount = previewSession?.reviewPhrases.length ?? 0
    const newCount    = previewSession?.newPhrases.length ?? 0
    const mins        = previewSession ? estimateMinutes(previewSession) : 0
    const isEmpty     = reviewCount + newCount === 0

    return (
      <div className="bg-white border border-gray-100 rounded-xl p-6 space-y-5">
        <div>
          <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Today&apos;s practice</p>
          {isEmpty ? (
            <p className="text-sm text-gray-500">
              All caught up! Add more videos to your library to get new phrases.
            </p>
          ) : (
            <>
              <p className="text-lg font-semibold text-gray-900">
                {reviewCount > 0 && `${reviewCount} review`}
                {reviewCount > 0 && newCount > 0 && ' + '}
                {newCount > 0 && `${newCount} new`}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">~{mins} min</p>
            </>
          )}
        </div>

        {!isEmpty && (
          <>
            {/* Preview pills */}
            <div className="flex flex-wrap gap-1.5">
              {reviewCount > 0 && (
                <span className="px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full text-xs font-medium">
                  {reviewCount} to review
                </span>
              )}
              {newCount > 0 && (
                <span className="px-2 py-0.5 bg-purple-50 text-purple-600 rounded-full text-xs font-medium">
                  {newCount} new phrases
                </span>
              )}
            </div>

            <button
              onClick={handleStart}
              className="w-full py-3 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 transition-colors"
            >
              Start Practice →
            </button>
          </>
        )}
      </div>
    )
  }

  // ── Practice state ──
  if (!currentItem) {
    // Session built with 0 items — shouldn't normally happen
    return null
  }

  const completedCount = dailySession?.completed.length ?? 0
  const progressPct = total > 0 ? (completedCount / total) * 100 : 0
  const suggestedRating = lastAzureScores ? azureToSRS(lastAzureScores) : undefined
  const composite = lastAzureScores ? compositeScore(lastAzureScores) : undefined
  const youtubeUrl = currentItem.videoId
    ? `https://youtu.be/${currentItem.videoId}`
    : null

  return (
    <div className="space-y-4">
      {/* ── Progress bar ── */}
      <div className="bg-white border border-gray-100 rounded-xl p-4 space-y-2">
        <div className="flex items-center justify-between text-xs text-gray-400">
          <span>Phrase {completedCount + 1} of {total}</span>
          <span>{Math.round(progressPct)}%</span>
        </div>
        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-500 rounded-full transition-all duration-300"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* ── Phrase card ── */}
      <div className="bg-white border border-gray-100 rounded-xl p-5 space-y-4">
        {/* Badge */}
        <div className="flex items-center justify-between">
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
            currentItem.isReview
              ? 'bg-blue-50 text-blue-600'
              : 'bg-purple-50 text-purple-600'
          }`}>
            {currentItem.isReview ? 'Review' : 'New'}
          </span>
          {youtubeUrl && (
            <a
              href={youtubeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1"
            >
              Watch on YouTube
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          )}
        </div>

        {/* Phrase text */}
        <p className="text-gray-800 text-lg leading-relaxed">{currentItem.phraseText}</p>

        {/* ── Assess pronunciation ── */}
        <div className="border-t border-gray-50 pt-4">
          <p className="text-xs text-gray-400 mb-3">Optional: assess your pronunciation</p>
          <PronunciationAssessor
            phraseText={currentItem.phraseText}
            phraseId={currentItem.phraseId}
            videoId={currentItem.videoId}
            onScoreReady={setLastAzureScores}
          />
        </div>

        {/* ── SRS rating ── */}
        <div className="border-t border-gray-50 pt-4 space-y-2">
          {suggestedRating !== undefined ? (
            <p className="text-xs text-gray-500">
              Score: {composite} →{' '}
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
                onClick={() => handleRate(rating)}
                className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                  suggestedRating === rating ? active : ghost
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-300 text-center">Rate to update your spaced repetition schedule</p>
        </div>

        {/* ── Skip ── */}
        <button
          onClick={handleSkip}
          className="w-full py-2 text-xs text-gray-400 hover:text-gray-600 transition-colors"
        >
          Skip phrase →
        </button>
      </div>
    </div>
  )
}
