// ─── Client-side pitch extraction from user recordings ────────────────────────
//
// Extracts pitch (F0), energy, and onset timing from raw PCM audio samples.
// Runs entirely in the browser — no server call needed.
//
// Algorithm: Autocorrelation-based pitch detection at 10ms frames,
// matching the server-side parselmouth output rate (100 points/second).
//
// Performance: ~50ms for a 10-second recording on any modern phone.

import type { UserProsody } from '@/types'

const HOP_SAMPLES = 160    // 10ms at 16kHz
const FRAME_SAMPLES = 640  // 40ms window (2.5 periods at 100Hz)
const MIN_FREQ = 75        // Hz — typical male fundamental
const MAX_FREQ = 500       // Hz — typical female upper range
const VOICED_THRESHOLD = 0.3  // autocorrelation confidence threshold

/**
 * Extract prosody features from raw PCM samples (16kHz mono Float32Array).
 * Returns the same structure as the server-side ProsodyProfile but for the user's voice.
 */
export function extractUserProsody(samples: Float32Array, sampleRate: number): UserProsody {
  const hopSamples = Math.round(sampleRate * 0.01)  // 10ms
  const frameSamples = Math.round(sampleRate * 0.04) // 40ms window
  const minPeriod = Math.round(sampleRate / MAX_FREQ)
  const maxPeriod = Math.round(sampleRate / MIN_FREQ)

  const pitchHz: (number | null)[] = []
  const energy: number[] = []
  const totalFrames = Math.floor((samples.length - frameSamples) / hopSamples)

  // Pass 1: Extract pitch and energy per frame
  for (let f = 0; f < totalFrames; f++) {
    const start = f * hopSamples
    const frame = samples.subarray(start, start + frameSamples)

    // RMS energy
    let sumSq = 0
    for (let i = 0; i < frame.length; i++) sumSq += frame[i] * frame[i]
    const rms = Math.sqrt(sumSq / frame.length)
    energy.push(rms)

    // Autocorrelation pitch detection
    if (rms < 0.01) {
      // Too quiet — unvoiced
      pitchHz.push(null)
      continue
    }

    let bestCorr = 0
    let bestPeriod = 0

    for (let lag = minPeriod; lag <= maxPeriod && lag < frame.length; lag++) {
      let num = 0
      let den1 = 0
      let den2 = 0
      const len = frame.length - lag

      for (let i = 0; i < len; i++) {
        num += frame[i] * frame[i + lag]
        den1 += frame[i] * frame[i]
        den2 += frame[i + lag] * frame[i + lag]
      }

      const denom = Math.sqrt(den1 * den2)
      if (denom === 0) continue
      const corr = num / denom

      if (corr > bestCorr) {
        bestCorr = corr
        bestPeriod = lag
      }
    }

    if (bestCorr >= VOICED_THRESHOLD && bestPeriod > 0) {
      pitchHz.push(sampleRate / bestPeriod)
    } else {
      pitchHz.push(null)
    }
  }

  // Convert Hz to semitones relative to median
  const voicedHz = pitchHz.filter((f): f is number => f !== null)
  const medianHz = voicedHz.length > 0 ? median(voicedHz) : 150

  const pitchSemitones: (number | null)[] = pitchHz.map((f) => {
    if (f === null) return null
    return 12 * Math.log2(f / medianHz)
  })

  // Normalize energy to 0-1
  const maxEnergy = Math.max(...energy, 0.001)
  const normalizedEnergy = energy.map((e) => e / maxEnergy)

  // Onset detection: energy rises sharply
  const onsets = detectOnsets(normalizedEnergy, 0.01) // 10ms per frame

  const durationSec = samples.length / sampleRate

  return {
    pitchSemitones,
    energy: normalizedEnergy,
    onsets,
    durationSec,
    medianPitchHz: medianHz,
  }
}

/** Simple energy-based onset detection */
function detectOnsets(energy: number[], frameTimeSec: number): number[] {
  const onsets: number[] = []
  const threshold = 0.15 * Math.max(...energy)
  const minGapFrames = 8  // 80ms minimum between onsets

  let lastOnset = -minGapFrames

  for (let i = 1; i < energy.length; i++) {
    if (
      energy[i] > threshold &&
      energy[i] > energy[i - 1] * 1.3 &&
      i - lastOnset >= minGapFrames
    ) {
      onsets.push(Math.round(i * frameTimeSec * 1000) / 1000)
      lastOnset = i
    }
  }

  return onsets
}

/** Compute median of a numeric array */
function median(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}
