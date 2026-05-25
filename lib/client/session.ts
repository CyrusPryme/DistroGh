export type ClientSession = {
  user_id: string
  email: string
  role: 'admin' | 'vendor'
  vendor_id: string | null
}

export async function fetchClientSession(): Promise<ClientSession | null> {
  const res = await fetch('/api/me', { cache: 'no-store' })
  const json = await res.json().catch(() => null)
  if (!res.ok || !json?.success || !json.data) return null
  return {
    user_id: String(json.data.user_id ?? ''),
    email: String(json.data.email ?? ''),
    role: json.data.role === 'vendor' ? 'vendor' : 'admin',
    vendor_id: (json.data.vendor_id ?? null) as string | null,
  }
}
