'use client'

import { useEffect, useState, useMemo } from 'react'
import Link from 'next/link'
import { Trash2, Loader2, AlertCircle, RefreshCw } from 'lucide-react'
import { getImportHistory, deleteSalesBatch, type ImportHistory } from '@/lib/actions/sales'
import { formatDate, cn } from '@/lib/utils'
import { PaginationBar, getPageSlice, DEFAULT_PAGE_SIZE } from '@/components/shared/PaginationBar'
import { PageToast } from '@/components/shared/PageToast'

type ImportHistoryContentProps = {
  importHref?: string
  emptyCtaLabel?: string
}

export function ImportHistoryContent({
  importHref = '/dashboard/sales/import',
  emptyCtaLabel = 'Import Sales',
}: ImportHistoryContentProps) {
  const [history, setHistory] = useState<ImportHistory[]>([])
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)
  const [histPage, setHistPage] = useState(1)

  const loadHistory = async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await getImportHistory()
      if (result.success && result.data) {
        setHistory(result.data)
      } else {
        setError(result.error || 'Failed to load import history')
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load import history')
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (batchId: string, rowCount: number) => {
    if (!confirm(`Are you sure? This will permanently remove all ${rowCount} sales from batch ${batchId}.`)) {
      return
    }

    setDeleting(batchId)
    try {
      const result = await deleteSalesBatch(batchId)
      if (result.success) {
        setHistory((prev) => prev.filter((item) => item.import_batch_id !== batchId))
        setToast({ msg: `Successfully deleted batch ${batchId}`, type: 'success' })
      } else {
        setToast({ msg: result.error || 'Failed to delete batch', type: 'error' })
      }
    } catch (e: unknown) {
      setToast({ msg: e instanceof Error ? e.message : 'Failed to delete batch', type: 'error' })
    } finally {
      setDeleting(null)
    }
  }

  useEffect(() => {
    loadHistory()
  }, [])

  useEffect(() => {
    setHistPage(1)
  }, [history.length])

  const paginatedHistory = useMemo(
    () => getPageSlice(history, histPage, DEFAULT_PAGE_SIZE),
    [history, histPage]
  )

  return (
    <div className="space-y-6">
      <PageToast
        message={toast?.msg ?? null}
        type={toast?.type}
        onDismiss={() => setToast(null)}
      />

      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={loadHistory}
          disabled={loading}
          className="btn-secondary"
        >
          <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="data-card bg-red-50 border-red-200">
          <div className="flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
            <div>
              <h3 className="font-medium text-red-900">Error</h3>
              <p className="text-red-700 text-sm mt-1">{error}</p>
            </div>
          </div>
        </div>
      )}

      {loading && (
        <div className="data-card text-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-brand-600 mx-auto mb-4" />
          <p className="text-slate-500">Loading import history…</p>
        </div>
      )}

      {!loading && !error && history.length === 0 && (
        <div className="data-card text-center py-16">
          <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-5">
            <AlertCircle className="w-8 h-8 text-slate-400" />
          </div>
          <h2 className="font-display text-xl font-semibold text-slate-900 mb-2">No import history</h2>
          <p className="text-slate-500 mb-6">You haven&apos;t imported any sales data yet.</p>
          <Link href={importHref} className="btn-primary">
            {emptyCtaLabel}
          </Link>
        </div>
      )}

      {!loading && !error && history.length > 0 && (
        <div className="data-card p-0 overflow-hidden">
          <div className="overflow-x-auto data-table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date / time</th>
                  <th>Batch ID</th>
                  <th>Total rows</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {paginatedHistory.map((item) => (
                  <tr key={item.import_batch_id}>
                    <td>
                      <div className="text-sm text-slate-900">{formatDate(item.imported_at)}</div>
                      <div className="text-xs text-slate-500">
                        {new Date(item.imported_at).toLocaleTimeString()}
                      </div>
                    </td>
                    <td>
                      <code className="px-2 py-1 bg-slate-100 text-slate-700 text-xs rounded font-mono">
                        {item.import_batch_id}
                      </code>
                    </td>
                    <td>
                      <span className="status-badge border bg-brand-50 text-brand-700 border-brand-200">
                        {item.row_count} rows
                      </span>
                    </td>
                    <td className="text-right">
                      <button
                        type="button"
                        onClick={() => handleDelete(item.import_batch_id, item.row_count)}
                        disabled={deleting === item.import_batch_id}
                        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-red-200 text-red-600 text-sm font-medium hover:bg-red-50 transition-colors disabled:opacity-50"
                      >
                        {deleting === item.import_batch_id ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Deleting…
                          </>
                        ) : (
                          <>
                            <Trash2 className="w-4 h-4" />
                            Delete
                          </>
                        )}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <PaginationBar
              page={histPage}
              pageSize={DEFAULT_PAGE_SIZE}
              totalItems={history.length}
              onPageChange={setHistPage}
            />
          </div>
        </div>
      )}
    </div>
  )
}
