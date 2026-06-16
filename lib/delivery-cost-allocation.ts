import { roundMoney } from '@/lib/utils'

export type DeliveryAllocationLine = {
  vendor_id: string
  vendor_name?: string
  quantity_delivered: number
  share_percent: number
  allocated_amount: number
}

/**
 * Split transport cost across vendors by units delivered on the run.
 * One shared vehicle → each vendor pays in proportion to their quantity.
 */
export function allocateTransportCostByQuantity(
  totalTransportCost: number,
  lines: { vendor_id: string; vendor_name?: string; quantity_delivered: number }[]
): DeliveryAllocationLine[] {
  const totalCost = Math.max(0, Number(totalTransportCost) || 0)
  if (totalCost <= 0 || lines.length === 0) return []

  const byVendor = new Map<string, { vendor_name?: string; quantity_delivered: number }>()
  for (const line of lines) {
    const vendorId = line.vendor_id?.trim()
    const qty = Math.max(0, Math.floor(Number(line.quantity_delivered) || 0))
    if (!vendorId || qty <= 0) continue
    const cur = byVendor.get(vendorId) ?? { vendor_name: line.vendor_name, quantity_delivered: 0 }
    cur.quantity_delivered += qty
    if (line.vendor_name && !cur.vendor_name) cur.vendor_name = line.vendor_name
    byVendor.set(vendorId, cur)
  }

  const vendors = [...byVendor.entries()]
  if (vendors.length === 0) return []

  const totalQty = vendors.reduce((s, [, v]) => s + v.quantity_delivered, 0)
  if (totalQty <= 0) return []

  const raw = vendors.map(([vendor_id, v]) => ({
    vendor_id,
    vendor_name: v.vendor_name,
    quantity_delivered: v.quantity_delivered,
    share_percent: (v.quantity_delivered / totalQty) * 100,
    allocated_amount: roundMoney((totalCost * v.quantity_delivered) / totalQty),
  }))

  const sumAllocated = raw.reduce((s, r) => s + r.allocated_amount, 0)
  const remainder = roundMoney(totalCost - sumAllocated)
  if (remainder !== 0 && raw.length > 0) {
    const largest = raw.reduce((best, row) =>
      row.quantity_delivered > best.quantity_delivered ? row : best
    )
    largest.allocated_amount = roundMoney(largest.allocated_amount + remainder)
  }

  return raw
    .filter((r) => r.allocated_amount > 0)
    .sort((a, b) => b.allocated_amount - a.allocated_amount)
}

/** Recompute share % from charge amounts (for manual edits). */
export function allocationSharesFromAmounts(
  totalTransportCost: number,
  lines: DeliveryAllocationLine[]
): DeliveryAllocationLine[] {
  const total = Math.max(0, roundMoney(Number(totalTransportCost) || 0))
  return lines.map((line) => ({
    ...line,
    allocated_amount: roundMoney(line.allocated_amount),
    share_percent: total > 0 ? roundMoney((line.allocated_amount / total) * 100) : 0,
  }))
}

export function sumAllocationAmounts(lines: Pick<DeliveryAllocationLine, 'allocated_amount'>[]): number {
  return roundMoney(lines.reduce((s, l) => s + (Number(l.allocated_amount) || 0), 0))
}

export function validateDeliveryChargeAllocation(
  totalTransportCost: number,
  allocation: DeliveryAllocationLine[],
  allowedVendorIds: Set<string>
): void {
  const total = Math.max(0, roundMoney(Number(totalTransportCost) || 0))

  if (total <= 0) {
    if (allocation.length > 0) {
      throw new Error('Vendor charges are not allowed when transport cost is zero.')
    }
    return
  }

  if (allocation.length === 0) {
    throw new Error('Transport cost is set — add vendor charges or set transport cost to zero.')
  }

  for (const row of allocation) {
    if (!allowedVendorIds.has(row.vendor_id)) {
      throw new Error('Charge includes a vendor not on this delivery run.')
    }
    const amount = roundMoney(Number(row.allocated_amount) || 0)
    if (amount < 0) throw new Error('Vendor charges cannot be negative.')
    if (amount <= 0) throw new Error('Each vendor charge must be greater than zero when transport cost is set.')
  }

  const allocated = sumAllocationAmounts(allocation)
  if (Math.abs(allocated - total) > 0.01) {
    throw new Error(
      `Vendor charges (${allocated.toFixed(2)}) must equal transport cost (${total.toFixed(2)}).`
    )
  }
}
