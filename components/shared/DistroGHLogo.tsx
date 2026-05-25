import Image from 'next/image'
import Link from 'next/link'
import { cn } from '@/lib/utils'

const HEIGHTS = { sm: 32, md: 40, lg: 56, xl: 72 } as const

type LogoSize = keyof typeof HEIGHTS

interface DistroGHLogoProps {
  size?: LogoSize
  href?: string | null
  className?: string
  priority?: boolean
  /** Light card behind logo — use on dark backgrounds */
  onDark?: boolean
}

export function DistroGHLogo({
  size = 'md',
  href = '/',
  className,
  priority = false,
  onDark = false,
}: DistroGHLogoProps) {
  const height = HEIGHTS[size]

  const image = (
    <Image
      src="/logo.png"
      alt="DistroGH"
      width={Math.round(height * 1.15)}
      height={height}
      priority={priority}
      className={cn('w-auto object-contain', className)}
      style={{ height }}
    />
  )

  const content = onDark ? (
    <span className="inline-flex rounded-xl bg-white/95 p-2 shadow-sm">{image}</span>
  ) : (
    image
  )

  if (href) {
    return (
      <Link
        href={href}
        className="inline-flex shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 rounded-lg"
      >
        {content}
      </Link>
    )
  }

  return <span className="inline-flex shrink-0">{content}</span>
}
