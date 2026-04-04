'use client'

import { useAppStore, SavedVideo } from '@/store/useAppStore'

interface Props {
  onSelectVideo: (video: SavedVideo) => void
}

function shortDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function VideoLibrary({ onSelectVideo }: Props) {
  const savedVideos = useAppStore((s) => s.savedVideos)
  const removeVideo = useAppStore((s) => s.removeVideo)

  if (savedVideos.length === 0) return null

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-text-secondary">My Library</h2>
        <span className="text-xs text-text-muted">{savedVideos.length}/20 videos</span>
      </div>
      <div className="grid gap-2">
        {savedVideos.map((video) => (
          <button
            key={video.videoId}
            onClick={() => onSelectVideo(video)}
            className="w-full text-left bg-white border border-border rounded-[12px] px-4 py-3 hover:bg-surface transition-colors group"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-text truncate">
                  {video.title || video.videoId}
                </p>
                <p className="text-xs text-text-muted mt-0.5">
                  {video.totalPhrases} phrases · saved {shortDate(video.savedAt)}
                </p>
              </div>
              <span
                onClick={(e) => { e.stopPropagation(); removeVideo(video.videoId) }}
                className="text-text-muted hover:text-red-400 text-xs opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer shrink-0 mt-1"
                title="Remove from library"
              >
                ✕
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
