const DEV_AUTH_SECRET = 'dev-insecure-secret-change-me'

/** Single source for JWT signing secret (session cookie + middleware). */
export function getAuthSecret(): Uint8Array {
  const raw = process.env.AUTH_SECRET?.trim()
  const isProd = process.env.NODE_ENV === 'production'
  if (isProd && (!raw || raw === DEV_AUTH_SECRET)) {
    throw new Error(
      '[auth] AUTH_SECRET must be set to a strong unique value in production (not the dev default).'
    )
  }
  const secret = raw || DEV_AUTH_SECRET
  return new TextEncoder().encode(secret)
}
