'use client'

// ─── PronunciationAssessor ─────────────────────────────────────────────────────
//
// Records audio via AudioContext (raw PCM → WAV) so Azure receives a format
// it can reliably decode, avoiding the SNR:0 issue with WebM/Opus on Android.
//
// Flow: [Hold to speak] → recording → [Done] → WAV sent to /api/assess-pronunciation → results

import { useState, useRef, useCallback } from 'react'
import { useAppStore } from '@/store/useAppStore'
import type { ScoreRecord } from '@/store/useAppStore'
import type { AzureScores } from '@/lib/autoRate'

interface WordResult {
  word: string
  accuracyScore: number
  errorType: 'None' | 'Mispronunciation' | 'Omission' | 'Insertion' | string
}

interface AssessmentResult {
  pronunciationScore: number
  accuracyScore: number
  fluencyScore: number
  completenessScore: number
  words: WordResult[]
}

type Status = 'idle' | 'recording' | 'processing' | 'done' | 'error'

interface Props {
  phraseText: string
  phraseId?: string
  videoId?: string
  onAssessStart?: () => void
  onAssessDone?: () => void
  onScoreReady?: (scores: AzureScores) => void
}

function scoreColor(score: number): string {
  if (score >= 80) return 'text-green-600'
  if (score >= 50) return 'text-yellow-500'
  return 'text-red-500'
}

function scoreBg(score: number): string {
  if (score >= 80) return 'bg-green-50 border-green-200 text-green-700'
  if (score >= 50) return 'bg-yellow-50 border-yellow-200 text-yellow-700'
  return 'bg-red-50 border-red-200 text-red-600'
}

/** Encode Float32 PCM samples as a WAV blob (16-bit mono) */
function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const int16 = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  const buf = new ArrayBuffer(44 + int16.byteLength)
  const v = new DataView(buf)
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i))
  }
  str(0, 'RIFF'); v.setUint32(4, 36 + int16.byteLength, true); str(8, 'WAVE')
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true)   // PCM
  v.setUint16(22, 1, true)                                                // mono
  v.setUint32(24, sampleRate, true)                                       // sample rate
  v.setUint32(28, sampleRate * 2, true)                                   // byte rate
  v.setUint16(32, 2, true); v.setUint16(34, 16, true)                    // block align, bits
  str(36, 'data'); v.setUint32(40, int16.byteLength, true)
  new Int16Array(buf, 44).set(int16)
  return new Blob([buf], { type: 'audio/wav' })
}

export default function PronunciationAssessor({ phraseText, phraseId, videoId, onAssessStart, onAssessDone, onScoreReady }: Props) {
  const [status, setStatus] = useState<Status>('idle')
  const [result, setResult] = useState<AssessmentResult | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [recordingSec, setRecordingSec] = useState(0)

  const addScore = useAppStore((s) => s.addScore)

  const streamRef = useRef<MediaStream | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const samplesRef = useRef<Float32Array[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const startRecording = useCallback(async () => {
    setStatus('recording')
    setResult(null)
    setRecordingSec(0)
    onAssessStart?.()

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }
      })
      streamRef.current = stream
      samplesRef.current = []

      // Use AudioContext to capture raw PCM — avoids WebM/Opus codec issues with Azure
      const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const audioCtx = new AudioCtx({ sampleRate: 16000 })
      audioCtxRef.current = audioCtx

      const source = audioCtx.createMediaStreamSource(stream)
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      const processor = audioCtx.createScriptProcessor(4096, 1, 1)
      processorRef.current = processor

      processor.onaudioprocess = (e) => {
        samplesRef.current.push(new Float32Array(e.inputBuffer.getChannelData(0)))
      }

      source.connect(processor)
      processor.connect(audioCtx.destination)

      timerRef.current = setInterval(() => setRecordingSec((s) => s + 1), 1000)
    } catch {
      setErrorMsg('Microphone access denied.')
      setStatus('error')
      onAssessDone?.()
    }
  }, [onAssessStart, onAssessDone])

  const stopAndAssess = useCallback(async () => {
    if (timerRef.current) clearInterval(timerRef.current)

    const processor = processorRef.current
    if (!processor) return
    processor.disconnect()
    processorRef.current = null

    // Stop mic tracks
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null

    const audioCtx = audioCtxRef.current
    audioCtxRef.current = null

    setStatus('processing')

    // Combine PCM samples and encode as WAV
    const allSamples = samplesRef.current
    samplesRef.current = []
    const totalLength = allSamples.reduce((sum, arr) => sum + arr.length, 0)
    const combined = new Float32Array(totalLength)
    let off = 0
    for (const arr of allSamples) { combined.set(arr, off); off += arr.length }

    const sampleRate = audioCtx?.sampleRate ?? 16000
    const wavBlob = encodeWav(combined, sampleRate)
    await audioCtx?.close()

    // Send WAV to server proxy → Azure
    try {
      const url = `/api/assess-pronunciation?text=${encodeURIComponent(phraseText)}`
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'audio/wav' },
        body: wavBlob,
      })

      if (!res.ok) {
        const text = await res.text()
        throw new Error(`Azure error ${res.status}: ${text}`)
      }

      const json = await res.json()

      if (!json.NBest?.[0]) {
        setErrorMsg('Could not understand. Try speaking more clearly.')
        setStatus('error')
        onAssessDone?.()
        return
      }

      const best = json.NBest[0]
      // Azure returns scores directly on NBest[0] (not nested in PronunciationAssessment)
      const pa = best.PronunciationAssessment ?? best

      const words: WordResult[] = (best.Words ?? []).map((w: {
        Word: string
        AccuracyScore?: number
        ErrorType?: string
        PronunciationAssessment?: { AccuracyScore?: number; ErrorType?: string }
      }) => ({
        word: w.Word,
        accuracyScore: w.AccuracyScore ?? w.PronunciationAssessment?.AccuracyScore ?? 0,
        errorType: (w.ErrorType ?? w.PronunciationAssessment?.ErrorType ?? 'None') as WordResult['errorType'],
      }))

      const pronunciation = Math.round(pa.PronScore ?? pa.AccuracyScore ?? 0)
      const accuracy = Math.round(pa.AccuracyScore ?? 0)
      const fluency = Math.round(pa.FluencyScore ?? 0)
      const completeness = Math.round(pa.CompletenessScore ?? 0)

      if (phraseId) {
        const record: ScoreRecord = {
          id: `${phraseId}:${Date.now()}`,
          phraseId,
          videoId: videoId ?? '',
          timestamp: new Date().toISOString(),
          pronunciation,
          accuracy,
          fluency,
          completeness,
          words: words.map((w) => ({ word: w.word, accuracy: w.accuracyScore, errorType: w.errorType })),
        }
        addScore(record)
      }

      onScoreReady?.({ accuracy, fluency, completeness })

      setResult({ pronunciationScore: pronunciation, accuracyScore: accuracy, fluencyScore: fluency, completenessScore: completeness, words })
      setStatus('done')
    } catch (err) {
      setErrorMsg(`Assessment failed: ${err instanceof Error ? err.message : err}`)
      setStatus('error')
    }

    onAssessDone?.()
  }, [phraseText, phraseId, videoId, addScore, onAssessDone, onScoreReady])

  return (
    <div className="space-y-3">
      {/* Idle / retry */}
      {(status === 'idle' || status === 'error' || status === 'done') && (
        <button
          onPointerDown={startRecording}
          className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 active:bg-purple-800 transition-colors select-none"
        >
          <span>🎤</span>
          {status === 'done' ? 'Assess again — hold & speak' : 'Hold & speak the phrase'}
        </button>
      )}

      {/* Recording */}
      {status === 'recording' && (
        <div className="space-y-2">
          <div className="flex items-center gap-3 px-4 py-2 bg-red-50 border border-red-200 rounded-lg">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-red-600" />
            </span>
            <span className="text-sm text-red-700 font-medium">Recording... {recordingSec}s</span>
          </div>
          <button
            onPointerUp={stopAndAssess}
            onClick={stopAndAssess}
            className="w-full py-2 bg-red-600 text-white rounded-lg text-sm font-medium"
          >
            Done — tap to analyze
          </button>
        </div>
      )}

      {/* Processing */}
      {status === 'processing' && (
        <div className="text-sm text-gray-400 px-1">Analyzing your pronunciation...</div>
      )}

      {/* Error */}
      {status === 'error' && (
        <p className="text-xs text-red-500 px-1">{errorMsg}</p>
      )}

      {/* Results */}
      {status === 'done' && result && (
        <div className="space-y-3">
          <div className={`flex items-center justify-between px-4 py-3 rounded-lg border ${scoreBg(result.pronunciationScore)}`}>
            <span className="text-sm font-medium">Pronunciation score</span>
            <span className="text-2xl font-bold">{result.pronunciationScore}</span>
          </div>

          <div className="bg-gray-50 rounded-lg px-4 py-3">
            <p className="text-xs text-gray-400 mb-2">Word accuracy</p>
            <div className="flex flex-wrap gap-1.5">
              {result.words.map((w, i) => (
                <span
                  key={i}
                  title={`${w.accuracyScore}/100`}
                  className={`text-sm font-medium px-1.5 py-0.5 rounded ${
                    w.errorType === 'Omission' ? 'line-through text-gray-300' :
                    w.errorType === 'Insertion' ? 'text-gray-400 italic' :
                    scoreColor(w.accuracyScore)
                  }`}
                >
                  {w.word}
                </span>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              { label: 'Accuracy', value: result.accuracyScore },
              { label: 'Fluency', value: result.fluencyScore },
              { label: 'Complete', value: result.completenessScore },
            ].map(({ label, value }) => (
              <div key={label} className="bg-gray-50 rounded-lg py-2">
                <p className={`text-lg font-bold ${scoreColor(value)}`}>{value}</p>
                <p className="text-xs text-gray-400">{label}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
