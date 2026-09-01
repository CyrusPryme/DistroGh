import {
  format,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  subDays,
  startOfQuarter,
  endOfQuarter,
  startOfDay,
} from 'date-fns'

export type ReportDatePresetKey =
  | 'all_time'
  | 'this_week'
  | 'this_month'
  | 'last_7'
  | 'last_30'
  | 'last_12_months'
  | 'quarter'
  | 'custom'

export type ReportDateRange = {
  preset: ReportDatePresetKey
  start: string
  end: string
  label: string
}

const ALL_TIME_START = '2020-01-01'

export const REPORT_DATE_PRESETS: {
  key: ReportDatePresetKey
  label: string
  getRange: () => { start: string; end: string }
}[] = [
  {
    key: 'all_time',
    label: 'All time',
    getRange: () => ({ start: ALL_TIME_START, end: format(new Date(), 'yyyy-MM-dd') }),
  },
  {
    key: 'this_week',
    label: 'This week',
    getRange: () => {
      const start = startOfWeek(new Date(), { weekStartsOn: 1 })
      const end = endOfWeek(new Date(), { weekStartsOn: 1 })
      return { start: format(start, 'yyyy-MM-dd'), end: format(end, 'yyyy-MM-dd') }
    },
  },
  {
    key: 'this_month',
    label: 'This month',
    getRange: () => {
      const start = startOfMonth(new Date())
      const end = endOfMonth(new Date())
      return { start: format(start, 'yyyy-MM-dd'), end: format(end, 'yyyy-MM-dd') }
    },
  },
  {
    key: 'last_7',
    label: 'Last 7 days',
    getRange: () => {
      const end = startOfDay(new Date())
      const start = subDays(end, 6)
      return { start: format(start, 'yyyy-MM-dd'), end: format(end, 'yyyy-MM-dd') }
    },
  },
  {
    key: 'last_30',
    label: 'Last 30 days',
    getRange: () => {
      const end = startOfDay(new Date())
      const start = subDays(end, 29)
      return { start: format(start, 'yyyy-MM-dd'), end: format(end, 'yyyy-MM-dd') }
    },
  },
  {
    key: 'last_12_months',
    label: 'Last 12 months',
    getRange: () => {
      const end = startOfDay(new Date())
      const start = subDays(end, 364)
      return { start: format(start, 'yyyy-MM-dd'), end: format(end, 'yyyy-MM-dd') }
    },
  },
  {
    key: 'quarter',
    label: 'Quarter to date',
    getRange: () => {
      const start = startOfQuarter(new Date())
      const end = endOfQuarter(new Date())
      return { start: format(start, 'yyyy-MM-dd'), end: format(end, 'yyyy-MM-dd') }
    },
  },
  { key: 'custom', label: 'Custom', getRange: () => ({ start: '', end: '' }) },
]

export function resolveReportDateRange(
  preset: ReportDatePresetKey,
  customStart: string,
  customEnd: string
): ReportDateRange {
  if (preset === 'custom') {
    const start = customStart.trim()
    const end = customEnd.trim()
    return {
      preset,
      start,
      end,
      label: start && end ? `${start} → ${end}` : 'Custom range',
    }
  }
  const def = REPORT_DATE_PRESETS.find((p) => p.key === preset)
  const { start, end } = def ? def.getRange() : { start: customStart, end: customEnd }
  return { preset, start, end, label: def?.label ?? 'Custom range' }
}
