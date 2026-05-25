import { apiFetch } from '@/lib/api/client'

export interface Category {
  id: string
  name: string
  sort_order: number
  created_at: string
  updated_at: string
}

export interface SystemSettings {
  company_name: string
  default_moq: number
  expiry_reminder_days: number
  week_starts_on: number
  packaging_presets: string[]
}

const DEFAULT_SETTINGS: SystemSettings = {
  company_name: 'DistroGH',
  default_moq: 1,
  expiry_reminder_days: 30,
  week_starts_on: 1,
  packaging_presets: ['100g', '250g', '400g', '500g', '1kg', '1L', '500ml'],
}

export const settingsService = {
  async getCategories(): Promise<Category[]> {
    return apiFetch<Category[]>('/api/categories', { fallbackError: 'Failed to load categories' })
  },

  async getSettings(): Promise<SystemSettings> {
    try {
      return await apiFetch<SystemSettings>('/api/settings', { fallbackError: 'Failed to load settings' })
    } catch {
      return DEFAULT_SETTINGS
    }
  },

  async getCategoryNames(): Promise<string[]> {
    const cats = await this.getCategories()
    return cats.map((c) => c.name).sort()
  },
}
