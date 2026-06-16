import { NextResponse } from 'next/server'
import { getDbPool } from '@/lib/db'
import { requireDeveloper } from '@/lib/auth/require'
import { apiError } from '@/lib/api/respond'

/** GET /api/developer/revenue — platform revenue breakdown */
export async function GET(req: Request) {
  try {
    await requireDeveloper()
    const pool = getDbPool()
    const url = new URL(req.url)

    const groupBy  = url.searchParams.get('group_by') ?? 'month'   // day | month | year | vendor | product | supermarket | category
    const dateFrom = url.searchParams.get('date_from') ?? ''
    const dateTo   = url.searchParams.get('date_to') ?? ''
    const limit    = Math.min(200, parseInt(url.searchParams.get('limit') ?? '60', 10))

    const dateFilter: string[] = ['s.deleted_at IS NULL']
    const vals: unknown[] = []
    let i = 1
    if (dateFrom) { dateFilter.push(`s.week_start >= $${i++}::date`); vals.push(dateFrom) }
    if (dateTo)   { dateFilter.push(`s.week_start <= $${i++}::date`); vals.push(dateTo) }
    const where = dateFilter.join(' AND ')

    let selectLabel: string
    let groupClause: string
    let orderClause: string

    switch (groupBy) {
      case 'day':
        selectLabel = `TO_CHAR(s.week_start, 'YYYY-MM-DD') as label`
        groupClause = `TO_CHAR(s.week_start, 'YYYY-MM-DD')`
        orderClause = `label ASC`
        break
      case 'year':
        selectLabel = `TO_CHAR(s.week_start, 'YYYY') as label`
        groupClause = `TO_CHAR(s.week_start, 'YYYY')`
        orderClause = `label ASC`
        break
      case 'vendor':
        selectLabel = `v.name as label`
        groupClause = `v.name`
        orderClause = `developer_revenue DESC`
        break
      case 'product':
        selectLabel = `p.name as label`
        groupClause = `p.name`
        orderClause = `developer_revenue DESC`
        break
      case 'supermarket':
        selectLabel = `sm.name as label`
        groupClause = `sm.name`
        orderClause = `developer_revenue DESC`
        break
      case 'category':
        selectLabel = `COALESCE(p.category, 'Uncategorized') as label`
        groupClause = `COALESCE(p.category, 'Uncategorized')`
        orderClause = `developer_revenue DESC`
        break
      default: // month
        selectLabel = `TO_CHAR(s.week_start, 'YYYY-MM') as label`
        groupClause = `TO_CHAR(s.week_start, 'YYYY-MM')`
        orderClause = `label ASC`
    }

    const joinClause = ['vendor','product','category'].includes(groupBy)
      ? `JOIN public.products p ON p.id = s.product_id JOIN public.vendors v ON v.id = p.vendor_id`
      : ['supermarket'].includes(groupBy)
      ? `JOIN public.supermarkets sm ON sm.id = s.supermarket_id JOIN public.products p ON p.id = s.product_id JOIN public.vendors v ON v.id = p.vendor_id`
      : `JOIN public.products p ON p.id = s.product_id JOIN public.vendors v ON v.id = p.vendor_id JOIN public.supermarkets sm ON sm.id = s.supermarket_id`

    const { rows } = await pool.query(
      `SELECT ${selectLabel},
              ROUND(SUM(s.total_sales)::numeric, 2) as total_sales,
              ROUND(SUM(s.vendor_due)::numeric, 2) as vendor_due,
              ROUND(SUM(s.developer_fee)::numeric, 2) as developer_revenue,
              ROUND(SUM(s.commission_amount)::numeric, 2) as distrogh_revenue,
              SUM(s.qty_sold) as total_qty
       FROM public.sales s
       ${joinClause}
       WHERE ${where}
       GROUP BY ${groupClause}
       ORDER BY ${orderClause}
       LIMIT $${i}`,
      [...vals, limit]
    )

    // Totals
    const totals = await pool.query(
      `SELECT ROUND(SUM(s.total_sales)::numeric,2) as total_sales,
              ROUND(SUM(s.vendor_due)::numeric,2) as vendor_due,
              ROUND(SUM(s.developer_fee)::numeric,2) as developer_revenue,
              ROUND(SUM(s.commission_amount)::numeric,2) as distrogh_revenue,
              SUM(s.qty_sold) as total_qty,
              COUNT(*) as record_count
       FROM public.sales s WHERE ${where}`,
      vals
    )

    return NextResponse.json({ success: true, data: rows, totals: totals.rows[0] })
  } catch (e) {
    return apiError(e, 'Failed to load revenue data')
  }
}
