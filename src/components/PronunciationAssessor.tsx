'use client'

// ─── PronunciationAssessor ─────────────────────────────────────────────────────
//
// Records audio with MediaRecorder (works reliably on iOS Safari),
// then sends to Azure Speech REST API for pronunciation assessment.
//
// Flow: [Hold to speak] → recording → [Release] → results

import { useState, useRef, useCallback } from 'react'

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
  onAssessStart?: () => void
  onAssessDone?: () => void
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

export default function PronunciationAssessor({ phraseText, onAssessStart, onAssessDone }: Props) {
  const [status, setStatus] = useState<Status>('idle')
  const [result, setResult] = useState<AssessmentResult | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [recordingSec, setRecordingSec] = useState(0)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
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
      chunksRef.current = []

      // Pick best supported format for Azure
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', '']
        .find(t => !t || MediaRecorder.isTypeSupported(t)) ?? ''
      const mr = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      mediaRecorderRef.current = mr

      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      mr.start(250) // collect chunks every 250ms

      // Show recording duration
      timerRef.current = setInterval(() => setRecordingSec((s) => s + 1), 1000)
    } catch {
      setErrorMsg('Microphone access denied.')
      setStatus('error')
      onAssessDone?.()
    }
  }, [onAssessStart, onAssessDone])

  const stopAndAssess = useCallback(async () => {
    if (timerRef.current) clearInterval(timerRef.current)

    const mr = mediaRecorderRef.current
    if (!mr || mr.state === 'inactive') return

    setStatus('processing')

    // Stop recording and collect audio
    const audioBlob = await new Promise<Blob>((resolve) => {
      mr.onstop = () => {
        streamRef.current?.getTracks().forEach((t) => t.stop())
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || 'audio/webm' })
        resolve(blob)
      }
      mr.stop()
    })

    // Send audio to our server — it proxies to Azure (key stays server-side)
    try {
      const url = `/api/assess-pronunciation?text=${encodeURIComponent(phraseText)}`
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': audioBlob.type || 'audio/webm' },
        body: audioBlob,
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
      // Azure puts scores directly on NBest[0] (not nested in PronunciationAssessment)
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

      setResult({
        pronunciationScore: Math.round(pa.PronScore ?? pa.AccuracyScore ?? 0),
        accuracyScore: Math.round(pa.AccuracyScore ?? 0),
        fluencyScore: Math.round(pa.FluencyScore ?? 0),
        completenessScore: Math.round(pa.CompletenessScore ?? 0),
        words,
      })
      setStatus('done')
    } catch (err) {
      setErrorMsg(`Assessment failed: ${err instanceof Error ? err.message : err}`)
      setStatus('error')
    }

    onAssessDone?.()
  }, [phraseText, onAssessDone])

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
