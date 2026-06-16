'use client'

import React, { useState, useEffect } from 'react'
import { Shield, Info, CheckCircle, Users, Copy } from 'lucide-react'
import { cn } from '@/lib/utils'
import { MODULES, ROLE_PRESETS, PERMISSION_ACTIONS, type PermissionAction } from '@/lib/auth/permissions'

const ACTION_LABELS: Record<PermissionAction, string> = {
  read: 'Read', create: 'Create', update: 'Update', delete: 'Delete',
  export: 'Export', approve: 'Approve', manage: 'Manage',
}

const ROLE_DESCRIPTIONS: Record<string, { color: string; desc: string }> = {
  super_admin: { color: 'text-purple-700 bg-purple-50 border-purple-200', desc: 'Unrestricted access to all modules including administration. Cannot be configured.' },
  admin: { color: 'text-emerald-700 bg-emerald-50 border-emerald-200', desc: 'Standard administrator. Default permissions are assigned when creating an admin account. Customize per user.' },
  user: { color: 'text-slate-700 bg-slate-100 border-slate-200', desc: 'Staff member with limited read access by default. Permissions are set individually per account.' },
}

export default function RolesPermissionsPage() {
  const [data, setData] = useState<{
    modules: typeof MODULES
    presets: typeof ROLE_PRESETS
    role_defaults: Record<string, string[]>
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedRole, setSelectedRole] = useState<string>('admin')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    fetch('/api/admin/roles')
      .then((r) => r.json())
      .then((j) => { if (j.success) setData(j.data) })
      .finally(() => setLoading(false))
  }, [])

  function copyPerms() {
    const perms = data?.role_defaults[selectedRole] ?? []
    navigator.clipboard.writeText(perms.join('\n')).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const rolePerms = new Set(data?.role_defaults[selectedRole] ?? [])
  const groups = [...new Set(MODULES.map((m) => m.group))]

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-purple-100 flex items-center justify-center">
          <Shield className="w-5 h-5 text-purple-600" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-800">Roles & Permissions</h1>
          <p className="text-xs text-slate-500">View default permissions for each role. Customize individual accounts in Admin Accounts.</p>
        </div>
      </div>

      {/* Role cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {['super_admin', 'admin', 'user'].map((role) => {
          const meta = ROLE_DESCRIPTIONS[role]
          const permCount = role === 'super_admin' ? '∞' : (data?.role_defaults[role]?.length ?? 0)
          return (
            <button
              key={role}
              onClick={() => role !== 'super_admin' && setSelectedRole(role)}
              className={cn(
                'text-left p-4 rounded-xl border transition',
                meta.color,
                selectedRole === role && role !== 'super_admin' && 'ring-2 ring-offset-1 ring-emerald-400',
                role === 'super_admin' && 'cursor-default opacity-80'
              )}
            >
              <div className="flex items-center gap-2 mb-2">
                <Shield className="w-4 h-4" />
                <span className="font-semibold capitalize text-sm">{role.replace('_', ' ')}</span>
              </div>
              <p className="text-xs leading-relaxed mb-2">{meta.desc}</p>
              <p className="text-xs font-semibold">{permCount} default permissions</p>
            </button>
          )
        })}
      </div>

      {/* Presets reference */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <Users className="w-4 h-4 text-slate-500" />
          <h2 className="font-semibold text-slate-800 text-sm">Permission Presets</h2>
          <span className="text-xs text-slate-400">(use when creating/editing admin accounts)</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {ROLE_PRESETS.map((preset) => (
            <div key={preset.id} className="border border-slate-100 rounded-lg p-3">
              <p className="font-medium text-slate-700 text-sm">{preset.label}</p>
              <p className="text-xs text-slate-500 mt-1 mb-2">{preset.description}</p>
              <p className="text-xs font-semibold text-emerald-700">{preset.permissions.length} permissions</p>
            </div>
          ))}
        </div>
      </div>

      {/* Permission matrix for selected role */}
      {selectedRole !== 'super_admin' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
            <div>
              <h2 className="font-semibold text-slate-800 text-sm capitalize">
                Default permissions for: <span className="text-emerald-700">{selectedRole.replace('_', ' ')}</span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                {rolePerms.size} permissions · These are defaults applied when creating a new {selectedRole} account.
              </p>
            </div>
            <button
              onClick={copyPerms}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:border-emerald-400 hover:text-emerald-700 transition"
            >
              {copied ? <CheckCircle className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copied!' : 'Copy list'}
            </button>
          </div>

          {loading ? (
            <div className="py-12 text-center text-slate-400 text-sm">Loading…</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100">
                    <th className="text-left px-4 py-2.5 font-semibold text-slate-600 min-w-[160px]">Module</th>
                    {PERMISSION_ACTIONS.map((a) => (
                      <th key={a} className="px-3 py-2.5 font-semibold text-slate-600 text-center min-w-[60px]">
                        {ACTION_LABELS[a]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {groups.map((group) => {
                    const gModules = MODULES.filter((m) => m.group === group)
                    return (
                      <React.Fragment key={group}>
                        <tr className="bg-slate-100/50">
                          <td colSpan={PERMISSION_ACTIONS.length + 1} className="px-4 py-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                            {group}
                          </td>
                        </tr>
                        {gModules.map((mod) => (
                          <tr key={mod.key} className="border-b border-slate-50 hover:bg-slate-50/50 transition">
                            <td className="px-4 py-2.5 font-medium text-slate-700">{mod.label}</td>
                            {PERMISSION_ACTIONS.map((action) => {
                              const key = `${mod.key}:${action}`
                              const supported = (mod.actions as string[]).includes(action)
                              const has = rolePerms.has(key)
                              return (
                                <td key={action} className="px-3 py-2.5 text-center">
                                  {supported ? (
                                    has ? (
                                      <CheckCircle className="w-3.5 h-3.5 text-emerald-500 mx-auto" />
                                    ) : (
                                      <span className="text-slate-200">✕</span>
                                    )
                                  ) : (
                                    <span className="text-slate-100">—</span>
                                  )}
                                </td>
                              )
                            })}
                          </tr>
                        ))}
                      </React.Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Note */}
      <div className="flex items-start gap-2 text-xs text-slate-500 bg-blue-50 border border-blue-100 rounded-lg px-4 py-3">
        <Info className="w-3.5 h-3.5 text-blue-400 flex-shrink-0 mt-0.5" />
        <p>
          Individual account permissions are configured in <strong>Admin Accounts</strong> page.
          The matrix above shows role <em>defaults</em> applied when creating a new account.
          Changes here do not retroactively affect existing accounts.
        </p>
      </div>
    </div>
  )
}
