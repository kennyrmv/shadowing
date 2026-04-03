'use client'

// ─── VideoClipPlayer ──────────────────────────────────────────────────────────
//
// Plays extracted video clips from R2 using native <video> element.
// Exposes the same imperative ref API as YouTubePlayer so parent components
// can swap between the two without changes.
//
// Advantages over YouTube IFrame:
//   - Precise looping via timeupdate event (no 100ms polling)
//   - Works offline (clip is a direct URL)
//   - No IFrame overhead
//   - Direct playbackRate control

import { useRef, useImperativeHandle, forwardRef, useCallback, useEffect } from 'react'
import type { YouTubePlayerRef } from './YouTubePlayer'

interface Props {
  clipUrl: string
  onReady?: () => void
  onStateChange?: (state: number) => void
  /** If true, automatically loop the clip */
  loop?: boolean
}

const VideoClipPlayer = forwardRef<YouTubePlayerRef, Props>(
  ({ clipUrl, onReady, onStateChange, loop = true }, ref) => {
    const videoRef = useRef<HTMLVideoElement>(null)

    // Expose same imperative API as YouTubePlayer
    useImperativeHandle(ref, () => ({
      seekTo: (seconds: number) => {
        const v = videoRef.current
        if (!v) return
        v.currentTime = seconds
        v.play().catch(() => { /* autoplay policy */ })
      },
      setRate: (rate: number) => {
        if (videoRef.current) videoRef.current.playbackRate = rate
      },
      getCurrentTime: () => videoRef.current?.currentTime ?? 0,
      pause: () => videoRef.current?.pause(),
      play: () => { videoRef.current?.play().catch(() => { /* autoplay policy */ }) },
    }))

    const handleLoadedData = useCallback(() => {
      onReady?.()
    }, [onReady])

    const handlePlay = useCallback(() => {
      onStateChange?.(1) // YT.PlayerState.PLAYING = 1
    }, [onStateChange])

    const handlePause = useCallback(() => {
      onStateChange?.(2) // YT.PlayerState.PAUSED = 2
    }, [onStateChange])

    const handleEnded = useCallback(() => {
      if (loop && videoRef.current) {
        videoRef.current.currentTime = 0
        videoRef.current.play().catch(() => {})
      } else {
        onStateChange?.(0) // YT.PlayerState.ENDED = 0
      }
    }, [loop, onStateChange])

    // Reset when clip URL changes
    useEffect(() => {
      const v = videoRef.current
      if (v) {
        v.load()
      }
    }, [clipUrl])

    return (
      <div className="w-full aspect-video bg-black rounded-xl overflow-hidden">
        <video
          ref={videoRef}
          src={clipUrl}
          playsInline // required for iOS inline playback
          preload="auto"
          onLoadedData={handleLoadedData}
          onPlay={handlePlay}
          onPause={handlePause}
          onEnded={handleEnded}
          className="w-full h-full object-contain"
          controls
        />
      </div>
    )
  }
)

VideoClipPlayer.displayName = 'VideoClipPlayer'
export default VideoClipPlayer
