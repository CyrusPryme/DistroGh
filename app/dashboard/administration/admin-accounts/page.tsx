'use client'

import React, { useState, useEffect, useCallback } from 'react'
import {
  Users, Plus, Search, Shield, ChevronDown, ChevronUp,
  Edit2, Trash2, Lock, RefreshCw, AlertCircle, CheckCircle,
  UserX, UserCheck, Eye, EyeOff, X
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { MODULES, ROLE_PRESETS, type PermissionAction } from '@/lib/auth/permissions'
import { PageToast } from '@/components/shared/PageToast'

// ─── Types ────────────────────────────────────────────────────────────────────

interface AdminUser {
  user_id: string
  email: string
  first_name: string
  last_name: string
  phone: string | null
  admin_role: 'super_admin' | 'admin' | 'user'
  status: 'active' | 'suspended'
  notes: string | null
  last_login_at: string | null
  created_at: string
  created_by_email: string | null
  permissions: string[]
}

interface Toast { type: 'success' | 'error'; message: string }

// ─── Permission Matrix ────────────────────────────────────────────────────────

const ACTIONS: PermissionAction[] = ['read', 'create', 'update', 'delete', 'export', 'approve', 'manage']
const ACTION_LABELS: Record<PermissionAction, string> = {
  read: 'Read', create: 'Create', update: 'Update', delete: 'Delete',
  export: 'Export', approve: 'Approve', manage: 'Manage',
}

function PermissionMatrix({
  permissions,
  onChange,
  disabled,
}: {
  permissions: string[]
  onChange: (p: string[]) => void
  disabled?: boolean
}) {
  const permSet = new Set(permissions)

  function toggle(module: string, action: string) {
    const key = `${module}:${action}`
    const next = new Set(permSet)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    onChange([...next])
  }

  function toggleModule(module: string, actions: PermissionAction[]) {
    const hasAll = actions.every((a) => permSet.has(`${module}:${a}`))
    const next = new Set(permSet)
    for (const a of actions) {
      if (hasAll) next.delete(`${module}:${a}`)
      else next.add(`${module}:${a}`)
    }
    onChange([...next])
  }

  function applyPreset(presetId: string) {
    const preset = ROLE_PRESETS.find((p) => p.id === presetId)
    if (preset) onChange([...preset.permissions])
  }

  const groups = [...new Set(MODULES.map((m) => m.group))]

  return (
    <div className="space-y-4">
      {/* Presets */}
      <div className="flex flex-wrap gap-2">
        <span className="text-xs font-medium text-slate-500 self-center">Presets:</span>
        {ROLE_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => applyPreset(p.id)}
            disabled={disabled}
            className="px-2 py-1 text-xs rounded border border-slate-200 hover:border-emerald-400 hover:text-emerald-700 transition disabled:opacity-50"
            title={p.description}
          >
            {p.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onChange([])}
          disabled={disabled}
          className="px-2 py-1 text-xs rounded border border-red-200 text-red-600 hover:bg-red-50 transition disabled:opacity-50"
        >
          Clear all
        </button>
      </div>

      {/* Matrix */}
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="text-left px-3 py-2 font-semibold text-slate-600 min-w-[160px]">Module</th>
              {ACTIONS.map((a) => (
                <th key={a} className="px-2 py-2 font-semibold text-slate-600 text-center min-w-[64px]">
                  {ACTION_LABELS[a]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => {
              const groupModules = MODULES.filter((m) => m.group === group)
              return (
                <React.Fragment key={group}>
                  <tr className="bg-slate-100/60">
                    <td colSpan={ACTIONS.length + 1} className="px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                      {group}
                    </td>
                  </tr>
                  {groupModules.map((mod) => {
                    const moduleAllChecked = mod.actions.every((a) => permSet.has(`${mod.key}:${a}`))
                    return (
                      <tr key={mod.key} className="border-b border-slate-100 hover:bg-slate-50/60 transition">
                        <td className="px-3 py-2 font-medium text-slate-700">
                          <button
                            type="button"
                            onClick={() => toggleModule(mod.key, mod.actions)}
                            disabled={disabled}
                            className={cn(
                              'text-left hover:text-emerald-700 transition disabled:cursor-default',
                              moduleAllChecked && 'text-emerald-700 font-semibold'
                            )}
                            title="Toggle all for this module"
                          >
                            {mod.label}
                          </button>
                        </td>
                        {ACTIONS.map((action) => {
                          const key = `${mod.key}:${action}`
                          const supported = (mod.actions as string[]).includes(action)
                          const checked = permSet.has(key)
                          return (
                            <td key={action} className="px-2 py-2 text-center">
                              {supported ? (
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => toggle(mod.key, action)}
                                  disabled={disabled}
                                  className="w-3.5 h-3.5 accent-emerald-600 cursor-pointer disabled:cursor-default"
                                />
                              ) : (
                                <span className="text-slate-200">—</span>
                              )}
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </React.Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-400">{permissions.length} permission(s) selected</p>
    </div>
  )
}

// ─── Create / Edit Modal ──────────────────────────────────────────────────────

function AdminUserModal({
  user,
  onClose,
  onSaved,
}: {
  user: AdminUser | null
  onClose: () => void
  onSaved: () => void
}) {
  const isEdit = !!user
  const [step, setStep] = useState<'details' | 'permissions'>('details')
  const [form, setForm] = useState({
    first_name: user?.first_name ?? '',
    last_name: user?.last_name ?? '',
    email: user?.email ?? '',
    phone: user?.phone ?? '',
    admin_role: user?.admin_role ?? 'admin',
    status: user?.status ?? 'active',
    notes: user?.notes ?? '',
    password: '',
    confirm_password: '',
  })
  const [permissions, setPermissions] = useState<string[]>(user?.permissions ?? [])
  const [showPass, setShowPass] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setError(null)
    if (!isEdit && form.password.length < 8) { setError('Password must be at least 8 characters.'); return }
    if (!isEdit && form.password !== form.confirm_password) { setError('Passwords do not match.'); return }
    if (!form.email.trim()) { setError('Email is required.'); return }

    setSaving(true)
    try {
      const payload: Record<string, unknown> = {
        first_name: form.first_name,
        last_name: form.last_name,
        email: form.email,
        phone: form.phone || null,
        admin_role: form.admin_role,
        status: form.status,
        notes: form.notes || null,
        permissions,
      }
      if (!isEdit) {
        payload.password = form.password
      } else if (form.password) {
        payload.password = form.password
      }

      const res = await fetch(
        isEdit ? `/api/admin/users/${user!.user_id}` : '/api/admin/users',
        {
          method: isEdit ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      )
      const json = await res.json()
      if (!res.ok || !json.success) {
        setError(json.error ?? 'Failed to save.')
        return
      }
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  const f = (field: string, val: string) => setForm((p) => ({ ...p, [field]: val }))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div>
            <h2 className="text-base font-semibold text-slate-800">
              {isEdit ? 'Edit Admin Account' : 'Create Admin Account'}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">{isEdit ? `Editing: ${user!.email}` : 'New administrator or user account'}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 transition">
            <X className="w-4 h-4 text-slate-500" />
          </button>
        </div>

        {/* Step tabs */}
        <div className="flex border-b border-slate-100 px-6">
          {(['details', 'permissions'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStep(s)}
              className={cn(
                'py-2.5 px-4 text-xs font-medium border-b-2 transition -mb-px capitalize',
                step === s
                  ? 'border-emerald-500 text-emerald-700'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              )}
            >
              {s === 'details' ? '1. Account Details' : '2. Permissions'}
            </button>
          ))}
        </div>

        {error && (
          <div className="mx-6 mt-4 flex items-start gap-2 text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs">
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
            {error}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {step === 'details' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">First Name</label>
                  <input value={form.first_name} onChange={(e) => f('first_name', e.target.value)} className="input-base" placeholder="John" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Last Name</label>
                  <input value={form.last_name} onChange={(e) => f('last_name', e.target.value)} className="input-base" placeholder="Mensah" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Email <span className="text-red-500">*</span></label>
                <input type="email" value={form.email} onChange={(e) => f('email', e.target.value)} disabled={isEdit} className="input-base disabled:bg-slate-50 disabled:text-slate-400" placeholder="john@distrogh.com" />
                {isEdit && <p className="text-[10px] text-slate-400 mt-1">Email cannot be changed after creation.</p>}
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Phone</label>
                <input value={form.phone} onChange={(e) => f('phone', e.target.value)} className="input-base" placeholder="+233 20 000 0000" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Role <span className="text-red-500">*</span></label>
                  <select value={form.admin_role} onChange={(e) => f('admin_role', e.target.value)} className="input-base">
                    <option value="admin">Admin</option>
                    <option value="user">User</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Status</label>
                  <select value={form.status} onChange={(e) => f('status', e.target.value)} className="input-base">
                    <option value="active">Active</option>
                    <option value="suspended">Suspended</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  {isEdit ? 'New Password (leave blank to keep current)' : 'Password *'}
                </label>
                <div className="relative">
                  <input
                    type={showPass ? 'text' : 'password'}
                    value={form.password}
                    onChange={(e) => f('password', e.target.value)}
                    className="input-base pr-10"
                    placeholder={isEdit ? 'Enter new password to reset' : 'Min. 8 characters'}
                  />
                  <button type="button" onClick={() => setShowPass((p) => !p)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                    {showPass ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
              {(!isEdit || form.password) && (
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Confirm Password</label>
                  <input type="password" value={form.confirm_password} onChange={(e) => f('confirm_password', e.target.value)} className="input-base" placeholder="Re-enter password" />
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Notes</label>
                <textarea value={form.notes} onChange={(e) => f('notes', e.target.value)} rows={2} className="input-base resize-none" placeholder="Internal notes (optional)" />
              </div>
            </div>
          )}

          {step === 'permissions' && (
            <PermissionMatrix
              permissions={permissions}
              onChange={setPermissions}
            />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-slate-100 bg-slate-50 rounded-b-xl">
          <div className="flex gap-2">
            {step === 'permissions' && (
              <button onClick={() => setStep('details')} className="btn-secondary text-xs">
                ← Back
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-secondary text-xs">Cancel</button>
            {step === 'details' ? (
              <button onClick={() => setStep('permissions')} className="btn-primary text-xs">
                Next: Permissions →
              </button>
            ) : (
              <button onClick={submit} disabled={saving} className="btn-primary text-xs">
                {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Account'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AdminAccountsPage() {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterRole, setFilterRole] = useState('')
  const [modal, setModal] = useState<'create' | AdminUser | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  const showToast = (type: Toast['type'], message: string) => {
    setToast({ type, message })
    setTimeout(() => setToast(null), 4000)
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      if (filterStatus) params.set('status', filterStatus)
      if (filterRole) params.set('admin_role', filterRole)
      const res = await fetch(`/api/admin/users?${params}`)
      const json = await res.json()
      if (json.success) setUsers(json.data)
    } finally {
      setLoading(false)
    }
  }, [search, filterStatus, filterRole])

  useEffect(() => { load() }, [load])

  async function handleStatusToggle(user: AdminUser) {
    const newStatus = user.status === 'active' ? 'suspended' : 'active'
    const res = await fetch(`/api/admin/users/${user.user_id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    })
    const json = await res.json()
    if (json.success) {
      showToast('success', `Account ${newStatus === 'active' ? 'reactivated' : 'suspended'}.`)
      load()
    } else {
      showToast('error', json.error ?? 'Failed to update status.')
    }
  }

  async function handleDelete(user: AdminUser) {
    if (!confirm(`Permanently delete ${user.email}? This cannot be undone.`)) return
    setDeleting(user.user_id)
    const res = await fetch(`/api/admin/users/${user.user_id}`, { method: 'DELETE' })
    const json = await res.json()
    setDeleting(null)
    if (json.success) {
      showToast('success', 'Account deleted.')
      load()
    } else {
      showToast('error', json.error ?? 'Failed to delete account.')
    }
  }

  const roleBadge = (role: string) => {
    const map: Record<string, string> = {
      super_admin: 'bg-purple-100 text-purple-700',
      admin: 'bg-emerald-100 text-emerald-700',
      user: 'bg-slate-200 text-slate-700',
    }
    return map[role] ?? 'bg-slate-200 text-slate-600'
  }

  const statusBadge = (status: string) => status === 'active'
    ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      {toast && <PageToast type={toast.type} message={toast.message} onDismiss={() => setToast(null)} />}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-purple-100 flex items-center justify-center">
            <Users className="w-5 h-5 text-purple-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800">Admin Accounts</h1>
            <p className="text-xs text-slate-500">Manage administrator and user accounts</p>
          </div>
        </div>
        <button
          onClick={() => setModal('create')}
          className="btn-primary flex items-center gap-2 text-sm"
        >
          <Plus className="w-4 h-4" />
          Create Account
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, email, phone…"
            className="pl-9 input-base text-sm"
          />
        </div>
        <select value={filterRole} onChange={(e) => setFilterRole(e.target.value)} className="input-base text-sm w-40">
          <option value="">All Roles</option>
          <option value="super_admin">Super Admin</option>
          <option value="admin">Admin</option>
          <option value="user">User</option>
        </select>
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="input-base text-sm w-36">
          <option value="">All Status</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
        </select>
        <button onClick={load} className="btn-secondary flex items-center gap-1.5 text-sm">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
        {loading ? (
          <div className="py-16 text-center text-slate-400 text-sm">Loading accounts…</div>
        ) : users.length === 0 ? (
          <div className="py-16 text-center text-slate-400 text-sm">No accounts found.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-xs text-slate-500">
                <th className="text-left px-4 py-3 font-semibold">Name / Email</th>
                <th className="text-left px-4 py-3 font-semibold">Role</th>
                <th className="text-left px-4 py-3 font-semibold">Status</th>
                <th className="text-left px-4 py-3 font-semibold">Permissions</th>
                <th className="text-left px-4 py-3 font-semibold">Last Login</th>
                <th className="px-4 py-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {users.map((u) => {
                const fullName = [u.first_name, u.last_name].filter(Boolean).join(' ') || '—'
                const isExpanded = expandedId === u.user_id
                return (
                  <React.Fragment key={u.user_id}>
                    <tr className={cn('hover:bg-slate-50/60 transition', u.status === 'suspended' && 'opacity-60')}>
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-800">{fullName}</p>
                        <p className="text-xs text-slate-400">{u.email}</p>
                        {u.phone && <p className="text-xs text-slate-400">{u.phone}</p>}
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn('px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide', roleBadge(u.admin_role))}>
                          {u.admin_role.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn('px-2 py-0.5 rounded text-[10px] font-semibold capitalize', statusBadge(u.status))}>
                          {u.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {u.admin_role === 'super_admin' ? (
                          <span className="text-xs text-purple-600 font-medium">All permissions</span>
                        ) : (
                          <button
                            onClick={() => setExpandedId(isExpanded ? null : u.user_id)}
                            className="flex items-center gap-1 text-xs text-slate-500 hover:text-emerald-700 transition"
                          >
                            {u.permissions.length} assigned
                            {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">
                        {u.last_login_at ? new Date(u.last_login_at).toLocaleDateString() : 'Never'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          {u.admin_role !== 'super_admin' && (
                            <>
                              <button
                                onClick={() => setModal(u)}
                                title="Edit"
                                className="p-1.5 rounded hover:bg-slate-100 text-slate-500 hover:text-emerald-700 transition"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleStatusToggle(u)}
                                title={u.status === 'active' ? 'Suspend' : 'Reactivate'}
                                className="p-1.5 rounded hover:bg-slate-100 text-slate-500 hover:text-amber-600 transition"
                              >
                                {u.status === 'active' ? <UserX className="w-3.5 h-3.5" /> : <UserCheck className="w-3.5 h-3.5" />}
                              </button>
                              <button
                                onClick={() => handleDelete(u)}
                                disabled={deleting === u.user_id}
                                title="Delete"
                                className="p-1.5 rounded hover:bg-red-50 text-slate-400 hover:text-red-600 transition disabled:opacity-50"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="bg-slate-50/80">
                        <td colSpan={6} className="px-4 py-3">
                          <PermissionMatrix
                            permissions={u.permissions}
                            onChange={() => {}}
                            disabled
                          />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal */}
      {modal && (
        <AdminUserModal
          user={modal === 'create' ? null : modal}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null)
            showToast('success', modal === 'create' ? 'Account created successfully.' : 'Account updated successfully.')
            load()
          }}
        />
      )}
    </div>
  )
}
