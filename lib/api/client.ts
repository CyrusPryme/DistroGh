type ApiSuccess<T> = { success: true; data: T }
type ApiFailure = { success: false; error: string }

export type ApiJson<T> = ApiSuccess<T> | ApiFailure

export async function apiFetch<T>(
  path: string,
  init?: RequestInit & { fallbackError?: string }
): Promise<T> {
  const res = await fetch(path, { cache: 'no-store', ...init })
  const json = (await res.json().catch(() => null)) as ApiJson<T> | null
  if (!res.ok || !json?.success) {
    throw new Error(
      (json && 'error' in json && json.error) ||
        init?.fallbackError ||
        `Request failed (${res.status})`
    )
  }
  return json.data as T
}

export async function apiFetchNullable<T>(
  path: string,
  init?: RequestInit & { fallbackError?: string }
): Promise<T | null> {
  const res = await fetch(path, { cache: 'no-store', ...init })
  const json = (await res.json().catch(() => null)) as ApiJson<T | null> | null
  if (!res.ok || !json?.success) {
    throw new Error(
      (json && 'error' in json && json.error) ||
        init?.fallbackError ||
        `Request failed (${res.status})`
    )
  }
  return (json.data ?? null) as T | null
}
