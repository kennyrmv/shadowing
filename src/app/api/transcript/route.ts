import { NextRequest, NextResponse } from 'next/server'
import { fetchTranscript } from '@/lib/fetchTranscript'
import { segmentPhrases } from '@/lib/segmentPhrases'

// ─── YouTube URL validation ────────────────────────────────────────────────────
const YOUTUBE_URL_RE =
  /^(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/

function extractVideoId(url: string): string | null {
  const match = url.trim().match(YOUTUBE_URL_RE)
  return match ? match[1] : null
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const url = searchParams.get('url')

  if (!url) {
    return NextResponse.json(
      { error: 'Missing ?url parameter. Pass a YouTube video URL.' },
      { status: 400 }
    )
  }

  const videoId = extractVideoId(url)
  if (!videoId) {
    return NextResponse.json(
      { error: 'Not a valid YouTube URL. Try: https://youtube.com/watch?v=...' },
      { status: 400 }
    )
  }

  try {
    const rawTranscript = await fetchTranscript(videoId)

    // ─── SPIKE: timestamp granularity inspection ──────────────────────────────
    // Findings: youtube-transcript-api returns caption-level timestamps only
    // (snippet.start in seconds → ms). No word-level timing available.
    // Fix: configurable timingOffset in the player (see useAppStore + PhrasePlayer).
    if (process.env.NODE_ENV === 'development') {
      console.log('[transcript] raw caption sample (first 3):',
        rawTranscript.slice(0, 3).map(c => ({
          text: c.text.slice(0, 40),
          offset_ms: c.offset,
          duration_ms: c.duration,
        }))
      )
      console.log(`[transcript] total captions: ${rawTranscript.length}, granularity: caption-level only`)
    }

    const phrases = segmentPhrases(rawTranscript, videoId)
    return NextResponse.json({ videoId, phrases })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'

    if (message === 'NO_CAPTIONS') {
      return NextResponse.json(
        { error: 'This video has no subtitles. Try a TED Talk or a video with captions enabled.', videoId },
        { status: 404 }
      )
    }

    console.error('[/api/transcript] Error:', message)
    return NextResponse.json(
      { error: 'Could not fetch transcript. The video may be private, region-restricted, or have no subtitles.' },
      { status: 500 }
    )
  }
}
