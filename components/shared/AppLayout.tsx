'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  LayoutDashboard, Users, Package, ShoppingCart, Upload,
  CreditCard, BarChart3, LogOut, Menu, ChevronRight, ChevronDown,
  Building2, RotateCcw, Inbox, Truck, Store, Layers, FileText, HelpCircle, User, MessageCircle, PowerOff, Settings
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { deliveryService } from '@/services/delivery.service'
import { payoutService } from '@/services/payout.service'
import { ServiceChargeBanner } from '@/components/vendors/ServiceChargeBanner'
import { DistroGHLogo } from '@/components/shared/DistroGHLogo'
import type { ServiceChargeBanner as ServiceChargeBannerData } from '@/lib/vendor-service-charge'

// Define navigation items with role-based access
const navItems = [
  { 
    href: '/dashboard', 
    label: 'Dashboard', 
    icon: LayoutDashboard,
    roles: ['admin', 'user'] // Admin and users see main dashboard
  },
  { 
    href: '/dashboard/vendor', 
    label: 'Dashboard', 
    icon: LayoutDashboard,
    roles: ['vendor'] // Vendors see vendor dashboard
  },
  { 
    href: '/dashboard/vendor/payouts', 
    label: 'Payout history', 
    icon: CreditCard,
    roles: ['vendor'] // Vendors see their payouts and balance
  },
  { 
    href: '/dashboard/vendor/statement', 
    label: 'Statement', 
    icon: FileText,
    roles: ['vendor'] // Vendors see sales, returns, payouts by period
  },
  { 
    href: '/dashboard/vendor/delivery-status', 
    label: 'Delivery status', 
    icon: Truck,
    roles: ['vendor'] // Vendors see which supermarkets received their products and when (confirmed only)
  },
  { 
    href: '/dashboard/vendors', 
    label: 'Vendors', 
    icon: Users,
    roles: ['admin'] // Only admin
  },
  { 
    href: '/dashboard/admin/applications', 
    label: 'Applications', 
    icon: Building2,
    roles: ['admin'] // Only admin
  },
  { 
    href: '/dashboard/products', 
    label: 'Products', 
    icon: Package,
    roles: ['admin', 'vendor'] // Admin and vendors
  },
  { 
    href: '/dashboard/sales', 
    label: 'Sales', 
    icon: ShoppingCart,
    roles: ['admin', 'vendor', 'user'] // All roles
  },
  { 
    href: '/dashboard/sales/import', 
    label: 'Import Sales', 
    icon: Upload,
    roles: ['admin'] // Admin only; vendors cannot import sales
  },
  { 
    href: '/dashboard/returns', 
    label: 'Returns', 
    icon: RotateCcw,
    roles: ['admin', 'vendor'] // Record and view returned/defective items
  },
  { 
    href: '/dashboard/receiving', 
    label: 'Receiving', 
    icon: Inbox,
    roles: ['admin', 'vendor'] // Admin: record intakes. Vendor: read-only visibility of their stock received & on hand
  },
  { 
    href: '/dashboard/deliveries', 
    label: 'Deliveries', 
    icon: Truck,
    roles: ['admin'] // Deliveries to supermarkets + transport cost
  },
  { 
    href: '/dashboard/supermarkets', 
    label: 'Supermarkets', 
    icon: Store,
    roles: ['admin', 'user'] // List outlets + summary stats
  },
  { 
    href: '/dashboard/stock-at-supermarkets', 
    label: 'Store stock', 
    icon: Layers,
    roles: ['admin', 'user'] // Which supermarkets have which products
  },
  { 
    href: '/dashboard/payouts', 
    label: 'Payouts', 
    icon: CreditCard,
    roles: ['admin'] // Only admin
  },
  { 
    href: '/dashboard/reports', 
    label: 'Reports', 
    icon: BarChart3,
    roles: ['admin', 'user'] // Admin and users
  },
  { 
    href: '/dashboard/settings', 
    label: 'Settings', 
    icon: Settings,
    roles: ['admin'] // Admin only
  },
]

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [userRole, setUserRole] = useState<string | null>(null)
  const [userEmail, setUserEmail] = useState<string>('')
  const [vendorInfo, setVendorInfo] = useState<{ name: string } | null>(null)
  const [vendorProfileOpen, setVendorProfileOpen] = useState(false)
  const [pendingDeliveries, setPendingDeliveries] = useState(0)
  const [pendingPayoutAlerts, setPendingPayoutAlerts] = useState(0)
  const [serviceChargeBanner, setServiceChargeBanner] = useState<ServiceChargeBannerData | null>(null)

  // Fetch user role on mount
  useEffect(() => {
    async function fetchUserRole() {
      const res = await fetch('/api/me', { cache: 'no-store' })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.success) {
        setUserRole(null)
        setUserEmail('')
        setVendorInfo(null)
        setServiceChargeBanner(null)
        return
      }

      const role = json.data?.role as string | undefined
      const email = (json.data?.email ?? '') as string
      const vendorId = (json.data?.vendor_id ?? null) as string | null

      setUserRole(role ?? null)
      setUserEmail(email)

      if (role === 'vendor') {
        const scBanner = json.data?.service_charge?.banner as ServiceChargeBannerData | null | undefined
        setServiceChargeBanner(scBanner ?? null)
      } else {
        setServiceChargeBanner(null)
      }

      if (role === 'vendor' && vendorId) {
        const vRes = await fetch(`/api/vendors/${vendorId}`, { cache: 'no-store' })
        const vJson = await vRes.json().catch(() => null)
        if (vRes.ok && vJson?.success && vJson?.data?.name) {
          setVendorInfo({ name: String(vJson.data.name) })
        }
      }
    }
    
    fetchUserRole()
  }, [])

  useEffect(() => {
    if (userRole !== 'admin') return
    const refetchDeliveries = () =>
      deliveryService.getPendingDeliveryCount().then(setPendingDeliveries).catch(() => {})
    const refetchPayouts = () =>
      payoutService
        .getPendingSummary()
        .then((s) => setPendingPayoutAlerts(s.alert_count))
        .catch(() => setPendingPayoutAlerts(0))

    refetchDeliveries()
    refetchPayouts()

    const onDelivery = () => refetchDeliveries()
    const onPayout = () => refetchPayouts()
    window.addEventListener('delivery-confirmed', onDelivery)
    window.addEventListener('delivery-created', onDelivery)
    window.addEventListener('payout-updated', onPayout)
    return () => {
      window.removeEventListener('delivery-confirmed', onDelivery)
      window.removeEventListener('delivery-created', onDelivery)
      window.removeEventListener('payout-updated', onPayout)
    }
  }, [userRole])

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {})
    router.push('/login')
    router.refresh()
  }

  // Filter navigation items based on user role. When role not yet loaded, only show items
  // that include vendor (minimal set so we never show Supermarkets, Reports, etc. to vendors)
  const visibleNavItems = navItems.filter(item => {
    if (!userRole) return false
    return item.roles.includes(userRole)
  })

  const profileHref =
    userRole === 'vendor' ? '/dashboard/vendor/profile' : '/dashboard/profile'

  const isProfileActive =
    pathname === profileHref || pathname.startsWith(`${profileHref}/`)

  const SidebarContent = () => (
    <div className="flex flex-col h-full">
      {/* Logo - compact */}
      <div className="px-4 py-3 border-b border-slate-100">
        <DistroGHLogo size="sm" href="/dashboard" />
      </div>

      {/* Ghana accent strip */}
      <div className="ghana-accent" />

      {/* User info badge - compact */}
      {userRole && (
        <div className="px-4 py-2 bg-slate-50 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <div className={cn(
              'px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide',
              userRole === 'admin' && 'bg-emerald-100 text-emerald-700',
              userRole === 'vendor' && 'bg-blue-100 text-blue-700',
              userRole === 'user' && 'bg-slate-200 text-slate-700'
            )}>
              {userRole}
            </div>
            <span className="text-xs text-slate-500 truncate">{userEmail}</span>
          </div>
        </div>
      )}

      {/* Navigation - compact so all items fit without scrolling on typical screens */}
      <nav className="flex-1 min-h-0 px-2 py-3 overflow-y-auto custom-scrollbar">
        <p className="px-2.5 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
          Main Menu
        </p>
        <div className="space-y-0.5">
          {visibleNavItems.map(({ href, label, icon: Icon }) => {
            const isActive = pathname === href ||
              (href !== '/dashboard' && pathname.startsWith(href + '/')) ||
              (href !== '/dashboard' && pathname.startsWith(href))
            const isDeliveries = href === '/dashboard/deliveries'
            const isPayouts = href === '/dashboard/payouts'
            const hasPending =
              (isDeliveries && pendingDeliveries > 0) ||
              (isPayouts && pendingPayoutAlerts > 0)
            const pendingTitle = isPayouts
              ? `${pendingPayoutAlerts} payment(s) need attention`
              : `${pendingDeliveries} pending delivery(ies)`
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  'flex items-center gap-2.5 px-2.5 py-2 rounded-lg transition-all duration-150 text-xs font-medium',
                  hasPending && !isActive && 'text-red-600 hover:bg-red-50 hover:text-red-700',
                  !hasPending && 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                  isActive && !hasPending && 'bg-emerald-50 text-emerald-800 font-semibold border-l-2 border-emerald-500',
                  isActive && hasPending && 'bg-red-50 text-red-800 font-semibold border-l-2 border-red-500'
                )}
              >
                <Icon className={cn('w-4 h-4 flex-shrink-0', hasPending && 'text-red-500')} />
                <span className="flex-1 truncate">{label}</span>
                {hasPending && (
                  <span className="shrink-0 w-2 h-2 rounded-full bg-red-500" title={pendingTitle} />
                )}
                {isActive && !hasPending && <ChevronRight className="w-3 h-3 opacity-50 flex-shrink-0" />}
                {isActive && hasPending && <ChevronRight className="w-3 h-3 text-red-500 flex-shrink-0" />}
              </Link>
            )
          })}
        </div>
      </nav>

      {/* Footer - compact */}
      <div className="p-3 border-t border-slate-100 space-y-1">
        {(userRole === 'vendor' || userRole === 'admin') && (
          <Link
            href="/dashboard/support"
            onClick={() => setSidebarOpen(false)}
            className={cn(
              'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg transition-all duration-200 text-xs font-medium',
              pathname === '/dashboard/support' || pathname.startsWith('/dashboard/support/')
                ? 'bg-emerald-50 text-emerald-800 font-semibold'
                : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'
            )}
          >
            <HelpCircle className="w-3.5 h-3.5" />
            Contact / Support
          </Link>
        )}
        {userRole && (
          <Link
            href={profileHref}
            onClick={() => setSidebarOpen(false)}
            className={cn(
              'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg transition-all duration-200 text-xs font-medium',
              isProfileActive
                ? 'bg-emerald-50 text-emerald-800 font-semibold'
                : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'
            )}
          >
            <User className="w-3.5 h-3.5" />
            Profile
          </Link>
        )}
        <button
          type="button"
          onClick={handleLogout}
          className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-600 transition-all duration-200 text-xs font-medium"
        >
          <LogOut className="w-3.5 h-3.5" />
          Sign Out
        </button>
      </div>
    </div>
  )

  return (
    <div className="app-layout-root flex h-screen bg-slate-50 overflow-hidden">
      {/* Desktop Sidebar */}
      <aside className="app-layout-sidebar no-print hidden lg:flex flex-col w-64 bg-white border-r border-slate-200/80 shrink-0 shadow-sm">
        <SidebarContent />
      </aside>

      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div
          className="app-layout-mobile-overlay no-print fixed inset-0 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        >
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
          <aside
            className="absolute left-0 top-0 h-full w-60 bg-white shadow-xl transform transition-transform duration-300 ease-in-out"
            onClick={(e) => e.stopPropagation()}
          >
            <SidebarContent />
          </aside>
        </div>
      )}

      {/* Main Content */}
      <main className="app-layout-main flex-1 flex flex-col overflow-hidden">
        {/* Top bar - vendor profile dropdown (visible for vendors on desktop) */}
        {userRole === 'vendor' && (
          <header className="app-layout-header no-print hidden lg:flex items-center justify-end px-4 py-2 sm:px-6 bg-white border-b border-slate-100 shrink-0">
            <div className="relative">
              <button
                type="button"
                onClick={() => setVendorProfileOpen((o) => !o)}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors"
                aria-expanded={vendorProfileOpen}
                aria-haspopup="true"
              >
                <User className="w-5 h-5 text-slate-500" />
                <span className="text-sm font-medium hidden sm:inline">
                  {vendorInfo?.name ?? 'Profile'}
                </span>
                <ChevronDown className={cn('w-4 h-4 transition-transform', vendorProfileOpen && 'rotate-180')} />
              </button>
              {vendorProfileOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setVendorProfileOpen(false)} aria-hidden="true" />
                  <div className="absolute right-0 top-full mt-1 py-1 w-56 bg-white rounded-xl shadow-lg border border-slate-200 z-50">
                    <Link
                      href="/dashboard/vendor/profile"
                      onClick={() => setVendorProfileOpen(false)}
                      className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50"
                    >
                      <User className="w-4 h-4 text-slate-500" />
                      Update contact & company details
                    </Link>
                    <Link
                      href="/dashboard/support"
                      onClick={() => setVendorProfileOpen(false)}
                      className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50"
                    >
                      <MessageCircle className="w-4 h-4 text-slate-500" />
                      Contact support
                    </Link>
                    <Link
                      href="/dashboard/vendor/request-deactivation"
                      onClick={() => setVendorProfileOpen(false)}
                      className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50"
                    >
                      <PowerOff className="w-4 h-4 text-slate-500" />
                      Request deactivation
                    </Link>
                  </div>
                </>
              )}
            </div>
          </header>
        )}

        {/* Mobile Header - touch-friendly for vendors on the move */}
        <header className="app-layout-header no-print lg:hidden flex items-center justify-between px-4 py-3 sm:p-4 bg-white border-b border-slate-100 shrink-0">
          <button
            onClick={() => setSidebarOpen(true)}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center -ml-2 rounded-lg text-slate-500 hover:bg-slate-100 active:bg-slate-200 transition-colors"
            aria-label="Open menu"
          >
            <Menu className="w-6 h-6" />
          </button>

          <div className="flex items-center gap-2">
            {userRole === 'vendor' && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setVendorProfileOpen((o) => !o)}
                  className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-slate-600 hover:bg-slate-100 min-h-[44px]"
                  aria-expanded={vendorProfileOpen}
                >
                  <User className="w-5 h-5 text-slate-500" />
                  <ChevronDown className={cn('w-4 h-4', vendorProfileOpen && 'rotate-180')} />
                </button>
                {vendorProfileOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setVendorProfileOpen(false)} aria-hidden="true" />
                    <div className="absolute right-0 top-full mt-1 py-1 w-52 bg-white rounded-xl shadow-lg border border-slate-200 z-50">
                      <Link href="/dashboard/vendor/profile" onClick={() => setVendorProfileOpen(false)} className="flex items-center gap-2 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50">
                        <User className="w-4 h-4 text-slate-500" />
                        Profile
                      </Link>
                      <Link href="/dashboard/support" onClick={() => setVendorProfileOpen(false)} className="flex items-center gap-2 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50">
                        <MessageCircle className="w-4 h-4 text-slate-500" />
                        Contact support
                      </Link>
                      <Link href="/dashboard/vendor/request-deactivation" onClick={() => setVendorProfileOpen(false)} className="flex items-center gap-2 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50">
                        <PowerOff className="w-4 h-4 text-slate-500" />
                        Request deactivation
                      </Link>
                    </div>
                  </>
                )}
              </div>
            )}
            {userRole && (
              <div className={cn(
                'px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide',
                userRole === 'admin' && 'bg-emerald-100 text-emerald-700',
                userRole === 'vendor' && 'bg-blue-100 text-blue-700',
                userRole === 'user' && 'bg-slate-200 text-slate-700'
              )}>
                {userRole}
              </div>
            )}
            <div className="text-right">
              <span className="text-xs text-slate-500 truncate block">{userEmail}</span>
              {vendorInfo && (
                <span className="text-xs text-slate-600 font-medium block">
                  {vendorInfo.name}
                </span>
              )}
            </div>
          </div>
        </header>

        {userRole === 'vendor' && serviceChargeBanner && (
          <ServiceChargeBanner banner={serviceChargeBanner} />
        )}

        {/* Page Content - responsive padding for phone/tablet */}
        <div className="app-layout-content flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-6 lg:p-8 bg-slate-50/90">
          {children}
        </div>
      </main>
    </div>
  )
}
