'use client'

// ─── YouTubePlayer ─────────────────────────────────────────────────────────────
//
// Embeds a YouTube video via the official IFrame API and exposes:
//   - seekTo(seconds)   → jump to a specific time
//   - setRate(rate)     → change playback speed (0.25 – 2.0)
//   - getCurrentTime()  → read current playback position
//
// The LOOP is managed by the parent (PhrasePlayer) via a polling interval.
// This component only handles the YouTube player lifecycle.
//
// Data flow:
//   Parent sets activePhrase → calls seekTo(phrase.startTime) → loop polls
//   currentTime → when >= phrase.startTime + phrase.duration → calls seekTo again

import { useEffect, useRef, useImperativeHandle, forwardRef } from 'react'

// ─── YouTube IFrame API types (subset we use) ──────────────────────────────────
declare global {
  interface Window {
    YT: {
      Player: new (
        el: HTMLElement,
        opts: {
          videoId: string
          playerVars?: Record<string, unknown>
          events?: {
            onReady?: (e: { target: YTPlayer }) => void
            onStateChange?: (e: { data: number }) => void
          }
        }
      ) => YTPlayer
      PlayerState: { PLAYING: number; PAUSED: number; ENDED: number }
    }
    onYouTubeIframeAPIReady?: () => void
  }
}

interface YTPlayer {
  seekTo(seconds: number, allowSeekAhead: boolean): void
  setPlaybackRate(rate: number): void
  getCurrentTime(): number
  getPlayerState(): number
  getVideoData(): { title: string; video_id: string }
  playVideo(): void
  pauseVideo(): void
  destroy(): void
}

// ─── Public ref API ────────────────────────────────────────────────────────────
export interface YouTubePlayerRef {
  seekTo(seconds: number): void
  setRate(rate: number): void
  getCurrentTime(): number
  pause(): void
  play(): void
}

interface Props {
  videoId: string
  onReady?: () => void
  onStateChange?: (state: number) => void
  onTitleReady?: (title: string) => void
}

// ─── Load the YouTube IFrame API script once ───────────────────────────────────
let apiLoaded = false
let apiCallbacks: (() => void)[] = []

function loadYouTubeAPI(onReady: () => void) {
  if (apiLoaded || window.YT) { apiLoaded = true; onReady(); return }
  apiCallbacks.push(onReady)
  if (document.getElementById('yt-iframe-api')) return // script already injected, wait for callback

  const script = document.createElement('script')
  script.id = 'yt-iframe-api'
  script.src = 'https://www.youtube.com/iframe_api'
  document.head.appendChild(script)

  window.onYouTubeIframeAPIReady = () => {
    apiLoaded = true
    apiCallbacks.forEach((cb) => cb())
    apiCallbacks = []
  }
}

// ─── Component ────────────────────────────────────────────────────────────────
const YouTubePlayer = forwardRef<YouTubePlayerRef, Props>(
  ({ videoId, onReady, onStateChange, onTitleReady }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null)
    const playerRef = useRef<YTPlayer | null>(null)

    // Expose imperative API to parent
    useImperativeHandle(ref, () => ({
      seekTo: (seconds: number) => {
        playerRef.current?.seekTo(seconds, true)
        playerRef.current?.playVideo()
      },
      setRate: (rate: number) => {
        playerRef.current?.setPlaybackRate(rate)
      },
      getCurrentTime: () => playerRef.current?.getCurrentTime() ?? 0,
      pause: () => playerRef.current?.pauseVideo(),
      play: () => playerRef.current?.playVideo(),
    }))

    useEffect(() => {
      if (!containerRef.current) return

      loadYouTubeAPI(() => {
        if (!containerRef.current) return
        playerRef.current?.destroy()

        playerRef.current = new window.YT.Player(containerRef.current, {
          videoId,
          playerVars: {
            autoplay: 0,
            controls: 1,          // show native controls
            rel: 0,               // don't show related videos
            modestbranding: 1,
            origin: window.location.origin,
          },
          events: {
            onReady: (e) => {
              onReady?.()
              try {
                const title = e.target.getVideoData()?.title
                if (title) onTitleReady?.(title)
              } catch { /* title unavailable */ }
            },
            onStateChange: (e) => onStateChange?.(e.data),
          },
        })
      })

      return () => {
        playerRef.current?.destroy()
        playerRef.current = null
      }
    }, [videoId]) // eslint-disable-line react-hooks/exhaustive-deps

    return (
      <div className="w-full aspect-video bg-black rounded-xl overflow-hidden">
        <div ref={containerRef} className="w-full h-full" />
      </div>
    )
  }
)

YouTubePlayer.displayName = 'YouTubePlayer'
export default YouTubePlayer
