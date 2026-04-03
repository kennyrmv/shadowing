// ─── POST /api/refresh-clip-urls ───────────────────────────────────────────────
//
// Refreshes presigned R2 URLs for extracted clips (they expire after 7 days).
// Body: { clips: [{ phraseId, videoId }] }
// Response: { clips: ExtractedClip[] }

import { NextRequest, NextResponse } from 'next/server'
import { getPresignedUrl, r2Keys } from '@/lib/r2'

export async function POST(req: NextRequest) {
  try {
    const { clips } = await req.json() as {
      clips: Array<{ phraseId: string; videoId: string }>
    }

    if (!clips?.length) {
      return NextResponse.json({ error: 'clips array required' }, { status: 400 })
    }

    const expiresIn = 7 * 24 * 3600
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString()

    const refreshed = await Promise.all(
      clips.map(async ({ phraseId, videoId }) => {
        const [clipUrl, audioUrl, prosodyUrl] = await Promise.all([
          getPresignedUrl(r2Keys.clip(videoId, phraseId), expiresIn),
          getPresignedUrl(r2Keys.audio(videoId, phraseId), expiresIn),
          getPresignedUrl(r2Keys.prosody(videoId, phraseId), expiresIn),
        ])
        return {
          phraseId,
          videoId,
          clipUrl,
          audioUrl,
          prosodyUrl,
          extractedAt: new Date().toISOString(),
          expiresAt,
        }
      })
    )

    return NextResponse.json({ clips: refreshed })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
