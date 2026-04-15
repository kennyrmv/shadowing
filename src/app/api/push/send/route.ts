// ─── POST /api/push/send ──────────────────────────────────────────────────────
//
// Sends a push notification to all registered subscriptions.
// Called by the node-cron scheduler in instrumentation.ts on the daily schedule.
// Can also be called manually for testing.
//
// Body: { title?: string, body?: string, url?: string }
// Response: { sent: number, failed: number }

import { NextRequest, NextResponse } from 'next/server'
import webpush from 'web-push'
import { query } from '@/lib/db'

// Never statically render — this route requires runtime DB access and VAPID keys
export const dynamic = 'force-dynamic'

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ''
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY ?? ''
const VAPID_EMAIL = process.env.VAPID_EMAIL ?? 'mailto:admin@shadowing.app'

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
}

export async function POST(req: NextRequest) {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    return NextResponse.json({ error: 'VAPID keys not configured' }, { status: 500 })
  }

  let body: { title?: string; body?: string; url?: string } = {}
  try {
    body = await req.json()
  } catch {
    // empty body is fine — use defaults
  }

  const payload = JSON.stringify({
    title: body.title ?? '¿Practicaste hoy?',
    body: body.body ?? 'Tu sesión de shadowing te espera.',
    url: body.url ?? '/',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
  })

  let subscriptions: { endpoint: string; auth: string; p256dh: string }[] = []
  try {
    const { rows } = await query('SELECT endpoint, auth, p256dh FROM push_subscriptions')
    subscriptions = rows
  } catch (err) {
    console.error('[push/send] Failed to read subscriptions from DB:', err)
    return NextResponse.json({ error: 'DB error' }, { status: 500 })
  }

  if (subscriptions.length === 0) {
    return NextResponse.json({ sent: 0, failed: 0, reason: 'no subscriptions' })
  }

  let sent = 0
  let failed = 0
  const expired: string[] = []

  await Promise.allSettled(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { auth: sub.auth, p256dh: sub.p256dh } },
          payload
        )
        sent++
      } catch (err: unknown) {
        const statusCode = (err as { statusCode?: number }).statusCode
        if (statusCode === 410 || statusCode === 404) {
          // Subscription expired — mark for removal
          expired.push(sub.endpoint)
        } else {
          console.error(`[push/send] Failed for ${sub.endpoint}:`, err)
        }
        failed++
      }
    })
  )

  // Remove expired subscriptions from DB
  if (expired.length > 0) {
    try {
      await query(
        `DELETE FROM push_subscriptions WHERE endpoint = ANY($1)`,
        [expired]
      )
      console.log(`[push/send] Removed ${expired.length} expired subscription(s)`)
    } catch (err) {
      console.error('[push/send] Failed to prune expired subscriptions:', err)
    }
  }

  console.log(`[push/send] Sent: ${sent}, Failed: ${failed}`)
  return NextResponse.json({ sent, failed })
}
