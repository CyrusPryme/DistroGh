import type { PoolClient } from 'pg'
import {
  allocateTransportCostByQuantity,
  allocationSharesFromAmounts,
  type DeliveryAllocationLine,
  validateDeliveryChargeAllocation,
} from '@/lib/delivery-cost-allocation'
import { formatDate, toSqlDate } from '@/lib/utils'

export type RunItemWithVendor = {
  product_id: string
  quantity_delivered: number
  vendor_id: string
  vendor_name: string
}

export async function loadRunItemsWithVendors(
  client: PoolClient,
  deliveryRunId: string
): Promise<RunItemWithVendor[]> {
  const { rows } = await client.query(
    `
    select
      dri.product_id,
      dri.quantity_delivered,
      p.vendor_id,
      v.name as vendor_name
    from public.delivery_run_items dri
    join public.products p on p.id = dri.product_id
    join public.vendors v on v.id = p.vendor_id
    where dri.delivery_run_id = $1::uuid
    `,
    [deliveryRunId]
  )
  return rows.map((r) => ({
    product_id: String(r.product_id),
    quantity_delivered: Number(r.quantity_delivered) || 0,
    vendor_id: String(r.vendor_id),
    vendor_name: String(r.vendor_name ?? ''),
  }))
}

export function mapChargeRows(
  rows: Array<{
    vendor_id: unknown
    vendor_name?: unknown
    quantity_delivered: unknown
    share_percent: unknown
    allocated_amount: unknown
  }>
): DeliveryAllocationLine[] {
  return rows.map((r) => ({
    vendor_id: String(r.vendor_id),
    vendor_name: String(r.vendor_name ?? ''),
    quantity_delivered: Number(r.quantity_delivered) || 0,
    share_percent: Number(r.share_percent) || 0,
    allocated_amount: Number(r.allocated_amount) || 0,
  }))
}

export function computeRunChargeAllocation(
  totalTransportCost: number,
  items: RunItemWithVendor[]
): DeliveryAllocationLine[] {
  return allocateTransportCostByQuantity(
    totalTransportCost,
    items.map((i) => ({
      vendor_id: i.vendor_id,
      vendor_name: i.vendor_name,
      quantity_delivered: i.quantity_delivered,
    }))
  )
}

export function buildDeliveryChargeReason(params: {
  supermarketLabel: string
  deliveryDate: string
  quantity: number
  sharePercent: number
}): string {
  const pct = params.sharePercent.toFixed(1)
  return `Delivery transport — ${params.supermarketLabel} (${params.deliveryDate}), ${params.quantity} units (${pct}% of load)`
}

/** Create vendor deductions + charge rows for a confirmed delivery run. Idempotent per run. */
export async function applyDeliveryVendorCharges(
  client: PoolClient,
  params: {
    deliveryRunId: string
    totalTransportCost: number
    deliveryDate: string
    supermarketLabel: string
    createdByUserId: string
    customAllocation?: DeliveryAllocationLine[]
  }
): Promise<DeliveryAllocationLine[]> {
  const existing = await client.query(
    `select 1 from public.delivery_run_vendor_charges where delivery_run_id = $1::uuid limit 1`,
    [params.deliveryRunId]
  )
  if ((existing.rowCount ?? 0) > 0) {
    const { rows } = await client.query(
      `
      select c.vendor_id, v.name as vendor_name, c.quantity_delivered, c.share_percent, c.allocated_amount
      from public.delivery_run_vendor_charges c
      join public.vendors v on v.id = c.vendor_id
      where c.delivery_run_id = $1::uuid
      order by c.allocated_amount desc
      `,
      [params.deliveryRunId]
    )
    return mapChargeRows(rows)
  }

  const items = await loadRunItemsWithVendors(client, params.deliveryRunId)
  const allowedVendorIds = new Set(items.map((i) => i.vendor_id))
  const totalTransportCost = Math.max(0, Number(params.totalTransportCost) || 0)

  if (totalTransportCost <= 0 && params.customAllocation?.length) {
    throw new Error('Vendor charges are not allowed when transport cost is zero.')
  }

  let allocation: DeliveryAllocationLine[]
  if (params.customAllocation?.length) {
    allocation = allocationSharesFromAmounts(totalTransportCost, params.customAllocation)
    validateDeliveryChargeAllocation(totalTransportCost, allocation, allowedVendorIds)
  } else {
    allocation = computeRunChargeAllocation(totalTransportCost, items)
    validateDeliveryChargeAllocation(totalTransportCost, allocation, allowedVendorIds)
  }

  if (allocation.length === 0) return []

  const sqlDate = toSqlDate(params.deliveryDate)
  const deliveryDateLabel = formatDate(sqlDate)

  for (const row of allocation) {
    const reason = buildDeliveryChargeReason({
      supermarketLabel: params.supermarketLabel,
      deliveryDate: deliveryDateLabel,
      quantity: row.quantity_delivered,
      sharePercent: row.share_percent,
    })

    const { rows: dedRows } = await client.query(
      `
      insert into public.vendor_deductions (
        vendor_id, amount, reason, deduction_date, reference_id, reference_type, created_by
      )
      values ($1::uuid, $2, $3, $4::date, $5::uuid, 'delivery_run', $6::uuid)
      returning id
      `,
      [
        row.vendor_id,
        row.allocated_amount,
        reason,
        sqlDate,
        params.deliveryRunId,
        params.createdByUserId,
      ]
    )

    const deductionId = dedRows[0]?.id
    if (!deductionId) throw new Error('Failed to create vendor deduction for delivery charge')

    await client.query(
      `
      insert into public.delivery_run_vendor_charges (
        delivery_run_id, vendor_id, quantity_delivered, share_percent, allocated_amount, vendor_deduction_id
      )
      values ($1::uuid, $2::uuid, $3, $4, $5, $6::uuid)
      `,
      [
        params.deliveryRunId,
        row.vendor_id,
        row.quantity_delivered,
        row.share_percent,
        row.allocated_amount,
        deductionId,
      ]
    )
  }

  return allocation
}
