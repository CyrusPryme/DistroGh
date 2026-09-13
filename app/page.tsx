import Image from 'next/image'
import { Building2, ArrowRight, Users, TrendingUp, Shield } from 'lucide-react'
import { cn } from '@/lib/utils'
import Link from 'next/link'
import { DistroGHLogo } from '@/components/shared/DistroGHLogo'
import { LandingNav } from '@/components/landing/LandingNav'
import { VendorApplicationForm } from '@/components/landing/VendorApplicationForm'

export default function HomePage() {
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

      <LandingNav />

      {/* Hero Section */}
      <section className="relative isolate overflow-hidden min-h-[85vh] flex items-center">
        <div className="absolute inset-0 z-0">
          <Image
            src="/images/supermarket-3.jpg"
            alt="Bright supermarket aisle with fully stocked grocery shelves"
            fill
            preload
            decoding="sync"
            quality={70}
            className="object-cover object-center"
            sizes="(max-width: 768px) 100vw, 1200px"
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
              <a
                href="#vendor-application"
                className="group flex items-center gap-2 px-8 py-4 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-semibold rounded-xl transition-all shadow-xl shadow-emerald-500/30 hover:shadow-emerald-500/40 hover:-translate-y-1 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2"
              >
                <Building2 className="w-5 h-5" />
                Become a Vendor
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </a>

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

                <VendorApplicationForm />
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
