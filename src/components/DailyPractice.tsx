'use client'

// ─── DailyPractice ─────────────────────────────────────────────────────────────
//
// Auto-generated daily practice session: SRS review phrases + new phrases
// from the saved video library.
//
// This component manages WHICH phrase is being practiced and WHEN to advance.
// The HOW (phases, looping, assessment) is handled by PracticePhaseView.
//
// View states:
//   empty    → library has no videos yet
//   summary  → session preview + Start button (+ level-up banner when ready)
//   practice → PracticePhaseView for the current phrase
//   done     → session complete

import { useState, useMemo, useCallback, useEffect } from 'react'
import { useAppStore } from '@/store/useAppStore'
import { buildDailySession, estimateMinutes } from '@/lib/sessionBuilder'
import { addToQueue, ratePhrase } from '@/lib/srs'
import { recordPhraseSession } from '@/lib/progress'
import { getLevelReport } from '@/lib/adaptiveDifficulty'
import type { Level } from '@/lib/adaptiveDifficulty'
import PracticePhaseView from '@/components/PracticePhaseView'
import type { PracticeItem } from '@/components/PracticePhaseView'
import type { AzureScores } from '@/lib/autoRate'
import type { SRSRating } from '@/types'

type View = 'empty' | 'summary' | 'practice' | 'done'

const LEVEL_LABEL: Record<Level, string> = { easy: 'easy', medium: 'medium', hard: 'hard' }

export default function DailyPractice() {
  const savedVideos         = useAppStore((s) => s.savedVideos)
  const scoreHistory        = useAppStore((s) => s.scoreHistory)
  const dailySession        = useAppStore((s) => s.dailySession)
  const setDailySession     = useAppStore((s) => s.setDailySession)
  const markPhraseCompleted = useAppStore((s) => s.markPhraseCompleted)

  // ── Adaptive difficulty ──────────────────────────────────────────────────────
  const levelReport = useMemo(
    () => getLevelReport(scoreHistory, savedVideos),
    [scoreHistory, savedVideos],
  )

  // preferredLevel: null = auto (use levelReport.currentLevel), or user-chosen override
  const [preferredLevel, setPreferredLevel] = useState<Level | null>(null)
  const effectiveLevel: Level = preferredLevel ?? levelReport.currentLevel

  // ── View / session state ─────────────────────────────────────────────────────
  const [view, setView]       = useState<View>(savedVideos.length === 0 ? 'empty' : 'summary')
  const [currentIndex, setCurrentIndex] = useState(0)
  const [previewSession, setPreviewSession] = useState(() =>
    savedVideos.length > 0 ? buildDailySession(savedVideos, 15, effectiveLevel) : null
  )

  // Rebuild preview when library or effective level changes
  useEffect(() => {
    if (savedVideos.length > 0) {
      setPreviewSession(buildDailySession(savedVideos, 15, effectiveLevel))
      if (view === 'empty') setView('summary')
    }
  }, [savedVideos.length, effectiveLevel]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Build flat ordered list of items from the active session ────────────────
  const items = useMemo<PracticeItem[]>(() => {
    if (!dailySession) return []

    // Review phrases — look up timing from saved library
    const reviewItems: PracticeItem[] = dailySession.reviewPhrases.map((e) => {
      const phrase = savedVideos.flatMap((v) => v.phrases).find((p) => p.id === e.phraseId)
      return {
        phraseId:   e.phraseId,
        phraseText: e.phraseText,
        videoId:    e.videoId,
        startTime:  phrase?.startTime ?? 0,
        duration:   phrase?.duration  ?? 5,
        isReview:   true,
      }
    })

    // New phrases — timing comes directly from the Phrase object
    const newItems: PracticeItem[] = dailySession.newPhrases.map((p) => {
      const video = savedVideos.find((v) => v.phrases.some((ph) => ph.id === p.id))
      return {
        phraseId:   p.id,
        phraseText: p.text,
        videoId:    video?.videoId ?? '',
        startTime:  p.startTime,
        duration:   p.duration,
        isReview:   false,
      }
    })

    return [...reviewItems, ...newItems]
  }, [dailySession, savedVideos])

  const currentItem = items[currentIndex]
  const total = items.length

  // ── Shared advance logic ─────────────────────────────────────────────────────
  const advance = useCallback(() => {
    const next = currentIndex + 1
    if (next >= total) {
      setDailySession({ ...dailySession!, completedAt: new Date().toISOString() })
      setView('done')
    } else {
      setCurrentIndex(next)
    }
  }, [currentIndex, total, dailySession, setDailySession])

  // ── Called by PracticePhaseView when user rates the phrase ───────────────────
  const handleComplete = useCallback((rating: SRSRating, _scores?: AzureScores) => {
    if (!currentItem) return
    const { phraseId, videoId, isReview } = currentItem

    if (!isReview) {
      // New phrase: add to SRS queue first, then rate
      const phrase = savedVideos.flatMap((v) => v.phrases).find((p) => p.id === phraseId)
      if (phrase && videoId) addToQueue(phrase, videoId)
    }

    ratePhrase(phraseId, rating)
    if (videoId) recordPhraseSession(videoId)
    markPhraseCompleted(phraseId)
    advance()
  }, [currentItem, savedVideos, markPhraseCompleted, advance])

  // ── Called by PracticePhaseView when user taps "Skip phrase" ─────────────────
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
            setPreviewSession(buildDailySession(savedVideos, 15, effectiveLevel))
            setCurrentIndex(0)
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

    // Show level-up banner when user has mastered current level and hasn't overridden yet
    const showLevelUp =
      levelReport.readyToProgress &&
      levelReport.nextLevel !== null &&
      preferredLevel === null

    return (
      <div className="bg-white border border-gray-100 rounded-xl p-6 space-y-5">

        {/* ── Level-up recommendation banner ── */}
        {showLevelUp && levelReport.nextLevel && (
          <div className="bg-green-50 border border-green-100 rounded-xl p-4 space-y-3">
            <div className="flex items-start gap-2">
              <span className="text-lg leading-none">🎯</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-green-800">
                  You&apos;re mastering {LEVEL_LABEL[levelReport.currentLevel]}!
                </p>
                <p className="text-xs text-green-600 mt-0.5">
                  Avg score {levelReport.avgComposite} over {levelReport.attempts} phrases.
                  Ready to try {LEVEL_LABEL[levelReport.nextLevel]}?
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setPreferredLevel(levelReport.nextLevel)}
                className="flex-1 py-2 bg-green-600 text-white rounded-lg text-xs font-semibold hover:bg-green-700 transition-colors"
              >
                Try {LEVEL_LABEL[levelReport.nextLevel!]} →
              </button>
              <button
                onClick={() => setPreferredLevel(levelReport.currentLevel)}
                className="flex-1 py-2 bg-white border border-green-200 text-green-700 rounded-lg text-xs font-medium hover:bg-green-50 transition-colors"
              >
                Keep {LEVEL_LABEL[levelReport.currentLevel]}
              </button>
            </div>
          </div>
        )}

        {/* ── Session header ── */}
        <div>
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-400 uppercase tracking-wide">Today&apos;s practice</p>
            {/* Level chip — only when user has enough data to show a level */}
            {levelReport.attempts > 0 && (
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                effectiveLevel === 'easy'   ? 'bg-green-50 text-green-600' :
                effectiveLevel === 'medium' ? 'bg-yellow-50 text-yellow-600' :
                                              'bg-red-50 text-red-500'
              }`}>
                {effectiveLevel}
              </span>
            )}
          </div>
          {isEmpty ? (
            <p className="text-sm text-gray-500 mt-1">
              All caught up! Add more videos to your library to get new phrases.
            </p>
          ) : (
            <>
              <p className="text-lg font-semibold text-gray-900 mt-1">
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

            <div className="bg-gray-50 rounded-xl p-4 space-y-2">
              <p className="text-xs font-medium text-gray-600">How each phrase works</p>
              <div className="space-y-1 text-xs text-gray-400">
                <p>① <span className="text-gray-600">Listen</span> — hear the rhythm</p>
                <p>② <span className="text-gray-600">Shadow</span> — speak along (no text)</p>
                <p>③ <span className="text-gray-600">Shadow with text</span> — read and speak</p>
                <p>④ <span className="text-gray-600">Assess</span> — Azure scores your pronunciation</p>
              </div>
            </div>

            <button
              onClick={() => {
                const session = buildDailySession(savedVideos, 15, effectiveLevel)
                session.startedAt = new Date().toISOString()
                setDailySession(session)
                setCurrentIndex(0)
                setView('practice')
              }}
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
  if (!currentItem) return null   // session with 0 items — edge case

  const completedCount = dailySession?.completed.length ?? 0
  const progressPct    = total > 0 ? (completedCount / total) * 100 : 0

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
            className="h-full bg-blue-500 rounded-full transition-all duration-500"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* ── Phase view — keyed by phraseId to force full remount on advance ── */}
      <PracticePhaseView
        key={currentItem.phraseId}
        item={currentItem}
        onComplete={handleComplete}
        onSkip={handleSkip}
      />
    </div>
  )
}
