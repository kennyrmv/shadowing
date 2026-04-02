'use client'

// ─── PronunciationAssessor ─────────────────────────────────────────────────────
//
// Uses Azure Cognitive Services Pronunciation Assessment to score the user's
// speech against the active phrase text.
//
// Flow:
//   [Assess] → 1s countdown (mic warms up) → "Speak now" → user speaks →
//   Azure auto-detects end of speech → scores shown

import { useState, useCallback } from 'react'

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

type Status = 'idle' | 'countdown' | 'listening' | 'processing' | 'done' | 'error'

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
  const [countdown, setCountdown] = useState(3)
  const [result, setResult] = useState<AssessmentResult | null>(null)
  const [errorMsg, setErrorMsg] = useState('')

  const runAssessment = useCallback(async () => {
    // Fetch Azure config from server
    let key: string, region: string
    try {
      const res = await fetch('/api/speech-config')
      if (!res.ok) throw new Error('not configured')
      const config = await res.json()
      key = config.key
      region = config.region
    } catch {
      setErrorMsg('Azure Speech not configured.')
      setStatus('error')
      return
    }

    setStatus('countdown')
    setResult(null)
    onAssessStart?.()

    // Countdown 3-2-1 so mic has time to initialize and user gets ready
    for (let i = 3; i >= 1; i--) {
      setCountdown(i)
      await new Promise((r) => setTimeout(r, 700))
    }

    setStatus('listening')

    try {
      const sdk = await import('microsoft-cognitiveservices-speech-sdk')

      const speechConfig = sdk.SpeechConfig.fromSubscription(key, region)
      speechConfig.speechRecognitionLanguage = 'en-US'
      // Give the user enough time to say the full phrase
      speechConfig.setProperty(sdk.PropertyId.SpeechServiceConnection_InitialSilenceTimeoutMs, '5000')
      speechConfig.setProperty(sdk.PropertyId.SpeechServiceConnection_EndSilenceTimeoutMs, '3000')

      const pronunciationConfig = new sdk.PronunciationAssessmentConfig(
        phraseText,
        sdk.PronunciationAssessmentGradingSystem.HundredMark,
        sdk.PronunciationAssessmentGranularity.Word,
        true
      )

      const audioConfig = sdk.AudioConfig.fromDefaultMicrophoneInput()
      const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig)
      pronunciationConfig.applyTo(recognizer)

      await new Promise<void>((resolve, reject) => {
        recognizer.recognizeOnceAsync(
          (sdkResult) => {
            recognizer.close()
            setStatus('processing')

            if (sdkResult.reason === sdk.ResultReason.NoMatch || !sdkResult.text) {
              setErrorMsg('Could not understand. Speak louder and closer to the mic.')
              setStatus('error')
              onAssessDone?.()
              resolve()
              return
            }

            try {
              const assessment = sdk.PronunciationAssessmentResult.fromResult(sdkResult)
              const jsonStr = sdkResult.properties.getProperty(
                sdk.PropertyId.SpeechServiceResponse_JsonResult
              )
              const json = JSON.parse(jsonStr)
              const rawWords: Array<{
                Word: string
                PronunciationAssessment?: { AccuracyScore?: number; ErrorType?: string }
              }> = json?.NBest?.[0]?.Words ?? []

              const words: WordResult[] = rawWords.map((w) => ({
                word: w.Word,
                accuracyScore: w.PronunciationAssessment?.AccuracyScore ?? 0,
                errorType: (w.PronunciationAssessment?.ErrorType ?? 'None') as WordResult['errorType'],
              }))

              setResult({
                pronunciationScore: Math.round(assessment.pronunciationScore),
                accuracyScore: Math.round(assessment.accuracyScore),
                fluencyScore: Math.round(assessment.fluencyScore),
                completenessScore: Math.round(assessment.completenessScore),
                words,
              })
              setStatus('done')
            } catch {
              setErrorMsg('Could not parse assessment result.')
              setStatus('error')
            }

            onAssessDone?.()
            resolve()
          },
          (err) => {
            recognizer.close()
            setErrorMsg(`Assessment failed: ${err}`)
            setStatus('error')
            onAssessDone?.()
            reject(err)
          }
        )
      })
    } catch (err) {
      setErrorMsg(`Could not start: ${err instanceof Error ? err.message : err}`)
      setStatus('error')
      onAssessDone?.()
    }
  }, [phraseText, onAssessStart, onAssessDone])

  return (
    <div className="space-y-3">
      {/* Trigger / retry button */}
      {(status === 'idle' || status === 'error' || status === 'done') && (
        <button
          onClick={runAssessment}
          className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 transition-colors"
        >
          <span>🎤</span>
          {status === 'done' ? 'Assess again' : 'Check pronunciation'}
        </button>
      )}

      {/* Countdown */}
      {status === 'countdown' && (
        <div className="flex items-center gap-3 px-4 py-3 bg-purple-50 border border-purple-200 rounded-lg">
          <span className="text-2xl font-bold text-purple-600 w-8 text-center">{countdown}</span>
          <span className="text-sm text-purple-700">Get ready to speak the phrase...</span>
        </div>
      )}

      {/* Listening */}
      {status === 'listening' && (
        <div className="flex items-center gap-3 px-4 py-2 bg-purple-50 border border-purple-200 rounded-lg">
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-purple-600" />
          </span>
          <span className="text-sm text-purple-700 font-medium">Listening — speak now!</span>
        </div>
      )}

      {/* Processing */}
      {status === 'processing' && (
        <div className="text-sm text-gray-400 px-1">Analyzing...</div>
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
                  title={`${w.accuracyScore}/100${w.errorType !== 'None' ? ` — ${w.errorType}` : ''}`}
                  className={`
                    text-sm font-medium px-1.5 py-0.5 rounded
                    ${w.errorType === 'Omission'
                      ? 'line-through text-gray-300'
                      : w.errorType === 'Insertion'
                        ? 'text-gray-400 italic'
                        : scoreColor(w.accuracyScore)
                    }
                  `}
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
