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

  // 1. Intonation: DTW-align pitch curves, correlation + distance penalty
  const pitchDtw = dtwAlign(native.pitchSemitones, user.pitchSemitones)
  const { aValues: nativePitch, bValues: userPitch } = getAlignedValues(
    native.pitchSemitones,
    user.pitchSemitones,
    pitchDtw.path
  )
  let intonation = 0
  if (nativePitch.length >= 5) {
    const corr = pearsonCorrelation(nativePitch, userPitch)
    const corrScore = correlationToScore(corr)
    // Penalize by mean absolute difference in semitones (DTW-aligned)
    const meanDiff = meanAbsDiff(nativePitch, userPitch)
    // 0 semitones diff = no penalty, 6+ semitones = heavy penalty
    const diffPenalty = Math.max(0, 1 - meanDiff / 6)
    intonation = corrScore * diffPenalty
  }

  // 2. Rhythm: normalized onset timing match
  const rhythm = compareOnsets(native.onsets, user.onsets, native.durationSec, user.durationSec)

  // 3. Stress: DTW-align energy curves, correlation + variance check
  const energyDtw = dtwAlign(
    native.energy.map((v) => v as number | null),
    user.energy.map((v) => v as number | null)
  )
  const { aValues: nativeEnergy, bValues: userEnergy } = getAlignedValues(
    native.energy.map((v) => v as number | null),
    user.energy.map((v) => v as number | null),
    energyDtw.path
  )
  let stress = 0
  if (nativeEnergy.length >= 5) {
    const corr = pearsonCorrelation(nativeEnergy, userEnergy)
    const corrScore = correlationToScore(corr)
    // Penalize flat energy (no dynamic range = monotone delivery)
    const userStdDev = stdDev(userEnergy)
    const nativeStdDev = stdDev(nativeEnergy)
    // If user's dynamic range is much less than native's, penalize
    const dynamicPenalty = nativeStdDev > 0.01
      ? Math.min(1, userStdDev / nativeStdDev)
      : 1
    stress = corrScore * dynamicPenalty
  }

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
 * Stricter curve: requires high correlation for good scores.
 * r=0 → 10, r=0.5 → 40, r=0.7 → 65, r=0.85 → 82, r=0.95 → 95
 */
function correlationToScore(r: number): number {
  const clamped = Math.max(-1, Math.min(1, r))
  if (clamped <= 0) return Math.max(0, 10 + clamped * 10) // -1→0, 0→10
  // Steeper curve: need r > 0.7 for a decent score
  return 10 + 90 * Math.pow(clamped, 2)
}

/** Mean absolute difference between two aligned arrays */
function meanAbsDiff(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length)
  if (n === 0) return 0
  let sum = 0
  for (let i = 0; i < n; i++) sum += Math.abs(a[i] - b[i])
  return sum / n
}

/** Standard deviation of an array */
function stdDev(arr: number[]): number {
  if (arr.length < 2) return 0
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length
  const variance = arr.reduce((sum, v) => sum + (v - mean) ** 2, 0) / arr.length
  return Math.sqrt(variance)
}
