// ─── POST /api/push/subscribe ─────────────────────────────────────────────────
//
// Saves a Web Push subscription to the push_subscriptions Postgres table.
// Called by the client when the user enables push notifications.
//
// Body: PushSubscription (endpoint + keys.auth + keys.p256dh)
// Response: { ok: true }

import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'

// Never statically render — this route requires runtime DB access
export const dynamic = 'force-dynamic'

interface PushSubscriptionJSON {
  endpoint: string
  keys: {
    auth: string
    p256dh: string
  }
}

export async function POST(req: NextRequest) {
  let body: PushSubscriptionJSON
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body?.endpoint || !body?.keys?.auth || !body?.keys?.p256dh) {
    return NextResponse.json(
      { error: 'Missing required fields: endpoint, keys.auth, keys.p256dh' },
      { status: 400 }
    )
  }

  try {
    // Upsert — replace if endpoint already registered
    await query(
      `INSERT INTO push_subscriptions (endpoint, auth, p256dh)
       VALUES ($1, $2, $3)
       ON CONFLICT (endpoint) DO UPDATE
         SET auth = EXCLUDED.auth, p256dh = EXCLUDED.p256dh, created_at = NOW()`,
      [body.endpoint, body.keys.auth, body.keys.p256dh]
    )

    const { rows } = await query('SELECT COUNT(*) FROM push_subscriptions')
    console.log(`[push/subscribe] Registered. Total: ${rows[0].count}`)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[push/subscribe] Failed to save subscription:', err)
    return NextResponse.json({ error: 'Failed to save subscription' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  let body: { endpoint: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body?.endpoint) {
    return NextResponse.json({ error: 'Missing endpoint' }, { status: 400 })
  }

  try {
    await query('DELETE FROM push_subscriptions WHERE endpoint = $1', [body.endpoint])
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[push/subscribe] Failed to remove subscription:', err)
    return NextResponse.json({ error: 'Failed to remove subscription' }, { status: 500 })
  }
}
