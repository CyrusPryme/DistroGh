'use client'

import { useState } from 'react'
import { Building2, Mail, Phone, FileText, Send, CheckCircle } from 'lucide-react'
import { vendorApplicationService } from '@/services/vendor-application.service'
import { cn } from '@/lib/utils'

export function VendorApplicationForm() {
  const [formData, setFormData] = useState({
    storeName: '',
    contactEmail: '',
    contactPhone: '',
    description: ''
  })
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSubmitted, setIsSubmitted] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setError('')

    try {
      await vendorApplicationService.submitApplication({
        store_name: formData.storeName,
        contact_email: formData.contactEmail,
        contact_phone: formData.contactPhone,
        description: formData.description
      })

      setIsSubmitted(true)
      setFormData({ storeName: '', contactEmail: '', contactPhone: '', description: '' })
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }))
    setError('')
  }

  if (isSubmitted) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 overflow-hidden bg-slate-50">
        <div className="absolute inset-0 pointer-events-none -z-10">
          <div className="absolute top-1/4 left-1/3 w-[500px] h-[500px] bg-emerald-400/20 rounded-full blur-[100px] animate-glow-pulse" />
          <div className="absolute bottom-1/3 right-1/4 w-[400px] h-[400px] bg-teal-400/15 rounded-full blur-[80px] animate-float" />
          <div className="absolute inset-0 bg-dot-grid opacity-40" />
        </div>
        <div className="relative bg-white/90 backdrop-blur-sm rounded-3xl shadow-2xl shadow-slate-300/30 border border-slate-200/60 p-10 max-w-md w-full text-center animate-fade-in">
          <div className="inline-flex w-20 h-20 bg-gradient-to-br from-emerald-500 to-teal-500 rounded-2xl items-center justify-center mx-auto mb-8 shadow-lg shadow-emerald-500/25 ring-4 ring-emerald-100">
            <CheckCircle className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-2xl md:text-3xl font-display font-bold text-slate-900 mb-4">Application Submitted!</h1>
          <p className="text-slate-600 mb-8 leading-relaxed">
            Thank you for your interest in becoming a vendor. We&apos;ll review your application and get back to you soon.
          </p>
          <div className="flex flex-col gap-3">
            <button
              onClick={() => setIsSubmitted(false)}
              className="w-full py-3.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-semibold rounded-xl transition-all shadow-lg shadow-emerald-500/25 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2"
            >
              Submit Another Application
            </button>
            <button
              type="button"
              onClick={() => setIsSubmitted(false)}
              className="w-full border-2 border-slate-200 text-slate-700 font-medium py-3 rounded-xl hover:bg-slate-50 hover:border-slate-300 transition-colors text-center focus:outline-none focus:ring-2 focus:ring-slate-300 focus:ring-offset-2"
            >
              Back to landing page
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Store Name */}
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-2">
          Store Name <span className="text-red-500">*</span>
        </label>
        <div className="relative">
          <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
          <input
            type="text"
            required
            value={formData.storeName}
            onChange={(e) => handleInputChange('storeName', e.target.value)}
            className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-colors"
            placeholder="Enter your store name"
          />
        </div>
      </div>

      {/* Contact Email */}
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-2">
          Contact Email <span className="text-red-500">*</span>
        </label>
        <div className="relative">
          <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
          <input
            type="email"
            required
            value={formData.contactEmail}
            onChange={(e) => handleInputChange('contactEmail', e.target.value)}
            className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-colors"
            placeholder="your@email.com"
          />
        </div>
      </div>

      {/* Telephone number */}
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-2">
          Telephone Number <span className="text-red-500">*</span>
        </label>
        <div className="relative">
          <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
          <input
            type="tel"
            required
            value={formData.contactPhone}
            onChange={(e) => handleInputChange('contactPhone', e.target.value)}
            className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-colors"
            placeholder="+233 24 123 4567"
            autoComplete="tel"
          />
        </div>
      </div>

      {/* Description */}
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-2">
          Tell us about your business
        </label>
        <div className="relative">
          <FileText className="absolute left-3 top-3 w-5 h-5 text-slate-400" />
          <textarea
            value={formData.description}
            onChange={(e) => handleInputChange('description', e.target.value)}
            rows={4}
            className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-colors resize-none"
            placeholder="Describe your products, target market, and business goals..."
          />
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-600 text-sm">{error}</p>
        </div>
      )}

      {/* Submit Button */}
      <button
        type="submit"
        disabled={isSubmitting}
        className={cn(
          'w-full flex items-center justify-center gap-2 py-4 rounded-xl font-semibold transition-colors',
          isSubmitting
            ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
            : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg shadow-emerald-600/20 hover:shadow-emerald-600/30 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2'
        )}
      >
        {isSubmitting ? (
          <>
            <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            Processing Application...
          </>
        ) : (
          <>
            <Send className="w-5 h-5" />
            Submit Vendor Application
          </>
        )}
      </button>
    </form>
  )
}
