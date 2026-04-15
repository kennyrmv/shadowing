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

function createPool(): Pool {
  if (!process.env.DATABASE_URL) {
    throw new Error('[db] DATABASE_URL is not set. Add a Postgres service on Railway.')
  }
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  })
}

const pool = globalThis._pgPool ?? createPool()
if (process.env.NODE_ENV !== 'production') globalThis._pgPool = pool

export function query(text: string, params?: unknown[]) {
  return pool.query(text, params)
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
