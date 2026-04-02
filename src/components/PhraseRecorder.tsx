'use client'

// ─── PhraseRecorder ────────────────────────────────────────────────────────────
//
// Records the user's voice and shows a waveform using WaveSurfer.js.
//
// NOTE: In v1, we only show the USER's recording waveform.
// Native speaker waveform comparison requires downloading YouTube audio,
// which is blocked by browser CORS rules. See TODOS.md for Phase 2.
//
// Flow:
//   [Record] clicked → MediaRecorder starts → user shadows the phrase
//   [Stop] clicked   → recording stops → WaveSurfer renders waveform
//   User plays back their recording → rates it (Hard / Good / Easy)

import { useState, useRef, useEffect } from 'react'
import { SRSRating } from '@/types'

interface Props {
  onRate: (rating: SRSRating) => void
  isQueued: boolean
  onAddToQueue: () => void
}

type RecordState = 'idle' | 'recording' | 'recorded'

export default function PhraseRecorder({ onRate, isQueued, onAddToQueue }: Props) {
  const [recordState, setRecordState] = useState<RecordState>('idle')
  const [hasPermission, setHasPermission] = useState<boolean | null>(null)
  const [audioBlobUrl, setAudioBlobUrl] = useState<string | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [duration, setDuration] = useState(0)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const waveformRef = useRef<HTMLDivElement>(null)
  const wavesurferRef = useRef<unknown>(null)

  // Lazy-load WaveSurfer (it's a large library, don't load on page load)
  async function initWaveSurfer(blob: Blob) {
    if (!waveformRef.current) return
    const { default: WaveSurfer } = await import('wavesurfer.js')

    // Destroy previous instance
    if (wavesurferRef.current) {
      (wavesurferRef.current as { destroy: () => void }).destroy()
    }

    const url = URL.createObjectURL(blob)
    setAudioBlobUrl(url)

    const ws = WaveSurfer.create({
      container: waveformRef.current,
      waveColor: '#93c5fd',      // blue-300
      progressColor: '#2563eb',  // blue-600
      cursorColor: '#1d4ed8',    // blue-700
      height: 64,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      url,
    })

    ws.on('ready', () => setDuration(ws.getDuration()))
    ws.on('finish', () => setIsPlaying(false))

    wavesurferRef.current = ws
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      setHasPermission(true)
      chunksRef.current = []

      const mr = new MediaRecorder(stream)
      mediaRecorderRef.current = mr

      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      mr.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        stream.getTracks().forEach((t) => t.stop())
        await initWaveSurfer(blob)
        setRecordState('recorded')
      }

      mr.start()
      setRecordState('recording')
    } catch (err) {
      if (err instanceof DOMException && err.name === 'NotAllowedError') {
        setHasPermission(false)
      }
    }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop()
  }

  function togglePlayback() {
    if (!wavesurferRef.current) return
    const ws = wavesurferRef.current as { playPause: () => void }
    ws.playPause()
    setIsPlaying(!isPlaying)
  }

  function resetRecording() {
    if (wavesurferRef.current) {
      (wavesurferRef.current as { destroy: () => void }).destroy()
      wavesurferRef.current = null
    }
    if (audioBlobUrl) URL.revokeObjectURL(audioBlobUrl)
    setAudioBlobUrl(null)
    setRecordState('idle')
    setIsPlaying(false)
    setDuration(0)
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (wavesurferRef.current) {
        (wavesurferRef.current as { destroy: () => void }).destroy()
      }
      if (audioBlobUrl) URL.revokeObjectURL(audioBlobUrl)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Check browser support
  const isSupported = typeof window !== 'undefined' && !!navigator.mediaDevices?.getUserMedia

  if (!isSupported) {
    return (
      <div className="text-xs text-gray-400 px-1">
        Recording not supported in this browser. Try Chrome or Firefox.
      </div>
    )
  }

  if (hasPermission === false) {
    return (
      <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-xs text-red-600">
        Microphone access denied. Allow microphone in browser settings to record.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* ── Add to drill queue button ── */}
      <button
        onClick={onAddToQueue}
        disabled={isQueued}
        className={`
          w-full py-2 rounded-lg text-sm font-medium transition-colors
          ${isQueued
            ? 'bg-green-50 text-green-600 border border-green-200 cursor-default'
            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }
        `}
      >
        {isQueued ? '✓ In drill queue' : '+ Add to drill queue'}
      </button>

      {/* ── Record controls ── */}
      <div className="flex items-center gap-2">
        {recordState === 'idle' && (
          <button
            onClick={startRecording}
            className="flex items-center gap-2 px-4 py-2 bg-red-500 text-white rounded-lg text-sm font-medium hover:bg-red-600 transition-colors"
          >
            <span className="w-2 h-2 bg-white rounded-full" />
            Record yourself
          </button>
        )}

        {recordState === 'recording' && (
          <button
            onClick={stopRecording}
            className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium animate-pulse"
          >
            <span className="w-2 h-2 bg-white rounded-sm" />
            Stop recording
          </button>
        )}

        {recordState === 'recorded' && (
          <>
            <button
              onClick={togglePlayback}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
            >
              {isPlaying ? '⏸ Pause' : '▶ Play back'}
            </button>
            <button
              onClick={resetRecording}
              className="px-3 py-2 text-gray-500 hover:text-gray-700 text-sm"
            >
              Re-record
            </button>
          </>
        )}
      </div>

      {/* ── Waveform ── */}
      {recordState === 'recorded' && (
        <div className="space-y-3">
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-xs text-gray-400 mb-2">Your recording ({duration.toFixed(1)}s)</p>
            <div ref={waveformRef} />
          </div>

          {/* ── SRS rating ── */}
          <div>
            <p className="text-xs text-gray-500 mb-2">How did it feel?</p>
            <div className="flex gap-2">
              {([
                { rating: 1 as SRSRating, label: 'Hard', color: 'bg-red-100 text-red-700 hover:bg-red-200' },
                { rating: 3 as SRSRating, label: 'Good', color: 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200' },
                { rating: 5 as SRSRating, label: 'Easy', color: 'bg-green-100 text-green-700 hover:bg-green-200' },
              ] as const).map(({ rating, label, color }) => (
                <button
                  key={rating}
                  onClick={() => { onRate(rating); resetRecording() }}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${color}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-300 mt-1 text-center">
              This tells the app when to show you this phrase again
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
