'use client'

// ─── PronunciationAssessor ─────────────────────────────────────────────────────
//
// Uses Azure Cognitive Services Pronunciation Assessment to score the user's
// speech against the active phrase text.
//
// Flow:
//   [Assess] → mic opens → user speaks → Azure scores → results shown
//
// Scoring (per word):
//   AccuracyScore >= 80 → green (good)
//   AccuracyScore >= 50 → yellow (needs work)
//   AccuracyScore <  50 → red (incorrect)
//   ErrorType "Omission" → gray strikethrough (skipped)
//   ErrorType "Insertion" → shown in brackets

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

type Status = 'idle' | 'listening' | 'processing' | 'done' | 'error'

interface Props {
  phraseText: string
  onAssessStart?: () => void   // so PhrasePlayer can pause the loop
  onAssessDone?: () => void    // so PhrasePlayer can resume
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

  const runAssessment = useCallback(async () => {
    // Fetch config from server at runtime — key is never embedded in client bundle
    let key: string, region: string
    try {
      const res = await fetch('/api/speech-config')
      if (!res.ok) throw new Error('not configured')
      const config = await res.json()
      key = config.key
      region = config.region
    } catch {
      setErrorMsg('Azure Speech not configured. Add NEXT_PUBLIC_AZURE_SPEECH_KEY to Railway variables.')
      setStatus('error')
      return
    }

    setStatus('listening')
    setResult(null)
    onAssessStart?.()

    try {
      // Lazy-load the SDK — it's large (~7MB), only load when needed
      const sdk = await import('microsoft-cognitiveservices-speech-sdk')

      const speechConfig = sdk.SpeechConfig.fromSubscription(key, region)
      speechConfig.speechRecognitionLanguage = 'en-US'

      const pronunciationConfig = new sdk.PronunciationAssessmentConfig(
        phraseText,
        sdk.PronunciationAssessmentGradingSystem.HundredMark,
        sdk.PronunciationAssessmentGranularity.Word,
        true  // enable miscue (detects omissions and insertions)
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
              setErrorMsg('Could not understand speech. Speak clearly and try again.')
              setStatus('error')
              onAssessDone?.()
              resolve()
              return
            }

            try {
              // Overall scores via SDK helper
              const assessment = sdk.PronunciationAssessmentResult.fromResult(sdkResult)

              // Word-level scores from the raw JSON response
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
            } catch (parseErr) {
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
      setErrorMsg(`Could not start assessment: ${err instanceof Error ? err.message : err}`)
      setStatus('error')
      onAssessDone?.()
    }
  }, [phraseText, onAssessStart, onAssessDone])

  return (
    <div className="space-y-3">
      {/* ── Trigger button ── */}
      {(status === 'idle' || status === 'error' || status === 'done') && (
        <button
          onClick={runAssessment}
          className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 transition-colors"
        >
          <span>🎤</span>
          {status === 'done' ? 'Assess again' : 'Check pronunciation'}
        </button>
      )}

      {/* ── Listening state ── */}
      {status === 'listening' && (
        <div className="flex items-center gap-3 px-4 py-2 bg-purple-50 border border-purple-200 rounded-lg">
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-purple-600" />
          </span>
          <span className="text-sm text-purple-700 font-medium">Listening... speak the phrase</span>
        </div>
      )}

      {/* ── Processing ── */}
      {status === 'processing' && (
        <div className="text-sm text-gray-400 px-1">Analyzing...</div>
      )}

      {/* ── Error ── */}
      {status === 'error' && (
        <p className="text-xs text-red-500 px-1">{errorMsg}</p>
      )}

      {/* ── Results ── */}
      {status === 'done' && result && (
        <div className="space-y-3">
          {/* Overall score */}
          <div className={`flex items-center justify-between px-4 py-3 rounded-lg border ${scoreBg(result.pronunciationScore)}`}>
            <span className="text-sm font-medium">Pronunciation score</span>
            <span className="text-2xl font-bold">{result.pronunciationScore}</span>
          </div>

          {/* Word-by-word */}
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

          {/* Sub-scores */}
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
