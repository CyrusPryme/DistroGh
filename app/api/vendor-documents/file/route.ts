import { NextResponse } from 'next/server'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { requireSession } from '@/lib/auth/require'
import { apiError } from '@/lib/api/respond'

export async function GET(req: Request) {
  try {
    const session = await requireSession()
    const url = new URL(req.url)
    const storedPath = (url.searchParams.get('path') ?? '').trim()
    if (!storedPath || storedPath.includes('..')) {
      return NextResponse.json({ success: false, error: 'Invalid path' }, { status: 400 })
    }

    const vendorId = storedPath.split('/')[0]
    if (session.role === 'vendor' && session.vendor_id !== vendorId) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
    }

    const absolute = path.join(process.cwd(), 'uploads', 'vendor-documents', storedPath)
    const bytes = await readFile(absolute)
    const ext = path.extname(storedPath).toLowerCase()
    const type =
      ext === '.pdf' ? 'application/pdf' :
      ext === '.png' ? 'image/png' :
      ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' :
      'application/octet-stream'

    const filename = path.basename(storedPath).replace(/[^\w.\-]/g, '_') || 'fda-certificate'

    return new NextResponse(bytes, {
      headers: {
        'Content-Type': type,
        'Content-Disposition': `inline; filename="${filename}"`,
        'Cache-Control': 'private, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (e) {
    return apiError(e, 'Document not found')
  }
}
