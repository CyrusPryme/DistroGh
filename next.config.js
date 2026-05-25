/** @type {import('next').NextConfig} */

/** Hostnames allowed to invoke Server Actions (CSRF protection). */
const allowedOrigins = new Set(['localhost:3000', '127.0.0.1:3000'])

// Set automatically on Vercel (production + preview), e.g. your-project.vercel.app
if (process.env.VERCEL_URL) {
  allowedOrigins.add(process.env.VERCEL_URL)
}

// Custom domain or explicit app URL from Vercel env: NEXT_PUBLIC_APP_URL=https://...
if (process.env.NEXT_PUBLIC_APP_URL) {
  try {
    allowedOrigins.add(new URL(process.env.NEXT_PUBLIC_APP_URL).host)
  } catch {
    // ignore invalid URL
  }
}

// Likely production host for DistroGh repo (update if Vercel assigns a different name)
allowedOrigins.add('distrogh.vercel.app')

const nextConfig = {
  experimental: {
    serverActions: {
      allowedOrigins: [...allowedOrigins],
    },
  },
}

module.exports = nextConfig
