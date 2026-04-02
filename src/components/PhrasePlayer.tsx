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
import PhraseList from './PhraseList'
import PhraseRecorder from './PhraseRecorder'
import PronunciationAssessor from './PronunciationAssessor'
import { Phrase, LoopState, SRSRating } from '@/types'
import { scorePhrases } from '@/lib/scorePhrases'
import { addToQueue, ratePhrase, isQueued, exportData } from '@/lib/srs'
import { recordPhraseSession } from '@/lib/progress'

interface Props {
  videoId: string
  phrases: Phrase[]
}

const DIFFICULTY_COLORS = {
  easy: 'bg-green-100 text-green-700',
  medium: 'bg-yellow-100 text-yellow-700',
  hard: 'bg-red-100 text-red-700',
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

export default function PhrasePlayer({ videoId, phrases }: Props) {
  const playerRef = useRef<YouTubePlayerRef>(null)
  const [activePhrase, setActivePhrase] = useState<Phrase | null>(null)
  const [loopState, setLoopState] = useState<LoopState>('idle')
  const [playbackRate, setPlaybackRate] = useState(1)
  const [isRestarting, setIsRestarting] = useState(false) // visual gap indicator
  const [playerReady, setPlayerReady] = useState(false)
  const [storageWarning, setStorageWarning] = useState(false)
  const [queuedIds, setQueuedIds] = useState<Set<string>>(new Set())
  const [startFromInput, setStartFromInput] = useState('')
  const [startFromSec, setStartFromSec] = useState(0)
  const [drillMode, setDrillMode] = useState(false)
  const [loopsTarget, setLoopsTarget] = useState(3)
  const [loopCount, setLoopCount] = useState(0)  // display only

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
  const loopStateRef = useRef<LoopState>('idle')
  const playbackRateRef = useRef(1)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const drillModeRef = useRef(false)
  const loopsTargetRef = useRef(3)
  const loopCountRef = useRef(0)  // readable inside setInterval
  const loopEndFiredRef = useRef(false)  // debounce: one increment per loop end

  // Keep refs in sync with state (refs are readable inside setInterval)
  useEffect(() => { activePhraseRef.current = activePhrase; loopCountRef.current = 0; loopEndFiredRef.current = false; setLoopCount(0) }, [activePhrase])
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
      const endTime = phrase.startTime + phrase.duration

      // Reset the end-fired guard once the player has actually seeked back
      if (loopEndFiredRef.current && current < endTime - 0.5) {
        loopEndFiredRef.current = false
      }

      if (current >= endTime - 0.1) {
        if (loopEndFiredRef.current) return  // already handled this loop end
        loopEndFiredRef.current = true
        loopCountRef.current += 1
        setLoopCount(loopCountRef.current)

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
            playerRef.current?.seekTo(next.startTime)
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
            playerRef.current?.seekTo(phrase.startTime)
            setIsRestarting(false)
          }
        }, LOOP_GAP_MS)
      }

      // Reschedule with rate-adjusted interval
      clearInterval(intervalRef.current!)
      intervalRef.current = setInterval(tick, Math.max(50, 100 / rate))
    }

    intervalRef.current = setInterval(tick, Math.max(50, 100 / playbackRateRef.current))
  }, [])

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
    playerRef.current?.seekTo(phrase.startTime)
  }, [activePhrase, loopState, playerReady])

  // ─── Speed control ────────────────────────────────────────────────────────────
  const handleRateChange = useCallback((rate: number) => {
    setPlaybackRate(rate)
    playerRef.current?.setRate(rate)
  }, [])

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
      {/* ── Video player ── */}
      <div className="relative">
        <YouTubePlayer
          ref={playerRef}
          videoId={videoId}
          onReady={() => setPlayerReady(true)}
          onStateChange={handleStateChange}
        />

        {/* Loop status overlay */}
        {activePhrase && (
          <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between">
            <div className={`
              px-3 py-1 rounded-full text-xs font-medium backdrop-blur-sm
              ${isRestarting
                ? 'bg-yellow-500/80 text-white'
                : loopState === 'playing'
                  ? 'bg-green-500/80 text-white'
                  : 'bg-gray-700/80 text-gray-200'
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

      {/* ── Start from ── */}
      <div className="flex items-center gap-3 px-1">
        <span className="text-sm text-gray-500 w-16 shrink-0">Start from</span>
        <input
          type="text"
          placeholder="e.g. 2:00"
          value={startFromInput}
          onChange={(e) => setStartFromInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') setStartFromSec(parseTime(startFromInput))
          }}
          className="w-20 px-2 py-1 text-sm border border-gray-200 rounded focus:outline-none focus:border-blue-400"
        />
        <button
          onClick={() => setStartFromSec(parseTime(startFromInput))}
          className="px-3 py-1 text-xs bg-gray-100 text-gray-600 rounded hover:bg-gray-200"
        >
          Skip
        </button>
        {startFromSec > 0 && (
          <button
            onClick={() => { setStartFromInput(''); setStartFromSec(0) }}
            className="text-xs text-gray-400 hover:text-gray-600"
          >
            Clear
          </button>
        )}
      </div>

      {/* ── Speed control ── */}
      <div className="flex items-center gap-3 px-1">
        <span className="text-sm text-gray-500 w-16 shrink-0">Speed</span>
        <div className="flex gap-2">
          {[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => (
            <button
              key={rate}
              onClick={() => handleRateChange(rate)}
              className={`
                px-2.5 py-1 rounded text-xs font-mono transition-colors
                ${playbackRate === rate
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }
              `}
            >
              {rate}×
            </button>
          ))}
        </div>
      </div>

      {/* ── Drill mode ── */}
      <div className="flex items-center gap-3 px-1">
        <span className="text-sm text-gray-500 w-16 shrink-0">Drill</span>
        <button
          onClick={() => setDrillMode((v) => !v)}
          className={`
            px-3 py-1 rounded text-xs font-medium transition-colors
            ${drillMode ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}
          `}
        >
          {drillMode ? 'On' : 'Off'}
        </button>
        {drillMode && (
          <>
            <span className="text-xs text-gray-400">loops per phrase</span>
            <div className="flex gap-1">
              {[1, 2, 3, 5, 10].map((n) => (
                <button
                  key={n}
                  onClick={() => setLoopsTarget(n)}
                  className={`
                    w-7 h-7 rounded text-xs font-mono transition-colors
                    ${loopsTarget === n ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}
                  `}
                >
                  {n}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* ── Active phrase display ── */}
      {activePhrase && (
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
          <p className="text-sm text-blue-500 font-medium mb-1">Now looping</p>
          <p className="text-gray-800 text-lg leading-relaxed">{activePhrase.text}</p>
          <p className="text-xs text-gray-400 mt-2">
            {activePhrase.startTime.toFixed(1)}s — {(activePhrase.startTime + activePhrase.duration).toFixed(1)}s
            · {activePhrase.wordCount} words
          </p>
        </div>
      )}

      {/* ── Storage warning ── */}
      {storageWarning && (
        <div className="bg-orange-50 border border-orange-200 rounded-xl px-4 py-3 flex items-center justify-between">
          <p className="text-sm text-orange-700">
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
            className="text-xs text-orange-600 underline ml-4 shrink-0"
          >
            Export
          </button>
        </div>
      )}

      {/* ── Active phrase panel: recorder + SRS ── */}
      {activePhrase && (
        <div className="bg-white border border-gray-100 rounded-xl p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm text-gray-500 font-medium mb-1">Now looping</p>
              <p className="text-gray-800 leading-relaxed">{activePhrase.text}</p>
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

          <PhraseRecorder
            onRate={handleRate}
            isQueued={queuedIds.has(activePhrase.id) || isQueued(activePhrase.id)}
            onAddToQueue={handleAddToQueue}
          />

          <div className="border-t border-gray-100 pt-3">
            <PronunciationAssessor
              phraseText={activePhrase.text}
              onAssessStart={() => {
                playerRef.current?.pause()
                setLoopState('paused')
              }}
              onAssessDone={() => {
                playerRef.current?.play()
                setLoopState('playing')
              }}
            />
          </div>
        </div>
      )}

      {/* ── Phrase list ── */}
      <PhraseList
        phrases={displayPhrases}
        activePhraseId={activePhrase?.id ?? null}
        onPhraseClick={handlePhraseClick}
        loopState={loopState}
        onMerge={handleMerge}
      />
    </div>
  )
}
