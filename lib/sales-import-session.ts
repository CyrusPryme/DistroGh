import type { ImportPreview } from '@/types'
import type { ImportSettingsValues } from '@/lib/validations'

const STORAGE_KEY = 'distrogh:sales-import-draft'

export type SalesImportDraft = {
  step: 'preview'
  preview: ImportPreview
  fileName: string
  settings: ImportSettingsValues
  previewPage: number
  showUnmatched: boolean
  /** Spreadsheet row key → manually linked product id */
  manualProductLinks: Record<string, string>
  savedAt: number
}

export function saveSalesImportDraft(draft: SalesImportDraft): boolean {
  if (typeof window === 'undefined') return false
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(draft))
    return true
  } catch {
    return false
  }
}

export function loadSalesImportDraft(): SalesImportDraft | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as SalesImportDraft
    if (parsed.step !== 'preview' || !parsed.preview?.rows?.length) return null
    return parsed
  } catch {
    return null
  }
}

export function clearSalesImportDraft(): void {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}

export function hasSalesImportDraft(): boolean {
  return loadSalesImportDraft() !== null
}
