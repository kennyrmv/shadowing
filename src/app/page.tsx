'use client'

import { useState, useTransition, useRef, useEffect, useMemo } from 'react'
import PhrasePlayer from '@/components/PhrasePlayer'
import ProgressDashboard from '@/components/ProgressDashboard'
import VideoLibrary from '@/components/VideoLibrary'
import DailyPractice from '@/components/DailyPractice'
import { Phrase } from '@/types'
import { useAppStore, SavedVideo } from '@/store/useAppStore'
import { scorePhrases } from '@/lib/scorePhrases'
import { getProgress } from '@/lib/progress'
import { getLevelReport } from '@/lib/adaptiveDifficulty'
import ThemeToggle from '@/components/ThemeToggle'
import PushNotificationToggle from '@/components/PushNotificationToggle'

type LoadState = 'idle' | 'loading' | 'loaded' | 'error'
// 'dashboard' is not a tab-bar entry — reachable only via the streak/level badge on Today
type Tab = 'today' | 'library' | 'dashboard'

export default function HomePage() {
  const [tab, setTab] = useState<Tab>('today')
  const [url, setUrl] = useState('')
  const [videoId, setVideoId] = useState<string | null>(null)
  const [phrases, setPhrases] = useState<Phrase[]>([])
  const [loadState, setLoadState] = useState<LoadState>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [isPending, startTransition] = useTransition()
  const [showUrlInput, setShowUrlInput] = useState(false)
  const [streak, setStreak] = useState(0)
  const videoTitleRef = useRef<string>('')

  const saveVideo = useAppStore((s) => s.saveVideo)
  const savedVideos = useAppStore((s) => s.savedVideos)
  const scoreHistory = useAppStore((s) => s.scoreHistory)
  const hasHydrated = useAppStore((s) => s._hasHydrated)

  // Route on hydration: empty library → Library tab, has videos → Today tab.
  // savedVideos intentionally excluded from deps — only run once on hydration,
  // not on every library change.
  useEffect(() => {
    if (hasHydrated) {
      setTab(savedVideos.length === 0 ? 'library' : 'today')
      setStreak(getProgress().streak)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasHydrated])

  const levelReport = useMemo(
    () => getLevelReport(scoreHistory, savedVideos),
    [scoreHistory, savedVideos],
  )

  // When dashboard is open (via badge), Today tab still appears active in the nav bar
  const activeTab = tab === 'dashboard' ? 'today' : tab

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
          {tab === 'library' && loadState === 'loaded' && !showUrlInput && (
            <button
              onClick={() => setShowUrlInput(true)}
              className="px-3 py-1.5 bg-surface border border-border text-text-secondary rounded-full text-xs font-medium hover:bg-gray-200 transition-colors"
            >
              Change video
            </button>
          )}
          {/* Streak/level badge — opens dashboard. Only shown after hydration to avoid "easy" flash. */}
          {hasHydrated && (tab === 'today' || tab === 'dashboard') && (
            <button
              onClick={() => setTab(tab === 'dashboard' ? 'today' : 'dashboard')}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-surface border border-border rounded-full text-xs font-medium text-text-secondary hover:bg-gray-200 transition-colors"
              title={tab === 'dashboard' ? 'Back to Today' : 'View your progress'}
            >
              {streak > 0 && <span>🔥 {streak}</span>}
              <span className="capitalize">{levelReport.currentLevel}</span>
            </button>
          )}
          <PushNotificationToggle />
          <ThemeToggle />
        </div>
      </header>

      <div className="max-w-[480px] mx-auto px-4 py-6 space-y-6">
        {/* ── Tabs ── */}
        <div className="flex gap-1 p-1 bg-surface rounded-[12px]">
          {([
            { id: 'today',   label: 'Today' },
            { id: 'library', label: 'Library' },
          ] as const).map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`
                flex-1 py-2 rounded-[8px] text-sm font-medium transition-colors
                ${activeTab === id
                  ? 'bg-bg text-text shadow-sm'
                  : 'text-text-secondary hover:text-text-secondary'
                }
              `}
            >
              {label}
            </button>
          ))}
        </div>

        {/* ── Dashboard (accessible via badge, not tab bar) ── */}
        {tab === 'dashboard' && <ProgressDashboard />}

        {/* ── Today tab ── */}
        {tab === 'today' && <DailyPractice />}

        {/* ── Library tab ── */}
        {tab === 'library' && <>

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

        </> /* end library tab */}
      </div>
    </main>
  )
}
