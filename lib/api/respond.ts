import { NextResponse } from 'next/server'

export function apiError(e: unknown, fallback = 'Request failed') {
  const isExpected = e instanceof Error &&
    (e.message === 'Unauthorized' || e.message === 'Forbidden')

  if (!isExpected) {
    // Log unexpected server errors so they appear in the server console
    console.error(`[API Error] ${fallback}:`, e)
  }

  const msg = e instanceof Error ? e.message : fallback
  const status = msg === 'Unauthorized' ? 401 : msg === 'Forbidden' ? 403 : 500
  return NextResponse.json({ success: false, error: msg }, { status })
}
