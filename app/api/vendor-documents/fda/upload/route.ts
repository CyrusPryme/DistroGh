import { NextResponse } from 'next/server'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { requireSession } from '@/lib/auth/require'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  const session = await requireSession()
  const form = await req.formData()
  const vendorId = String(form.get('vendor_id') ?? '')
  const file = form.get('file')

  if (!vendorId) {
    return NextResponse.json({ success: false, error: 'vendor_id is required' }, { status: 400 })
  }
  if (session.role === 'vendor' && session.vendor_id !== vendorId) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ success: false, error: 'file is required' }, { status: 400 })
  }

  const ext = (file.name.split('.').pop() || 'pdf').toLowerCase()
  const dir = path.join(process.cwd(), 'uploads', 'vendor-documents', vendorId)
  await mkdir(dir, { recursive: true })
  const filename = `fda.${ext}`
  const absolute = path.join(dir, filename)

  const bytes = Buffer.from(await file.arrayBuffer())
  await writeFile(absolute, bytes)

  // store a relative path in DB (similar to previous storage path convention)
  const storedPath = `${vendorId}/${filename}`
  return NextResponse.json({ success: true, data: { path: storedPath } })
}

