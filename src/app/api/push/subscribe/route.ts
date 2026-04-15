// ─── POST /api/push/subscribe ─────────────────────────────────────────────────
//
// Saves a Web Push subscription to data/push-subscriptions.json.
// Called by the client when the user enables push notifications.
//
// Body: PushSubscription (endpoint + keys.auth + keys.p256dh)
// Response: { ok: true }

import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs/promises'
import path from 'path'

const SUBSCRIPTIONS_FILE = path.join(process.cwd(), 'data', 'push-subscriptions.json')

interface PushSubscriptionJSON {
  endpoint: string
  keys: {
    auth: string
    p256dh: string
  }
  expirationTime?: number | null
}

async function readSubscriptions(): Promise<PushSubscriptionJSON[]> {
  try {
    const raw = await fs.readFile(SUBSCRIPTIONS_FILE, 'utf-8')
    return JSON.parse(raw)
  } catch {
    return []
  }
}

async function writeSubscriptions(subs: PushSubscriptionJSON[]): Promise<void> {
  await fs.mkdir(path.dirname(SUBSCRIPTIONS_FILE), { recursive: true })
  await fs.writeFile(SUBSCRIPTIONS_FILE, JSON.stringify(subs, null, 2), 'utf-8')
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
    const existing = await readSubscriptions()
    // Dedup by endpoint — replace if already registered
    const filtered = existing.filter((s) => s.endpoint !== body.endpoint)
    await writeSubscriptions([...filtered, body])
    console.log(`[push/subscribe] Registered subscription. Total: ${filtered.length + 1}`)
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
    const existing = await readSubscriptions()
    const filtered = existing.filter((s) => s.endpoint !== body.endpoint)
    await writeSubscriptions(filtered)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[push/subscribe] Failed to remove subscription:', err)
    return NextResponse.json({ error: 'Failed to remove subscription' }, { status: 500 })
  }
}
