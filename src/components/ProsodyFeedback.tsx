'use client'

// ─── ProsodyFeedback ──────────────────────────────────────────────────────────
//
// Displays prosody comparison results: intonation, rhythm, stress scores
// plus a pitch contour visualization (native vs user).
//
// Mobile-first: compact layout, scrollable if needed.

import type { ProsodyProfile, UserProsody, ProsodyScores } from '@/types'

function scoreColor(score: number): string {
  if (score >= 80) return 'text-green-600'
  if (score >= 50) return 'text-yellow-500'
  return 'text-red-500'
}

function scoreBg(score: number): string {
  if (score >= 80) return 'bg-green-50'
  if (score >= 50) return 'bg-yellow-50'
  return 'bg-red-50'
}

interface Props {
  scores: ProsodyScores
  nativeProfile: ProsodyProfile
  userProsody: UserProsody
}

/** Render a mini pitch contour SVG */
function PitchContour({ native, user }: { native: (number | null)[]; user: (number | null)[] }) {
  const width = 300
  const height = 80
  const padding = 4

  const toPath = (data: (number | null)[], color: string): React.ReactNode => {
    // Find min/max for scaling
    const values = data.filter((v): v is number => v !== null)
    const allNative = native.filter((v): v is number => v !== null)
    const allUser = user.filter((v): v is number => v !== null)
    const allValues = [...allNative, ...allUser]
    if (allValues.length === 0) return null

    const minVal = Math.min(...allValues)
    const maxVal = Math.max(...allValues)
    const range = maxVal - minVal || 1

    const xScale = (width - padding * 2) / Math.max(data.length - 1, 1)
    const yScale = (height - padding * 2) / range

    // Build SVG path segments (skip nulls)
    const segments: string[] = []
    let inSegment = false

    for (let i = 0; i < data.length; i++) {
      if (data[i] === null) {
        inSegment = false
        continue
      }
      const x = padding + i * xScale
      const y = height - padding - (data[i]! - minVal) * yScale

      if (!inSegment) {
        segments.push(`M ${x} ${y}`)
        inSegment = true
      } else {
        segments.push(`L ${x} ${y}`)
      }
    }

    return (
      <path
        d={segments.join(' ')}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        opacity={0.8}
      />
    )
  }

  return (
    <div className="bg-gray-50 rounded-lg p-3">
      <p className="text-xs text-gray-400 mb-1">Pitch contour</p>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-16"
        preserveAspectRatio="none"
      >
        {toPath(native, '#3b82f6')}
        {toPath(user, '#f97316')}
      </svg>
      <div className="flex gap-4 mt-1">
        <span className="text-xs text-blue-500">Native</span>
        <span className="text-xs text-orange-500">You</span>
      </div>
    </div>
  )
}

/** Render rhythm dots showing onset alignment */
function RhythmDots({ nativeOnsets, userOnsets, nativeDur, userDur }: {
  nativeOnsets: number[]
  userOnsets: number[]
  nativeDur: number
  userDur: number
}) {
  const width = 300
  const height = 40

  const normalize = (t: number, dur: number) => (t / dur) * (width - 20) + 10

  return (
    <div className="bg-gray-50 rounded-lg p-3">
      <p className="text-xs text-gray-400 mb-1">Rhythm pattern</p>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-8">
        {/* Native onsets (top row) */}
        {nativeOnsets.map((t, i) => (
          <circle
            key={`n-${i}`}
            cx={normalize(t, nativeDur)}
            cy={12}
            r={4}
            fill="#3b82f6"
            opacity={0.7}
          />
        ))}
        {/* User onsets (bottom row) */}
        {userOnsets.map((t, i) => (
          <circle
            key={`u-${i}`}
            cx={normalize(t, userDur)}
            cy={28}
            r={4}
            fill="#f97316"
            opacity={0.7}
          />
        ))}
        {/* Center line */}
        <line x1={10} y1={20} x2={width - 10} y2={20} stroke="#e5e7eb" strokeWidth={0.5} />
      </svg>
      <div className="flex gap-4 mt-1">
        <span className="text-xs text-blue-500">Native</span>
        <span className="text-xs text-orange-500">You</span>
      </div>
    </div>
  )
}

export default function ProsodyFeedback({ scores, nativeProfile, userProsody }: Props) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 px-1">
        <span className="text-sm font-medium text-gray-700">Prosody match</span>
        <span className={`text-lg font-bold ${scoreColor(scores.overall)}`}>
          {scores.overall}
        </span>
      </div>

      {/* Score cards */}
      <div className="grid grid-cols-3 gap-2 text-center">
        {[
          { label: 'Intonation', value: scores.intonation },
          { label: 'Rhythm', value: scores.rhythm },
          { label: 'Stress', value: scores.stress },
        ].map(({ label, value }) => (
          <div key={label} className={`rounded-lg py-2 ${scoreBg(value)}`}>
            <p className={`text-lg font-bold ${scoreColor(value)}`}>{value}</p>
            <p className="text-xs text-gray-400">{label}</p>
          </div>
        ))}
      </div>

      {/* Pitch contour visualization */}
      <PitchContour
        native={nativeProfile.pitchSemitones}
        user={userProsody.pitchSemitones}
      />

      {/* Rhythm dots */}
      <RhythmDots
        nativeOnsets={nativeProfile.onsets}
        userOnsets={userProsody.onsets}
        nativeDur={nativeProfile.durationSec}
        userDur={userProsody.durationSec}
      />
    </div>
  )
}
