'use server'

import type { VendorApplication } from '@/types/vendor-application'
import { cookies, headers } from 'next/headers'

async function apiFetch(path: string, init?: RequestInit) {
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host')
  const proto = h.get('x-forwarded-proto') ?? (process.env.NODE_ENV === 'production' ? 'https' : 'http')
  if (!host) throw new Error('Cannot determine request host')

  const cookieHeader = (await cookies()).toString()
  const res = await fetch(`${proto}://${host}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      cookie: cookieHeader,
    },
    cache: 'no-store',
  })
  return res
}

/**
 * Approves a vendor application via the Postgres-backed API. The API performs an atomic transaction:
 * vendor upsert, user creation (bcrypt hash), profile linking, and application status update.
 */
export async function approveVendorApplication(application: VendorApplication): Promise<{
  success: true
  vendorId: string
  initialPassword: string
  loginEmail: string
}> {
  // Keep existing signature + returned fields for UI compatibility.
  if (!application?.id) throw new Error('Application ID required')

  const res = await apiFetch(`/api/vendor-applications/${encodeURIComponent(application.id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'approved' }),
  })
  const json = await res.json().catch(() => null)
  if (!res.ok || !json?.success) {
    throw new Error(json?.error || 'Failed to approve application')
  }

  return {
    success: true,
    vendorId: String(json.vendorId ?? ''),
    initialPassword: String(json.initialPassword ?? ''),
    loginEmail: String(json.loginEmail ?? ''),
  }
}

/**
 * Remove an application from the list (admin). Allowed only for approved or rejected
 * applications so the list can be kept tidy without losing pending items.
 */
export async function removeVendorApplication(applicationId: string): Promise<{ success: true }> {
  if (!applicationId?.trim()) throw new Error('Application ID required')
  const res = await apiFetch(`/api/vendor-applications/${encodeURIComponent(applicationId)}`, { method: 'DELETE' })
  const json = await res.json().catch(() => null)
  if (!res.ok || !json?.success) throw new Error(json?.error || 'Failed to remove application')
  return { success: true }
}
