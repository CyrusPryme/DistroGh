import { NextResponse } from 'next/server'

export function apiError(e: unknown, fallback = 'Request failed') {
  const msg = e instanceof Error ? e.message : fallback
  const status = msg === 'Unauthorized' ? 401 : msg === 'Forbidden' ? 403 : 500
  return NextResponse.json({ success: false, error: msg }, { status })
}
