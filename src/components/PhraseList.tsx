'use client'

// ─── PhraseList ────────────────────────────────────────────────────────────────
//
// Displays the list of phrases with virtual scrolling (TanStack Virtual).
// Only renders the phrases visible in the viewport — handles 400+ items smoothly.
//
// Each phrase row shows:
//   - Timestamp (0:34)
//   - The phrase text
//   - Duration badge
//   - Active/playing indicator

import { useRef, useCallback } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Phrase, LoopState } from '@/types'

interface Props {
  phrases: Phrase[]
  activePhraseId: string | null
  onPhraseClick: (phrase: Phrase) => void
  loopState: LoopState
  onMerge: (phraseId: string) => void
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function PhraseList({ phrases, activePhraseId, onPhraseClick, loopState, onMerge }: Props) {
  const parentRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: phrases.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 72,     // estimated row height in px
    overscan: 5,                // render 5 extra rows above/below viewport
  })

  const handleClick = useCallback(
    (phrase: Phrase) => onPhraseClick(phrase),
    [onPhraseClick]
  )

  if (!phrases.length) {
    return (
      <div className="text-center py-12 text-gray-400">
        No phrases yet. Paste a YouTube URL above.
      </div>
    )
  }

  return (
    <div>
      <p className="text-sm text-gray-400 mb-2 px-1">
        {phrases.length} phrases — click any to start looping
      </p>

      {/* Scrollable container — TanStack Virtual needs a fixed height */}
      <div
        ref={parentRef}
        className="h-[420px] overflow-y-auto rounded-xl border border-gray-100 bg-white"
      >
        {/* Total height spacer so the scrollbar is proportional */}
        <div
          style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const phrase = phrases[virtualRow.index]
            const isActive = phrase.id === activePhraseId
            const isPlaying = isActive && loopState === 'playing'

            return (
              <div
                key={phrase.id}
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <div className="group relative">
                  <button
                    onClick={() => handleClick(phrase)}
                    className={`
                      w-full text-left px-4 py-3 border-b border-gray-50
                      transition-colors duration-100 flex items-start gap-3
                      ${isActive
                        ? 'bg-blue-50 border-l-2 border-l-blue-500'
                        : 'hover:bg-gray-50'
                      }
                    `}
                  >
                    {/* Timestamp */}
                    <span className="text-xs font-mono text-gray-400 mt-0.5 w-10 shrink-0">
                      {formatTime(phrase.startTime)}
                    </span>

                    {/* Phrase text */}
                    <span className={`
                      text-sm leading-snug flex-1
                      ${isActive ? 'text-blue-700 font-medium' : 'text-gray-700'}
                    `}>
                      {phrase.text}
                    </span>

                    {/* Right side: difficulty badge + duration + playing indicator */}
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      {phrase.difficulty && (
                        <span className={`
                          text-xs px-1.5 py-0.5 rounded font-medium
                          ${phrase.difficulty.overall === 'easy' ? 'bg-green-100 text-green-600' : ''}
                          ${phrase.difficulty.overall === 'medium' ? 'bg-yellow-100 text-yellow-600' : ''}
                          ${phrase.difficulty.overall === 'hard' ? 'bg-red-100 text-red-600' : ''}
                        `}>
                          {phrase.difficulty.overall}
                        </span>
                      )}
                      <span className="text-xs text-gray-300 font-mono">
                        {phrase.duration.toFixed(1)}s
                      </span>
                      {isPlaying && (
                        <span className="text-xs text-green-500">⟳</span>
                      )}
                      {isActive && loopState === 'paused' && (
                        <span className="text-xs text-gray-400">⏸</span>
                      )}
                    </div>
                  </button>

                  {/* Merge with next — visible on hover, hidden on last phrase */}
                  {virtualRow.index < phrases.length - 1 && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onMerge(phrase.id) }}
                      title="Merge with next phrase"
                      className="
                        absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2
                        opacity-0 group-hover:opacity-100 transition-opacity z-10
                        bg-white border border-gray-200 rounded-full px-2 py-0.5
                        text-xs text-gray-400 hover:text-blue-500 hover:border-blue-300
                        leading-none shadow-sm
                      "
                    >
                      + merge
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
