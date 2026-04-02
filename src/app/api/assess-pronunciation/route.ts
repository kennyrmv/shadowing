import { NextRequest, NextResponse } from 'next/server'

// Proxies pronunciation assessment to Azure Speech REST API.
// The key never leaves the server.
export async function POST(req: NextRequest) {
  const key = process.env.NEXT_PUBLIC_AZURE_SPEECH_KEY
  const region = process.env.NEXT_PUBLIC_AZURE_SPEECH_REGION

  if (!key || key === 'your_key_here' || !region) {
    return NextResponse.json({ error: 'Azure Speech not configured' }, { status: 503 })
  }

  const cleanKey = key.replace(/\s/g, '')
  const cleanRegion = region.trim()
  console.log('[assess] key length:', cleanKey.length, 'region:', cleanRegion)

  const referenceText = req.nextUrl.searchParams.get('text') ?? ''
  const audioBuffer = await req.arrayBuffer()

  const assessConfig = Buffer.from(JSON.stringify({
    ReferenceText: referenceText,
    GradingSystem: 'HundredMark',
    Granularity: 'Word',
    EnableMiscue: true,
  })).toString('base64')

  const contentType = req.headers.get('content-type') || 'audio/webm'

  // Step 1: Exchange API key for a short-lived token (works with Foundry keys)
  const tokenRes = await fetch(
    `https://${cleanRegion}.api.cognitive.microsoft.com/sts/v1.0/issueToken`,
    { method: 'POST', headers: { 'Ocp-Apim-Subscription-Key': cleanKey } }
  )
  if (!tokenRes.ok) {
    const tokenErr = await tokenRes.text()
    console.error('[assess] token error:', tokenRes.status, tokenErr.slice(0, 200))
    return NextResponse.json({ error: `Auth failed ${tokenRes.status}` }, { status: 401 })
  }
  const token = await tokenRes.text()
  console.log('[assess] token obtained, length:', token.length)

  // Step 2: Use token for speech recognition
  const endpoint = `https://${cleanRegion}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=en-US&format=detailed`

  const azureRes = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': contentType,
      'Pronunciation-Assessment': assessConfig,
    },
    body: audioBuffer,
  })

  const text = await azureRes.text()

  if (!azureRes.ok) {
    console.error('[assess-pronunciation] Azure error:', azureRes.status, text.slice(0, 300))
    return NextResponse.json(
      { error: `Azure error ${azureRes.status}: ${text.slice(0, 200)}` },
      { status: azureRes.status }
    )
  }

  return NextResponse.json(JSON.parse(text))
}
