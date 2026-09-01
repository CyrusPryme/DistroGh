'use client'

import Link from 'next/link'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

type IconActionProps = {
  label: string
  disabled?: boolean
  destructive?: boolean
  onClick?: () => void
  href?: string
  className?: string
  children: React.ReactNode
}

export function IconAction({
  label,
  disabled,
  destructive,
  onClick,
  href,
  className,
  children,
}: IconActionProps) {
  const classes = cn(
    'inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors',
    disabled
      ? 'opacity-30 cursor-not-allowed'
      : destructive
        ? 'hover:bg-red-50 hover:text-red-600'
        : 'hover:bg-slate-100 hover:text-slate-800',
    className
  )

  const control =
    href && !disabled ? (
      <Link href={href} className={classes} aria-label={label}>
        {children}
      </Link>
    ) : (
      <button type="button" disabled={disabled} onClick={onClick} className={classes} aria-label={label}>
        {children}
      </button>
    )

  if (disabled) return control

  return (
    <Tooltip>
      <TooltipTrigger asChild>{control}</TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  )
}
