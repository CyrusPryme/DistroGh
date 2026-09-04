import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parseWorkbook } from '@/lib/migration/parse'
import {
  REVIEW_FLAG_COLUMN,
  buildReviewFlag,
  isoToExcelDate,
  migrationStr,
  writeFixedMigrationWorkbook,
} from '@/lib/migration/fix-workbook'

describe('fix-workbook', () => {
  it('buildReviewFlag joins prefix and detail', () => {
    expect(buildReviewFlag('FIX DATE', 'return before delivery')).toBe(
      'FIX DATE — return before delivery'
    )
  })

  it('migrationStr trims and stringifies', () => {
    expect(migrationStr('  x  ')).toBe('x')
    expect(migrationStr(null)).toBe('')
  })

  it('isoToExcelDate builds UTC midnight', () => {
    const d = isoToExcelDate('2025-08-23')
    expect(d.toISOString()).toBe('2025-08-23T00:00:00.000Z')
  })

  it('writeFixedMigrationWorkbook adds review_flag and legend when rows flagged', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'migration-fix-'))
    const out = join(dir, 'test-FIXED.xlsx')
    try {
      const { highlightedByKind, outputColumns } = await writeFixedMigrationWorkbook({
        outputPath: out,
        dataColumns: ['product_name', 'quantity'],
        rows: [
          { product_name: 'OK', quantity: 1 },
          { product_name: 'BAD', quantity: 2 },
        ],
        legend: [
          { colorLabel: 'Rose', meaning: 'test', adminAction: 'fix it' },
        ],
        getHighlight: (row) =>
          row.product_name === 'BAD'
            ? { kind: 'rose', reviewFlag: buildReviewFlag('TEST', 'example') }
            : null,
      })

      expect(outputColumns).toContain(REVIEW_FLAG_COLUMN)
      expect(highlightedByKind.rose).toEqual([3])

      const parsed = await parseWorkbook(readFileSync(out))
      expect(parsed.rows).toHaveLength(2)
      expect(parsed.sheetNames).toContain('Review legend')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
