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
  selectMode?: boolean
  selectedIds?: Set<string>
  extractedIds?: Set<string>
  onToggleSelect?: (phraseId: string) => void
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function PhraseList({ phrases, activePhraseId, onPhraseClick, loopState, onMerge, selectMode, selectedIds, extractedIds, onToggleSelect }: Props) {
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
      <div className="text-center py-12 text-text-muted">
        No phrases yet. Paste a YouTube URL above.
      </div>
    )
  }

  return (
    <div>
      <p className="text-sm text-text-muted mb-2 px-1">
        {phrases.length} phrases — click any to start looping
      </p>

      {/* Scrollable container — TanStack Virtual needs a fixed height */}
      <div
        ref={parentRef}
        className="h-[420px] overflow-y-auto rounded-[12px] border border-border bg-bg"
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
                    onClick={() => selectMode && onToggleSelect ? onToggleSelect(phrase.id) : handleClick(phrase)}
                    className={`
                      w-full text-left px-4 py-3 border-b border-surface
                      transition-colors duration-100 flex items-start gap-3
                      ${isActive && !selectMode
                        ? 'bg-primary-light border-l-2 border-l-primary'
                        : selectMode && selectedIds?.has(phrase.id)
                          ? 'bg-primary-light border-l-2 border-l-primary'
                          : 'hover:bg-surface'
                      }
                    `}
                  >
                    {/* Select checkbox or extracted badge */}
                    {selectMode ? (
                      <span className={`
                        mt-0.5 w-5 h-5 shrink-0 rounded border-2 flex items-center justify-center text-xs
                        ${selectedIds?.has(phrase.id)
                          ? 'bg-primary border-primary text-white'
                          : extractedIds?.has(phrase.id)
                            ? 'bg-success-light border-success/40 text-success'
                            : 'border-text-muted'
                        }
                      `}>
                        {selectedIds?.has(phrase.id) ? '✓' : extractedIds?.has(phrase.id) ? '✓' : ''}
                      </span>
                    ) : extractedIds?.has(phrase.id) ? (
                      <span className="mt-0.5 w-5 h-5 shrink-0 rounded-full bg-success-light text-success flex items-center justify-center text-xs" title="Clip extracted">
                        ✓
                      </span>
                    ) : null}

                    {/* Timestamp */}
                    <span className="text-xs font-mono text-text-muted mt-0.5 w-10 shrink-0">
                      {formatTime(phrase.startTime)}
                    </span>

                    {/* Phrase text */}
                    <span className={`
                      text-sm leading-snug flex-1
                      ${isActive ? 'text-primary font-medium' : 'text-text-secondary'}
                    `}>
                      {phrase.text}
                    </span>

                    {/* Right side: difficulty badge + duration + playing indicator */}
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      {phrase.difficulty && (
                        <span className={`
                          text-xs px-1.5 py-0.5 rounded font-medium
                          ${phrase.difficulty.overall === 'easy' ? 'bg-success-light text-success' : ''}
                          ${phrase.difficulty.overall === 'medium' ? 'bg-warning-light text-warning' : ''}
                          ${phrase.difficulty.overall === 'hard' ? 'bg-error-light text-error' : ''}
                        `}>
                          {phrase.difficulty.overall}
                        </span>
                      )}
                      <span className="text-xs text-text-muted font-mono">
                        {phrase.duration.toFixed(1)}s
                      </span>
                      {isPlaying && (
                        <span className="text-xs text-success">⟳</span>
                      )}
                      {isActive && loopState === 'paused' && (
                        <span className="text-xs text-text-muted">⏸</span>
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
                        bg-bg border border-border rounded-full px-2 py-0.5
                        text-xs text-text-muted hover:text-primary hover:border-primary/30
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
