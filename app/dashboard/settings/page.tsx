'use client'

import { useEffect, useState, useMemo } from 'react'
import {
  Settings,
  Tag,
  Building2,
  Package,
  Calendar,
  Plus,
  Edit2,
  Trash2,
  Loader2,
  Check,
  X,
  AlertCircle,
  Save,
} from 'lucide-react'
import { settingsService, type Category, type SystemSettings } from '@/services/settings.service'
import {
  createCategory,
  updateCategory,
  deleteCategory,
  updateSystemSetting,
} from './actions'
import { cn } from '@/lib/utils'
import { PaginationBar, getPageSlice, DEFAULT_PAGE_SIZE } from '@/components/shared/PaginationBar'
import { useSession } from '@/hooks/useSession'

export default function SettingsPage() {
  const { role, loading: sessionLoading } = useSession({ requireAuth: true })
  const [categories, setCategories] = useState<Category[]>([])
  const [settings, setSettings] = useState<SystemSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

  const [categoryAddName, setCategoryAddName] = useState('')
  const [categoryEditingId, setCategoryEditingId] = useState<string | null>(null)
  const [categoryEditName, setCategoryEditName] = useState('')
  const [categorySubmitting, setCategorySubmitting] = useState(false)

  const [settingsSubmitting, setSettingsSubmitting] = useState(false)
  const [companyName, setCompanyName] = useState('')
  const [defaultMoq, setDefaultMoq] = useState(1)
  const [expiryReminderDays, setExpiryReminderDays] = useState(30)
  const [categoryPage, setCategoryPage] = useState(1)

  const paginatedCategories = useMemo(
    () => getPageSlice(categories, categoryPage, DEFAULT_PAGE_SIZE),
    [categories, categoryPage]
  )

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3500)
  }

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const [cats, opts] = await Promise.all([
        settingsService.getCategories(),
        settingsService.getSettings(),
      ])
      setCategories(cats)
      setSettings(opts)
      setCompanyName(opts.company_name ?? 'DistroGH')
      setDefaultMoq(opts.default_moq ?? 1)
      setExpiryReminderDays(opts.expiry_reminder_days ?? 30)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!sessionLoading && role === 'admin') load()
  }, [role, sessionLoading])

  const handleAddCategory = async () => {
    const name = categoryAddName.trim()
    if (!name) return
    setCategorySubmitting(true)
    try {
      const result = await createCategory(name)
      if ('error' in result) {
        showToast(result.error, 'error')
        return
      }
      showToast('Category added')
      setCategoryAddName('')
      setCategoryPage(1)
      load()
    } catch (e: any) {
      showToast(e.message, 'error')
    } finally {
      setCategorySubmitting(false)
    }
  }

  const handleUpdateCategory = async () => {
    if (!categoryEditingId) return
    const name = categoryEditName.trim()
    if (!name) return
    setCategorySubmitting(true)
    try {
      const result = await updateCategory(categoryEditingId, name)
      if ('error' in result) {
        showToast(result.error, 'error')
        return
      }
      showToast('Category updated')
      setCategoryEditingId(null)
      load()
    } catch (e: any) {
      showToast(e.message, 'error')
    } finally {
      setCategorySubmitting(false)
    }
  }

  const handleDeleteCategory = async (cat: Category) => {
    if (!confirm(`Delete category "${cat.name}"? Products with this category will have their category cleared.`)) return
    setCategorySubmitting(true)
    try {
      const result = await deleteCategory(cat.id)
      if ('error' in result) {
        showToast(result.error, 'error')
        return
      }
      showToast('Category deleted')
      setCategoryEditingId(null)
      load()
    } catch (e: any) {
      showToast(e.message, 'error')
    } finally {
      setCategorySubmitting(false)
    }
  }

  const handleSaveSettings = async () => {
    setSettingsSubmitting(true)
    try {
      await Promise.all([
        updateSystemSetting('company_name', companyName.trim() || 'DistroGH'),
        updateSystemSetting('default_moq', Math.max(1, Math.floor(defaultMoq))),
        updateSystemSetting('expiry_reminder_days', Math.max(1, Math.min(365, Math.floor(expiryReminderDays)))),
      ])
      showToast('Settings saved')
      load()
    } catch (e: any) {
      showToast(e.message, 'error')
    } finally {
      setSettingsSubmitting(false)
    }
  }

  if (role !== 'admin') {
    return (
      <div className="page-container flex items-center justify-center min-h-[40vh]">
        <p className="text-slate-500">Only admins can access settings.</p>
      </div>
    )
  }

  if (loading && !categories.length) {
    return (
      <div className="page-container flex items-center justify-center min-h-[40vh]">
        <div className="flex flex-col items-center gap-3 text-slate-500">
          <Loader2 className="w-8 h-8 animate-spin" />
          <span>Loading settings...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="page-container space-y-8">
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

        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Settings className="w-7 h-7 text-slate-500" />
            Settings
          </h1>
          <p className="text-slate-500 text-sm mt-0.5">Manage categories, company info, and system defaults</p>
        </div>

        {error && (
          <div className="flex items-center gap-3 p-4 rounded-xl bg-red-50 border border-red-100 text-red-700">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Categories */}
        <div className="data-card">
          <h2 className="font-display font-semibold text-slate-900 mb-4 flex items-center gap-2">
            <Tag className="w-5 h-5 text-brand-600" />
            Product categories
          </h2>
          <p className="text-slate-500 text-sm mb-4">
            Categories appear in the product form dropdown. Add, edit, or remove categories. Deleting a category clears it from affected products.
          </p>

          <div className="flex gap-3 mb-6">
            <input
              value={categoryAddName}
              onChange={(e) => setCategoryAddName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddCategory()}
              className="form-input flex-1 max-w-xs"
              placeholder="New category name"
            />
            <button
              onClick={handleAddCategory}
              disabled={!categoryAddName.trim() || categorySubmitting}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
            >
              {categorySubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Add
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th className="text-right w-32">Actions</th>
                </tr>
              </thead>
              <tbody>
                {categories.length === 0 ? (
                  <tr>
                    <td colSpan={2} className="text-slate-500 py-8 text-center">
                      No categories yet. Add one above or add products with categories.
                    </td>
                  </tr>
                ) : (
                  paginatedCategories.map((cat) => (
                    <tr key={cat.id}>
                      <td className="font-medium text-slate-800">
                        {categoryEditingId === cat.id ? (
                          <input
                            value={categoryEditName}
                            onChange={(e) => setCategoryEditName(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleUpdateCategory()}
                            className="form-input w-full max-w-xs"
                            autoFocus
                          />
                        ) : (
                          cat.name
                        )}
                      </td>
                      <td className="text-right">
                        {categoryEditingId === cat.id ? (
                          <div className="flex gap-1 justify-end">
                            <button
                              onClick={handleUpdateCategory}
                              disabled={categorySubmitting}
                              className="p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50"
                              title="Save"
                            >
                              <Check className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => setCategoryEditingId(null)}
                              className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"
                              title="Cancel"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex gap-1 justify-end">
                            <button
                              onClick={() => {
                                setCategoryEditingId(cat.id)
                                setCategoryEditName(cat.name)
                              }}
                              className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                              title="Edit"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleDeleteCategory(cat)}
                              disabled={categorySubmitting}
                              className="p-1.5 rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600"
                              title="Delete"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            {categories.length > 0 && (
              <PaginationBar
                page={categoryPage}
                pageSize={DEFAULT_PAGE_SIZE}
                totalItems={categories.length}
                onPageChange={setCategoryPage}
              />
            )}
          </div>
        </div>

        {/* Company & defaults */}
        <div className="data-card">
          <h2 className="font-display font-semibold text-slate-900 mb-4 flex items-center gap-2">
            <Building2 className="w-5 h-5 text-brand-600" />
            Company & defaults
          </h2>

          <div className="grid gap-6 sm:grid-cols-2 max-w-2xl">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Company name</label>
              <input
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                className="form-input w-full"
                placeholder="DistroGH"
              />
              <p className="mt-1 text-xs text-slate-400">Shown on reports and invoices</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5 flex items-center gap-2">
                <Package className="w-4 h-4" />
                Default MOQ
              </label>
              <input
                type="number"
                min={1}
                value={defaultMoq}
                onChange={(e) => setDefaultMoq(Math.max(1, parseInt(e.target.value, 10) || 1))}
                className="form-input w-24"
              />
              <p className="mt-1 text-xs text-slate-400">Default minimum order quantity for new products</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5 flex items-center gap-2">
                <Calendar className="w-4 h-4" />
                Expiry reminder (days)
              </label>
              <input
                type="number"
                min={1}
                max={365}
                value={expiryReminderDays}
                onChange={(e) => setExpiryReminderDays(Math.max(1, Math.min(365, parseInt(e.target.value, 10) || 30)))}
                className="form-input w-24"
              />
              <p className="mt-1 text-xs text-slate-400">Days before expiry to alert (for future features)</p>
            </div>
          </div>

          <div className="mt-6">
            <button
              onClick={handleSaveSettings}
              disabled={settingsSubmitting}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-60"
            >
              {settingsSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save settings
            </button>
          </div>
        </div>
    </div>
  )
}
