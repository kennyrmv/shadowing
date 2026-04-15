// ─── Shared in-memory job store ───────────────────────────────────────────────
//
// Kept in a separate module so both route.ts and status/route.ts can import it
// without violating Next.js 16's rule that route files may only export HTTP
// handler functions (GET, POST, etc.) and route segment config.

export interface ClipResult {
  phraseId: string
  videoId: string
  clipUrl: string
  audioUrl: string
  prosodyUrl: string
  prosodyProfile: unknown
  extractedAt: string
  expiresAt: string
}

export type JobState =
  | { status: 'processing'; progress: string }
  | { status: 'done'; progress: string; clips: ClipResult[] }
  | { status: 'error'; progress: string; error: string }

export const jobs = new Map<string, JobState>()
