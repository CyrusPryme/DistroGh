import { cn, formatGHS, formatNumber } from '@/lib/utils'
import { LucideIcon, TrendingUp, TrendingDown, Minus } from 'lucide-react'

interface KPICardProps {
  title: string
  value: string | number
  subtitle?: string
  icon: LucideIcon
  iconColor?: string
  iconBg?: string
  trend?: number
  prefix?: string
  isCurrency?: boolean
  className?: string
}

export function KPICard({
  title,
  value,
  subtitle,
  icon: Icon,
  iconColor = 'text-brand-600',
  iconBg = 'bg-brand-50',
  trend,
  prefix,
  isCurrency = false,
  className,
}: KPICardProps) {
  const displayValue = isCurrency
    ? formatGHS(Number(value))
    : typeof value === 'number'
    ? formatNumber(value)
    : value

  const TrendIcon = trend && trend > 0 ? TrendingUp : trend && trend < 0 ? TrendingDown : Minus
  const trendColor = trend && trend > 0
    ? 'text-emerald-600'
    : trend && trend < 0
    ? 'text-red-500'
    : 'text-slate-400'

  return (
    <div className={cn('kpi-card', className)}>
      <div className="flex items-start justify-between">
        <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center', iconBg)}>
          <Icon className={cn('w-5 h-5', iconColor)} />
        </div>
        {trend !== undefined && (
          <div className={cn('flex items-center gap-1 text-xs font-medium', trendColor)}>
            <TrendIcon className="w-3.5 h-3.5" />
            <span>{Math.abs(trend)}%</span>
          </div>
        )}
      </div>

      <div className="mt-4">
        <p className="text-2xl font-display font-bold text-slate-900 leading-none">
          {prefix && <span className="text-base font-semibold text-slate-500 mr-1">{prefix}</span>}
          {displayValue}
        </p>
        <p className="mt-1.5 text-sm font-medium text-slate-500">{title}</p>
        {subtitle && (
          <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>
        )}
      </div>
    </div>
  )
}
