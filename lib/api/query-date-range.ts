/** Parse optional dashboard date window from query params. */
export function parseQueryDateRange(url: URL): { from: string | null; to: string | null } {
  const from = (url.searchParams.get('from') ?? url.searchParams.get('range_start') ?? '').trim()
  const to = (url.searchParams.get('to') ?? url.searchParams.get('range_end') ?? '').trim()
  const iso = /^\d{4}-\d{2}-\d{2}$/
  return {
    from: iso.test(from) ? from : null,
    to: iso.test(to) ? to : null,
  }
}

/** SQL fragment: sales.week_start within [from, to] (inclusive). Params: $from, $to appended after existing. */
export function salesWeekStartFilter(alias = 's', fromIdx: number, toIdx: number): string {
  return `and (${alias}.week_start::date >= $${fromIdx}::date and ${alias}.week_start::date <= $${toIdx}::date)`
}

export function intakesDateFilter(alias = 'i', fromIdx: number, toIdx: number): string {
  return `and (${alias}.received_date::date >= $${fromIdx}::date and ${alias}.received_date::date <= $${toIdx}::date)`
}

export function returnsDateFilter(alias = 'r', fromIdx: number, toIdx: number): string {
  return `and (${alias}.return_date::date >= $${fromIdx}::date and ${alias}.return_date::date <= $${toIdx}::date)`
}
