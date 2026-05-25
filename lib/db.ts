import { Pool } from 'pg'

declare global {
  // eslint-disable-next-line no-var
  var __pgPool: Pool | undefined
}

export function getDbPool() {
  if (!global.__pgPool) {
    const connectionString =
      process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5433/consignment'
    global.__pgPool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    })
  }
  return global.__pgPool
}

