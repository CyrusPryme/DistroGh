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

const nextConfig = {
  experimental: {
    serverActions: {
      allowedOrigins: [...allowedOrigins],
    },
  },
}

module.exports = nextConfig
