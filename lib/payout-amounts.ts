import { roundMoney } from '@/lib/utils'
import type { Payout, PayoutStatus } from '@/types'

export function payoutAmountDue(payout: { amount_due?: number | string | null }): number {
  return roundMoney(Number(payout.amount_due ?? 0))
}

export function payoutAmountPaid(payout: { amount_paid?: number | string | null }): number {
  return roundMoney(Number(payout.amount_paid ?? 0))
}

export function payoutBalanceRemaining(payout: {
  amount_due?: number | string | null
  amount_paid?: number | string | null
}): number {
  return roundMoney(Math.max(0, payoutAmountDue(payout) - payoutAmountPaid(payout)))
}

export function payoutIsFullyPaid(payout: {
  amount_due?: number | string | null
  amount_paid?: number | string | null
}): boolean {
  return payoutBalanceRemaining(payout) <= 0 && payoutAmountDue(payout) > 0
}

export function resolvePayoutStatusAfterPayment(
  amountDue: number,
  amountPaid: number
): PayoutStatus {
  if (amountPaid >= amountDue && amountDue > 0) return 'completed'
  return 'pending'
}

export type PayoutDisplayStatus = PayoutStatus | 'partial'

export function getPayoutDisplayStatus(payout: {
  status?: PayoutStatus | string | null
  amount_due?: number | string | null
  amount_paid?: number | string | null
}): PayoutDisplayStatus {
  const status = (payout.status ?? 'pending') as PayoutStatus
  if (status === 'pending' && payoutAmountPaid(payout) > 0 && payoutBalanceRemaining(payout) > 0) {
    return 'partial'
  }
  return status
}

export function appendMomoTxnId(existing: string | null | undefined, next: string): string {
  const trimmed = next.trim()
  if (!trimmed) return existing?.trim() ?? ''
  if (!existing?.trim()) return trimmed
  const parts = existing.split(/[,;]\s*/).map((p) => p.trim()).filter(Boolean)
  if (parts.includes(trimmed)) return parts.join(', ')
  return [...parts, trimmed].join(', ')
}
