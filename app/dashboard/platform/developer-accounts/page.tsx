'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { PageToast } from '@/components/shared/PageToast'

type DevAccount = {
  user_id: string
  email: string
  first_name: string
  last_name: string
  phone?: string
  status: string
  notes?: string
  last_login_at?: string
  last_ip?: string
  created_at: string
}

type Toast = { type: 'success' | 'error'; message: string } | null
type ModalMode = 'create' | 'edit' | 'reset_password' | null

export default function DeveloperAccountsPage() {
  const [accounts, setAccounts] = useState<DevAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [toast, setToast] = useState<Toast>(null)
  const [modal, setModal] = useState<ModalMode>(null)
  const [selected, setSelected] = useState<DevAccount | null>(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ first_name: '', last_name: '', email: '', phone: '', password: '', notes: '' })
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ type, message })
    setTimeout(() => setToast(null), 4000)
  }

  // Stable load — accepts query string explicitly so it never recreates on search changes
  const load = useCallback(async (q: string) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/developer/accounts?search=${encodeURIComponent(q)}`)
      const data = await res.json()
      if (data.success) setAccounts(data.data)
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, []) // stable — no deps

  // Mount
  useEffect(() => { load('') }, [load])

  const handleSearch = (v: string) => {
    setSearch(v)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => load(v), 400)
  }

  const openCreate = () => {
    setSelected(null)
    setForm({ first_name: '', last_name: '', email: '', phone: '', password: '', notes: '' })
    setModal('create')
  }

  const openEdit = (acc: DevAccount) => {
    setSelected(acc)
    setForm({ first_name: acc.first_name, last_name: acc.last_name, email: acc.email, phone: acc.phone ?? '', password: '', notes: acc.notes ?? '' })
    setModal('edit')
  }

  const handleCreate = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/developer/accounts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!data.success) { showToast('error', data.error ?? 'Failed to create account'); return }
      showToast('success', 'Developer account created.')
      setModal(null)
      load(search)
    } catch { showToast('error', 'Network error') }
    finally { setSaving(false) }
  }

  const handleUpdate = async () => {
    if (!selected) return
    setSaving(true)
    try {
      const payload: Record<string, unknown> = { first_name: form.first_name, last_name: form.last_name, phone: form.phone, notes: form.notes }
      if (modal === 'reset_password' && form.password) payload.password = form.password
      const res = await fetch(`/api/developer/accounts/${selected.user_id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!data.success) { showToast('error', data.error ?? 'Failed to update'); return }
      showToast('success', modal === 'reset_password' ? 'Password reset.' : 'Account updated.')
      setModal(null)
      load(search)
    } catch { showToast('error', 'Network error') }
    finally { setSaving(false) }
  }

  const handleToggleStatus = async (acc: DevAccount) => {
    const newStatus = acc.status === 'active' ? 'suspended' : 'active'
    try {
      const res = await fetch(`/api/developer/accounts/${acc.user_id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      const data = await res.json()
      if (!data.success) { showToast('error', data.error ?? 'Failed'); return }
      showToast('success', `Account ${newStatus}.`)
      load(search)
    } catch { showToast('error', 'Network error') }
  }

  const fmtDate = (d?: string) => d ? new Date(d).toLocaleString() : '—'

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <PageToast message={toast?.message ?? null} type={toast?.type} />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Developer Accounts</h1>
          <p className="text-sm text-slate-500 mt-0.5">Manage platform developer identities</p>
        </div>
        <button onClick={openCreate} className="btn-primary">+ New Developer</button>
      </div>

      {/* Search */}
      <input
        value={search}
        onChange={e => handleSearch(e.target.value)}
        placeholder="Search by name or email…"
        className="input-base w-full max-w-md"
      />

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
            <tr>
              {['Name','Email','Status','Last Login','Last IP','Created','Actions'].map(h => (
                <th key={h} className="px-4 py-3 text-left font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr><td colSpan={7} className="py-10 text-center text-slate-400">Loading…</td></tr>
            ) : accounts.length === 0 ? (
              <tr><td colSpan={7} className="py-10 text-center text-slate-400">No developer accounts found.</td></tr>
            ) : accounts.map(acc => (
              <tr key={acc.user_id} className={cn('hover:bg-slate-50 transition', acc.status === 'suspended' && 'opacity-60')}>
                <td className="px-4 py-3 font-medium text-slate-800">
                  {[acc.first_name, acc.last_name].filter(Boolean).join(' ') || '—'}
                </td>
                <td className="px-4 py-3 text-slate-600">{acc.email}</td>
                <td className="px-4 py-3">
                  <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium',
                    acc.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                  )}>
                    {acc.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-500 text-xs">{fmtDate(acc.last_login_at)}</td>
                <td className="px-4 py-3 text-slate-500 font-mono text-xs">{acc.last_ip ?? '—'}</td>
                <td className="px-4 py-3 text-slate-500 text-xs">{fmtDate(acc.created_at)}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    <button onClick={() => openEdit(acc)} className="text-blue-600 hover:underline text-xs">Edit</button>
                    <button onClick={() => { setSelected(acc); setForm(f => ({ ...f, password: '' })); setModal('reset_password') }} className="text-amber-600 hover:underline text-xs">Reset Pwd</button>
                    <button onClick={() => handleToggleStatus(acc)} className={cn('text-xs hover:underline', acc.status === 'active' ? 'text-red-600' : 'text-emerald-600')}>
                      {acc.status === 'active' ? 'Suspend' : 'Activate'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modal */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6 space-y-4">
            <h2 className="text-lg font-bold text-slate-800">
              {modal === 'create' ? 'New Developer Account' : modal === 'reset_password' ? 'Reset Password' : 'Edit Account'}
            </h2>
            {modal !== 'reset_password' && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">First Name</label>
                    <input value={form.first_name} onChange={e => setForm(f => ({ ...f, first_name: e.target.value }))} className="input-base w-full" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Last Name</label>
                    <input value={form.last_name} onChange={e => setForm(f => ({ ...f, last_name: e.target.value }))} className="input-base w-full" />
                  </div>
                </div>
                {modal === 'create' && (
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Email *</label>
                    <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className="input-base w-full" />
                  </div>
                )}
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Phone</label>
                  <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} className="input-base w-full" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Notes</label>
                  <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className="input-base w-full" rows={2} />
                </div>
              </>
            )}
            {(modal === 'create' || modal === 'reset_password') && (
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Password *</label>
                <input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} className="input-base w-full" placeholder="Min 8 characters" />
              </div>
            )}
            <div className="flex justify-end gap-3 pt-2">
              <button onClick={() => setModal(null)} className="btn-secondary">Cancel</button>
              <button
                onClick={modal === 'create' ? handleCreate : handleUpdate}
                disabled={saving}
                className="btn-primary disabled:opacity-50"
              >
                {saving ? 'Saving…' : modal === 'reset_password' ? 'Reset Password' : modal === 'create' ? 'Create Account' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}


