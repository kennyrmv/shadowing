// ─── GET /api/push/config ─────────────────────────────────────────────────────
//
// Returns the VAPID public key for the client to use when subscribing.
// Serving it from the server avoids NEXT_PUBLIC_ build-time baking issues.

import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? process.env.VAPID_PUBLIC_KEY ?? ''
  if (!key) {
    return NextResponse.json({ error: 'VAPID key not configured' }, { status: 500 })
  }
  return NextResponse.json({ vapidPublicKey: key })
}
