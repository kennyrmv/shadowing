// ─── YouTube transcript fetcher via Python subprocess ─────────────────────────
//
// Approach: call scripts/fetch_transcript.py as a child process.
// The Python youtube-transcript-api library bypasses YouTube's bot detection
// by using the same InnerTube client tricks that real apps use.
//
// Requires: pip3 install youtube-transcript-api

import { execFile } from 'child_process'
import { promisify } from 'util'
import path from 'path'

const execFileAsync = promisify(execFile)

export interface RawCaption {
  text: string
  offset: number   // milliseconds
  duration: number // milliseconds
}

// Resolve script path relative to project root (works in both dev and prod)
const SCRIPT_PATH = path.join(process.cwd(), 'scripts', 'fetch_transcript.py')

// Try these Python executables in order
const PYTHON_CANDIDATES = [
  '/Users/lider/Library/Python/3.9/bin/python3',
  '/usr/local/bin/python3',
  '/usr/bin/python3',
  'python3',
  'python',
]

async function findPython(): Promise<string> {
  for (const candidate of PYTHON_CANDIDATES) {
    try {
      await execFileAsync(candidate, ['--version'])
      return candidate
    } catch {
      // try next
    }
  }
  throw new Error('Python 3 not found. Install it and run: pip3 install youtube-transcript-api')
}

let cachedPython: string | null = null

export async function fetchTranscript(videoId: string): Promise<RawCaption[]> {
  if (!cachedPython) {
    cachedPython = await findPython()
  }

  let stdout: string
  try {
    const result = await execFileAsync(
      cachedPython,
      [SCRIPT_PATH, videoId],
      { timeout: 20000, env: { ...process.env } }  // explicitly pass env so YOUTUBE_PROXY reaches Python
    )
    stdout = result.stdout
  } catch (err: unknown) {
    // execFile throws when exit code != 0; stdout may still have useful JSON
    const execErr = err as { stdout?: string; stderr?: string; message?: string }
    stdout = execErr.stdout ?? ''
    if (!stdout.trim()) {
      throw new Error(`Transcript script failed: ${execErr.message ?? 'unknown error'}`)
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(stdout.trim())
  } catch {
    throw new Error('Could not parse transcript script output')
  }

  // Script returns { error: '...' } on failure
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const { error } = parsed as { error: string }
    if (error === 'NO_CAPTIONS' || error === 'VIDEO_UNAVAILABLE') {
      throw new Error('NO_CAPTIONS')
    }
    throw new Error(error ?? 'Unknown error from transcript script')
  }

  const captions = parsed as RawCaption[]
  if (!captions.length) throw new Error('NO_CAPTIONS')

  return captions
}
