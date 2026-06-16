'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { PageToast } from '@/components/shared/PageToast'

type ConfigItem = {
  key: string
  value: string | null
  value_type: string
  description?: string
  category: string
  is_sensitive: boolean
  updated_at: string
}

type Toast = { type: 'success' | 'error'; message: string } | null

const CATEGORY_COLORS: Record<string, string> = {
  finance:  'bg-emerald-50 border-emerald-200',
  security: 'bg-red-50 border-red-200',
  system:   'bg-slate-50 border-slate-200',
  branding: 'bg-blue-50 border-blue-200',
  general:  'bg-gray-50 border-gray-200',
}

export default function ConfigurationPage() {
  const [items, setItems] = useState<ConfigItem[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState<Set<string>>(new Set())
  const [toast, setToast] = useState<Toast>(null)

  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ type, message }); setTimeout(() => setToast(null), 4000)
  }

  const load = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/developer/config')
      const data = await res.json()
      if (data.success) {
        setItems(data.data)
        const initial: Record<string, string> = {}
        for (const item of data.data) initial[item.key] = item.value ?? ''
        setEditing(initial)
        setDirty(new Set())
      }
    } catch { /* ignore */ } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const handleChange = (key: string, value: string) => {
    setEditing(prev => ({ ...prev, [key]: value }))
    setDirty(prev => new Set([...prev, key]))
  }

  const handleSaveAll = async () => {
    const updates = Array.from(dirty).map(key => ({ key, value: editing[key] }))
    if (!updates.length) return
    setSaving(true)
    try {
      const res = await fetch('/api/developer/config', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
      const data = await res.json()
      if (!data.success) { showToast('error', data.error ?? 'Failed to save'); return }
      showToast('success', `Saved ${updates.length} configuration value(s).`)
      setDirty(new Set())
      load()
    } catch { showToast('error', 'Network error') } finally { setSaving(false) }
  }

  const grouped = items.reduce<Record<string, ConfigItem[]>>((acc, item) => {
    if (!acc[item.category]) acc[item.category] = []
    acc[item.category].push(item)
    return acc
  }, {})

  const renderInput = (item: ConfigItem) => {
    const val = editing[item.key] ?? ''
    if (item.is_sensitive) return <span className="text-slate-400 text-sm">••••••••  (read-only)</span>
    if (item.value_type === 'boolean') {
      return (
        <select value={val} onChange={e => handleChange(item.key, e.target.value)} className="input-base">
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      )
    }
    if (item.value_type === 'number') {
      return <input type="number" value={val} onChange={e => handleChange(item.key, e.target.value)} className="input-base w-40" step="any" />
    }
    return <input type="text" value={val} onChange={e => handleChange(item.key, e.target.value)} className="input-base w-full max-w-sm" />
  }

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-8">
      <PageToast message={toast?.message ?? null} type={toast?.type} />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Configuration</h1>
          <p className="text-sm text-slate-500 mt-0.5">System variables, feature flags and financial rules</p>
        </div>
        {dirty.size > 0 && (
          <button onClick={handleSaveAll} disabled={saving} className="btn-primary disabled:opacity-50">
            {saving ? 'Saving…' : `Save ${dirty.size} Change${dirty.size !== 1 ? 's' : ''}`}
          </button>
        )}
      </div>

      {loading ? (
        <p className="text-slate-400 text-center py-10">Loading configuration…</p>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([category, catItems]) => (
            <div key={category} className={cn('rounded-xl border p-5 space-y-4', CATEGORY_COLORS[category] ?? 'bg-white border-slate-200')}>
              <h2 className="font-semibold text-slate-800 capitalize">{category}</h2>
              {catItems.map(item => (
                <div key={item.key} className={cn('flex items-start gap-4 py-3 border-t border-slate-200/80 first:border-t-0', dirty.has(item.key) && 'bg-amber-50/50 rounded-lg -mx-2 px-2')}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-mono text-xs font-semibold text-slate-700">{item.key}</p>
                      <span className="px-1.5 py-0.5 bg-slate-200 text-slate-500 rounded text-xs">{item.value_type}</span>
                      {dirty.has(item.key) && <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded text-xs">unsaved</span>}
                    </div>
                    {item.description && <p className="text-xs text-slate-500 mt-0.5">{item.description}</p>}
                  </div>
                  <div className="flex-shrink-0">{renderInput(item)}</div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

