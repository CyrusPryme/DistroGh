import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('plaintext vendor password removal', () => {
  it('does not write initial_password outside the drop migration and the baseline schema', () => {
    const files = [
      'app/dashboard/vendors/actions.ts',
      'lib/migration/writers.ts',
      'app/api/vendors/[id]/route.ts',
      'app/api/vendor-applications/[id]/route.ts',
      'app/dashboard/vendors/[id]/page.tsx',
    ]
    for (const file of files) {
      const src = readFileSync(resolve(file), 'utf8')
      expect(src, file).not.toContain('initial_password')
    }
  })
})
