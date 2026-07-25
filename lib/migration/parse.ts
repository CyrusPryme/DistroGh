import ExcelJS from 'exceljs'
import type { Pool } from 'pg'
import type { MigrationEntityType } from '@/lib/migration/types'
import { getFileBlob, listMigrationFiles } from '@/lib/migration/files'
import { detectEntityType } from '@/lib/migration/detect'
import { writeMigrationAudit } from '@/lib/migration/audit'
import { touchMigration } from '@/lib/migration/projects'

function cellToPrimitive(value: ExcelJS.CellValue): unknown {
  if (value == null) return null
  if (typeof value === 'object' && 'result' in (value as object)) {
    return (value as { result?: unknown }).result ?? null
  }
  if (typeof value === 'object' && 'text' in (value as object)) {
    return (value as { text?: string }).text ?? null
  }
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return value
}

function parseCsv(buffer: Buffer): { columns: string[]; rows: Record<string, unknown>[] } {
  const text = buffer.toString('utf8')
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length)
  if (!lines.length) return { columns: [], rows: [] }
  const split = (line: string) => {
    const out: string[] = []
    let cur = ''
    let inQ = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; continue }
        inQ = !inQ
        continue
      }
      if (ch === ',' && !inQ) { out.push(cur); cur = ''; continue }
      cur += ch
    }
    out.push(cur)
    return out.map((s) => s.trim())
  }
  const columns = split(lines[0])
  const rows = lines.slice(1).map((line) => {
    const vals = split(line)
    const obj: Record<string, unknown> = {}
    columns.forEach((c, i) => { obj[c] = vals[i] ?? '' })
    return obj
  })
  return { columns, rows }
}

async function parseWorkbook(buffer: Buffer): Promise<{
  sheetNames: string[]
  columns: string[]
  rows: Record<string, unknown>[]
}> {
  const wb = new ExcelJS.Workbook()
  // exceljs accepts Buffer
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await wb.xlsx.load(buffer as any)
  const sheet = wb.worksheets[0]
  if (!sheet) return { sheetNames: [], columns: [], rows: [] }

  const sheetNames = wb.worksheets.map((s) => s.name)
  const headerRow = sheet.getRow(1)
  const columns: string[] = []
  headerRow.eachCell({ includeEmpty: false }, (cell, col) => {
    columns[col - 1] = String(cellToPrimitive(cell.value) ?? `col_${col}`).trim()
  })

  const rows: Record<string, unknown>[] = []
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return
    const obj: Record<string, unknown> = {}
    let any = false
    columns.forEach((col, idx) => {
      const v = cellToPrimitive(row.getCell(idx + 1).value)
      if (v !== null && v !== '') any = true
      obj[col] = v
    })
    if (any) rows.push(obj)
  })

  return { sheetNames, columns: columns.filter(Boolean), rows }
}

export async function parseMigrationFileToStaging(
  pool: Pool,
  params: { migrationId: string; fileId: string; actorId?: string | null }
): Promise<{ rowCount: number; entityType: MigrationEntityType | null }> {
  const blob = await getFileBlob(pool, params.fileId)
  if (!blob) throw new Error('File blob missing')

  const meta = await pool.query(
    `SELECT * FROM public.migration_files WHERE id = $1 AND migration_id = $2`,
    [params.fileId, params.migrationId]
  )
  if (!meta.rows[0]) throw new Error('File not found')

  await pool.query(
    `UPDATE public.migration_files SET parse_status = 'parsing', parse_error = NULL WHERE id = $1`,
    [params.fileId]
  )

  try {
    const filename = String(meta.rows[0].original_filename)
    const isCsv = filename.toLowerCase().endsWith('.csv')
    const parsed = isCsv
      ? { sheetNames: ['Sheet1'], ...parseCsv(blob) }
      : await parseWorkbook(blob)

    let entityType = (meta.rows[0].entity_type as MigrationEntityType | null)
      ?? detectEntityType(filename, parsed.columns)

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(
        `DELETE FROM public.migration_staging_rows WHERE migration_id = $1 AND file_id = $2`,
        [params.migrationId, params.fileId]
      )

      // Bulk insert in chunks
      const chunkSize = 500
      for (let i = 0; i < parsed.rows.length; i += chunkSize) {
        const chunk = parsed.rows.slice(i, i + chunkSize)
        for (let j = 0; j < chunk.length; j++) {
          const rowNumber = i + j + 1
          const raw = chunk[j]
          await client.query(
            `INSERT INTO public.migration_staging_rows
              (migration_id, file_id, entity_type, row_number, raw_data, normalized_data)
             VALUES ($1,$2,$3,$4,$5::jsonb,$5::jsonb)`,
            [
              params.migrationId,
              params.fileId,
              entityType ?? 'sales',
              rowNumber,
              JSON.stringify(raw),
            ]
          )
        }
      }

      await client.query(
        `UPDATE public.migration_files
         SET parse_status = 'parsed', row_count = $2, sheet_names = $3::jsonb,
             detected_columns = $4::jsonb, entity_type = COALESCE(entity_type, $5)
         WHERE id = $1`,
        [
          params.fileId,
          parsed.rows.length,
          JSON.stringify(parsed.sheetNames),
          JSON.stringify(parsed.columns),
          entityType,
        ]
      )
      await touchMigration(client, params.migrationId)
      await writeMigrationAudit(client, {
        migrationId: params.migrationId,
        actorId: params.actorId,
        action: 'migration.file_parsed',
        stage: 3,
        details: { file_id: params.fileId, rows: parsed.rows.length, entity_type: entityType },
      })
      await client.query('COMMIT')
      return { rowCount: parsed.rows.length, entityType }
    } catch (e) {
      await client.query('ROLLBACK')
      throw e
    } finally {
      client.release()
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Parse failed'
    await pool.query(
      `UPDATE public.migration_files SET parse_status = 'failed', parse_error = $2 WHERE id = $1`,
      [params.fileId, msg]
    )
    throw e
  }
}

export async function parseAllActiveFiles(pool: Pool, migrationId: string, actorId?: string | null) {
  const files = await listMigrationFiles(pool, migrationId)
  const results = []
  for (const f of files) {
    results.push(await parseMigrationFileToStaging(pool, { migrationId, fileId: f.id, actorId }))
  }
  return results
}
