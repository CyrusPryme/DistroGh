import { NextResponse } from 'next/server'
import { getDbPool } from '@/lib/db'
import { apiError } from '@/lib/api/respond'
import { requirePermission } from '@/lib/auth/require'
import { createMigrationProject, listMigrationProjects } from '@/lib/migration/projects'

export async function GET(req: Request) {
  try {
    await requirePermission('historical_migrations', 'read')
    const url = new URL(req.url)
    const status = url.searchParams.get('status') || undefined
    const q = url.searchParams.get('q') || undefined
    const pool = getDbPool()
    const data = await listMigrationProjects(pool, { status, q })
    return NextResponse.json({ success: true, data })
  } catch (e) {
    return apiError(e, 'Failed to list migrations')
  }
}

export async function POST(req: Request) {
  try {
    const session = await requirePermission('historical_migrations', 'create')
    const body = await req.json()
    const name = String(body.name || '').trim()
    if (!name) {
      return NextResponse.json({ success: false, error: 'Name is required' }, { status: 400 })
    }
    const pool = getDbPool()
    const project = await createMigrationProject(pool, {
      name,
      description: body.description ? String(body.description) : undefined,
      createdBy: session.user_id,
    })
    return NextResponse.json({ success: true, data: project })
  } catch (e) {
    return apiError(e, 'Failed to create migration')
  }
}
