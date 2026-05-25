'use client'

import { useState } from 'react'
import { Mail, Phone, MessageCircle, Send, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { DISTROGH_CONTACT } from '@/lib/constants'

export type SupportContext = {
  label: string
  name: string
  email: string
  phone?: string | null
  roleLabel?: string
}

type Props = {
  context?: SupportContext | null
  loading?: boolean
}

export function ContactSupportPanel({ context, loading }: Props) {
  const [enquiry, setEnquiry] = useState('')
  const [formData, setFormData] = useState({ name: '', email: '', message: '' })
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSubmitted, setIsSubmitted] = useState(false)

  const handleSubmitForm = (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setTimeout(() => {
      setIsSubmitted(true)
      setFormData({ name: '', email: '', message: '' })
      setIsSubmitting(false)
    }, 800)
  }

  const handleSendMailto = () => {
    const senderName = context?.name ?? formData.name.trim()
    const senderEmail = context?.email ?? formData.email.trim()
    const body = [
      '---',
      context ? `${context.label} (pre-filled):` : 'Sender:',
      `Name: ${senderName}`,
      `Email: ${senderEmail}`,
      context?.phone ? `Phone: ${context.phone}` : null,
      context?.roleLabel ? `Role: ${context.roleLabel}` : null,
      '---',
      '',
      enquiry.trim() || formData.message.trim() || '(Your message)',
    ]
      .filter(Boolean)
      .join('\n')
    const subject = context
      ? `Support enquiry from ${context.name}`
      : `Support enquiry from ${senderName || 'DistroGH user'}`
    window.location.href = `mailto:${DISTROGH_CONTACT.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
      </div>
    )
  }

  return (
    <div className="grid lg:grid-cols-2 gap-6 lg:gap-8">
      <div className="space-y-6">
        <div>
          <h2 className="font-display text-lg font-semibold text-slate-900">Reach DistroGH</h2>
          <p className="text-slate-600 text-sm mt-1">
            Questions about payouts, products, deliveries, or your account — we&apos;re here to help.
          </p>
        </div>

        <div className="space-y-3">
          <a
            href={`mailto:${DISTROGH_CONTACT.email}`}
            className="flex items-center gap-4 p-4 rounded-xl bg-white border border-slate-200 hover:border-emerald-200 hover:shadow-sm transition-all"
          >
            <div className="w-11 h-11 rounded-xl bg-emerald-100 flex items-center justify-center shrink-0">
              <Mail className="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Email</p>
              <p className="text-slate-900 font-medium text-sm">{DISTROGH_CONTACT.email}</p>
            </div>
          </a>

          <a
            href={`tel:${DISTROGH_CONTACT.phone.replace(/\s/g, '')}`}
            className="flex items-center gap-4 p-4 rounded-xl bg-white border border-slate-200 hover:border-emerald-200 hover:shadow-sm transition-all"
          >
            <div className="w-11 h-11 rounded-xl bg-teal-100 flex items-center justify-center shrink-0">
              <Phone className="w-5 h-5 text-teal-600" />
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Phone</p>
              <p className="text-slate-900 font-medium text-sm">{DISTROGH_CONTACT.phone}</p>
            </div>
          </a>

          <a
            href={`https://wa.me/${DISTROGH_CONTACT.whatsapp.replace(/\D/g, '')}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-4 p-4 rounded-xl bg-white border border-slate-200 hover:border-emerald-200 hover:shadow-sm transition-all"
          >
            <div className="w-11 h-11 rounded-xl bg-emerald-100 flex items-center justify-center shrink-0">
              <MessageCircle className="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">WhatsApp</p>
              <p className="text-slate-900 font-medium text-sm">{DISTROGH_CONTACT.whatsapp}</p>
            </div>
          </a>
        </div>
      </div>

      <div className="data-card space-y-5">
        <h2 className="font-display text-lg font-semibold text-slate-900">Send an enquiry</h2>

        {context ? (
          <>
            <div className="rounded-lg bg-slate-50 border border-slate-100 p-4 space-y-2">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Your details (included automatically)
              </p>
              <p className="text-slate-800 font-medium">{context.name}</p>
              <p className="text-slate-600 text-sm">{context.email}</p>
              {context.phone ? (
                <p className="text-slate-600 text-sm font-mono">{context.phone}</p>
              ) : null}
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Your message</label>
              <textarea
                value={enquiry}
                onChange={(e) => setEnquiry(e.target.value)}
                rows={4}
                className="form-input resize-y"
                placeholder="How can we help?"
              />
            </div>

            <button
              type="button"
              onClick={handleSendMailto}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand-600 text-white font-semibold hover:bg-brand-700"
            >
              <Send className="w-4 h-4" />
              Open email to send
            </button>
          </>
        ) : isSubmitted ? (
          <div className="py-6 text-center">
            <p className="text-emerald-600 font-medium mb-4">Thank you! We&apos;ll be in touch soon.</p>
            <button
              type="button"
              onClick={() => setIsSubmitted(false)}
              className="text-slate-600 hover:text-emerald-600 font-medium text-sm underline"
            >
              Send another enquiry
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmitForm} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Name</label>
              <input
                type="text"
                required
                value={formData.name}
                onChange={(e) => setFormData((p) => ({ ...p, name: e.target.value }))}
                className="form-input"
                placeholder="Your name"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Email</label>
              <input
                type="email"
                required
                value={formData.email}
                onChange={(e) => setFormData((p) => ({ ...p, email: e.target.value }))}
                className="form-input"
                placeholder="your@email.com"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Message</label>
              <textarea
                required
                rows={4}
                value={formData.message}
                onChange={(e) => setFormData((p) => ({ ...p, message: e.target.value }))}
                className="form-input resize-y"
                placeholder="How can we help?"
              />
            </div>
            <button
              type="submit"
              disabled={isSubmitting}
              className={cn(
                'w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-semibold transition-colors',
                isSubmitting
                  ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
                  : 'bg-brand-600 hover:bg-brand-700 text-white'
              )}
            >
              {isSubmitting ? (
                <>
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Send className="w-5 h-5" />
                  Send enquiry
                </>
              )}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
