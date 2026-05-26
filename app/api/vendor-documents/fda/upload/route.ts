import { NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth/require'
import { getDbPool } from '@/lib/db'
import { validateFdaDates } from '@/lib/fda-certificate'
import {
  uploadFdaCertificateToDrive,
  mimeTypeForFdaExtension,
  MAX_FDA_BYTES,
  isGoogleDriveConfigured,
} from '@/lib/google-drive'

export const runtime = 'nodejs'

const ALLOWED_EXT = new Set(['pdf', 'png', 'jpg', 'jpeg', 'webp'])

export async function POST(req: Request) {
  try {
    const session = await requireSession()
    if (!isGoogleDriveConfigured()) {
      return NextResponse.json(
        { success: false, error: 'FDA upload is not configured (Google Drive).' },
        { status: 503 }
      )
    }

    const form = await req.formData()
    const vendorId = String(form.get('vendor_id') ?? '')
    const acquiredRaw = String(form.get('fda_certificate_acquired_at') ?? '')
    const expiryRaw = String(form.get('facility_expiry_date') ?? '')
    const file = form.get('file')

    if (!vendorId) {
      return NextResponse.json({ success: false, error: 'vendor_id is required' }, { status: 400 })
    }
    if (session.role === 'vendor' && session.vendor_id !== vendorId) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
    }
    if (session.role !== 'admin' && session.role !== 'vendor') {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
    }

    const dateError = validateFdaDates(acquiredRaw, expiryRaw)
    if (dateError) {
      return NextResponse.json({ success: false, error: dateError }, { status: 400 })
    }

    if (!(file instanceof File)) {
      return NextResponse.json({ success: false, error: 'file is required' }, { status: 400 })
    }

    const ext = (file.name.split('.').pop() || 'pdf').toLowerCase()
    if (!ALLOWED_EXT.has(ext)) {
      return NextResponse.json(
        { success: false, error: 'File must be PDF or image (PNG, JPG, WEBP)' },
        { status: 400 }
      )
    }

    const mimeType = mimeTypeForFdaExtension(ext)
    if (!mimeType) {
      return NextResponse.json({ success: false, error: 'Unsupported file type' }, { status: 400 })
    }

    const bytes = Buffer.from(await file.arrayBuffer())
    if (bytes.length > MAX_FDA_BYTES) {
      return NextResponse.json({ success: false, error: 'File exceeds 10 MB limit' }, { status: 400 })
    }

    const pool = getDbPool()
    const { rows } = await pool.query<{ id: string; name: string }>(
      `select id, name from public.vendors where id = $1::uuid and deleted_at is null`,
      [vendorId]
    )
    if (!rows[0]) {
      return NextResponse.json({ success: false, error: 'Vendor not found' }, { status: 404 })
    }

    const upload = await uploadFdaCertificateToDrive({
      buffer: bytes,
      mimeType,
      vendorId,
      vendorName: rows[0].name,
      acquiredDate: acquiredRaw.trim(),
      expiryDate: expiryRaw.trim(),
      ext,
    })

    const isVendorUpload = session.role === 'vendor'

    await pool.query(
      `
      update public.vendors
      set
        fda_certificate_acquired_at = $2::date,
        facility_expiry_date = $3::date,
        fda_drive_file_id = $4,
        fda_drive_view_link = $5,
        fda_uploaded_at = $6::timestamptz,
        fda_certificate_path = null,
        verification_feedback = case when $7::boolean then null else verification_feedback end,
        status = case when $7::boolean then 'pending_verification' else status end,
        updated_at = now()
      where id = $1::uuid
      `,
      [
        vendorId,
        acquiredRaw.trim(),
        expiryRaw.trim(),
        upload.fileId,
        upload.viewLink,
        upload.uploadedAt,
        isVendorUpload,
      ]
    )

    return NextResponse.json({
      success: true,
      data: {
        fileId: upload.fileId,
        viewLink: upload.viewLink,
        acquiredAt: acquiredRaw.trim(),
        expiresAt: expiryRaw.trim(),
        uploadedAt: upload.uploadedAt,
      },
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Upload failed'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
