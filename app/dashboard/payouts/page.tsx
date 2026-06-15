'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import {
  CreditCard, CheckCircle2, Clock, Loader2,
  AlertCircle, Phone, Send, RefreshCw, Bell
} from 'lucide-react'
import { payoutService } from '@/services/payout.service'
import { vendorService } from '@/services/vendor.service'
import { formatGHS, formatDate, formatWeekRange, getWeekRange, cn } from '@/lib/utils'
import { MOMO_NETWORK_COLORS, PAYOUT_STATUS_STYLES } from '@/lib/utils'
import { PaginationBar, getPageSlice, DEFAULT_PAGE_SIZE } from '@/components/shared/PaginationBar'
import {
  getPayoutDisplayStatus,
  payoutAmountDue,
  payoutAmountPaid,
  payoutBalanceRemaining,
} from '@/lib/payout-amounts'
import type { Payout, VendorBalance } from '@/types'

interface PayoutDialogData {
  mode: 'new' | 'existing'
  vendorId: string
  vendorName: string
  amountDue: number
  amountPaid: number
  payoutId?: string
}

function dispatchPayoutUpdated() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('payout-updated'))
  }
}

export default function PayoutsPage() {
  const [payouts, setPayouts] = useState<Payout[]>([])
  const [balances, setBalances] = useState<VendorBalance[]>([])
  const [summary, setSummary] = useState({
    pending_payout_count: 0,
    pending_payout_balance: 0,
    vendor_balance_count: 0,
    vendor_balance_total: 0,
    alert_count: 0,
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<PayoutDialogData | null>(null)
  const [paymentAmount, setPaymentAmount] = useState('')
  const [txnId, setTxnId] = useState('')
  const [processingId, setProcessingId] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)
  const [activeTab, setActiveTab] = useState<'balances' | 'pending' | 'history'>('balances')
  const [weekStart, setWeekStart] = useState(getWeekRange().week_start)
  const [weekEnd, setWeekEnd] = useState(getWeekRange().week_end)
  const [bulkProcessing, setBulkProcessing] = useState(false)
  const [balancePage, setBalancePage] = useState(1)
  const [pendingPage, setPendingPage] = useState(1)
  const [historyPage, setHistoryPage] = useState(1)

  const load = useCallback(async () => {
    try {
      const [po, bs, sm] = await Promise.all([
        payoutService.getAll(),
        vendorService.getBalances(),
        payoutService.getPendingSummary(),
      ])
      setPayouts(po)
      setBalances(bs.filter((b) => b.balance > 0))
      setSummary(sm)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load payouts')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 4000)
  }

  const openPaymentDialog = (payout: Payout) => {
    const vendor = payout.vendor as { name?: string } | undefined
    const due = payoutAmountDue(payout)
    const paid = payoutAmountPaid(payout)
    setDialog({
      mode: 'existing',
      vendorId: payout.vendor_id,
      payoutId: payout.id,
      vendorName: vendor?.name ?? '',
      amountDue: due,
      amountPaid: paid,
    })
    setPaymentAmount(String(payoutBalanceRemaining(payout)))
    setTxnId('')
  }

  const openNewPayoutDialog = (balance: VendorBalance) => {
    setDialog({
      mode: 'new',
      vendorId: balance.vendor_id,
      vendorName: balance.vendor_name,
      amountDue: balance.balance,
      amountPaid: 0,
    })
    setPaymentAmount(String(balance.balance))
    setTxnId('')
  }

  const closePaymentDialog = () => {
    setDialog(null)
    setPaymentAmount('')
    setTxnId('')
  }

  const handleStartPayout = (balance: VendorBalance) => {
    const existing = pendingByVendorId.get(balance.vendor_id)
    if (existing) {
      openPaymentDialog(existing)
      return
    }
    openNewPayoutDialog(balance)
  }

  const handleBulkCreate = async () => {
    if (!confirm(`Create pending payouts for all ${balances.length} vendors with outstanding balances?`)) return
    setBulkProcessing(true)
    try {
      const result = await payoutService.bulkCreateForVendors(
        balances.map((b) => ({ vendor_id: b.vendor_id, balance: b.balance })),
        weekStart,
        weekEnd
      )
      const skippedNote =
        result.skipped > 0 ? ` (${result.skipped} skipped — already had open pending payout)` : ''
      showToast(
        `${result.created} pending payout(s) created${skippedNote} — pay on MoMo, then confirm each payment`
      )
      await load()
      setActiveTab('pending')
      dispatchPayoutUpdated()
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to create payouts', 'error')
    } finally {
      setBulkProcessing(false)
    }
  }

  const handleConfirmPayment = async () => {
    if (!dialog) return
    const amount = Number(paymentAmount)
    if (!Number.isFinite(amount) || amount <= 0) {
      showToast('Enter a valid payment amount', 'error')
      return
    }
    const remaining = payoutBalanceRemaining({
      amount_due: dialog.amountDue,
      amount_paid: dialog.amountPaid,
    })
    if (amount > remaining + 0.001) {
      showToast(`Payment cannot exceed remaining balance (${formatGHS(remaining)})`, 'error')
      return
    }

    setProcessingId(dialog.mode === 'existing' ? dialog.payoutId! : 'new')
    try {
      let payoutId = dialog.payoutId

      if (dialog.mode === 'new') {
        const created = await payoutService.create({
          vendor_id: dialog.vendorId,
          amount_due: dialog.amountDue,
          week_start: weekStart,
          week_end: weekEnd,
        })
        payoutId = created.id
      }

      const updated = await payoutService.recordPayment(payoutId!, {
        payment_amount: amount,
        momo_txn_id: txnId.trim() || undefined,
      })
      const stillOwed = payoutBalanceRemaining(updated)
      showToast(
        stillOwed > 0
          ? `Payment recorded — ${formatGHS(stillOwed)} still owed`
          : 'Payment confirmed — vendor fully paid'
      )
      closePaymentDialog()
      await load()
      dispatchPayoutUpdated()
      if (stillOwed > 0) setActiveTab('pending')
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to record payment', 'error')
    } finally {
      setProcessingId(null)
    }
  }

  const pendingPayouts = useMemo(() => {
    const groups = new Map<string, Payout[]>()
    for (const p of payouts) {
      if (p.status !== 'pending' || payoutBalanceRemaining(p) <= 0) continue
      const key = `${p.vendor_id}:${p.week_start}:${p.week_end}`
      const list = groups.get(key) ?? []
      list.push(p)
      groups.set(key, list)
    }
    return Array.from(groups.values()).map((list) =>
      [...list].sort(
        (a, b) =>
          payoutAmountPaid(b) - payoutAmountPaid(a) ||
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )[0]
    )
  }, [payouts])

  /** Duplicate open rows still in DB (extras beyond the kept row per vendor/week). */
  const duplicatePendingIds = useMemo(() => {
    const groups = new Map<string, Payout[]>()
    for (const p of payouts) {
      if (p.status !== 'pending' || payoutBalanceRemaining(p) <= 0) continue
      const key = `${p.vendor_id}:${p.week_start}:${p.week_end}`
      const list = groups.get(key) ?? []
      list.push(p)
      groups.set(key, list)
    }
    const dupes = new Set<string>()
    for (const list of groups.values()) {
      if (list.length <= 1) continue
      const sorted = [...list].sort(
        (a, b) =>
          payoutAmountPaid(b) - payoutAmountPaid(a) ||
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )
      for (const p of sorted.slice(1)) dupes.add(p.id)
    }
    return dupes
  }, [payouts])

  const allOpenPending = useMemo(
    () =>
      payouts.filter(
        (p) => p.status === 'pending' && payoutBalanceRemaining(p) > 0
      ),
    [payouts]
  )

  const pendingByVendorId = useMemo(() => {
    const map = new Map<string, Payout>()
    for (const p of allOpenPending) {
      if (!map.has(p.vendor_id)) map.set(p.vendor_id, p)
    }
    return map
  }, [allOpenPending])

  const totalPending = balances.reduce((s, b) => s + b.balance, 0)
  const dialogRemaining = dialog
    ? Math.max(0, dialog.amountDue - dialog.amountPaid - (Number(paymentAmount) || 0))
    : 0

  const paginatedBalances = useMemo(
    () => getPageSlice(balances, balancePage, DEFAULT_PAGE_SIZE),
    [balances, balancePage]
  )
  const handleRemoveAllDuplicates = async () => {
    if (duplicatePendingIds.size === 0) return
    if (
      !confirm(
        `Remove ${duplicatePendingIds.size} duplicate pending payout(s)? The newest record for each vendor/week is kept.`
      )
    ) {
      return
    }
    setBulkProcessing(true)
    try {
      for (const id of duplicatePendingIds) {
        await payoutService.softDelete(id)
      }
      showToast(`Removed ${duplicatePendingIds.size} duplicate payout(s)`)
      await load()
      dispatchPayoutUpdated()
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to remove duplicates', 'error')
    } finally {
      setBulkProcessing(false)
    }
  }

  const paginatedPending = useMemo(
    () => getPageSlice(pendingPayouts, pendingPage, DEFAULT_PAGE_SIZE),
    [pendingPayouts, pendingPage]
  )
  const paginatedPayouts = useMemo(
    () => getPageSlice(payouts, historyPage, DEFAULT_PAGE_SIZE),
    [payouts, historyPage]
  )

  return (
    <div className="page-container space-y-6">
      {toast && (
        <div
          className={cn(
            'fixed top-4 right-4 z-50 px-4 py-3 rounded-xl shadow-modal text-sm font-medium animate-slide-up',
            toast.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'
          )}
        >
          {toast.msg}
        </div>
      )}

      {dialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
          <div className="relative bg-white rounded-2xl shadow-modal w-full max-w-md max-h-[min(90vh,720px)] flex flex-col overflow-hidden animate-slide-up my-auto p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center">
                <Send className="w-5 h-5 text-emerald-600" />
              </div>
              <div>
                <h3 className="font-display font-semibold text-slate-900">
                  {dialog.mode === 'new' ? 'Pay vendor on MoMo' : 'Record MoMo Payment'}
                </h3>
                <p className="text-xs text-slate-400">
                  {dialog.mode === 'new'
                    ? 'Send payment on your phone, then confirm below — nothing is saved until you confirm'
                    : 'Pay on your phone first, then enter details here'}
                </p>
              </div>
            </div>

            <div className="bg-slate-50 rounded-xl p-4 mb-5 border border-slate-100 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Vendor</span>
                <span className="font-semibold text-slate-800">{dialog.vendorName}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Amount due</span>
                <span className="font-semibold text-slate-800">{formatGHS(dialog.amountDue)}</span>
              </div>
              {dialog.amountPaid > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Already paid</span>
                  <span className="font-semibold text-emerald-600">{formatGHS(dialog.amountPaid)}</span>
                </div>
              )}
              <div className="flex justify-between text-sm border-t border-slate-200 pt-2">
                <span className="text-slate-500">Balance before this payment</span>
                <span className="font-bold text-amber-600">
                  {formatGHS(
                    payoutBalanceRemaining({
                      amount_due: dialog.amountDue,
                      amount_paid: dialog.amountPaid,
                    })
                  )}
                </span>
              </div>
            </div>

            <div className="mb-4">
              <label className="text-sm font-medium text-slate-700 mb-1.5 block">
                Amount paid (this transfer) <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={paymentAmount}
                onChange={(e) => setPaymentAmount(e.target.value)}
                className="form-input font-mono"
                placeholder="0.00"
                autoFocus
              />
              {Number(paymentAmount) > 0 && (
                <p className="mt-1.5 text-xs text-slate-500">
                  After this payment:{' '}
                  <span className={dialogRemaining <= 0 ? 'text-emerald-600 font-semibold' : 'text-amber-600 font-semibold'}>
                    {dialogRemaining <= 0 ? 'Fully paid' : `${formatGHS(dialogRemaining)} remaining`}
                  </span>
                </p>
              )}
            </div>

            <div className="mb-5">
              <label className="text-sm font-medium text-slate-700 mb-1.5 block">
                MoMo transaction ID <span className="text-slate-400 font-normal">(optional)</span>
              </label>
              <input
                value={txnId}
                onChange={(e) => setTxnId(e.target.value)}
                className="form-input font-mono"
                placeholder="e.g. MTN-XXXXXXXXXX"
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={closePaymentDialog}
                className="flex-1 px-4 py-2.5 rounded-lg border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmPayment}
                disabled={!paymentAmount || Number(paymentAmount) <= 0 || !!processingId}
                className="flex-1 px-4 py-2.5 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {processingId ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="w-4 h-4" />
                )}
                Confirm Payment
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">Payouts</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            Manual MoMo payouts — pay on phone, record amount, confirm in system
          </p>
        </div>
        <button
          onClick={load}
          className="p-2 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors"
          title="Refresh"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {(summary.pending_payout_count > 0 || summary.vendor_balance_count > 0) && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3">
          <Bell className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-semibold text-amber-900">Payments need attention</p>
            <ul className="mt-1.5 space-y-1 text-amber-800">
              {summary.vendor_balance_count > 0 && (
                <li>
                  {summary.vendor_balance_count} vendor(s) owe{' '}
                  <span className="font-semibold">{formatGHS(summary.vendor_balance_total)}</span>{' '}
                  — create payouts from Vendor Balances
                </li>
              )}
              {summary.pending_payout_count > 0 && (
                <li>
                  {summary.pending_payout_count} payout(s) awaiting MoMo confirmation (
                  <span className="font-semibold">{formatGHS(summary.pending_payout_balance)}</span>{' '}
                  remaining)
                </li>
              )}
            </ul>
          </div>
        </div>
      )}

      <div className="data-card py-4">
        <p className="text-sm font-medium text-slate-600 mb-3">Payout week range</p>
        <div className="grid sm:grid-cols-3 gap-3 items-end">
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Week Start</label>
            <input type="date" value={weekStart} onChange={(e) => setWeekStart(e.target.value)} className="form-input text-sm" />
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Week End</label>
            <input type="date" value={weekEnd} onChange={(e) => setWeekEnd(e.target.value)} className="form-input text-sm" />
          </div>
          {balances.length > 0 && (
            <button
              onClick={handleBulkCreate}
              disabled={bulkProcessing}
              className="px-4 py-2.5 bg-slate-800 hover:bg-slate-900 text-white text-sm font-semibold rounded-lg flex items-center gap-2 justify-center disabled:opacity-60"
            >
              {bulkProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Create pending payouts ({balances.length})
            </button>
          )}
        </div>
      </div>

      <div className="flex gap-1 bg-slate-100 p-1 rounded-xl w-fit flex-wrap">
        {[
          { key: 'balances', label: 'Vendor Balances', count: balances.length },
          { key: 'pending', label: 'Pending Payments', count: pendingPayouts.length },
          { key: 'history', label: 'Payout History', count: payouts.length },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => {
              setActiveTab(tab.key as 'balances' | 'pending' | 'history')
              if (tab.key === 'balances') setBalancePage(1)
              else if (tab.key === 'pending') setPendingPage(1)
              else setHistoryPage(1)
            }}
            className={cn(
              'px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2',
              activeTab === tab.key
                ? 'bg-white shadow-sm text-slate-900'
                : 'text-slate-500 hover:text-slate-700'
            )}
          >
            {tab.label}
            <span
              className={cn(
                'text-xs rounded-full px-1.5 py-0.5 font-semibold',
                activeTab === tab.key ? 'bg-brand-100 text-brand-700' : 'bg-slate-200 text-slate-500',
                tab.key === 'pending' && tab.count > 0 && activeTab !== tab.key && 'bg-amber-200 text-amber-800'
              )}
            >
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      {activeTab === 'balances' && (
        <div className="data-card p-0 overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-slate-400">Loading...</div>
          ) : error ? (
            <div className="flex items-center gap-3 p-6 text-red-600">
              <AlertCircle className="w-5 h-5" />
              <span>{error}</span>
            </div>
          ) : balances.length === 0 ? (
            <div className="p-12 text-center">
              <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-3" />
              <p className="font-semibold text-slate-600">All vendors settled!</p>
              <p className="text-slate-400 text-sm mt-1">No outstanding balances.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Vendor</th>
                    <th>Network</th>
                    <th>MoMo Number</th>
                    <th className="text-right">Total Earned</th>
                    <th className="text-right">Total Paid</th>
                    <th className="text-right">Balance Owed</th>
                    <th className="text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedBalances.map((b) => {
                    const netColors = MOMO_NETWORK_COLORS[b.momo_network]
                    const hasPendingPayout = pendingByVendorId.has(b.vendor_id)
                    return (
                      <tr key={b.vendor_id}>
                        <td>
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center text-brand-700 text-xs font-bold">
                              {b.vendor_name.slice(0, 2).toUpperCase()}
                            </div>
                            <span className="font-medium text-slate-800">{b.vendor_name}</span>
                          </div>
                        </td>
                        <td>
                          <span className={cn('status-badge', netColors?.bg, netColors?.text, netColors?.border)}>
                            {b.momo_network}
                          </span>
                        </td>
                        <td>
                          <div className="flex items-center gap-1.5 font-mono text-sm text-slate-600">
                            <Phone className="w-3.5 h-3.5 text-slate-400" />
                            {b.momo_number}
                          </div>
                        </td>
                        <td className="text-right font-mono text-slate-600">{formatGHS(b.total_due)}</td>
                        <td className="text-right font-mono text-emerald-600">{formatGHS(b.total_paid)}</td>
                        <td className="text-right">
                          <span className="font-bold text-amber-600 font-mono">{formatGHS(b.balance)}</span>
                        </td>
                        <td className="text-right">
                          <button
                            onClick={() => handleStartPayout(b)}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold rounded-lg transition-colors ml-auto"
                          >
                            <Send className="w-3 h-3" />
                            {hasPendingPayout ? 'Record payment' : 'Pay vendor'}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={5}>Total Outstanding</td>
                    <td className="text-right font-mono text-amber-600">{formatGHS(totalPending)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
              <PaginationBar
                page={balancePage}
                pageSize={DEFAULT_PAGE_SIZE}
                totalItems={balances.length}
                onPageChange={setBalancePage}
              />
            </div>
          )}
        </div>
      )}

      {activeTab === 'pending' && (
        <div className="data-card p-0 overflow-hidden">
          {duplicatePendingIds.size > 0 && (
            <div className="px-5 py-4 border-b border-amber-200 bg-amber-50 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-amber-900">
                <span className="font-semibold">{duplicatePendingIds.size} duplicate</span> pending payout
                {duplicatePendingIds.size === 1 ? '' : 's'} from earlier clicks — only one is needed per vendor/week.
              </p>
              <button
                type="button"
                onClick={handleRemoveAllDuplicates}
                disabled={bulkProcessing}
                className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold disabled:opacity-60"
              >
                {bulkProcessing ? 'Removing…' : 'Remove duplicates'}
              </button>
            </div>
          )}
          {pendingPayouts.length === 0 ? (
            <div className="p-12 text-center">
              <Clock className="w-10 h-10 text-slate-300 mx-auto mb-3" />
              <p className="font-semibold text-slate-600">No pending payments</p>
              <p className="text-slate-400 text-sm mt-1">
                Create payouts from Vendor Balances, pay vendors on MoMo, then record payment here.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Vendor</th>
                    <th>Week</th>
                    <th className="text-right">Due</th>
                    <th className="text-right">Paid</th>
                    <th className="text-right">Balance</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedPending.map((p) => {
                    const vendor = p.vendor as { name?: string; deleted_at?: string | null } | undefined
                    const displayStatus = getPayoutDisplayStatus(p)
                    const ss = PAYOUT_STATUS_STYLES[displayStatus]
                    return (
                      <tr key={p.id}>
                        <td className="font-medium text-slate-800">{vendor?.name ?? '—'}</td>
                        <td className="text-xs text-slate-400">{formatWeekRange(p.week_start, p.week_end)}</td>
                        <td className="text-right font-mono">{formatGHS(payoutAmountDue(p))}</td>
                        <td className="text-right font-mono text-emerald-600">
                          {payoutAmountPaid(p) > 0 ? formatGHS(payoutAmountPaid(p)) : '—'}
                        </td>
                        <td className="text-right font-mono font-semibold text-amber-600">
                          {formatGHS(payoutBalanceRemaining(p))}
                        </td>
                        <td>
                          <span className={cn('status-badge', ss?.bg, ss?.text, ss?.border)}>{ss?.label}</span>
                        </td>
                        <td>
                          <button
                            type="button"
                            onClick={() => openPaymentDialog(p)}
                            className="text-xs font-semibold text-brand-600 hover:text-brand-700"
                          >
                            Record payment
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <PaginationBar
                page={pendingPage}
                pageSize={DEFAULT_PAGE_SIZE}
                totalItems={pendingPayouts.length}
                onPageChange={setPendingPage}
              />
            </div>
          )}
        </div>
      )}

      {activeTab === 'history' && (
        <div className="data-card p-0 overflow-hidden">
          {payouts.length === 0 ? (
            <div className="p-12 text-center text-slate-400">No payout history yet</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Vendor</th>
                    <th>Week</th>
                    <th className="text-right">Due</th>
                    <th className="text-right">Paid</th>
                    <th className="text-right">Balance</th>
                    <th>Txn ID</th>
                    <th>Date</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedPayouts.map((p) => {
                    const displayStatus = getPayoutDisplayStatus(p)
                    const ss = PAYOUT_STATUS_STYLES[displayStatus]
                    const vendor = p.vendor as { name?: string; deleted_at?: string | null } | undefined
                    const remaining = payoutBalanceRemaining(p)
                    return (
                      <tr key={p.id}>
                        <td>
                          <span className={cn('font-medium text-slate-800', vendor?.deleted_at && 'text-slate-500')}>
                            {vendor?.name ?? '—'}
                          </span>
                        </td>
                        <td className="text-xs text-slate-400">{formatWeekRange(p.week_start, p.week_end)}</td>
                        <td className="text-right font-mono font-semibold">{formatGHS(payoutAmountDue(p))}</td>
                        <td className="text-right font-mono text-emerald-600">
                          {payoutAmountPaid(p) > 0 ? formatGHS(payoutAmountPaid(p)) : '—'}
                        </td>
                        <td className="text-right font-mono text-amber-600">
                          {remaining > 0 ? formatGHS(remaining) : '—'}
                        </td>
                        <td className="font-mono text-xs text-slate-500 max-w-[140px] truncate" title={p.momo_txn_id ?? ''}>
                          {p.momo_txn_id ?? '—'}
                        </td>
                        <td className="text-xs text-slate-400">
                          {p.payout_date ? formatDate(p.payout_date) : '—'}
                        </td>
                        <td>
                          <span className={cn('status-badge', ss?.bg, ss?.text, ss?.border)}>{ss?.label}</span>
                        </td>
                        <td>
                          {remaining > 0 && p.status !== 'failed' && (
                            <button
                              onClick={() => openPaymentDialog(p)}
                              className="text-xs text-brand-600 hover:underline font-medium"
                            >
                              Record payment
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <PaginationBar
                page={historyPage}
                pageSize={DEFAULT_PAGE_SIZE}
                totalItems={payouts.length}
                onPageChange={setHistoryPage}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
