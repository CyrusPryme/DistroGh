import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'DistroGH — Consignment Distribution Management',
  description: 'Modern consignment distribution management system for Ghana distributors. Real-time analytics, automated commission tracking, and seamless vendor management.',
  keywords: ['consignment', 'distribution', 'Ghana', 'vendors', 'sales', 'analytics'],
  icons: {
    icon: [{ url: '/favicon.png', type: 'image/png' }],
    apple: '/favicon.png',
    shortcut: '/favicon.png',
  },
  openGraph: {
    title: 'DistroGH — Consignment Distribution Management',
    description: 'Modern consignment distribution management system for Ghana distributors.',
    images: [{ url: '/logo.png' }],
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#006B3F',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="scroll-smooth">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&family=Sora:wght@600;700;800&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="font-sans antialiased bg-slate-50 text-slate-900 subpixel-antialiased min-h-screen">
        {children}
      </body>
    </html>
  )
}
