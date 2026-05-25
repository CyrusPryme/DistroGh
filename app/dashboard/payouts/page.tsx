'use client'

import { useEffect, useState, useMemo } from 'react'
import {
  CreditCard, CheckCircle2, Clock, XCircle, Loader2,
  AlertCircle, ChevronDown, Phone, Send, RefreshCw
} from 'lucide-react'
import { payoutService } from '@/services/payout.service'
import { vendorService } from '@/services/vendor.service'
import { formatGHS, formatDate, formatWeekRange, getWeekRange, cn } from '@/lib/utils'
import { MOMO_NETWORK_COLORS, PAYOUT_STATUS_STYLES } from '@/lib/utils'
import { PaginationBar, getPageSlice, DEFAULT_PAGE_SIZE } from '@/components/shared/PaginationBar'
import type { Payout, VendorBalance } from '@/types'

interface PayoutDialogData {
  payoutId: string
  vendorName: string
  amountDue: number
}

export default function PayoutsPage() {
  const [payouts, setPayouts] = useState<Payout[]>([])
  const [balances, setBalances] = useState<VendorBalance[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<PayoutDialogData | null>(null)
  const [txnId, setTxnId] = useState('')
  const [processingId, setProcessingId] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)
  const [activeTab, setActiveTab] = useState<'balances' | 'history'>('balances')
  const [weekStart, setWeekStart] = useState(getWeekRange().week_start)
  const [weekEnd, setWeekEnd] = useState(getWeekRange().week_end)
  const [bulkProcessing, setBulkProcessing] = useState(false)
  const [balancePage, setBalancePage] = useState(1)
  const [historyPage, setHistoryPage] = useState(1)

  const load = async () => {
    try {
      const [po, bs] = await Promise.all([
        payoutService.getAll(),
        vendorService.getBalances(),
      ])
      setPayouts(po)
      setBalances(bs.filter(b => b.balance > 0))
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 4000)
  }

  const handleCreatePayout = async (vendorId: string, balance: number) => {
    try {
      const payout = await payoutService.create({
        vendor_id: vendorId,
        amount_due: balance,
        week_start: weekStart,
        week_end: weekEnd,
      })
      setDialog({
        payoutId: payout.id,
        vendorName: balances.find(b => b.vendor_id === vendorId)?.vendor_name ?? '',
        amountDue: balance,
      })
      showToast('Payout created — enter transaction ID to confirm')
    } catch (e: any) {
      showToast(e.message, 'error')
    }
  }

  const handleBulkCreate = async () => {
    if (!confirm(`Create payouts for all ${balances.length} vendors with outstanding balances?`)) return
    setBulkProcessing(true)
    try {
      await payoutService.bulkCreateForVendors(
        balances.map(b => ({ vendor_id: b.vendor_id, balance: b.balance })),
        weekStart,
        weekEnd
      )
      showToast(`${balances.length} payouts created`)
      load()
      setActiveTab('history')
    } catch (e: any) {
      showToast(e.message, 'error')
    } finally {
      setBulkProcessing(false)
    }
  }

  const handleConfirmPayout = async () => {
    if (!dialog || !txnId.trim()) return
    setProcessingId(dialog.payoutId)
    try {
      await payoutService.markCompleted(dialog.payoutId, {
        amount_paid: dialog.amountDue,
        momo_txn_id: txnId.trim(),
      })
      showToast('Payout marked as completed!')
      setDialog(null)
      setTxnId('')
      load()
    } catch (e: any) {
      showToast(e.message, 'error')
    } finally {
      setProcessingId(null)
    }
  }

  const handleUpdateStatus = async (id: string, status: 'processing' | 'failed') => {
    try {
      await payoutService.updateStatus(id, status)
      showToast(`Payout marked as ${status}`)
      load()
    } catch (e: any) {
      showToast(e.message, 'error')
    }
  }

  const totalPending = balances.reduce((s, b) => s + b.balance, 0)

  const paginatedBalances = useMemo(
    () => getPageSlice(balances, balancePage, DEFAULT_PAGE_SIZE),
    [balances, balancePage]
  )
  const paginatedPayouts = useMemo(
    () => getPageSlice(payouts, historyPage, DEFAULT_PAGE_SIZE),
    [payouts, historyPage]
  )

  return (
    <div className="page-container space-y-6">
      {/* Toast */}
      {toast && (
        <div className={cn(
          'fixed top-4 right-4 z-50 px-4 py-3 rounded-xl shadow-modal text-sm font-medium animate-slide-up',
          toast.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'
        )}>
          {toast.msg}
        </div>
      )}

      {/* Payout Confirmation Dialog */}
      {dialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
          <div className="relative bg-white rounded-2xl shadow-modal w-full max-w-md max-h-[min(90vh,720px)] flex flex-col overflow-hidden animate-slide-up my-auto p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center">
                <Send className="w-5 h-5 text-emerald-600" />
              </div>
              <div>
                <h3 className="font-display font-semibold text-slate-900">Confirm MoMo Payout</h3>
                <p className="text-xs text-slate-400">Enter the transaction ID from MoMo</p>
              </div>
            </div>

            <div className="bg-slate-50 rounded-xl p-4 mb-5 border border-slate-100">
              <div className="flex justify-between text-sm mb-2">
                <span className="text-slate-500">Vendor</span>
                <span className="font-semibold text-slate-800">{dialog.vendorName}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Amount</span>
                <span className="font-bold text-emerald-600 text-base">{formatGHS(dialog.amountDue)}</span>
              </div>
            </div>

            <div className="mb-5">
              <label className="text-sm font-medium text-slate-700 mb-1.5 block">
                MoMo Transaction ID <span className="text-red-500">*</span>
              </label>
              <input
                value={txnId}
                onChange={e => setTxnId(e.target.value)}
                className="form-input font-mono"
                placeholder="e.g., MTN-XXXXXXXXXX"
                autoFocus
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => { setDialog(null); setTxnId('') }}
                className="flex-1 px-4 py-2.5 rounded-lg border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmPayout}
                disabled={!txnId.trim() || !!processingId}
                className="flex-1 px-4 py-2.5 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {processingId ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                Confirm Payment
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">Payouts</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            {balances.length} vendors with outstanding balances · {formatGHS(totalPending)} total
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

      {/* Week settings */}
      <div className="data-card py-4">
        <p className="text-sm font-medium text-slate-600 mb-3">Payout week range</p>
        <div className="grid sm:grid-cols-3 gap-3 items-end">
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Week Start</label>
            <input type="date" value={weekStart} onChange={e => setWeekStart(e.target.value)} className="form-input text-sm" />
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Week End</label>
            <input type="date" value={weekEnd} onChange={e => setWeekEnd(e.target.value)} className="form-input text-sm" />
          </div>
          {balances.length > 0 && (
            <button
              onClick={handleBulkCreate}
              disabled={bulkProcessing}
              className="px-4 py-2.5 bg-slate-800 hover:bg-slate-900 text-white text-sm font-semibold rounded-lg flex items-center gap-2 justify-center disabled:opacity-60"
            >
              {bulkProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Bulk Payout All ({balances.length})
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 p-1 rounded-xl w-fit">
        {[
          { key: 'balances', label: 'Vendor Balances', count: balances.length },
          { key: 'history', label: 'Payout History', count: payouts.length },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => {
              setActiveTab(tab.key as 'balances' | 'history')
              if (tab.key === 'balances') setBalancePage(1)
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
            <span className={cn(
              'text-xs rounded-full px-1.5 py-0.5 font-semibold',
              activeTab === tab.key ? 'bg-brand-100 text-brand-700' : 'bg-slate-200 text-slate-500'
            )}>
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      {/* ── Balances Tab ──────────────────────────────────────────────── */}
      {activeTab === 'balances' && (
        <div className="data-card p-0 overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-slate-400">Loading...</div>
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
                  {paginatedBalances.map(b => {
                    const netColors = MOMO_NETWORK_COLORS[b.momo_network]
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
                            onClick={() => handleCreatePayout(b.vendor_id, b.balance)}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold rounded-lg transition-colors ml-auto"
                          >
                            <Send className="w-3 h-3" />
                            Pay Now
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

      {/* ── History Tab ───────────────────────────────────────────────── */}
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
                    <th className="text-right">Amount Due</th>
                    <th className="text-right">Amount Paid</th>
                    <th>Txn ID</th>
                    <th>Date</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedPayouts.map(p => {
                    const ss = PAYOUT_STATUS_STYLES[p.status as keyof typeof PAYOUT_STATUS_STYLES]
                    const vendor = p.vendor as any
                    return (
                      <tr key={p.id}>
                        <td>
                          <div className="flex flex-wrap items-center gap-2 min-w-0">
                            <span className={cn(
                              'font-medium text-slate-800',
                              vendor?.deleted_at && 'text-slate-500'
                            )}>
                              {vendor?.name ?? '—'}
                            </span>
                            {vendor?.deleted_at ? (
                              <span className="status-badge bg-slate-200 text-slate-700 border-slate-300 text-[10px] uppercase tracking-wide shrink-0">
                                Deleted
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td className="text-xs text-slate-400">
                          {formatWeekRange(p.week_start, p.week_end)}
                        </td>
                        <td className="text-right font-mono font-semibold">{formatGHS(Number(p.amount_due))}</td>
                        <td className="text-right font-mono text-emerald-600">
                          {p.amount_paid > 0 ? formatGHS(Number(p.amount_paid)) : '—'}
                        </td>
                        <td className="font-mono text-xs text-slate-500">{p.momo_txn_id ?? '—'}</td>
                        <td className="text-xs text-slate-400">
                          {p.payout_date ? formatDate(p.payout_date) : '—'}
                        </td>
                        <td>
                          <span className={cn('status-badge', ss?.bg, ss?.text, ss?.border)}>
                            {ss?.label}
                          </span>
                        </td>
                        <td>
                          {p.status === 'pending' && (
                            <button
                              onClick={() => setDialog({
                                payoutId: p.id,
                                vendorName: vendor?.name ?? '',
                                amountDue: Number(p.amount_due),
                              })}
                              className="text-xs text-brand-600 hover:underline font-medium"
                            >
                              Confirm
                            </button>
                          )}
                          {p.status === 'processing' && (
                            <button
                              onClick={() => handleUpdateStatus(p.id, 'failed')}
                              className="text-xs text-red-500 hover:underline font-medium"
                            >
                              Mark Failed
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
