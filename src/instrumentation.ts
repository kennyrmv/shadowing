// ─── instrumentation.ts ────────────────────────────────────────────────────────
//
// Next.js instrumentation hook — runs once at server startup.
// Used to register the daily push notification cron job.
//
// Docs: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
//
// Schedule: PUSH_CRON_SCHEDULE env var (default: "0 9 * * *" = 9am UTC daily)

export async function register() {
  // Only run on the Node.js server runtime, not in the Edge runtime or client
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  // Skip in development to avoid push spam during hot reload
  if (process.env.NODE_ENV === 'development') {
    console.log('[instrumentation] Push cron skipped in development')
    return
  }

  const schedule = process.env.PUSH_CRON_SCHEDULE ?? '0 9 * * *'

  try {
    const cron = await import('node-cron')

    if (!cron.default.validate(schedule)) {
      console.error(`[instrumentation] Invalid cron schedule: "${schedule}". Using default "0 9 * * *"`)
    }

    cron.default.schedule(schedule, async () => {
      console.log('[push/cron] Firing daily notification...')
      try {
        // Call our own send endpoint internally
        const baseUrl = process.env.NEXTAUTH_URL ?? process.env.RAILWAY_PUBLIC_DOMAIN
          ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
          : 'http://localhost:3000'

        const res = await fetch(`${baseUrl}/api/push/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        })
        const data = await res.json()
        console.log(`[push/cron] Result: sent=${data.sent}, failed=${data.failed}`)
      } catch (err) {
        console.error('[push/cron] Failed to trigger push send:', err)
      }
    })

    // Health check log — visible in Railway logs to confirm cron registered
    console.log(`[instrumentation] Push notification scheduler registered (schedule: "${schedule}")`)
  } catch (err) {
    console.error('[instrumentation] Failed to register push cron:', err)
  }
}
