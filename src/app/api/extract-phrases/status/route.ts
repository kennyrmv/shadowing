// ─── GET /api/extract-phrases/status?jobId=xxx ─────────────────────────────────
//
// Poll for extraction job completion.
// Returns: { status: 'processing' | 'done' | 'error', progress?, clips?, error? }

import { NextRequest, NextResponse } from 'next/server'
import { jobs } from '../jobs'

export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get('jobId')

  if (!jobId) {
    return NextResponse.json({ error: 'jobId required' }, { status: 400 })
  }

  const job = jobs.get(jobId)

  if (!job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }

  // Clean up completed jobs after returning them (keep memory lean)
  if (job.status === 'done' || job.status === 'error') {
    // Give the client one more chance to read it, then delete
    setTimeout(() => jobs.delete(jobId), 60000)
  }

  return NextResponse.json(job)
}
