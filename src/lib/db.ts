// ─── db.ts ────────────────────────────────────────────────────────────────────
//
// Single shared Postgres pool for the app.
// Railway injects DATABASE_URL automatically when a Postgres service is added
// to the same project.
//
// Usage:
//   import { query } from '@/lib/db'
//   const { rows } = await query('SELECT * FROM push_subscriptions')

import { Pool } from 'pg'

declare global {
  // Prevent creating multiple pools during Next.js hot reload in development
  // eslint-disable-next-line no-var
  var _pgPool: Pool | undefined
}

// Lazy — pool is created on first query, not at import time.
// This prevents build-time failures when DATABASE_URL is not available.
function getPool(): Pool {
  if (globalThis._pgPool) return globalThis._pgPool

  if (!process.env.DATABASE_URL) {
    throw new Error('[db] DATABASE_URL is not set. Add a Postgres service on Railway.')
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  })

  // Cache the pool to avoid creating multiple instances during hot reload
  globalThis._pgPool = pool
  return pool
}

export function query(text: string, params?: unknown[]) {
  return getPool().query(text, params)
}

// ─── Table init ───────────────────────────────────────────────────────────────
// Called once at startup (from instrumentation.ts) to ensure the table exists.
// Idempotent — safe to call on every deploy.

export async function initDb(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      endpoint   TEXT PRIMARY KEY,
      auth       TEXT NOT NULL,
      p256dh     TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `)
}
