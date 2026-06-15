import { NextResponse } from 'next/server'
import { getDbPool } from '@/lib/db'
import { requireAdminSession } from '@/lib/auth/require'
import { roundMoney, normalizeSaleMonthPeriod } from '@/lib/utils'
import { resolveProductPricing } from '@/lib/product-pricing'

type SaleInsert = {
  product_id: string
  supermarket_id: string
  qty_sold: number
  week_start: string
  week_end: string
  import_batch_id: string
  /** Snapshot from import preview — stored on the sale row; does not rewrite past sales. */
  unit_price?: number
  commission_amount?: number
  vendor_due?: number
  total_sales?: number
}

export async function POST(req: Request) {
  await requireAdminSession()
  const body = await req.json().catch(() => null)
  const sales = (Array.isArray(body) ? body : []) as SaleInsert[]

  if (sales.length === 0) {
    return NextResponse.json({ success: false, error: 'No sales rows provided' }, { status: 400 })
  }

  for (const sale of sales) {
    if (!sale.product_id || !String(sale.product_id).trim()) {
      return NextResponse.json({ success: false, error: 'Product ID is required' }, { status: 400 })
    }
    if (!sale.supermarket_id || !String(sale.supermarket_id).trim()) {
      return NextResponse.json({ success: false, error: 'Supermarket ID is required' }, { status: 400 })
    }
    const qty = Number(sale.qty_sold ?? 0)
    if (!Number.isFinite(qty) || qty <= 0) {
      return NextResponse.json({ success: false, error: 'Quantity sold must be greater than 0' }, { status: 400 })
    }
    if (!sale.week_start || !sale.week_end) {
      return NextResponse.json({ success: false, error: 'Report month period is required' }, { status: 400 })
    }
    if (!sale.import_batch_id || !String(sale.import_batch_id).trim()) {
      return NextResponse.json({ success: false, error: 'Import batch ID is required' }, { status: 400 })
    }
  }

  const batchId = String(sales[0].import_batch_id).trim()
  if (!sales.every((s) => String(s.import_batch_id).trim() === batchId)) {
    return NextResponse.json({ success: false, error: 'All rows must have the same import_batch_id' }, { status: 400 })
  }

  const pool = getDbPool()
  const client = await pool.connect()

  try {
    await client.query('begin')

    const existing = await client.query(
      `select 1 from public.sales where import_batch_id = $1 limit 1`,
      [batchId]
    )
    if (existing.rowCount) {
      await client.query('rollback')
      return NextResponse.json({ success: false, error: 'Import batch already processed' }, { status: 409 })
    }

    const productIds = Array.from(new Set(sales.map((s) => String(s.product_id).trim())))
    const productRows = await client.query(
      `
      select id, vendor_price, distrogh_markup
      from public.products
      where id = any($1::uuid[]) and deleted_at is null
      `,
      [productIds]
    )
    const productMap = new Map<
      string,
      { vendor_price: number; distrogh_markup: number }
    >(
      (productRows.rows ?? []).map((r: any) => [
        String(r.id),
        { vendor_price: Number(r.vendor_price ?? 0), distrogh_markup: Number(r.distrogh_markup ?? 0) },
      ])
    )

    for (const s of sales) {
      if (!productMap.has(String(s.product_id).trim())) {
        await client.query('rollback')
        return NextResponse.json({ success: false, error: `Product ${s.product_id} not found` }, { status: 400 })
      }
    }

    // Insert sales with calculated pricing fields.
    for (const s of sales) {
      const pid = String(s.product_id).trim()
      const smid = String(s.supermarket_id).trim()
      const qty = Number(s.qty_sold ?? 0)
      const product = productMap.get(pid)!

      const hasSnapshot =
        s.unit_price != null &&
        s.vendor_due != null &&
        s.commission_amount != null &&
        Number.isFinite(Number(s.unit_price)) &&
        Number.isFinite(Number(s.vendor_due)) &&
        Number.isFinite(Number(s.commission_amount))

      let unitPrice: number
      let vendorDue: number
      let commissionAmount: number
      let totalSales: number

      if (hasSnapshot) {
        unitPrice = roundMoney(Number(s.unit_price))
        vendorDue = roundMoney(Number(s.vendor_due))
        commissionAmount = roundMoney(Number(s.commission_amount))
        totalSales = roundMoney(
          s.total_sales != null && Number.isFinite(Number(s.total_sales))
            ? Number(s.total_sales)
            : qty * unitPrice
        )
      } else {
        const pricing = resolveProductPricing({
          vendor_price: product.vendor_price,
          distrogh_markup: product.distrogh_markup,
        })
        unitPrice = roundMoney(pricing.shopPrice)
        vendorDue = roundMoney(qty * pricing.vendorPrice)
        commissionAmount = roundMoney(qty * (pricing.markup + pricing.addOnTotal))
        totalSales = roundMoney(qty * unitPrice)
      }

      const period = normalizeSaleMonthPeriod(String(s.week_start))

      await client.query(
        `
        insert into public.sales (
          product_id,
          supermarket_id,
          qty_sold,
          unit_price,
          total_sales,
          commission_amount,
          vendor_due,
          week_start,
          week_end,
          import_batch_id
        )
        values (
          $1::uuid,
          $2::uuid,
          $3::int,
          $4::numeric,
          $5::numeric,
          $6::numeric,
          $7::numeric,
          $8::date,
          $9::date,
          $10
        )
        `,
        [pid, smid, Math.floor(qty), unitPrice, totalSales, commissionAmount, vendorDue, period.week_start, period.week_end, batchId]
      )
    }

    // Deduct sold quantities from supermarket_inventory, aggregating by (supermarket_id, product_id).
    const byKey = new Map<string, number>()
    for (const s of sales) {
      const key = `${String(s.supermarket_id).trim()}:${String(s.product_id).trim()}`
      byKey.set(key, (byKey.get(key) ?? 0) + Number(s.qty_sold ?? 0))
    }

    for (const [key, totalSold] of byKey) {
      const [supermarket_id, product_id] = key.split(':')
      const sold = Math.floor(Number(totalSold ?? 0))
      if (!sold || sold <= 0) continue

      await client.query(
        `
        insert into public.supermarket_inventory (supermarket_id, product_id, quantity, updated_at)
        values ($1::uuid, $2::uuid, 0, now())
        on conflict (supermarket_id, product_id) do nothing
        `,
        [supermarket_id, product_id]
      )

      await client.query(
        `
        update public.supermarket_inventory
        set quantity = greatest(0, quantity - $3::int),
            updated_at = now()
        where supermarket_id = $1::uuid and product_id = $2::uuid
        `,
        [supermarket_id, product_id, sold]
      )
    }

    await client.query('commit')
    return NextResponse.json({ success: true })
  } catch (e: any) {
    try {
      await client.query('rollback')
    } catch {
      // ignore
    }
    return NextResponse.json({ success: false, error: e?.message ?? 'Failed to import sales' }, { status: 500 })
  } finally {
    client.release()
  }
}

