import { apiFetch } from '@/lib/api/client'
import { logError } from '@/utils/error-handler'
import type { VendorApplication } from '@/types/vendor-application'

export interface VendorApplicationForm {
  store_name: string
  contact_email: string
  contact_phone: string
  description?: string
}

export const vendorApplicationService = {
  async submitApplication(data: VendorApplicationForm): Promise<VendorApplication> {
    const payload = {
      store_name: data.store_name.trim(),
      contact_email: data.contact_email.trim().toLowerCase(),
      contact_phone: data.contact_phone.trim(),
      description: data.description?.trim() || null,
    }

    try {
      return await apiFetch<VendorApplication>('/api/vendor-applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        fallbackError: 'Failed to submit application',
      })
    } catch (error) {
      logError(error, 'vendorApplicationService.submitApplication')
      throw error
    }
  },

  async getPendingApplications(): Promise<VendorApplication[]> {
    try {
      return await apiFetch<VendorApplication[]>(
        '/api/vendor-applications?status=pending&includeRejected=true',
        { fallbackError: 'Failed to load applications' }
      )
    } catch (error) {
      logError(error, 'vendorApplicationService.getPendingApplications')
      throw error
    }
  },

  async getAllApplications(): Promise<VendorApplication[]> {
    try {
      return await apiFetch<VendorApplication[]>('/api/vendor-applications?includeRejected=true', {
        fallbackError: 'Failed to load applications',
      })
    } catch (error) {
      logError(error, 'vendorApplicationService.getAllApplications')
      if (error instanceof Error) throw error
      throw new Error('An unexpected error occurred while loading applications')
    }
  },

  async updateApplicationStatus(
    id: string,
    status: 'approved' | 'rejected',
    vendorId?: string
  ): Promise<VendorApplication> {
    try {
      return await apiFetch<VendorApplication>(`/api/vendor-applications/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, vendorId }),
        fallbackError: 'Failed to update application',
      })
    } catch (error) {
      logError(error, 'vendorApplicationService.updateApplicationStatus')
      throw error
    }
  },

  async deleteApplication(id: string): Promise<void> {
    try {
      await apiFetch<unknown>(`/api/vendor-applications/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        fallbackError: 'Failed to delete application',
      })
    } catch (error) {
      logError(error, 'vendorApplicationService.deleteApplication')
      throw error
    }
  },

  async checkEmailExists(email: string): Promise<boolean> {
    try {
      const target = email.trim().toLowerCase()
      if (!target) return false
      const data = await apiFetch<{ exists: boolean }>(
        `/api/vendor-applications/check-email?email=${encodeURIComponent(target)}`
      )
      return !!data.exists
    } catch (error) {
      logError(error, 'vendorApplicationService.checkEmailExists')
      throw error
    }
  },
}
