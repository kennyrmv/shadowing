import { NextResponse } from 'next/server'

// Returns Azure Speech config to the client at runtime.
// Key stays server-side — never embedded in the client bundle.
export async function GET() {
  const key = process.env.NEXT_PUBLIC_AZURE_SPEECH_KEY
  const region = process.env.NEXT_PUBLIC_AZURE_SPEECH_REGION

  if (!key || key === 'your_key_here' || !region) {
    return NextResponse.json({ error: 'Azure Speech not configured' }, { status: 503 })
  }

  return NextResponse.json({ key, region })
}
