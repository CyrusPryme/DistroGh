'use client'

import { useState } from 'react'
import Image from 'next/image'
import { Building2, Mail, Phone, FileText, Send, CheckCircle, Menu, X, ArrowRight, Users, TrendingUp, Shield } from 'lucide-react'
import { vendorApplicationService } from '@/services/vendor-application.service'
import { cn } from '@/lib/utils'
import Link from 'next/link'
import { DistroGHLogo } from '@/components/shared/DistroGHLogo'

export default function HomePage() {
  const [formData, setFormData] = useState({
    storeName: '',
    contactEmail: '',
    contactPhone: '',
    description: ''
  })
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSubmitted, setIsSubmitted] = useState(false)
  const [error, setError] = useState('')
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

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

  const scrollToApplication = () => {
    const element = document.getElementById('vendor-application')
    element?.scrollIntoView({ behavior: 'smooth' })
  }

  if (isSubmitted) {
    return (
      <div className="min-h-screen relative flex items-center justify-center p-4 overflow-hidden">
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
    <div className="min-h-screen relative overflow-x-hidden">
      {/* Animated gradient mesh — below hero only */}
      <div className="fixed inset-0 pointer-events-none -z-10 bg-slate-50">
        <div className="absolute top-[85vh] left-0 right-0 bottom-0">
          <div className="absolute top-0 left-1/4 w-[600px] h-[600px] bg-emerald-400/20 rounded-full blur-[120px] animate-glow-pulse" />
          <div className="absolute top-1/4 right-0 w-[500px] h-[500px] bg-teal-400/15 rounded-full blur-[100px] animate-float" />
          <div className="absolute bottom-1/4 left-0 w-[400px] h-[400px] bg-cyan-400/10 rounded-full blur-[80px] animate-float" style={{ animationDelay: '-2s' }} />
          <div className="absolute inset-0 bg-dot-grid opacity-60" />
        </div>
      </div>

      {/* Navigation Header */}
      <nav className="sticky top-0 z-50 bg-white/95 backdrop-blur-xl border-b border-slate-200/60 shadow-lg shadow-slate-200/20">
        <div className="container mx-auto px-4">
          <div className="flex items-center justify-between h-16">
            <DistroGHLogo size="md" priority />

            {/* Desktop Navigation */}
            <div className="hidden md:flex items-center gap-4">
              <Link
                href="/contact"
                className="text-slate-600 hover:text-emerald-600 font-medium transition-colors"
              >
                Contact
              </Link>
              <Link 
                href="/login"
                className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl transition-all shadow-lg shadow-emerald-600/20 hover:shadow-emerald-600/30 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2"
              >
                Partner Login
              </Link>
            </div>

            {/* Mobile Menu Button */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden p-2.5 rounded-xl hover:bg-slate-100 transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
              aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
            >
              {mobileMenuOpen ? (
                <X className="w-5 h-5 text-slate-600" />
              ) : (
                <Menu className="w-5 h-5 text-slate-600" />
              )}
            </button>
          </div>

          {/* Mobile Menu */}
          {mobileMenuOpen && (
            <div className="md:hidden py-4 border-t border-slate-100 animate-fade-in space-y-2">
              <Link
                href="/contact"
                className="block w-full text-center px-6 py-3 text-slate-700 font-medium rounded-xl hover:bg-slate-50"
              >
                Contact
              </Link>
              <Link 
                href="/login"
                className="block w-full text-center px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl transition-colors"
              >
                Partner Login
              </Link>
            </div>
          )}
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative isolate overflow-hidden min-h-[85vh] flex items-center">
        <div className="absolute inset-0 z-0">
          <Image
            src="/images/supermarket-3.jpg"
            alt=""
            fill
            priority
            className="object-cover object-center"
            sizes="100vw"
          />
          <div className="absolute inset-0 bg-slate-900/55" />
          <div className="absolute inset-0 bg-gradient-to-b from-emerald-950/45 via-slate-900/35 to-slate-900/70" />
        </div>
        <div className="container relative z-10 mx-auto px-4 py-24 md:py-36 w-full">
          <div className="text-center max-w-4xl mx-auto">
            {/* Badge */}
            <div className="inline-flex items-center gap-2 px-5 py-2.5 bg-white/90 backdrop-blur-sm text-emerald-800 rounded-full text-sm font-semibold mb-10 border border-emerald-200/80 shadow-lg shadow-emerald-900/5 animate-fade-in">
              <Shield className="w-4 h-4 text-emerald-600" />
              Trusted by Ghana&apos;s Leading Distributors
            </div>

            {/* Main Headline */}
            <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-display font-bold text-white mb-6 leading-[1.08] tracking-tight animate-slide-up drop-shadow-sm">
              Empower Your
              <span className="block bg-gradient-to-r from-emerald-300 via-teal-200 to-cyan-200 bg-clip-text text-transparent mt-2">
                Consignment Business
              </span>
            </h1>

            {/* Sub-headline */}
            <p className="text-lg md:text-xl text-slate-200 mb-14 max-w-2xl mx-auto leading-relaxed animate-slide-up" style={{ animationDelay: '0.1s' }}>
              Streamline your distribution network with real-time analytics, automated commission tracking, and seamless vendor management. Built for Ghana&apos;s growing market.
            </p>

            {/* CTA Buttons */}
            <div className="flex flex-col sm:flex-row gap-4 justify-center items-center animate-slide-up" style={{ animationDelay: '0.2s' }}>
              <button
                onClick={scrollToApplication}
                className="group flex items-center gap-2 px-8 py-4 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-semibold rounded-xl transition-all shadow-xl shadow-emerald-500/30 hover:shadow-emerald-500/40 hover:-translate-y-1 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2"
              >
                <Building2 className="w-5 h-5" />
                Become a Vendor
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </button>
              
              <Link 
                href="/login"
                className="group flex items-center gap-2 px-8 py-4 bg-white hover:bg-slate-50 text-slate-800 font-semibold rounded-xl transition-all border-2 border-slate-200 hover:border-emerald-300 shadow-lg hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:ring-offset-2"
              >
                <Users className="w-5 h-5 group-hover:text-emerald-600 transition-colors" />
                Partner Login
              </Link>
            </div>

            {/* Trust Indicators - Card style */}
            <div className="grid grid-cols-3 gap-6 mt-20 max-w-3xl mx-auto animate-slide-up" style={{ animationDelay: '0.3s' }}>
              {[
                { value: '500+', label: 'Active Vendors', icon: Users },
                { value: 'GHS 2M+', label: 'Monthly Volume', icon: TrendingUp },
                { value: '99.9%', label: 'Uptime', icon: Shield },
              ].map((stat, i) => (
                <div key={i} className="p-5 rounded-2xl bg-white/70 backdrop-blur-sm border border-slate-200/60 shadow-lg shadow-slate-200/30 hover:shadow-xl hover:border-emerald-200/60 transition-all duration-300 hover:-translate-y-0.5">
                  <stat.icon className="w-6 h-6 text-emerald-500 mx-auto mb-2" />
                  <div className="text-2xl sm:text-3xl font-display font-bold bg-gradient-to-r from-emerald-600 to-teal-600 bg-clip-text text-transparent mb-1">{stat.value}</div>
                  <div className="text-xs sm:text-sm text-slate-500 font-medium">{stat.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-24 md:py-28 relative">
        <div className="absolute inset-0 bg-white/50" />
        <div className="container mx-auto px-4 relative z-10">
          <div className="text-center mb-20">
            <span className="inline-block px-4 py-1.5 rounded-full bg-emerald-100 text-emerald-700 text-sm font-semibold mb-6">
              Features
            </span>
            <h2 className="text-3xl md:text-5xl font-display font-bold text-slate-900 mb-4 tracking-tight">
              Why Choose <span className="bg-gradient-to-r from-emerald-600 to-teal-600 bg-clip-text text-transparent">DistroGH</span>?
            </h2>
            <p className="text-lg md:text-xl text-slate-600 max-w-2xl mx-auto">
              Powerful features designed to scale your consignment business
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto">
            {[
              { icon: TrendingUp, title: 'Real-time Analytics', desc: 'Track sales, commissions, and performance metrics with live dashboards and detailed reporting.', iconColor: 'text-emerald-600', bg: 'bg-emerald-500/10', ring: 'ring-emerald-200' },
              { icon: Shield, title: 'Secure Payments', desc: 'Automated commission calculations and timely payouts with transparent payment tracking.', iconColor: 'text-teal-600', bg: 'bg-teal-500/10', ring: 'ring-teal-200' },
              { icon: Users, title: 'Vendor Management', desc: 'Easy onboarding, role-based access, and comprehensive vendor relationship management.', iconColor: 'text-cyan-600', bg: 'bg-cyan-500/10', ring: 'ring-cyan-200' },
            ].map((f, i) => (
              <div
                key={i}
                className="group relative p-8 rounded-2xl bg-white/80 backdrop-blur-sm border border-slate-200/60 shadow-lg shadow-slate-200/20 transition-all duration-300 hover:-translate-y-2 hover:shadow-2xl hover:shadow-emerald-500/10 hover:border-emerald-200/80 overflow-hidden before:absolute before:inset-0 before:rounded-2xl before:bg-gradient-to-br before:from-emerald-500/5 before:to-teal-500/5 before:opacity-0 hover:before:opacity-100 before:transition-opacity before:duration-300"
              >
                <div className={cn('relative w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6 ring-4 ring-offset-2 transition-transform duration-300 group-hover:scale-110', f.bg, f.ring)}>
                  <f.icon className={cn('w-8 h-8', f.iconColor)} />
                </div>
                <h3 className="relative text-xl font-display font-semibold text-slate-900 mb-4">{f.title}</h3>
                <p className="relative text-slate-600 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Vendor Application Form */}
      <section id="vendor-application" className="py-24 md:py-28 relative">
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-50/80 via-white to-teal-50/60" />
        <div className="container mx-auto px-4 relative z-10">
          <div className="max-w-2xl mx-auto">
            <div className="relative bg-white/90 backdrop-blur-sm rounded-3xl shadow-2xl shadow-slate-300/30 border border-slate-200/60 p-8 md:p-10 overflow-hidden">
              {/* Decorative gradient corner */}
              <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-bl from-emerald-400/10 to-transparent rounded-bl-full -translate-y-1/2 translate-x-1/2" />
              <div className="absolute bottom-0 left-0 w-48 h-48 bg-gradient-to-tr from-teal-400/10 to-transparent rounded-tr-full translate-y-1/2 -translate-x-1/2" />
              <div className="relative">
                <div className="text-center mb-10">
                  <div className="inline-flex w-20 h-20 bg-gradient-to-br from-emerald-500 to-teal-500 rounded-2xl items-center justify-center mx-auto mb-6 shadow-lg shadow-emerald-500/25 ring-4 ring-emerald-100">
                    <Building2 className="w-10 h-10 text-white" />
                  </div>
                  <h2 className="text-3xl md:text-4xl font-display font-bold text-slate-900 mb-2">Start Your Vendor Journey</h2>
                  <p className="text-slate-600 text-lg">
                    Join our network of successful distributors and expand your reach
                  </p>
                </div>

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
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative bg-slate-900 text-white py-16 overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-emerald-900/20 via-transparent to-transparent" />
        <div className="ghana-accent" />
        <div className="container mx-auto px-4 pt-8 relative z-10">
          <div className="text-center">
            <div className="flex justify-center mb-5">
              <DistroGHLogo size="lg" href="/" onDark />
            </div>
            <p className="text-slate-400 text-lg max-w-md mx-auto mb-8">
              Empowering Ghana&apos;s consignment distribution network with modern tools
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-6 text-sm text-slate-400">
              <span>© {new Date().getFullYear()} DistroGH</span>
              <span className="hidden sm:inline text-slate-600">•</span>
              <Link href="/contact" className="text-slate-400 hover:text-white font-medium transition-colors focus:outline-none focus:underline">
                Contact
              </Link>
              <span className="hidden sm:inline text-slate-600">•</span>
              <Link href="/login" className="text-emerald-400 hover:text-emerald-300 font-medium transition-colors focus:outline-none focus:underline">
                Partner Login →
              </Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
