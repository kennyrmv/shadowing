// ─── Prosody comparison scoring ──────────────────────────────────────────────
//
// Compares user's prosody against native speaker's prosody profile.
// Three dimensions:
//   - Intonation (40%): pitch contour shape match via Pearson correlation
//   - Rhythm (30%): onset timing pattern match
//   - Stress (30%): energy pattern match via Pearson correlation
//
// All scores are 0-100.

import type { ProsodyProfile, UserProsody, ProsodyScores } from '@/types'
import { dtwAlign, getAlignedValues } from './dtwAlign'

/**
 * Compare user prosody against native speaker's prosody profile.
 */
export function compareProsody(
  native: ProsodyProfile,
  user: UserProsody
): ProsodyScores {
  // ── Silence detection ──
  // If the user barely spoke, all scores should be 0.
  const userVoicedFrames = user.pitchSemitones.filter((v) => v !== null).length
  const userVoicedRatio = user.pitchSemitones.length > 0
    ? userVoicedFrames / user.pitchSemitones.length
    : 0
  const userMeanEnergy = user.energy.length > 0
    ? user.energy.reduce((a, b) => a + b, 0) / user.energy.length
    : 0

  // Less than 10% voiced frames or very low energy = silence/noise
  if (userVoicedRatio < 0.1 || userMeanEnergy < 0.05) {
    return { intonation: 0, rhythm: 0, stress: 0, overall: 0 }
  }

  // 1. Intonation: DTW-align pitch curves, then Pearson correlation
  const pitchDtw = dtwAlign(native.pitchSemitones, user.pitchSemitones)
  const { aValues: nativePitch, bValues: userPitch } = getAlignedValues(
    native.pitchSemitones,
    user.pitchSemitones,
    pitchDtw.path
  )
  const intonation = nativePitch.length >= 5
    ? correlationToScore(pearsonCorrelation(nativePitch, userPitch))
    : 0 // not enough voiced frames = bad

  // 2. Rhythm: normalized onset timing match
  const rhythm = compareOnsets(native.onsets, user.onsets, native.durationSec, user.durationSec)

  // 3. Stress: DTW-align energy curves, then Pearson correlation
  const energyDtw = dtwAlign(
    native.energy.map((v) => v as number | null),
    user.energy.map((v) => v as number | null)
  )
  const { aValues: nativeEnergy, bValues: userEnergy } = getAlignedValues(
    native.energy.map((v) => v as number | null),
    user.energy.map((v) => v as number | null),
    energyDtw.path
  )
  const stress = nativeEnergy.length >= 5
    ? correlationToScore(pearsonCorrelation(nativeEnergy, userEnergy))
    : 0

  // Weighted composite: same philosophy as autoRate.ts
  const overall = Math.round(intonation * 0.4 + rhythm * 0.3 + stress * 0.3)

  return {
    intonation: Math.round(intonation),
    rhythm: Math.round(rhythm),
    stress: Math.round(stress),
    overall,
  }
}

/**
 * Compare onset timing patterns.
 * Normalizes both onset arrays to [0, 1] to remove speed differences,
 * then measures how close each native onset is to the nearest user onset.
 */
function compareOnsets(
  nativeOnsets: number[],
  userOnsets: number[],
  nativeDuration: number,
  userDuration: number
): number {
  if (nativeOnsets.length < 2 || userOnsets.length < 2) return 0

  // Normalize to [0, 1]
  const normalize = (onsets: number[], dur: number) =>
    onsets.map((t) => t / dur)

  const nNorm = normalize(nativeOnsets, nativeDuration)
  const uNorm = normalize(userOnsets, userDuration)

  // For each native onset, find distance to nearest user onset
  let totalError = 0
  for (const nt of nNorm) {
    let minDist = 1
    for (const ut of uNorm) {
      const d = Math.abs(nt - ut)
      if (d < minDist) minDist = d
    }
    totalError += minDist
  }

  const meanError = totalError / nNorm.length
  // Threshold: 0.15 = 15% of duration error → score 0
  const threshold = 0.15
  const score = Math.max(0, Math.min(100, 100 * (1 - meanError / threshold)))
  return score
}

/** Pearson correlation coefficient between two arrays */
function pearsonCorrelation(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length)
  if (n < 3) return 0

  let sumA = 0, sumB = 0
  for (let i = 0; i < n; i++) { sumA += a[i]; sumB += b[i] }
  const meanA = sumA / n
  const meanB = sumB / n

  let num = 0, denA = 0, denB = 0
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA
    const db = b[i] - meanB
    num += da * db
    denA += da * da
    denB += db * db
  }

  const denom = Math.sqrt(denA * denB)
  if (denom === 0) return 0
  return num / denom
}

/**
 * Map Pearson correlation (-1 to +1) to a 0-100 score.
 * Negative correlation (opposite intonation) gets low scores.
 * r=0.3 → ~50, r=0.7 → ~80, r=0.9 → ~95
 */
function correlationToScore(r: number): number {
  // Clamp to [-1, 1]
  const clamped = Math.max(-1, Math.min(1, r))
  // Map: -1→0, 0→30, 0.3→50, 0.7→80, 1→100
  // Using a simple power curve
  if (clamped <= 0) return Math.max(0, 30 + clamped * 30) // -1→0, 0→30
  // Positive: 0→30, 1→100
  return 30 + 70 * Math.pow(clamped, 0.7)
}
