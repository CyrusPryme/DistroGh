import { roundMoney } from '@/lib/utils'

/**
 * Return value that counts against vendor balance at a product + supermarket pair.
 * Capped by vendor_due from supermarket-settled sales at that pair (see vendor-balance-sql.ts).
 */
export function effectiveReturnDeduction(returnValue: number, settledVendorDueAtPair: number): number {
  const returns = Math.max(0, roundMoney(Number(returnValue)))
  const settled = Math.max(0, roundMoney(Number(settledVendorDueAtPair)))
  return roundMoney(Math.min(returns, settled))
}
