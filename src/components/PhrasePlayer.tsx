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
import { compareProsody } from '@/lib/prosodyScore'
import type { AzureScores } from '@/lib/autoRate'

interface Props {
  videoId: string
  phrases: Phrase[]
  onTitleReady?: (title: string) => void
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

export default function PhrasePlayer({ videoId, phrases, onTitleReady }: Props) {
  const playerRef = useRef<YouTubePlayerRef>(null)

  // ── State from Zustand store ──
  const activePhrase = useAppStore((s) => s.activePhrase)
  const setActivePhrase = useAppStore((s) => s.setActivePhrase)
  const loopState = useAppStore((s) => s.loopState)
  const setLoopState = useAppStore((s) => s.setLoopState)
  const playbackRate = useAppStore((s) => s.playbackRate)
  const storeSetPlaybackRate = useAppStore((s) => s.setPlaybackRate)
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

  // Reset scores when phrase changes + fetch native prosody profile if available
  useEffect(() => {
    setLastAzureScores(null)
    setProsodyScores(null)
    setUserProsody(null)
    setNativeProfile(null)

    if (!activePhrase) return
    const clip = extractedClips[activePhrase.id]
    if (!clip?.prosodyUrl) return

    // Fetch native prosody profile from R2
    fetch(clip.prosodyUrl)
      .then((res) => res.json())
      .then((profile: ProsodyProfile) => setNativeProfile(profile))
      .catch(() => { /* prosody profile unavailable */ })
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
      // For extracted clips, the clip starts at 0; for YouTube, use phrase.startTime
      const clips = useAppStore.getState().extractedClips
      const hasClip = !!clips[phrase.id]
      const startTime = hasClip ? 0 : phrase.startTime
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
            playerRef.current?.seekTo(nextHasClip ? 0 : next.startTime)
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
    // For clips, seek to 0 (clip IS the phrase); for YouTube, seek to phrase.startTime
    const hasClip = !!extractedClips[phrase.id]
    playerRef.current?.seekTo(hasClip ? 0 : phrase.startTime)
  }, [activePhrase, loopState, playerReady, extractedClips])

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
          onClick={() => setDrillMode(!drillMode)}
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
            suggestedRating={lastAzureScores
              ? combinedToSRS(lastAzureScores, prosodyScores?.overall)
              : undefined
            }
            azureComposite={lastAzureScores
              ? combinedComposite(lastAzureScores, prosodyScores?.overall)
              : undefined
            }
          />

          <div className="border-t border-gray-100 pt-3">
            <PronunciationAssessor
              phraseText={activePhrase.text}
              phraseId={activePhrase.id}
              videoId={videoId}
              onAssessStart={() => {
                playerRef.current?.pause()
                setLoopState('paused')
              }}
              onAssessDone={() => {
                playerRef.current?.play()
                setLoopState('playing')
              }}
              onScoreReady={setLastAzureScores}
              onProsodyReady={(up) => {
                setUserProsody(up)
                if (nativeProfile) {
                  setProsodyScores(compareProsody(nativeProfile, up))
                }
              }}
            />
          </div>

          {/* Prosody comparison feedback (only for extracted clips) */}
          {prosodyScores && nativeProfile && userProsody && (
            <div className="border-t border-gray-100 pt-3">
              <ProsodyFeedback
                scores={prosodyScores}
                nativeProfile={nativeProfile}
                userProsody={userProsody}
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
            px-3 py-1.5 rounded-lg text-xs font-medium transition-colors
            ${selectMode ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}
          `}
        >
          {selectMode ? 'Cancel selection' : 'Select phrases to extract'}
        </button>

        {selectMode && selectedPhraseIds.length > 0 && (
          <button
            onClick={handleExtract}
            disabled={extractionStatus === 'extracting'}
            className="px-4 py-1.5 rounded-lg text-xs font-medium bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
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
        <div className="bg-purple-50 border border-purple-200 rounded-xl px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-purple-600" />
            </span>
            <p className="text-sm text-purple-700">{extractionProgress}</p>
          </div>
        </div>
      )}

      {extractionStatus === 'error' && extractionProgress && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          <p className="text-sm text-red-700">{extractionProgress}</p>
        </div>
      )}

      {/* ── Phrase list ── */}
      <PhraseList
        phrases={displayPhrases}
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
