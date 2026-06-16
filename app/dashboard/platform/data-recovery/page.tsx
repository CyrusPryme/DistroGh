'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { PageToast } from '@/components/shared/PageToast'

type DeletedRecord = { id: string; label: string; deleted_at: string }
type TableMeta = { key: string; label: string }
type Toast = { type: 'success' | 'error'; message: string } | null

export default function DataRecoveryPage() {
  const [tables, setTables] = useState<TableMeta[]>([])
  const [activeTable, setActiveTable] = useState('vendors')
  const [records, setRecords] = useState<DeletedRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [restoring, setRestoring] = useState<string | null>(null)
  const [toast, setToast] = useState<Toast>(null)

  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ type, message }); setTimeout(() => setToast(null), 4000)
  }

  const load = async (table = activeTable) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/developer/data-recovery?table=${table}`)
      const data = await res.json()
      if (data.success) {
        setRecords(data.data)
        if (data.available_tables) setTables(data.available_tables)
      }
    } catch { /* ignore */ } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const handleRestore = async (id: string) => {
    setRestoring(id)
    try {
      const res = await fetch('/api/developer/data-recovery/restore', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ table: activeTable, id }),
      })
      const data = await res.json()
      if (!data.success) { showToast('error', data.error ?? 'Failed to restore'); return }
      showToast('success', 'Record restored successfully.')
      setRecords(prev => prev.filter(r => r.id !== id))
    } catch { showToast('error', 'Network error') } finally { setRestoring(null) }
  }

  const fmtDate = (d: string) => new Date(d).toLocaleString()

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <PageToast message={toast?.message ?? null} type={toast?.type} />

      <div>
        <h1 className="text-xl font-bold text-slate-900">Data Recovery</h1>
        <p className="text-sm text-slate-500 mt-0.5">Restore soft-deleted records from the recovery bin</p>
      </div>

      {/* Warning banner */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
        <strong>Caution:</strong> Restoring records makes them visible and active again. Ensure related data is consistent before restoring.
      </div>

      {/* Table selector */}
      <div className="flex gap-2 flex-wrap">
        {tables.map(t => (
          <button
            key={t.key}
            onClick={() => { setActiveTable(t.key); load(t.key) }}
            className={cn('px-4 py-2 rounded-lg text-sm font-medium border transition',
              activeTable === t.key
                ? 'bg-violet-600 text-white border-violet-600'
                : 'bg-white text-slate-600 border-slate-200 hover:border-violet-300'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Records */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
            <tr>
              {['ID / Name','Deleted At','Action'].map(h => <th key={h} className="px-4 py-3 text-left font-semibold">{h}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr><td colSpan={3} className="py-10 text-center text-slate-400">Loading…</td></tr>
            ) : records.length === 0 ? (
              <tr><td colSpan={3} className="py-10 text-center text-slate-400">No deleted records in this category.</td></tr>
            ) : records.map(rec => (
              <tr key={rec.id} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <p className="font-medium text-slate-800 text-xs truncate max-w-xs">{rec.label ?? rec.id}</p>
                  <p className="font-mono text-xs text-slate-400">{rec.id}</p>
                </td>
                <td className="px-4 py-3 text-xs text-slate-500">{fmtDate(rec.deleted_at)}</td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => handleRestore(rec.id)}
                    disabled={restoring === rec.id}
                    className="btn-secondary text-xs disabled:opacity-50"
                  >
                    {restoring === rec.id ? 'Restoring…' : 'Restore'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

