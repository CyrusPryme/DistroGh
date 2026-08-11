import { vi } from 'vitest'
import type { Pool, PoolClient } from 'pg'

export interface MockQueryCall {
  text: string
  params: unknown[]
}

export type MockQueryHandler = (call: MockQueryCall) => { rows: unknown[] } | undefined

export interface MockClient {
  query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }>
  release: () => void
  calls: MockQueryCall[]
  calledMatching(pattern: RegExp): MockQueryCall[]
}

/**
 * Minimal fake `PoolClient`/`Pool` for unit-testing SQL-issuing lib functions without a
 * real database. Handlers are tried in order; the first whose `match` matches the query
 * text wins. Unmatched queries return `{ rows: [] }` (never throw) so audit/log helpers
 * that swallow their own errors don't need explicit handlers.
 *
 * Cast to `Pool & PoolClient` (rather than requiring every call site to cast) since this
 * intentionally implements only the `query`/`release` surface those lib functions use.
 */
export function createMockClient(
  handlers: Array<{ match: RegExp; respond: MockQueryHandler }> = []
): MockClient & Pool & PoolClient {
  const calls: MockQueryCall[] = []

  const query = vi.fn(async (text: string, params: unknown[] = []) => {
    calls.push({ text, params })
    for (const h of handlers) {
      if (h.match.test(text)) {
        const result = h.respond({ text, params })
        if (result) return result
      }
    }
    return { rows: [] }
  })

  const mock: MockClient = {
    query,
    release: vi.fn(),
    calls,
    calledMatching(pattern: RegExp): MockQueryCall[] {
      return calls.filter((c) => pattern.test(c.text))
    },
  }

  return mock as unknown as MockClient & Pool & PoolClient
}
