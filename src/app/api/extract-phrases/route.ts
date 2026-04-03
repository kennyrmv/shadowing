// ─── POST /api/extract-phrases ─────────────────────────────────────────────────
//
// Starts a background job to extract video clips + prosody profiles for
// selected phrases from a YouTube video.
//
// Body: { videoId: string, phrases: [{ id, startTime, duration, text }] }
// Response: { jobId: string }

import { NextRequest, NextResponse } from 'next/server'
import { execFile } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import fs from 'fs/promises'
import os from 'os'
import { uploadToR2, getPresignedUrl, r2Keys } from '@/lib/r2'

const execFileAsync = promisify(execFile)

interface PhraseInput {
  id: string
  startTime: number
  duration: number
  text: string
}

interface JobState {
  status: 'processing' | 'done' | 'error'
  progress: string
  clips?: Array<{
    phraseId: string
    videoId: string
    clipUrl: string
    audioUrl: string
    prosodyUrl: string
    extractedAt: string
    expiresAt: string
  }>
  error?: string
}

// In-memory job store (Railway = single instance)
const jobs = new Map<string, JobState>()

// Find Python executable (same pattern as fetchTranscript.ts)
const PYTHON_CANDIDATES = [
  '/Users/lider/Library/Python/3.9/bin/python3',
  '/usr/local/bin/python3',
  '/usr/bin/python3',
  'python3',
  'python',
]

let cachedPython: string | null = null

async function findPython(): Promise<string> {
  if (cachedPython) return cachedPython
  for (const candidate of PYTHON_CANDIDATES) {
    try {
      await execFileAsync(candidate, ['--version'])
      cachedPython = candidate
      return candidate
    } catch { /* try next */ }
  }
  throw new Error('Python 3 not found')
}

async function runExtraction(jobId: string, videoId: string, phrases: PhraseInput[]) {
  const python = await findPython()
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shadowing-extract-'))
  const extractScript = path.join(process.cwd(), 'scripts', 'extract_clips.py')
  const prosodyScript = path.join(process.cwd(), 'scripts', 'analyze_prosody.py')

  try {
    // Step 1: Extract video clips + audio
    jobs.set(jobId, { status: 'processing', progress: `Downloading video and extracting ${phrases.length} clips...` })

    const extractResult = await execFileAsync(
      python,
      [extractScript, videoId, tmpDir, JSON.stringify(phrases)],
      { timeout: 180000, maxBuffer: 10 * 1024 * 1024 }
    )

    const extractedFiles: Array<{ phraseId: string; clipPath: string; audioPath: string }> =
      JSON.parse(extractResult.stdout.trim())

    // Step 2: Analyze prosody for each clip + upload to R2
    jobs.set(jobId, { status: 'processing', progress: 'Analyzing prosody and uploading...' })

    const clips = []
    const expiresIn = 7 * 24 * 3600 // 7 days
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString()

    for (let i = 0; i < extractedFiles.length; i++) {
      const { phraseId, clipPath, audioPath } = extractedFiles[i]
      jobs.set(jobId, {
        status: 'processing',
        progress: `Processing ${i + 1}/${extractedFiles.length}: prosody analysis...`,
      })

      // Run prosody analysis
      const prosodyResult = await execFileAsync(
        python,
        [prosodyScript, audioPath, phraseId],
        { timeout: 30000 }
      )
      const prosodyProfile = prosodyResult.stdout.trim()

      // Upload clip, audio, and prosody to R2
      const clipKey = r2Keys.clip(videoId, phraseId)
      const audioKey = r2Keys.audio(videoId, phraseId)
      const prosodyKey = r2Keys.prosody(videoId, phraseId)

      const [clipBuf, audioBuf] = await Promise.all([
        fs.readFile(clipPath),
        fs.readFile(audioPath),
      ])

      await Promise.all([
        uploadToR2(clipKey, clipBuf, 'video/mp4'),
        uploadToR2(audioKey, audioBuf, 'audio/wav'),
        uploadToR2(prosodyKey, Buffer.from(prosodyProfile), 'application/json'),
      ])

      // Generate presigned URLs
      const [clipUrl, audioUrl, prosodyUrl] = await Promise.all([
        getPresignedUrl(clipKey, expiresIn),
        getPresignedUrl(audioKey, expiresIn),
        getPresignedUrl(prosodyKey, expiresIn),
      ])

      clips.push({
        phraseId,
        videoId,
        clipUrl,
        audioUrl,
        prosodyUrl,
        prosodyProfile: JSON.parse(prosodyProfile),
        extractedAt: new Date().toISOString(),
        expiresAt,
      })
    }

    jobs.set(jobId, { status: 'done', progress: '', clips })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    jobs.set(jobId, { status: 'error', progress: '', error: message })
  } finally {
    // Clean up temp directory
    try {
      await fs.rm(tmpDir, { recursive: true, force: true })
    } catch { /* ignore cleanup errors */ }
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { videoId, phrases } = body as { videoId: string; phrases: PhraseInput[] }

    if (!videoId || !phrases?.length) {
      return NextResponse.json({ error: 'videoId and phrases required' }, { status: 400 })
    }

    if (phrases.length > 15) {
      return NextResponse.json({ error: 'Maximum 15 phrases per batch' }, { status: 400 })
    }

    const jobId = `${videoId}-${Date.now()}`
    jobs.set(jobId, { status: 'processing', progress: 'Starting...' })

    // Run extraction in background (don't await)
    runExtraction(jobId, videoId, phrases).catch((err) => {
      jobs.set(jobId, { status: 'error', progress: '', error: String(err) })
    })

    return NextResponse.json({ jobId })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// Export jobs map for status route
export { jobs }
