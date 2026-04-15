'use client'

// ─── Homepage ──────────────────────────────────────────────────────────────────
//
// The full user flow:
//   1. User pastes a YouTube URL OR picks from library
//   2. App fetches transcript (or loads from library)
//   3. PhrasePlayer renders the video + phrase list
//   4. User clicks any phrase → it loops
//   5. User can save video to library for future sessions

import { useState, useTransition, useRef, useEffect } from 'react'
import PhrasePlayer from '@/components/PhrasePlayer'
import ProgressDashboard from '@/components/ProgressDashboard'
import VideoLibrary from '@/components/VideoLibrary'
import DailyPractice from '@/components/DailyPractice'
import { Phrase } from '@/types'
import { useAppStore, SavedVideo } from '@/store/useAppStore'
import { scorePhrases } from '@/lib/scorePhrases'
import ThemeToggle from '@/components/ThemeToggle'

type LoadState = 'idle' | 'loading' | 'loaded' | 'error'
type Tab = 'dashboard' | 'practice' | 'daily'

export default function HomePage() {
  const [tab, setTab] = useState<Tab>('dashboard')
  const [url, setUrl] = useState('')
  const [videoId, setVideoId] = useState<string | null>(null)
  const [phrases, setPhrases] = useState<Phrase[]>([])
  const [loadState, setLoadState] = useState<LoadState>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [isPending, startTransition] = useTransition()
  const [showUrlInput, setShowUrlInput] = useState(false)
  const videoTitleRef = useRef<string>('')

  const saveVideo = useAppStore((s) => s.saveVideo)
  const savedVideos = useAppStore((s) => s.savedVideos)
  const hasHydrated = useAppStore((s) => s._hasHydrated)

  // After Zustand loads from localStorage, switch to Daily tab if the user has videos.
  // Using useEffect (not useState initializer) avoids SSR mismatch while still
  // preventing the flash — _hasHydrated fires synchronously after the first render.
  useEffect(() => {
    if (hasHydrated && savedVideos.length > 0 && tab === 'dashboard') {
      setTab('daily')
    }
    // Only run once on hydration, not on subsequent savedVideos changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasHydrated])

  // Check if current video is already saved
  const isVideoSaved = videoId ? savedVideos.some((v) => v.videoId === videoId) : false

  async function loadVideo(inputUrl: string) {
    const trimmed = inputUrl.trim()
    if (!trimmed) return

    setLoadState('loading')
    setErrorMsg('')
    setPhrases([])
    setVideoId(null)
    videoTitleRef.current = ''

    startTransition(async () => {
      try {
        const res = await fetch(`/api/transcript?url=${encodeURIComponent(trimmed)}`)
        const data = await res.json()

        if (!res.ok) {
          setErrorMsg(data.error ?? 'Something went wrong.')
          setLoadState('error')
          return
        }

        setVideoId(data.videoId)
        setPhrases(data.phrases)
        setLoadState('loaded')
        setShowUrlInput(false)
      } catch {
        setErrorMsg('Could not connect to the server. Check your internet connection.')
        setLoadState('error')
      }
    })
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    loadVideo(url)
  }

  function handleSaveToLibrary() {
    if (!videoId || phrases.length === 0) return
    const scored = scorePhrases(phrases)
    const video: SavedVideo = {
      videoId,
      title: videoTitleRef.current || videoId,
      url: url.trim(),
      phrases: scored,
      savedAt: new Date().toISOString(),
      totalPhrases: scored.length,
    }
    saveVideo(video)
  }

  function handleSelectFromLibrary(video: SavedVideo) {
    setVideoId(video.videoId)
    setPhrases(video.phrases)
    setUrl(video.url)
    videoTitleRef.current = video.title
    setLoadState('loaded')
    setShowUrlInput(false)
    setErrorMsg('')
  }

  function handleTitleReady(title: string) {
    videoTitleRef.current = title
  }

  const isLoading = loadState === 'loading' || isPending

  return (
    <main className="min-h-screen bg-surface">
      {/* ── Header ── */}
      <header className="border-b border-border bg-bg px-4 py-4">
        <div className="max-w-[480px] mx-auto flex items-center gap-3">
          <span className="text-2xl">🎙</span>
          <div className="flex-1">
            <h1 className="text-lg font-bold font-display text-text leading-none">Shadowing</h1>
            <p className="text-xs text-text-muted mt-0.5">Loop any phrase. Master the rhythm.</p>
          </div>
          {tab === 'practice' && loadState === 'loaded' && !showUrlInput && (
            <button
              onClick={() => setShowUrlInput(true)}
              className="px-3 py-1.5 bg-surface border border-border text-text-secondary rounded-full text-xs font-medium hover:bg-gray-200 transition-colors"
            >
              Change video
            </button>
          )}
          <ThemeToggle />
        </div>
      </header>

      <div className="max-w-[480px] mx-auto px-4 py-6 space-y-6">
        {/* ── Tabs ── */}
        <div className="flex gap-1 p-1 bg-surface rounded-[12px]">
          {([
            { id: 'dashboard', label: 'Dashboard' },
            { id: 'practice',  label: 'Practice' },
            { id: 'daily',     label: 'Daily' },
          ] as const).map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`
                flex-1 py-2 rounded-[8px] text-sm font-medium transition-colors
                ${tab === id
                  ? 'bg-bg text-text shadow-sm'
                  : 'text-text-secondary hover:text-text-secondary'
                }
              `}
            >
              {label}
            </button>
          ))}
        </div>

        {/* ── Dashboard tab ── */}
        {tab === 'dashboard' && <ProgressDashboard />}

        {/* ── Daily Practice tab ── */}
        {tab === 'daily' && <DailyPractice />}

        {/* ── Practice tab ── */}
        {tab === 'practice' && <>

        {/* ── URL input (visible when no video loaded, or user clicks "Change video") ── */}
        {(loadState !== 'loaded' || showUrlInput) && (
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Paste a YouTube URL... (e.g. https://youtube.com/watch?v=...)"
            className="
              flex-1 px-4 py-3 rounded-[12px] border border-border bg-bg
              text-sm text-text placeholder:text-text-muted
              focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent
              disabled:opacity-50
            "
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading || !url.trim()}
            className="
              px-5 py-3 bg-primary text-white rounded-[12px] text-sm font-medium
              hover:bg-primary-dark transition-colors
              disabled:opacity-50 disabled:cursor-not-allowed
              min-w-[80px]
            "
          >
            {isLoading ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
                Loading
              </span>
            ) : 'Load'}
          </button>
        </form>
        )}

        {/* ── Error state ── */}
        {loadState === 'error' && (
          <div className="bg-error-light border border-error/20 rounded-[12px] px-4 py-3">
            <p className="text-sm text-error">{errorMsg}</p>
          </div>
        )}

        {/* ── Video Library ── */}
        {loadState !== 'loaded' && (
          <VideoLibrary onSelectVideo={handleSelectFromLibrary} />
        )}

        {/* ── Idle / hint ── */}
        {loadState === 'idle' && savedVideos.length === 0 && (
          <div className="text-center py-8 text-text-muted space-y-2">
            <p className="text-4xl">🎧</p>
            <p className="text-sm font-medium">Paste a YouTube link to get started</p>
            <p className="text-xs">
              Works with TED Talks, podcasts, interviews — any video with subtitles
            </p>
            <div className="mt-4 text-xs text-text-muted space-y-1">
              <p>Try: <span className="font-mono">https://youtube.com/watch?v=iG9CE55wbtY</span></p>
              <p className="text-text-muted text-xs">(TED Talk: &quot;Do schools kill creativity?&quot;)</p>
            </div>
          </div>
        )}

        {/* ── Loaded: save button + player + phrase list ── */}
        {loadState === 'loaded' && videoId && phrases.length > 0 && (
          <>
            {/* Save to library button */}
            <div className="flex items-center gap-3">
              <button
                onClick={handleSaveToLibrary}
                disabled={isVideoSaved}
                className={`
                  px-4 py-2 rounded-lg text-sm font-medium transition-colors
                  ${isVideoSaved
                    ? 'bg-success-light text-success border border-success/30 cursor-default'
                    : 'bg-surface text-text-secondary hover:bg-gray-200'
                  }
                `}
              >
                {isVideoSaved ? '✓ Saved to library' : '+ Save to library'}
              </button>
              {videoTitleRef.current && (
                <span className="text-sm text-text-secondary truncate">{videoTitleRef.current}</span>
              )}
            </div>

            <PhrasePlayer
              videoId={videoId}
              phrases={phrases}
              onTitleReady={handleTitleReady}
            />
          </>
        )}

        {/* ── Loaded but no phrases ── */}
        {loadState === 'loaded' && phrases.length === 0 && (
          <div className="bg-warning-light border border-warning/20 rounded-[12px] px-4 py-3">
            <p className="text-sm text-warning">
              Transcript loaded but no phrases were detected. The video may have very short or unusual captions.
            </p>
          </div>
        )}

        </> /* end practice tab */}
      </div>
    </main>
  )
}
