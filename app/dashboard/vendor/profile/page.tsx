'use client'

import { useEffect, useState } from 'react'
import { useSession } from '@/hooks/useSession'
import Link from 'next/link'
import { vendorService } from '@/services/vendor.service'
import { updateVendorMomo, updateVendorDetails } from '@/app/dashboard/vendor/actions'
import { ArrowLeft, Building2, Phone, CreditCard, Calendar, Mail, Loader2, AlertCircle, CheckCircle, ShieldCheck, MessageCircle } from 'lucide-react'
import { formatDate, cn } from '@/lib/utils'
import {
  getServiceChargeLifecycle,
  getServiceChargePaymentStatus,
  SERVICE_CHARGE_LIFECYCLE_LABELS,
  formatServiceChargeCoverage,
} from '@/lib/vendor-service-charge'
import { DISTROGH_CONTACT } from '@/lib/constants'
import type { Vendor } from '@/types'

const MOMO_NETWORKS = ['MTN', 'Vodafone', 'AirtelTigo'] as const

export default function VendorProfilePage() {
  const { vendorId, loading: sessionLoading } = useSession({
    requireAuth: true,
    ensureVendorProfile: true,
  })
  const [vendor, setVendor] = useState<Vendor | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [momoNumber, setMomoNumber] = useState('')
  const [momoNetwork, setMomoNetwork] = useState<string>('MTN')
  const [businessName, setBusinessName] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [savingBusiness, setSavingBusiness] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

  useEffect(() => {
    if (sessionLoading) return
    if (!vendorId) {
      setLoading(false)
      setError('No vendor linked to your account.')
      return
    }
    vendorService
      .getById(vendorId)
      .then((v) => {
        setVendor(v ?? null)
        if (v) {
          setMomoNumber(v.momo_number ?? '')
          setMomoNetwork(v.momo_network ?? 'MTN')
          setBusinessName(v.name ?? '')
          setContactPhone((v as Vendor).contact_phone ?? '')
          setDescription((v as Vendor).description ?? '')
        }
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Failed to load profile')
      })
      .finally(() => setLoading(false))
  }, [sessionLoading, vendorId])

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3500)
  }

  const handleSaveBusiness = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!vendorId || !businessName.trim()) {
      showToast('Business name is required.', 'error')
      return
    }
    setSavingBusiness(true)
    try {
      await updateVendorDetails(vendorId, {
        name: businessName.trim(),
        contact_phone: contactPhone.trim() || null,
        description: description.trim() || null,
      })
      const v = await vendorService.getById(vendorId)
      setVendor(v ?? null)
      showToast('Business details updated.')
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Update failed', 'error')
    } finally {
      setSavingBusiness(false)
    }
  }

  const handleSaveMomo = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!vendorId || !momoNumber.trim()) {
      showToast('Enter a valid MoMo number.', 'error')
      return
    }
    setSaving(true)
    try {
      await updateVendorMomo(vendorId, {
        momo_number: momoNumber.trim(),
        momo_network: momoNetwork as 'MTN' | 'Vodafone' | 'AirtelTigo',
      })
      const v = await vendorService.getById(vendorId)
      setVendor(v ?? null)
      showToast('Payout details updated.')
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Update failed', 'error')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="page-container flex items-center justify-center py-16">
        <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
      </div>
    )
  }

  if (error || !vendor) {
    return (
      <div className="page-container">
        <div className="data-card text-center py-12">
          <AlertCircle className="w-12 h-12 text-amber-500 mx-auto mb-3" />
          <p className="text-slate-700 font-medium">{error || 'Vendor not found'}</p>
          <Link href="/dashboard/vendor" className="mt-4 inline-block text-brand-600 hover:text-brand-700 text-sm font-medium">
            ← Back to dashboard
          </Link>
        </div>
      </div>
    )
  }

  const status = (vendor as any).status ?? 'active'
  const hasAdminFeedback = !!(vendor as any)?.verification_feedback?.trim()
  const hasFdaAndFacility = !!(vendor as any)?.fda_certificate_path && !!(vendor as any)?.facility_expiry_date

  const displayStatus =
    status === 'suspended' ? 'Suspended' :
    status === 'active' ? 'Approved' :
    hasAdminFeedback ? 'Changes requested' :
    hasFdaAndFacility ? 'Pending verification' : 'Pending'

  const nextStep =
    status === 'suspended' ? 'Contact admin to resolve.' :
    status === 'active' ? null :
    hasAdminFeedback ? 'Resubmit documents per admin feedback.' :
    hasFdaAndFacility ? 'Awaiting admin verification.' : 'Upload FDA certificate and facility expiry date.'

  return (
    <div className="page-container space-y-6">
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

      <div className="flex items-center justify-between">
        <Link
          href="/dashboard/vendor"
          className="inline-flex items-center gap-2 text-slate-600 hover:text-slate-900 text-sm font-medium"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to dashboard
        </Link>
      </div>

      <div>
        <h1 className="font-display text-2xl font-bold text-slate-900">Vendor profile</h1>
        <p className="text-slate-500 text-sm mt-0.5">Your company and payout details</p>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Editable: Business info */}
        <div className="data-card space-y-4">
          <h2 className="font-display font-semibold text-slate-900 flex items-center gap-2">
            <Building2 className="w-5 h-5 text-slate-500" />
            Business info
          </h2>
          <form onSubmit={handleSaveBusiness} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Business name</label>
              <input
                type="text"
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                className="form-input"
                placeholder="e.g. Kofi Foods Ltd"
                minLength={2}
                maxLength={100}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Contact phone</label>
              <input
                type="tel"
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                className="form-input"
                placeholder="e.g. 0241234567"
              />
              <p className="mt-0.5 text-xs text-slate-400">For business enquiries</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Business description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="form-input min-h-[80px] resize-y"
                placeholder="Brief description of your business"
                rows={3}
                maxLength={500}
              />
              <p className="mt-0.5 text-xs text-slate-400">{description.length}/500 characters</p>
            </div>
            <button
              type="submit"
              disabled={savingBusiness}
              className="w-full min-h-[44px] py-2.5 rounded-xl bg-brand-600 text-white font-semibold flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {savingBusiness ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
              Save business details
            </button>
          </form>
          <dl className="space-y-3 pt-4 border-t border-slate-100">
            <div>
              <dt className="text-xs font-medium text-slate-500 uppercase tracking-wider">Login email</dt>
              <dd className="text-slate-700 mt-0.5 flex items-center gap-2">
                <Mail className="w-4 h-4 text-slate-400" />
                {(vendor as any).login_email ?? '—'}
              </dd>
              <p className="mt-0.5 text-xs text-slate-400">Contact admin to change</p>
            </div>
            <div>
              <dt className="text-xs font-medium text-slate-500 uppercase tracking-wider">Annual service charge</dt>
              <dd className="text-slate-700 mt-0.5 text-sm">
                {vendor
                  ? (() => {
                      const paid = getServiceChargePaymentStatus(vendor)
                      const life = getServiceChargeLifecycle(vendor)
                      const coverage = formatServiceChargeCoverage(vendor)
                      return (
                        <>
                          <span className="font-medium">{paid === 'paid' ? 'Paid' : 'Unpaid'}</span>
                          {' · '}
                          {SERVICE_CHARGE_LIFECYCLE_LABELS[life]}
                          {coverage ? <> · {coverage}</> : null}
                        </>
                      )
                    })()
                  : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-slate-500 uppercase tracking-wider">Pricing</dt>
              <dd className="text-slate-700 mt-0.5 flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-slate-400" />
                Agreed with admin per product — that is what you earn on each sale
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-slate-500 uppercase tracking-wider">Verification status</dt>
              <dd className="mt-0.5">
                <span
                  className={cn(
                    'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium',
                    displayStatus === 'Approved' && 'bg-emerald-100 text-emerald-800',
                    (displayStatus === 'Pending' || displayStatus === 'Pending verification') && 'bg-amber-100 text-amber-800',
                    displayStatus === 'Changes requested' && 'bg-orange-100 text-orange-800',
                    displayStatus === 'Suspended' && 'bg-red-100 text-red-800'
                  )}
                >
                  {displayStatus === 'Approved' && <CheckCircle className="w-3.5 h-3.5" />}
                  {displayStatus === 'Pending verification' && <ShieldCheck className="w-3.5 h-3.5" />}
                  {displayStatus}
                </span>
              </dd>
            </div>
            {nextStep && (
              <div className="pt-2 border-t border-slate-100">
                <dt className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">Next step</dt>
                <dd className="text-slate-600 text-sm">{nextStep}</dd>
              </div>
            )}
            {hasAdminFeedback && (
              <div className="p-3 rounded-lg bg-amber-50 border border-amber-200">
                <dt className="text-xs font-medium text-slate-600 uppercase tracking-wider mb-1">Message from administrator</dt>
                <dd className="text-amber-900 text-sm whitespace-pre-wrap">{(vendor as any).verification_feedback}</dd>
              </div>
            )}
            {(vendor as any).facility_expiry_date && (
              <div>
                <dt className="text-xs font-medium text-slate-500 uppercase tracking-wider">Facility expiry</dt>
                <dd className="text-slate-700 mt-0.5 flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-slate-400" />
                  {formatDate((vendor as any).facility_expiry_date)}
                </dd>
              </div>
            )}
          </dl>
        </div>

        {/* Editable: MoMo for payouts */}
        <div className="data-card">
          <h2 className="font-display font-semibold text-slate-900 flex items-center gap-2 mb-4">
            <Phone className="w-5 h-5 text-slate-500" />
            Payout details (MoMo)
          </h2>
          <p className="text-slate-500 text-sm mb-4">
            Update your mobile money number and network so we can process your payouts.
          </p>
          <form onSubmit={handleSaveMomo} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">MoMo number</label>
              <input
                type="tel"
                value={momoNumber}
                onChange={(e) => setMomoNumber(e.target.value)}
                className="form-input"
                placeholder="e.g. 0241234567"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Network</label>
              <select
                value={momoNetwork}
                onChange={(e) => setMomoNetwork(e.target.value)}
                className="form-input"
              >
                {MOMO_NETWORKS.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              disabled={saving}
              className="w-full min-h-[44px] py-2.5 rounded-xl bg-brand-600 text-white font-semibold flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
              Save payout details
            </button>
          </form>
        </div>

        {/* Support / Contact DistroGH */}
        <div className="data-card lg:col-span-2">
          <h2 className="font-display font-semibold text-slate-900 flex items-center gap-2 mb-4">
            <MessageCircle className="w-5 h-5 text-slate-500" />
            Support & contact
          </h2>
          <p className="text-slate-600 text-sm mb-4">
            Need help? Reach out to the DistroGH team for questions about payouts, products, or your account.
          </p>
          <div className="flex flex-wrap gap-3">
            <a
              href={`mailto:${DISTROGH_CONTACT.email}`}
              className="inline-flex items-center gap-2 px-4 py-2.5 min-h-[44px] rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-colors text-sm font-medium"
            >
              <Mail className="w-4 h-4 text-slate-500" />
              {DISTROGH_CONTACT.email}
            </a>
            <a
              href={`tel:${DISTROGH_CONTACT.phone.replace(/\s/g, '')}`}
              className="inline-flex items-center gap-2 px-4 py-2.5 min-h-[44px] rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-colors text-sm font-medium"
            >
              <Phone className="w-4 h-4 text-slate-500" />
              {DISTROGH_CONTACT.phone}
            </a>
            <a
              href={`https://wa.me/${DISTROGH_CONTACT.whatsapp.replace(/\D/g, '')}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2.5 min-h-[44px] rounded-lg border border-emerald-200 bg-emerald-50/50 text-emerald-800 hover:bg-emerald-50 transition-colors text-sm font-medium"
            >
              <MessageCircle className="w-4 h-4" />
              WhatsApp
            </a>
            <Link
              href="/dashboard/support"
              className="inline-flex items-center gap-2 px-4 py-2.5 min-h-[44px] rounded-lg bg-brand-600 text-white hover:bg-brand-700 transition-colors text-sm font-medium"
            >
              Contact support
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
