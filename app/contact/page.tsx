'use client'

import { useState } from 'react'
import { Mail, Phone, MessageCircle, Send, ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { DISTROGH_CONTACT } from '@/lib/constants'

export default function ContactPage() {
  const [formData, setFormData] = useState({ name: '', email: '', enquiry: '' })
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSubmitted, setIsSubmitted] = useState(false)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    // TODO: wire up enquiry submission later
    setTimeout(() => {
      setIsSubmitted(true)
      setFormData({ name: '', email: '', enquiry: '' })
      setIsSubmitting(false)
    }, 800)
  }

  return (
    <div className="min-h-screen relative overflow-x-hidden">
      <div className="fixed inset-0 pointer-events-none -z-10">
        <div className="absolute top-0 left-1/4 w-[600px] h-[600px] bg-emerald-400/20 rounded-full blur-[120px] animate-glow-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] bg-teal-400/15 rounded-full blur-[100px] animate-float" />
        <div className="absolute inset-0 bg-dot-grid opacity-60" />
      </div>

      <div className="container mx-auto px-4 py-16 md:py-24">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-slate-600 hover:text-emerald-600 font-medium mb-12 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to home
        </Link>

        <div className="max-w-4xl mx-auto grid md:grid-cols-2 gap-12">
          {/* Contact info */}
          <div>
            <h1 className="text-3xl md:text-4xl font-display font-bold text-slate-900 mb-6">
              Get in <span className="bg-gradient-to-r from-emerald-600 to-teal-600 bg-clip-text text-transparent">touch</span>
            </h1>
            <p className="text-slate-600 mb-10 text-lg">
              Have a question or want to partner with us? Reach out and we&apos;ll get back to you soon.
            </p>

            <div className="space-y-6">
              <a
                href={`mailto:${DISTROGH_CONTACT.email}`}
                className="flex items-center gap-4 p-4 rounded-xl bg-white/80 backdrop-blur-sm border border-slate-200/60 shadow-lg shadow-slate-200/20 hover:border-emerald-200/80 hover:shadow-xl transition-all"
              >
                <div className="w-12 h-12 rounded-xl bg-emerald-100 flex items-center justify-center shrink-0">
                  <Mail className="w-6 h-6 text-emerald-600" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Email</p>
                  <p className="text-slate-900 font-medium">{DISTROGH_CONTACT.email}</p>
                </div>
              </a>

              <a
                href={`tel:${DISTROGH_CONTACT.phone.replace(/\s/g, '')}`}
                className="flex items-center gap-4 p-4 rounded-xl bg-white/80 backdrop-blur-sm border border-slate-200/60 shadow-lg shadow-slate-200/20 hover:border-emerald-200/80 hover:shadow-xl transition-all"
              >
                <div className="w-12 h-12 rounded-xl bg-teal-100 flex items-center justify-center shrink-0">
                  <Phone className="w-6 h-6 text-teal-600" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Phone</p>
                  <p className="text-slate-900 font-medium">{DISTROGH_CONTACT.phone}</p>
                </div>
              </a>

              <a
                href={`https://wa.me/${DISTROGH_CONTACT.whatsapp.replace(/\D/g, '')}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-4 p-4 rounded-xl bg-white/80 backdrop-blur-sm border border-slate-200/60 shadow-lg shadow-slate-200/20 hover:border-emerald-200/80 hover:shadow-xl transition-all"
              >
                <div className="w-12 h-12 rounded-xl bg-emerald-100 flex items-center justify-center shrink-0">
                  <MessageCircle className="w-6 h-6 text-emerald-600" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">WhatsApp</p>
                  <p className="text-slate-900 font-medium">{DISTROGH_CONTACT.whatsapp}</p>
                </div>
              </a>
            </div>
          </div>

          {/* Enquiry form */}
          <div className="relative bg-white/90 backdrop-blur-sm rounded-3xl shadow-2xl shadow-slate-300/30 border border-slate-200/60 p-8 overflow-hidden">
            <div className="relative">
              <h2 className="text-xl font-display font-bold text-slate-900 mb-6">Send an enquiry</h2>

              {isSubmitted ? (
                <div className="py-8 text-center">
                  <p className="text-emerald-600 font-medium mb-4">Thank you! We&apos;ll be in touch soon.</p>
                  <button
                    type="button"
                    onClick={() => setIsSubmitted(false)}
                    className="text-slate-600 hover:text-emerald-600 font-medium underline"
                  >
                    Send another enquiry
                  </button>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-6">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Name</label>
                    <input
                      type="text"
                      required
                      value={formData.name}
                      onChange={(e) => setFormData((p) => ({ ...p, name: e.target.value }))}
                      className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-colors"
                      placeholder="Your name"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Email</label>
                    <input
                      type="email"
                      required
                      value={formData.email}
                      onChange={(e) => setFormData((p) => ({ ...p, email: e.target.value }))}
                      className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-colors"
                      placeholder="your@email.com"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Enquiry</label>
                    <textarea
                      required
                      rows={4}
                      value={formData.enquiry}
                      onChange={(e) => setFormData((p) => ({ ...p, enquiry: e.target.value }))}
                      className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-colors resize-none"
                      placeholder="How can we help?"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className={cn(
                      'w-full flex items-center justify-center gap-2 py-3.5 rounded-xl font-semibold transition-colors',
                      isSubmitting
                        ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
                        : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg shadow-emerald-500/25 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2'
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
        </div>
      </div>
    </div>
  )
}
