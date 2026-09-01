import { format, startOfMonth, endOfMonth, subDays, subWeeks } from 'date-fns'

export type DashboardDatePreset = 'all_time' | 'last_7_days' | 'this_month' | 'last_8_weeks' | 'last_12_months' | 'custom'

export type DashboardDateRange = {
  preset: DashboardDatePreset
  from: string
  to: string
  label: string
}

function toIsoDate(d: Date): string {
  return format(d, 'yyyy-MM-dd')
}

export function resolveDashboardDateRange(
  preset: DashboardDatePreset,
  customFrom?: string,
  customTo?: string
): DashboardDateRange {
  const today = new Date()

  switch (preset) {
    case 'all_time':
      return {
        preset,
        from: '',
        to: '',
        label: 'All time',
      }
    case 'last_7_days':
      return {
        preset,
        from: toIsoDate(subDays(today, 6)),
        to: toIsoDate(today),
        label: 'Last 7 days',
      }
    case 'this_month':
      return {
        preset,
        from: toIsoDate(startOfMonth(today)),
        to: toIsoDate(endOfMonth(today)),
        label: 'This month',
      }
    case 'last_8_weeks':
      return {
        preset,
        from: toIsoDate(subWeeks(today, 8)),
        to: toIsoDate(today),
        label: 'Last 8 weeks',
      }
    case 'last_12_months':
      return {
        preset,
        from: toIsoDate(subWeeks(today, 52)),
        to: toIsoDate(today),
        label: 'Last 12 months',
      }
    case 'custom': {
      const from = customFrom && /^\d{4}-\d{2}-\d{2}$/.test(customFrom) ? customFrom : toIsoDate(subWeeks(today, 8))
      const to = customTo && /^\d{4}-\d{2}-\d{2}$/.test(customTo) ? customTo : toIsoDate(today)
      return { preset, from, to, label: `${from} → ${to}` }
    }
    default:
      return resolveDashboardDateRange('last_8_weeks')
  }
}

export const DASHBOARD_DATE_PRESETS: { id: DashboardDatePreset; label: string }[] = [
  { id: 'all_time', label: 'All time' },
  { id: 'last_7_days', label: 'Last 7 days' },
  { id: 'this_month', label: 'This month' },
  { id: 'last_8_weeks', label: 'Last 8 weeks' },
  { id: 'last_12_months', label: 'Last 12 months' },
  { id: 'custom', label: 'Custom' },
]
