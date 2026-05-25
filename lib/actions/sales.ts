'use server'

import { getDbPool } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/require'

export interface ImportHistory {
  import_batch_id: string
  imported_at: string
  row_count: number
}

export async function deleteSalesBatch(batchId: string): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin()
    const pool = getDbPool()
    const client = await pool.connect()

    try {
      await client.query('begin')
      const { rows: sales } = await client.query(
        `select supermarket_id, product_id, qty_sold from public.sales where import_batch_id = $1`,
        [batchId]
      )

      const byKey = new Map<string, number>()
      for (const s of sales) {
        const key = `${s.supermarket_id}:${s.product_id}`
        byKey.set(key, (byKey.get(key) ?? 0) + Number(s.qty_sold ?? 0))
      }

      for (const [key, totalRestore] of byKey) {
        const [supermarket_id, product_id] = key.split(':')
        const inv = await client.query(
          `
          select id, quantity from public.supermarket_inventory
          where supermarket_id = $1::uuid and product_id = $2::uuid
          for update
          `,
          [supermarket_id, product_id]
        )
        if (inv.rows[0]) {
          const newQty = Number(inv.rows[0].quantity ?? 0) + totalRestore
          await client.query(
            `update public.supermarket_inventory set quantity = $2, updated_at = now() where id = $1::uuid`,
            [inv.rows[0].id, newQty]
          )
        }
      }

      await client.query(`delete from public.sales where import_batch_id = $1`, [batchId])
      await client.query('commit')
      return { success: true }
    } catch (e) {
      await client.query('rollback')
      throw e
    } finally {
      client.release()
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to delete sales batch'
    return { success: false, error: msg }
  }
}

export async function getImportHistory(): Promise<{ success: boolean; data?: ImportHistory[]; error?: string }> {
  try {
    await requireAdmin()
    const pool = getDbPool()
    const { rows } = await pool.query(
      `
      select import_batch_id, imported_at, count(*)::int as row_count
      from public.sales
      where import_batch_id is not null
      group by import_batch_id, imported_at
      order by imported_at desc
      `
    )
    return {
      success: true,
      data: rows.map((r) => ({
        import_batch_id: r.import_batch_id,
        imported_at: r.imported_at,
        row_count: Number(r.row_count),
      })),
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to fetch import history'
    return { success: false, error: msg }
  }
}
