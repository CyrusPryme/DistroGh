/** @type {import('next').NextConfig} */

/** Hostnames allowed to invoke Server Actions (CSRF protection). */
const allowedOrigins = new Set(['localhost:3000', '127.0.0.1:3000'])

// Set automatically on Vercel (production + preview), e.g. your-project.vercel.app
if (process.env.VERCEL_URL) {
  allowedOrigins.add(process.env.VERCEL_URL)
}

// Stable production alias (distinct from VERCEL_URL, which is per-deployment) — set
// automatically by Vercel for the project's assigned production domain.
if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
  allowedOrigins.add(process.env.VERCEL_PROJECT_PRODUCTION_URL)
}

// Custom domain or explicit app URL from Vercel env: NEXT_PUBLIC_APP_URL=https://...
if (process.env.NEXT_PUBLIC_APP_URL) {
  try {
    allowedOrigins.add(new URL(process.env.NEXT_PUBLIC_APP_URL).host)
  } catch {
    // ignore invalid URL
  }
}

// Actual production host for this project (with hyphen — not "distrogh.vercel.app").
// Kept as a hardcoded fallback in case the env vars above aren't set for some reason.
allowedOrigins.add('distro-gh.vercel.app')

const isProd = process.env.NODE_ENV === 'production'

/**
 * Enforcing CSP that still allows this app's Next.js runtime and Google Fonts.
 * Next injects inline bootstrap scripts, and Tailwind/Recharts set style attributes,
 * so script-src and style-src include 'unsafe-inline'. No third-party script hosts
 * are allowed. 'unsafe-eval' is development-only (React Refresh). A nonce-based
 * policy would need nonces threaded through middleware and the root layout; that
 * is easy to break hydration, so this compatible policy is enforced rather than
 * sent as Report-Only.
 */
function contentSecurityPolicy() {
  const scriptSrc = isProd
    ? "script-src 'self' 'unsafe-inline'"
    : "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
  const directives = [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob:",
    "connect-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ]
  if (isProd) directives.push('upgrade-insecure-requests')
  return directives.join('; ')
}

const securityHeaders = [
  { key: 'Content-Security-Policy', value: contentSecurityPolicy() },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
]

const nextConfig = {
  experimental: {
    serverActions: {
      allowedOrigins: [...allowedOrigins],
    },
  },
  images: {
    formats: ['image/avif', 'image/webp'],
    // Cap full-bleed srcset so the landing hero is not forced to 1920w/3840w.
    deviceSizes: [640, 750, 828, 1080, 1200],
    qualities: [70, 75],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ]
  },
}

module.exports = nextConfig
