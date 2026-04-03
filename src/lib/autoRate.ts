import { SRSRating } from '@/types'

// ─── Auto-SRS rating from Azure pronunciation scores ──────────────────────────
//
// Converts the three Azure dimension scores (accuracy, fluency, completeness)
// into an SM-2 quality rating (1 = Hard, 3 = Good, 5 = Easy).
//
// Weights: accuracy 40%, fluency 30%, completeness 30%
// These match how native speakers judge pronunciation quality:
//   - Accuracy (are the sounds right?) carries the most weight
//   - Fluency (is the rhythm natural?) and completeness (did you say all words?)
//     matter equally for communication

export interface AzureScores {
  accuracy: number      // 0-100
  fluency: number       // 0-100
  completeness: number  // 0-100
}

/** Weighted composite score (0-100) from Azure dimensions */
export function compositeScore(scores: AzureScores): number {
  return Math.round(scores.accuracy * 0.4 + scores.fluency * 0.3 + scores.completeness * 0.3)
}

/**
 * Convert Azure pronunciation scores to an SM-2 quality rating.
 *
 * composite >= 85 → Easy (5)  — space it out, user has it
 * composite >= 60 → Good (3)  — normal interval, keep practicing
 * composite < 60  → Hard (1)  — see it again soon
 */
export function azureToSRS(scores: AzureScores): SRSRating {
  const composite = compositeScore(scores)
  if (composite >= 85) return 5
  if (composite >= 60) return 3
  return 1
}

/**
 * Combined composite score incorporating prosody when available.
 * Azure measures pronunciation correctness (60% weight).
 * Prosody measures naturalness: intonation, rhythm, stress (40% weight).
 */
export function combinedComposite(azure: AzureScores, prosodyOverall?: number): number {
  const azureScore = compositeScore(azure)
  if (prosodyOverall == null) return azureScore
  return Math.round(azureScore * 0.6 + prosodyOverall * 0.4)
}

/**
 * SRS rating from combined Azure + prosody scores.
 */
export function combinedToSRS(azure: AzureScores, prosodyOverall?: number): SRSRating {
  const combined = combinedComposite(azure, prosodyOverall)
  if (combined >= 85) return 5
  if (combined >= 60) return 3
  return 1
}
