import { cn } from '@/lib/utils'

export type PageHeaderProps = {
  title: string
  description?: string
  /** Optional leading icon or badge */
  icon?: React.ReactNode
  /** Right-side actions (buttons, filters) */
  actions?: React.ReactNode
  className?: string
}

/** Standard dashboard page title row. */
export function PageHeader({ title, description, icon, actions, className }: PageHeaderProps) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between',
        className
      )}
    >
      <div className="flex items-start gap-3 min-w-0">
        {icon ? <div className="shrink-0 mt-0.5">{icon}</div> : null}
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
            {title}
          </h1>
          {description ? (
            <p className="mt-0.5 text-sm text-slate-500">{description}</p>
          ) : null}
        </div>
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>
      ) : null}
    </div>
  )
}
