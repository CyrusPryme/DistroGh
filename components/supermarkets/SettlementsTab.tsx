'use client'

import { Banknote, CheckCircle2, Clock, AlertTriangle, Loader2, AlertCircle, ShoppingCart } from 'lucide-react'
import { formatGHS, cn } from '@/lib/utils'
import { formatDisplayName } from '@/lib/format-display-name'
import { KPICard } from '@/components/dashboard/KPICard'
import { DataTableShell } from '@/components/shared/DataTableShell'
import { PaginationBar, getPageSlice } from '@/components/shared/PaginationBar'
import { IconAction } from '@/components/shared/IconAction'
import type { SupermarketSettlementsResponse } from '@/services/supermarket.service'

interface SettlementsTabProps {
  data: SupermarketSettlementsResponse | null
  loading: boolean
  error: string | null
  page: number
  pageSize: number
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
}

export function SettlementsTab({
  data,
  loading,
  error,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: SettlementsTabProps) {
  if (loading) {
    return (
      <div className="data-card flex items-center justify-center py-16">
        <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="flex items-center gap-3 p-4 bg-red-50 rounded-xl border border-red-200">
        <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
        <p className="text-red-700 text-sm">{error ?? 'Failed to load settlements'}</p>
      </div>
    )
  }

  const { overall, byChain } = data
  const rowsWithActivity = byChain.filter((r) => r.total_billed > 0)
  const paginated = getPageSlice(rowsWithActivity, page, pageSize)
  const allSettled = overall.total_outstanding <= 0

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600 max-w-2xl">
        Money supermarkets owe DistroGH — the receivables side of the ledger (mirrors Payouts, which
        tracks what DistroGH owes vendors). Grouped by retailer chain, not individual branch — a chain
        settles with DistroGH as one relationship (e.g. all Palace branches are paid together via Palace
        Spintex), so branches within a chain don&apos;t owe separately. A sale line counts as outstanding
        until it&apos;s marked settled on the{' '}
        <a href="/dashboard/sales" className="text-brand-600 hover:underline font-medium">Sales page</a>.
      </p>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPICard
          compact
          title="Outstanding"
          value={overall.total_outstanding}
          isCurrency
          icon={AlertTriangle}
          iconBg={allSettled ? 'bg-emerald-50' : 'bg-amber-50'}
          iconColor={allSettled ? 'text-emerald-600' : 'text-amber-600'}
        />
        <KPICard
          compact
          title="Settled (all-time)"
          value={overall.total_settled}
          isCurrency
          icon={CheckCircle2}
          iconBg="bg-emerald-50"
          iconColor="text-emerald-600"
        />
        <KPICard
          compact
          title="Unsettled lines"
          value={overall.unsettled_count}
          icon={ShoppingCart}
          iconBg="bg-slate-100"
          iconColor="text-slate-600"
        />
        <KPICard
          compact
          title="Oldest unsettled"
          value={overall.oldest_unsettled_days}
          subtitle="days"
          icon={Clock}
          iconBg={overall.oldest_unsettled_days > 60 ? 'bg-rose-50' : 'bg-slate-100'}
          iconColor={overall.oldest_unsettled_days > 60 ? 'text-rose-600' : 'text-slate-600'}
        />
      </div>

      {overall.total_outstanding > 0 && (
        <div className="data-card py-4">
          <div className="flex items-center gap-2 mb-3">
            <Banknote className="w-4 h-4 text-slate-500" />
            <h3 className="font-display font-semibold text-slate-900 text-sm">Outstanding by age</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <AgingBucket label="0–30 days" amount={overall.aging_0_30} tone="slate" />
            <AgingBucket label="31–60 days" amount={overall.aging_31_60} tone="amber" />
            <AgingBucket label="60+ days" amount={overall.aging_60_plus} tone="rose" />
          </div>
        </div>
      )}

      {rowsWithActivity.length === 0 ? (
        <div className="data-card text-center py-12">
          <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto mb-3" />
          <p className="text-slate-600 font-medium">No sales recorded yet</p>
        </div>
      ) : (
        <DataTableShell
          pagination={
            <PaginationBar
              page={page}
              pageSize={pageSize}
              totalItems={rowsWithActivity.length}
              onPageChange={onPageChange}
              onPageSizeChange={onPageSizeChange}
            />
          }
        >
          <table className="data-table min-w-[900px]">
            <thead>
              <tr>
                <th className="min-w-[200px]">Retailer chain</th>
                <th>Branches</th>
                <th className="text-right">Billed</th>
                <th className="text-right">Settled</th>
                <th className="text-right">Outstanding</th>
                <th>Oldest unsettled</th>
                <th className="text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {paginated.map((r) => {
                const isSettled = r.total_outstanding <= 0
                // Sales page only supports filtering by one branch at a time — link straight to
                // that branch when the chain has just one, otherwise view all sales for the chain.
                const singleBranchId = r.branches.length === 1 ? r.branches[0].id : null
                const salesHref = singleBranchId
                  ? `/dashboard/sales?supermarket_id=${singleBranchId}`
                  : '/dashboard/sales'
                return (
                  <tr key={r.name}>
                    <td className="min-w-[200px] max-w-[260px]">
                      <span className="font-semibold text-slate-800 truncate block" title={r.name}>
                        {formatDisplayName(r.name)}
                      </span>
                    </td>
                    <td className="text-slate-600 text-xs max-w-[220px]">
                      {r.branch_count > 1 ? (
                        <span title={r.branches.map((b) => b.branch?.trim() || '—').join(', ')}>
                          {r.branch_count} branches (settled centrally)
                        </span>
                      ) : (
                        r.branches[0]?.branch?.trim() || '—'
                      )}
                    </td>
                    <td className="text-right tabular-nums text-slate-600">{formatGHS(r.total_billed)}</td>
                    <td className="text-right tabular-nums text-brand-600">{formatGHS(r.total_settled)}</td>
                    <td className="text-right tabular-nums">
                      {isSettled ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                          <CheckCircle2 className="w-3 h-3" />
                          Settled
                        </span>
                      ) : (
                        <span className="font-bold text-amber-600 font-mono">{formatGHS(r.total_outstanding)}</span>
                      )}
                    </td>
                    <td className="text-xs text-slate-500 whitespace-nowrap">
                      {r.oldest_unsettled_date ? (
                        <span className={cn(r.oldest_unsettled_days > 60 && 'text-rose-600 font-semibold')}>
                          {r.oldest_unsettled_days}d ago
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="text-right">
                      <IconAction label={`View sales — ${r.name}`} href={salesHref}>
                        <ShoppingCart className="h-4 w-4" />
                      </IconAction>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4}>Total outstanding</td>
                <td className="text-right font-mono text-amber-600">{formatGHS(overall.total_outstanding)}</td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          </table>
        </DataTableShell>
      )}
    </div>
  )
}

function AgingBucket({
  label,
  amount,
  tone,
}: {
  label: string
  amount: number
  tone: 'slate' | 'amber' | 'rose'
}) {
  const styles = {
    slate: 'bg-slate-50 text-slate-700 border-slate-200',
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
    rose: 'bg-rose-50 text-rose-700 border-rose-200',
  }[tone]
  return (
    <div className={cn('rounded-xl border px-4 py-3', styles)}>
      <p className="text-xs font-medium opacity-80">{label}</p>
      <p className="text-lg font-display font-bold mt-0.5">{formatGHS(amount)}</p>
    </div>
  )
}
