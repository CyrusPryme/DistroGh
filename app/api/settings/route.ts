import { NextResponse } from 'next/server'
import { getDbPool } from '@/lib/db'
import { requireAdminSession, requireSession } from '@/lib/auth/require'

interface SystemSettings {
  company_name: string
  default_moq: number
  expiry_reminder_days: number
  week_starts_on: number
  packaging_presets: string[]
}

const DEFAULT_SETTINGS: SystemSettings = {
  company_name: 'DistroGH',
  default_moq: 1,
  expiry_reminder_days: 30,
  week_starts_on: 1,
  packaging_presets: ['100g', '250g', '400g', '500g', '1kg', '1L', '500ml'],
}

function coerceSettings(rows: { key: string; value: unknown }[]): SystemSettings {
  const out: SystemSettings = { ...DEFAULT_SETTINGS }
  for (const row of rows) {
    const k = row.key as keyof SystemSettings
    const v = row.value
    if (k === 'company_name' && typeof v === 'string') out.company_name = v
    if (k === 'default_moq') out.default_moq = Number(v) || 1
    if (k === 'expiry_reminder_days') out.expiry_reminder_days = Number(v) || 30
    if (k === 'week_starts_on') out.week_starts_on = Number(v) ?? 1
    if (k === 'packaging_presets' && Array.isArray(v)) out.packaging_presets = v.filter((x) => typeof x === 'string')
  }
  return out
}

export async function GET() {
  await requireSession()
  const pool = getDbPool()
  const { rows } = await pool.query(`select key, value from public.system_settings`)
  const settings = coerceSettings(rows ?? [])
  return NextResponse.json({ success: true, data: settings })
}

export async function PATCH(req: Request) {
  await requireAdminSession()
  const body = await req.json().catch(() => null)

  const pool = getDbPool()

  // Supports either { key, value } or { settings: { ...partial } }
  const key = body?.key != null ? String(body.key) : null
  if (key) {
    const value = body?.value
    await pool.query(
      `
      insert into public.system_settings (key, value, updated_at)
      values ($1, $2, now())
      on conflict (key) do update set value = excluded.value, updated_at = now()
      `,
      [key, value]
    )
    return NextResponse.json({ success: true })
  }

  const settings = body?.settings && typeof body.settings === 'object' ? (body.settings as Record<string, unknown>) : null
  if (!settings) {
    return NextResponse.json({ success: false, error: 'Invalid body. Expected { key, value } or { settings }.' }, { status: 400 })
  }

  const entries = Object.entries(settings).filter(([k]) => k in DEFAULT_SETTINGS)
  if (entries.length === 0) {
    return NextResponse.json({ success: false, error: 'No valid settings keys provided.' }, { status: 400 })
  }

  for (const [k, v] of entries) {
    await pool.query(
      `
      insert into public.system_settings (key, value, updated_at)
      values ($1, $2, now())
      on conflict (key) do update set value = excluded.value, updated_at = now()
      `,
      [k, v]
    )
  }

  return NextResponse.json({ success: true })
}

