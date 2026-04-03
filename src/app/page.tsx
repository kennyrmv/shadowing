'use client'

// ─── Homepage ──────────────────────────────────────────────────────────────────
//
// The full user flow:
//   1. User pastes a YouTube URL OR picks from library
//   2. App fetches transcript (or loads from library)
//   3. PhrasePlayer renders the video + phrase list
//   4. User clicks any phrase → it loops
//   5. User can save video to library for future sessions

import { useState, useTransition, useRef } from 'react'
import PhrasePlayer from '@/components/PhrasePlayer'
import ProgressDashboard from '@/components/ProgressDashboard'
import VideoLibrary from '@/components/VideoLibrary'
import DailyPractice from '@/components/DailyPractice'
import { Phrase } from '@/types'
import { useAppStore, SavedVideo } from '@/store/useAppStore'
import { scorePhrases } from '@/lib/scorePhrases'

type LoadState = 'idle' | 'loading' | 'loaded' | 'error'
type Tab = 'practice' | 'daily'

export default function HomePage() {
  const [tab, setTab] = useState<Tab>('practice')
  const [url, setUrl] = useState('')
  const [videoId, setVideoId] = useState<string | null>(null)
  const [phrases, setPhrases] = useState<Phrase[]>([])
  const [loadState, setLoadState] = useState<LoadState>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [isPending, startTransition] = useTransition()
  const videoTitleRef = useRef<string>('')

  const saveVideo = useAppStore((s) => s.saveVideo)
  const savedVideos = useAppStore((s) => s.savedVideos)

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
    setErrorMsg('')
  }

  function handleTitleReady(title: string) {
    videoTitleRef.current = title
  }

  const isLoading = loadState === 'loading' || isPending

  return (
    <main className="min-h-screen bg-gray-50">
      {/* ── Header ── */}
      <header className="border-b border-gray-100 bg-white px-4 py-4">
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <span className="text-2xl">🎙</span>
          <div>
            <h1 className="text-lg font-semibold text-gray-900 leading-none">Shadowing</h1>
            <p className="text-xs text-gray-400 mt-0.5">Loop any phrase. Master the rhythm.</p>
          </div>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        {/* ── Tabs ── */}
        <div className="flex gap-1 p-1 bg-gray-100 rounded-xl">
          {([
            { id: 'practice', label: '🎧 Practice' },
            { id: 'daily',    label: '📅 Daily' },
          ] as const).map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`
                flex-1 py-2 rounded-lg text-sm font-medium transition-colors
                ${tab === id
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
                }
              `}
            >
              {label}
            </button>
          ))}
        </div>

        {/* ── Daily Practice tab ── */}
        {tab === 'daily' && <DailyPractice />}

        {/* ── Practice tab ── */}
        {tab === 'practice' && <>

        {/* ── URL input ── */}
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Paste a YouTube URL... (e.g. https://youtube.com/watch?v=...)"
            className="
              flex-1 px-4 py-3 rounded-xl border border-gray-200 bg-white
              text-sm text-gray-800 placeholder:text-gray-400
              focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
              disabled:opacity-50
            "
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading || !url.trim()}
            className="
              px-5 py-3 bg-blue-600 text-white rounded-xl text-sm font-medium
              hover:bg-blue-700 transition-colors
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

        {/* ── Error state ── */}
        {loadState === 'error' && (
          <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3">
            <p className="text-sm text-red-600">{errorMsg}</p>
          </div>
        )}

        {/* ── Progress (always visible — the landing and the scoreboard) ── */}
        <ProgressDashboard />

        {/* ── Video Library ── */}
        {loadState !== 'loaded' && (
          <VideoLibrary onSelectVideo={handleSelectFromLibrary} />
        )}

        {/* ── Idle / hint ── */}
        {loadState === 'idle' && savedVideos.length === 0 && (
          <div className="text-center py-8 text-gray-400 space-y-2">
            <p className="text-4xl">🎧</p>
            <p className="text-sm font-medium">Paste a YouTube link to get started</p>
            <p className="text-xs">
              Works with TED Talks, podcasts, interviews — any video with subtitles
            </p>
            <div className="mt-4 text-xs text-gray-300 space-y-1">
              <p>Try: <span className="font-mono">https://youtube.com/watch?v=iG9CE55wbtY</span></p>
              <p className="text-gray-400 text-xs">(TED Talk: &quot;Do schools kill creativity?&quot;)</p>
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
                    ? 'bg-green-50 text-green-600 border border-green-200 cursor-default'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }
                `}
              >
                {isVideoSaved ? '✓ Saved to library' : '+ Save to library'}
              </button>
              {videoTitleRef.current && (
                <span className="text-sm text-gray-500 truncate">{videoTitleRef.current}</span>
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
          <div className="bg-yellow-50 border border-yellow-100 rounded-xl px-4 py-3">
            <p className="text-sm text-yellow-700">
              Transcript loaded but no phrases were detected. The video may have very short or unusual captions.
            </p>
          </div>
        )}

        </> /* end practice tab */}
      </div>
    </main>
  )
}
