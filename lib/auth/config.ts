/** Single source for JWT signing secret (session cookie + middleware). */
export function getAuthSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET ?? 'dev-insecure-secret-change-me'
  if (process.env.NODE_ENV === 'production' && secret === 'dev-insecure-secret-change-me') {
    console.warn('[auth] AUTH_SECRET is not set — using insecure default. Set AUTH_SECRET in production.')
  }
  return new TextEncoder().encode(secret)
}
