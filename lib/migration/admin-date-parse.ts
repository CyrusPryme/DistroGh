import { normalizeAdminDate } from '@/lib/migration/admin-intake-corrections'

const MONTH: Record<string, string> = {
  jan: '01',
  feb: '02',
  mar: '03',
  apr: '04',
  may: '05',
  jun: '06',
  jul: '07',
  aug: '08',
  sep: '09',
  oct: '10',
  nov: '11',
  dec: '12',
}

/** ISO date from admin free text (e.g. "13 DEC 2025", "DATE SHOULD BE 13 DEC 2025"). */
export function parseAdminTextDate(raw: string): string | null {
  const t = raw.trim()
  if (!t) return null
  const iso = normalizeAdminDate(t)
  if (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso

  const m = t.match(/(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{4})/i)
  if (!m) return null
  const day = m[1]!.padStart(2, '0')
  const mon = MONTH[m[2]!.slice(0, 3).toLowerCase()]
  if (!mon) return null
  return `${m[3]}-${mon}-${day}`
}
