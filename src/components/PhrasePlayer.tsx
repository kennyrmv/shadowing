'use client'

// ─── PhrasePlayer ──────────────────────────────────────────────────────────────
//
// Orchestrates the loop mechanism on top of YouTubePlayer.
//
// Loop state machine:
//
//   idle ──[click phrase]──► playing
//     ▲                         │
//     │                         │ currentTime >= endTime
//     │                         ▼
//     │                    [seek to startTime] ◄── loop!
//     │
//     └──[click same phrase again]── paused ──[click]──► playing
//
// Polling: runs every (100ms / playbackRate) while state is 'playing'.
// Visual gap: 0.5s countdown shown between loops so the restart feels intentional.

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import YouTubePlayer, { YouTubePlayerRef } from './YouTubePlayer'
import VideoClipPlayer from './VideoClipPlayer'
import PhraseList from './PhraseList'
import PhraseRecorder from './PhraseRecorder'
import PronunciationAssessor from './PronunciationAssessor'
import ProsodyFeedback from './ProsodyFeedback'
import { Phrase, SRSRating } from '@/types'
import type { ProsodyProfile, UserProsody, ProsodyScores } from '@/types'
import { scorePhrases } from '@/lib/scorePhrases'
import { addToQueue, ratePhrase, isQueued, exportData } from '@/lib/srs'
import { recordPhraseSession } from '@/lib/progress'
import { useAppStore } from '@/store/useAppStore'
import { azureToSRS, compositeScore, combinedToSRS, combinedComposite } from '@/lib/autoRate'
import type { AssessmentResult } from './PronunciationAssessor'
import { compareProsody } from '@/lib/prosodyScore'
import type { AzureScores } from '@/lib/autoRate'

interface Props {
  videoId: string
  phrases: Phrase[]
  onTitleReady?: (title: string) => void
}

const DIFFICULTY_COLORS = {
  easy: 'bg-success-light text-success',
  medium: 'bg-warning-light text-warning',
  hard: 'bg-error-light text-error',
}

const LOOP_GAP_MS = 500  // visual pause between loops

function parseTime(input: string): number {
  const trimmed = input.trim()
  if (!trimmed) return 0
  if (trimmed.includes(':')) {
    const [m, s] = trimmed.split(':').map(Number)
    return (m || 0) * 60 + (s || 0)
  }
  return Number(trimmed) || 0
}

export default function PhrasePlayer({ videoId, phrases, onTitleReady }: Props) {
  const playerRef = useRef<YouTubePlayerRef>(null)

  // ── State from Zustand store ──
  const activePhrase = useAppStore((s) => s.activePhrase)
  const setActivePhrase = useAppStore((s) => s.setActivePhrase)
  const loopState = useAppStore((s) => s.loopState)
  const setLoopState = useAppStore((s) => s.setLoopState)
  const playbackRate = useAppStore((s) => s.playbackRate)
  const storeSetPlaybackRate = useAppStore((s) => s.setPlaybackRate)
  const timingOffset = useAppStore((s) => s.timingOffset)
  const setTimingOffset = useAppStore((s) => s.setTimingOffset)
  const drillMode = useAppStore((s) => s.drillMode)
  const setDrillMode = useAppStore((s) => s.setDrillMode)
  const loopsTarget = useAppStore((s) => s.loopsTarget)
  const setLoopsTarget = useAppStore((s) => s.setLoopsTarget)
  const loopCount = useAppStore((s) => s.loopCount)
  const setLoopCount = useAppStore((s) => s.setLoopCount)
  const incrementLoopCount = useAppStore((s) => s.incrementLoopCount)

  // ── Extraction state from store ──
  const extractedClips = useAppStore((s) => s.extractedClips)
  const extractionStatus = useAppStore((s) => s.extractionStatus)
  const selectedPhraseIds = useAppStore((s) => s.selectedPhraseIds)
  const setExtractionStatus = useAppStore((s) => s.setExtractionStatus)
  const togglePhraseSelection = useAppStore((s) => s.togglePhraseSelection)
  const clearPhraseSelection = useAppStore((s) => s.clearPhraseSelection)
  const addExtractedClip = useAppStore((s) => s.addExtractedClip)

  // ── Local-only state (not persisted) ──
  const [isRestarting, setIsRestarting] = useState(false) // visual gap indicator
  const [playerReady, setPlayerReady] = useState(false)
  const [storageWarning, setStorageWarning] = useState(false)
  const [queuedIds, setQueuedIds] = useState<Set<string>>(new Set())
  const [startFromInput, setStartFromInput] = useState('')
  const [startFromSec, setStartFromSec] = useState(0)
  const [lastAzureScores, setLastAzureScores] = useState<AzureScores | null>(null)
  const [selectMode, setSelectMode] = useState(false)
  const [extractionProgress, setExtractionProgress] = useState('')
  const [nativeProfile, setNativeProfile] = useState<ProsodyProfile | null>(null)
  const [userProsody, setUserProsody] = useState<UserProsody | null>(null)
  const [prosodyScores, setProsodyScores] = useState<ProsodyScores | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [focusedMode, setFocusedMode] = useState(false)
  const [practiceStep, setPracticeStep] = useState<'looping' | 'assessing' | 'results' | 'rating'>('looping')
  const [lastFullResult, setLastFullResult] = useState<AssessmentResult | null>(null)

  // Score all phrases once (pure function, useMemo so it doesn't re-run on every render)
  const scoredPhrases = useMemo(() => scorePhrases(phrases), [phrases])

  // Filtered phrases based on startFrom
  const visiblePhrases = useMemo(
    () => startFromSec > 0 ? scoredPhrases.filter((p) => p.startTime >= startFromSec) : scoredPhrases,
    [scoredPhrases, startFromSec]
  )

  // Display phrases — start from visiblePhrases, updated when user merges
  const [displayPhrases, setDisplayPhrases] = useState<Phrase[]>(visiblePhrases)
  useEffect(() => { setDisplayPhrases(visiblePhrases) }, [visiblePhrases])

  // Ref so handleMerge can read current displayPhrases without a stale closure
  const displayPhrasesRef = useRef<Phrase[]>(displayPhrases)
  useEffect(() => { displayPhrasesRef.current = displayPhrases }, [displayPhrases])

  const handleMerge = useCallback((phraseId: string) => {
    const prev = displayPhrasesRef.current
    const idx = prev.findIndex((p) => p.id === phraseId)
    if (idx === -1 || idx === prev.length - 1) return
    const curr = prev[idx]
    const next = prev[idx + 1]
    const merged: Phrase = {
      ...curr,
      text: curr.text + ' ' + next.text,
      duration: next.startTime + next.duration - curr.startTime,
      wordCount: curr.wordCount + next.wordCount,
      difficulty: undefined,
    }
    setDisplayPhrases([...prev.slice(0, idx), merged, ...prev.slice(idx + 2)])

    // If the active phrase was merged, update it so the loop uses the new duration
    if (activePhraseRef.current?.id === curr.id) {
      activePhraseRef.current = merged
      setActivePhrase(merged)
    }
  }, [])

  // Listen for storage-full events from srs.ts / progress.ts
  useEffect(() => {
    const handler = () => setStorageWarning(true)
    window.addEventListener('srs:storage-full', handler)
    return () => window.removeEventListener('srs:storage-full', handler)
  }, [])

  const activePhraseRef = useRef<Phrase | null>(null)
  const loopStateRef = useRef(loopState)
  const playbackRateRef = useRef(playbackRate)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const drillModeRef = useRef(drillMode)
  const loopsTargetRef = useRef(loopsTarget)
  const loopCountRef = useRef(0)  // readable inside setInterval
  const loopEndFiredRef = useRef(false)  // debounce: one increment per loop end

  // Reset scores and practice step when phrase changes + load native prosody profile from store
  useEffect(() => {
    setLastAzureScores(null)
    setProsodyScores(null)
    setUserProsody(null)
    setNativeProfile(null)
    setPracticeStep('looping')
    setLastFullResult(null)

    if (!activePhrase) return
    const clip = extractedClips[activePhrase.id]
    if (!clip?.prosodyProfile) return

    // Read prosody directly from store (no CORS issues)
    setNativeProfile(clip.prosodyProfile)
  }, [activePhrase?.id, extractedClips])

  // Keep refs in sync with store state (refs are readable inside setInterval)
  useEffect(() => { activePhraseRef.current = activePhrase; loopCountRef.current = 0; loopEndFiredRef.current = false; setLoopCount(0) }, [activePhrase, setLoopCount])
  useEffect(() => { loopStateRef.current = loopState }, [loopState])
  useEffect(() => { playbackRateRef.current = playbackRate }, [playbackRate])
  useEffect(() => { drillModeRef.current = drillMode }, [drillMode])
  useEffect(() => { loopsTargetRef.current = loopsTarget }, [loopsTarget])

  // ─── Loop polling ────────────────────────────────────────────────────────────
  const startPolling = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current)

    const tick = () => {
      const phrase = activePhraseRef.current
      const state = loopStateRef.current
      const rate = playbackRateRef.current

      if (!phrase || state !== 'playing') return

      const current = playerRef.current?.getCurrentTime() ?? 0
      // For extracted clips, the clip starts at 0; for YouTube, use phrase.startTime + timingOffset
      const clips = useAppStore.getState().extractedClips
      const hasClip = !!clips[phrase.id]
      const offset = hasClip ? 0 : useAppStore.getState().timingOffset
      const startTime = hasClip ? 0 : phrase.startTime + offset
      const endTime = startTime + phrase.duration

      // Reset the end-fired guard once the player has actually seeked back
      if (loopEndFiredRef.current && current < endTime - 0.5) {
        loopEndFiredRef.current = false
      }

      if (current >= endTime - 0.1) {
        if (loopEndFiredRef.current) return  // already handled this loop end
        loopEndFiredRef.current = true
        loopCountRef.current += 1
        incrementLoopCount()

        // Drill mode: advance to next phrase after N loops
        if (drillModeRef.current && loopCountRef.current >= loopsTargetRef.current) {
          recordPhraseSession(videoId)
          const phrases = displayPhrasesRef.current
          const idx = phrases.findIndex((p) => p.id === phrase.id)
          const next = phrases[idx + 1]
          if (next) {
            activePhraseRef.current = next
            setActivePhrase(next)
            setIsRestarting(false)
            const nextHasClip = !!clips[next.id]
            const nextOffset = nextHasClip ? 0 : useAppStore.getState().timingOffset
            playerRef.current?.seekTo(nextHasClip ? 0 : next.startTime + nextOffset)
          } else {
            // End of phrase list — stop
            setLoopState('paused')
          }
          return
        }

        // Normal loop with visual gap
        setIsRestarting(true)
        setTimeout(() => {
          if (loopStateRef.current === 'playing') {
            playerRef.current?.seekTo(startTime)
            setIsRestarting(false)
          }
        }, LOOP_GAP_MS)
      }

      // Reschedule with rate-adjusted interval
      clearInterval(intervalRef.current!)
      intervalRef.current = setInterval(tick, Math.max(50, 100 / rate))
    }

    intervalRef.current = setInterval(tick, Math.max(50, 100 / playbackRateRef.current))
  }, [videoId, incrementLoopCount, setActivePhrase, setLoopState])

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }, [])

  useEffect(() => {
    if (loopState === 'playing') {
      startPolling()
    } else {
      stopPolling()
    }
    return stopPolling
  }, [loopState, startPolling, stopPolling])

  // ─── SRS handlers ────────────────────────────────────────────────────────────
  const handleAddToQueue = useCallback(() => {
    if (!activePhrase) return
    addToQueue(activePhrase, videoId)
    setQueuedIds((prev) => new Set([...prev, activePhrase.id]))
  }, [activePhrase, videoId])

  const handleRate = useCallback((rating: SRSRating) => {
    if (!activePhrase) return
    ratePhrase(activePhrase.id, rating)
    recordPhraseSession(videoId)
    setLastAzureScores(null)
  }, [activePhrase, videoId])

  // ─── Click a phrase in the list ──────────────────────────────────────────────
  const handlePhraseClick = useCallback((phrase: Phrase) => {
    if (!playerReady) return

    if (activePhrase?.id === phrase.id) {
      // Toggle play/pause on same phrase
      if (loopState === 'playing') {
        playerRef.current?.pause()
        setLoopState('paused')
      } else {
        playerRef.current?.play()
        setLoopState('playing')
      }
      return
    }

    // New phrase selected
    setActivePhrase(phrase)
    setLoopState('playing')
    setIsRestarting(false)
    // For clips, seek to 0 (clip IS the phrase); for YouTube, seek to phrase.startTime + timingOffset
    const hasClip = !!extractedClips[phrase.id]
    playerRef.current?.seekTo(hasClip ? 0 : phrase.startTime + timingOffset)
  }, [activePhrase, loopState, playerReady, extractedClips, timingOffset, setActivePhrase, setLoopState])

  // ─── Speed control ────────────────────────────────────────────────────────────
  const handleRateChange = useCallback((rate: number) => {
    storeSetPlaybackRate(rate)
    playerRef.current?.setRate(rate)
  }, [storeSetPlaybackRate])

  // ─── Extract selected phrases ─────────────────────────────────────────────────
  const handleExtract = useCallback(async () => {
    if (selectedPhraseIds.length === 0) return
    setExtractionStatus('extracting')
    setExtractionProgress('Starting extraction...')

    const phrasesToExtract = displayPhrases.filter((p) => selectedPhraseIds.includes(p.id))

    try {
      const res = await fetch('/api/extract-phrases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoId,
          phrases: phrasesToExtract.map((p) => ({
            id: p.id,
            startTime: p.startTime,
            duration: p.duration,
            text: p.text,
          })),
        }),
      })

      if (!res.ok) {
        throw new Error(await res.text())
      }

      const { jobId } = await res.json()

      // Poll for completion
      const poll = async () => {
        const statusRes = await fetch(`/api/extract-phrases/status?jobId=${jobId}`)
        const statusData = await statusRes.json()

        if (statusData.status === 'done') {
          for (const clip of statusData.clips) {
            addExtractedClip(clip)
          }
          setExtractionStatus('done')
          setExtractionProgress('')
          clearPhraseSelection()
          setSelectMode(false)
          setFocusedMode(true)
        } else if (statusData.status === 'error') {
          throw new Error(statusData.error || 'Extraction failed')
        } else {
          setExtractionProgress(statusData.progress || 'Processing...')
          setTimeout(poll, 2000)
        }
      }

      await poll()
    } catch (err) {
      setExtractionStatus('error')
      setExtractionProgress(`Error: ${err instanceof Error ? err.message : err}`)
    }
  }, [selectedPhraseIds, displayPhrases, videoId, addExtractedClip, setExtractionStatus, clearPhraseSelection])

  // ─── Player state change (e.g. user manually seeks) ──────────────────────────
  const handleStateChange = useCallback((state: number) => {
    // YT.PlayerState.PAUSED = 2, ENDED = 0
    if (state === 2 || state === 0) {
      if (loopStateRef.current === 'playing') {
        // User manually paused or video ended — pause our loop
        setLoopState('paused')
      }
    }
  }, [])

  return (
    <div className="flex flex-col gap-4">
      {/* ── Video player (clip or YouTube) ── */}
      <div className="relative">
        {activePhrase && extractedClips[activePhrase.id] ? (
          <VideoClipPlayer
            ref={playerRef}
            clipUrl={extractedClips[activePhrase.id].clipUrl}
            onReady={() => setPlayerReady(true)}
            onStateChange={handleStateChange}
            loop={false} // parent manages looping
          />
        ) : (
          <YouTubePlayer
            ref={playerRef}
            videoId={videoId}
            onReady={() => setPlayerReady(true)}
            onStateChange={handleStateChange}
            onTitleReady={onTitleReady}
          />
        )}

        {/* Loop status overlay */}
        {activePhrase && (
          <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between">
            <div className={`
              px-3 py-1 rounded-full text-xs font-medium backdrop-blur-sm
              ${isRestarting
                ? 'bg-warning/80 text-white'
                : loopState === 'playing'
                  ? 'bg-success/80 text-white'
                  : 'bg-text/80 text-text-muted'
              }
            `}>
              {isRestarting
                ? '↺ restarting...'
                : loopState === 'playing'
                  ? drillMode
                    ? `⟳ ${loopCount + 1} / ${loopsTarget}`
                    : '⟳ looping'
                  : '⏸ paused'
              }
            </div>
          </div>
        )}
      </div>

      {/* ── Video settings (collapsible) ── */}
      <button
        onClick={() => setShowSettings(!showSettings)}
        className="flex items-center gap-2 w-full px-3 py-2 bg-surface rounded-[8px] text-sm text-text-secondary hover:text-text transition-colors"
      >
        <span>Video settings</span>
        <svg
          className={`w-3.5 h-3.5 transition-transform duration-200 ${showSettings ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {showSettings && (
        <div className="space-y-3">
          {/* Start from */}
          <div className="flex items-center gap-3 px-1">
            <span className="text-sm text-text-secondary w-16 shrink-0">Start from</span>
            <input
              type="text"
              placeholder="e.g. 2:00"
              value={startFromInput}
              onChange={(e) => setStartFromInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') setStartFromSec(parseTime(startFromInput))
              }}
              className="w-20 px-2 py-1 text-sm border border-border rounded focus:outline-none focus:border-primary"
            />
            <button
              onClick={() => setStartFromSec(parseTime(startFromInput))}
              className="px-3 py-1 text-xs bg-surface text-text-secondary rounded hover:bg-gray-200"
            >
              Skip
            </button>
            {startFromSec > 0 && (
              <button
                onClick={() => { setStartFromInput(''); setStartFromSec(0) }}
                className="text-xs text-text-muted hover:text-text-secondary"
              >
                Clear
              </button>
            )}
          </div>

          {/* Speed control */}
          <div className="flex items-center gap-3 px-1">
            <span className="text-sm text-text-secondary w-16 shrink-0">Speed</span>
            <div className="flex gap-2">
              {[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => (
                <button
                  key={rate}
                  onClick={() => handleRateChange(rate)}
                  className={`
                    px-2.5 py-1 rounded text-xs font-mono transition-colors
                    ${playbackRate === rate
                      ? 'bg-primary text-white'
                      : 'bg-surface text-text-secondary hover:bg-gray-200'
                    }
                  `}
                >
                  {rate}×
                </button>
              ))}
            </div>
          </div>

          {/* Timing offset — fix caption drift (caption-level timestamps only, no word-level available) */}
          <div className="flex items-center gap-3 px-1">
            <span className="text-sm text-text-secondary w-16 shrink-0">Timing</span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setTimingOffset(Math.round((timingOffset - 0.1) * 10) / 10)}
                className="w-6 h-6 rounded bg-surface text-text-secondary hover:bg-gray-200 text-sm font-mono leading-none"
                title="Start phrase 0.1s earlier"
              >−</button>
              <span className="text-xs font-mono text-text w-14 text-center">
                {timingOffset === 0 ? '0.0 s' : `${timingOffset > 0 ? '+' : ''}${timingOffset.toFixed(1)} s`}
              </span>
              <button
                onClick={() => setTimingOffset(Math.round((timingOffset + 0.1) * 10) / 10)}
                className="w-6 h-6 rounded bg-surface text-text-secondary hover:bg-gray-200 text-sm font-mono leading-none"
                title="Start phrase 0.1s later"
              >+</button>
              {timingOffset !== 0 && (
                <button
                  onClick={() => setTimingOffset(0)}
                  className="text-xs text-text-muted hover:text-text-secondary ml-1"
                >reset</button>
              )}
            </div>
            <span className="text-xs text-text-muted">offset</span>
          </div>

          {/* Drill mode */}
          <div className="flex items-center gap-3 px-1">
            <span className="text-sm text-text-secondary w-16 shrink-0">Drill</span>
            <button
              onClick={() => setDrillMode(!drillMode)}
              className={`
                px-3 py-1 rounded text-xs font-medium transition-colors
                ${drillMode ? 'bg-primary text-white' : 'bg-surface text-text-secondary hover:bg-gray-200'}
              `}
            >
              {drillMode ? 'On' : 'Off'}
            </button>
            {drillMode && (
              <>
                <span className="text-xs text-text-muted">loops per phrase</span>
                <div className="flex gap-1">
                  {[1, 2, 3, 5, 10].map((n) => (
                    <button
                      key={n}
                      onClick={() => setLoopsTarget(n)}
                      className={`
                        w-7 h-7 rounded text-xs font-mono transition-colors
                        ${loopsTarget === n ? 'bg-primary text-white' : 'bg-surface text-text-secondary hover:bg-gray-200'}
                      `}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Storage warning ── */}
      {storageWarning && (
        <div className="bg-warning-light border border-warning/30 rounded-[12px] px-4 py-3 flex items-center justify-between">
          <p className="text-sm text-warning">
            Storage is almost full. Export your data to keep your progress.
          </p>
          <button
            onClick={() => {
              const json = exportData()
              const a = document.createElement('a')
              a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
              a.download = 'shadowing-progress.json'
              a.click()
            }}
            className="text-xs text-warning underline ml-4 shrink-0"
          >
            Export
          </button>
        </div>
      )}

      {/* ── Active phrase panel: sequential practice flow ── */}
      {activePhrase && (
        <div className="bg-bg border border-border rounded-[12px] p-4 space-y-3">
          {/* Always visible: phrase card */}
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm text-primary font-medium mb-1">Now looping</p>
              <p className="text-text leading-relaxed">{activePhrase.text}</p>
              <p className="text-xs text-text-muted mt-2">
                {activePhrase.startTime.toFixed(1)}s — {(activePhrase.startTime + activePhrase.duration).toFixed(1)}s
                · {activePhrase.wordCount} words
              </p>
            </div>
            {activePhrase.difficulty && (
              <span className={`
                shrink-0 px-2 py-0.5 rounded text-xs font-medium
                ${DIFFICULTY_COLORS[activePhrase.difficulty.overall]}
              `}>
                {activePhrase.difficulty.overall}
                <span className="ml-1 opacity-60">{activePhrase.difficulty.wpm}wpm</span>
              </span>
            )}
          </div>

          {/* Step: looping / assessing — show PronunciationAssessor (button + recording only) */}
          {(practiceStep === 'looping' || practiceStep === 'assessing') && (
            <div className="border-t border-border pt-3">
              <PronunciationAssessor
                phraseText={activePhrase.text}
                phraseId={activePhrase.id}
                videoId={videoId}
                hideResults
                onAssessStart={() => {
                  playerRef.current?.pause()
                  setLoopState('paused')
                  setPracticeStep('assessing')
                }}
                onAssessDone={() => {
                  playerRef.current?.play()
                  setLoopState('playing')
                }}
                onScoreReady={setLastAzureScores}
                onFullResult={(result) => {
                  setLastFullResult(result)
                  setPracticeStep('results')
                }}
                onProsodyReady={(up) => {
                  setUserProsody(up)
                  if (nativeProfile) {
                    setProsodyScores(compareProsody(nativeProfile, up))
                  }
                }}
              />
            </div>
          )}

          {/* Step: results — show pronunciation scores + prosody + advance to rating */}
          {practiceStep === 'results' && lastFullResult && (
            <div className="border-t border-border pt-3 space-y-3">
              {/* Pronunciation score */}
              <div className={`flex items-center justify-between px-4 py-3 rounded-[8px] border ${
                lastFullResult.pronunciationScore >= 80 ? 'bg-success-light border-success/30 text-success' :
                lastFullResult.pronunciationScore >= 50 ? 'bg-warning-light border-warning/30 text-warning' :
                'bg-error-light border-error/30 text-error'
              }`}>
                <span className="text-sm font-medium">Pronunciation score</span>
                <span className="text-2xl font-bold font-display">{lastFullResult.pronunciationScore}</span>
              </div>

              {/* Word accuracy */}
              <div className="bg-surface rounded-[8px] px-4 py-3">
                <p className="text-xs text-text-muted mb-2">Word accuracy</p>
                <div className="flex flex-wrap gap-1.5">
                  {lastFullResult.words.map((w, i) => (
                    <span
                      key={i}
                      title={`${w.accuracyScore}/100`}
                      className={`text-sm font-medium px-1.5 py-0.5 rounded ${
                        w.errorType === 'Omission' ? 'line-through text-text-muted' :
                        w.errorType === 'Insertion' ? 'text-text-muted italic' :
                        w.accuracyScore >= 80 ? 'text-success' :
                        w.accuracyScore >= 50 ? 'text-warning' :
                        'text-error'
                      }`}
                    >
                      {w.word}
                    </span>
                  ))}
                </div>
              </div>

              {/* Accuracy / Fluency / Completeness */}
              <div className="grid grid-cols-3 gap-2 text-center">
                {[
                  { label: 'Accuracy', value: lastFullResult.accuracyScore },
                  { label: 'Fluency', value: lastFullResult.fluencyScore },
                  { label: 'Complete', value: lastFullResult.completenessScore },
                ].map(({ label, value }) => (
                  <div key={label} className="bg-surface rounded-[8px] py-2">
                    <p className={`text-lg font-bold ${
                      value >= 80 ? 'text-success' : value >= 50 ? 'text-warning' : 'text-error'
                    }`}>{value}</p>
                    <p className="text-xs text-text-muted">{label}</p>
                  </div>
                ))}
              </div>

              {/* Prosody feedback (if available for extracted clips) */}
              {prosodyScores && nativeProfile && userProsody && (
                <ProsodyFeedback
                  scores={prosodyScores}
                  nativeProfile={nativeProfile}
                  userProsody={userProsody}
                />
              )}

              {/* Advance to rating */}
              <button
                onClick={() => setPracticeStep('rating')}
                className="w-full py-2.5 bg-primary text-white rounded-[8px] text-sm font-medium hover:bg-primary-dark transition-colors"
              >
                Rate this phrase
              </button>
            </div>
          )}

          {/* Step: rating — show Hard/Good/Easy */}
          {practiceStep === 'rating' && (
            <div className="border-t border-border pt-3">
              <PhraseRecorder
                onRate={(rating) => {
                  handleRate(rating)
                  setPracticeStep('looping')
                }}
                isQueued={queuedIds.has(activePhrase.id) || isQueued(activePhrase.id)}
                onAddToQueue={handleAddToQueue}
                suggestedRating={lastAzureScores
                  ? combinedToSRS(lastAzureScores, prosodyScores?.overall)
                  : undefined
                }
                azureComposite={lastAzureScores
                  ? combinedComposite(lastAzureScores, prosodyScores?.overall)
                  : undefined
                }
              />
            </div>
          )}
        </div>
      )}

      {/* ── Select mode controls ── */}
      <div className="flex items-center gap-3 px-1">
        <button
          onClick={() => { setSelectMode(!selectMode); if (selectMode) clearPhraseSelection() }}
          className={`
            px-3 py-1.5 rounded-[8px] text-xs font-medium transition-colors
            ${selectMode ? 'bg-primary text-white' : 'bg-surface text-text-secondary hover:bg-gray-200'}
          `}
        >
          {selectMode ? 'Cancel selection' : 'Select phrases to extract'}
        </button>

        {selectMode && selectedPhraseIds.length > 0 && (
          <button
            onClick={handleExtract}
            disabled={extractionStatus === 'extracting'}
            className="px-4 py-1.5 rounded-[8px] text-xs font-medium bg-success text-white hover:bg-success disabled:opacity-50"
          >
            {extractionStatus === 'extracting'
              ? 'Extracting...'
              : `Extract ${selectedPhraseIds.length} clip${selectedPhraseIds.length > 1 ? 's' : ''}`
            }
          </button>
        )}
      </div>

      {/* ── Extraction progress ── */}
      {extractionStatus === 'extracting' && extractionProgress && (
        <div className="bg-primary-light border border-primary/30 rounded-[12px] px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-primary" />
            </span>
            <p className="text-sm text-primary">{extractionProgress}</p>
          </div>
        </div>
      )}

      {extractionStatus === 'error' && extractionProgress && (
        <div className="bg-error-light border border-error/30 rounded-[12px] px-4 py-3">
          <p className="text-sm text-error">{extractionProgress}</p>
        </div>
      )}

      {/* ── Focused mode banner ── */}
      {focusedMode && (
        <div className="flex items-center justify-between px-1">
          <span className="text-xs text-primary font-medium">
            Showing {displayPhrases.filter(p => !!extractedClips[p.id]).length} extracted clips
          </span>
          <button
            onClick={() => setFocusedMode(false)}
            className="text-xs text-text-muted hover:text-text transition-colors"
          >
            Show all phrases
          </button>
        </div>
      )}

      {/* ── Phrase list ── */}
      <PhraseList
        phrases={focusedMode ? displayPhrases.filter(p => !!extractedClips[p.id]) : displayPhrases}
        activePhraseId={activePhrase?.id ?? null}
        onPhraseClick={handlePhraseClick}
        loopState={loopState}
        onMerge={handleMerge}
        selectMode={selectMode}
        selectedIds={new Set(selectedPhraseIds)}
        extractedIds={new Set(Object.keys(extractedClips))}
        onToggleSelect={togglePhraseSelection}
      />
    </div>
  )
}
