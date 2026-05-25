'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Mail, Lock, Eye, EyeOff, Loader2, AlertCircle, TrendingUp, ArrowLeft, Home, Sparkles } from 'lucide-react'
import Link from 'next/link'

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
})

type LoginForm = z.infer<typeof loginSchema>

const demoAccounts = [
  {
    role: 'Admin',
    email: 'admin@example.com',
    password: 'password123',
    description: 'Full system access',
  },
  {
    role: 'Vendor',
    email: 'gorce@vendor.com',
    password: 'password123',
    description: 'Gorce Ltd',
  },
]

function LoginPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [showPassword, setShowPassword] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)
  const [isLoggingIn, setIsLoggingIn] = useState(false)

  useEffect(() => {
    const err = searchParams?.get('error')
    if (err === 'profile_required') {
      setAuthError('Your account has no profile assigned. Contact an administrator to set up your access.')
    }
  }, [searchParams])

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  })

  const getAuthErrorMessage = (error: unknown): string => {
    let msg = ''
    if (error instanceof Error) {
      msg = error.message
    } else if (error && typeof error === 'object') {
      const anyErr = error as any
      if (typeof anyErr.message === 'string') msg = anyErr.message
      else if (typeof anyErr.error === 'string') msg = anyErr.error
    }
    if (
      msg === 'Failed to fetch' ||
      msg === 'NetworkError when attempting to fetch resource.' ||
      /failed to fetch|networkerror|load failed/i.test(msg)
    ) {
      return 'Cannot reach the server. Check your internet connection, confirm DATABASE_URL is set (restart dev server after changes), and that Docker Postgres is running.'
    }
    return msg || 'An unexpected error occurred'
  }

  const onSubmit = async (data: LoginForm) => {
    setAuthError(null)
    setIsLoggingIn(true)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: data.email, password: data.password }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.success) {
        setAuthError(getAuthErrorMessage({ message: json?.error ?? 'Login failed' }))
        return
      }
      const role = json.role as string | undefined
      if (role === 'vendor') router.push('/dashboard/vendor')
      else router.push('/dashboard')
      router.refresh()
    } catch (error: unknown) {
      setAuthError(getAuthErrorMessage(error))
    } finally {
      setIsLoggingIn(false)
    }
  }

  const useDemoAccount = async (email: string, password: string) => {
    setAuthError(null)
    setIsLoggingIn(true)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.success) {
        setAuthError(getAuthErrorMessage({ message: json?.error ?? 'Login failed' }))
        return
      }
      const role = json.role as string | undefined
      if (role === 'vendor') router.push('/dashboard/vendor')
      else router.push('/dashboard')
      router.refresh()
    } catch (error: unknown) {
      setAuthError(getAuthErrorMessage(error))
    } finally {
      setIsLoggingIn(false)
    }
  }

  return (
    <div className="min-h-screen flex">
      {/* Left: Brand panel */}
      <div className="hidden lg:flex lg:w-[48%] xl:w-[52%] relative overflow-hidden bg-gradient-to-br from-emerald-700 via-emerald-800 to-teal-900">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml,%3Csvg width=\'60\' height=\'60\' viewBox=\'0 0 60 60\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'none\' fill-rule=\'evenodd\'%3E%3Cg fill=\'%23ffffff\' fill-opacity=\'0.04\'%3E%3Cpath d=\'M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z\'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E')] opacity-80" />
        <div className="absolute top-0 right-0 w-96 h-96 bg-emerald-500/20 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
        <div className="absolute bottom-0 left-0 w-80 h-80 bg-teal-500/20 rounded-full blur-3xl translate-y-1/2 -translate-x-1/2" />
        <div className="relative z-10 flex flex-col justify-between p-10 xl:p-14 text-white">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-white/90 hover:text-white text-sm font-medium transition-colors w-fit"
          >
            <ArrowLeft className="w-4 h-4" />
            <Home className="w-4 h-4" />
            Back to Home
          </Link>
          <div>
            <div className="flex items-center gap-3 mb-6">
              <div className="w-14 h-14 rounded-2xl bg-white/15 backdrop-blur-sm flex items-center justify-center shadow-lg border border-white/10">
                <TrendingUp className="w-7 h-7 text-white" />
              </div>
              <div>
                <h1 className="text-2xl xl:text-3xl font-bold tracking-tight">DistroGH</h1>
                <p className="text-emerald-200/90 text-sm font-medium">Distribution System</p>
              </div>
            </div>
            <p className="text-white/90 text-lg max-w-sm leading-relaxed mb-8">
              Sign in to manage consignment sales, payouts, and vendor operations in one place.
            </p>
            <div className="flex items-center gap-2 text-white/70 text-sm">
              <Sparkles className="w-4 h-4 text-amber-300" />
              <span>Built for Ghana&apos;s growing distribution networks</span>
            </div>
          </div>
        </div>
      </div>

      {/* Right: Form */}
      <div className="flex-1 flex flex-col justify-center px-4 sm:px-6 lg:px-10 xl:px-16 bg-slate-50/80">
        <div className="w-full max-w-md mx-auto">
          {/* Mobile back link */}
          <div className="lg:hidden mb-6">
            <Link
              href="/"
              className="inline-flex items-center gap-2 text-slate-600 hover:text-slate-900 text-sm font-medium"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Home
            </Link>
          </div>

          <div className="bg-white rounded-3xl shadow-xl shadow-slate-200/50 border border-slate-100 p-8 sm:p-10">
            <div className="text-center mb-8">
              <h2 className="text-xl font-bold text-slate-900 mb-1">Welcome back</h2>
              <p className="text-slate-500 text-sm">Enter your credentials to continue</p>
            </div>

            {authError && (
              <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-2xl flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-red-800 text-sm font-medium">{authError}</p>
                  <p className="text-red-600/80 text-xs mt-1">Check your email and password and try again.</p>
                </div>
              </div>
            )}

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Email</label>
                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                  <input
                    type="email"
                    {...register('email')}
                    disabled={isLoggingIn}
                    placeholder="you@company.com"
                    autoComplete="email"
                    className="w-full pl-11 pr-4 py-3.5 rounded-xl border border-slate-200 bg-slate-50/50 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 focus:bg-white transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed"
                  />
                </div>
                {errors.email && (
                  <p className="mt-1.5 text-sm text-red-600">{errors.email.message}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Password</label>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    {...register('password')}
                    disabled={isLoggingIn}
                    placeholder="••••••••"
                    autoComplete="current-password"
                    className="w-full pl-11 pr-12 py-3.5 rounded-xl border border-slate-200 bg-slate-50/50 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 focus:bg-white transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    disabled={isLoggingIn}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors p-1 rounded-lg hover:bg-slate-100 disabled:pointer-events-none"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {errors.password && (
                  <p className="mt-1.5 text-sm text-red-600">{errors.password.message}</p>
                )}
              </div>

              <button
                type="submit"
                disabled={isSubmitting || isLoggingIn}
                className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-700 hover:to-emerald-800 text-white font-semibold shadow-lg shadow-emerald-600/25 hover:shadow-emerald-600/30 transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isLoggingIn ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Signing in...
                  </>
                ) : (
                  'Sign in'
                )}
              </button>
            </form>

            <div className="relative my-8">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-slate-200" />
              </div>
              <div className="relative flex justify-center">
                <span className="px-4 bg-white text-slate-400 text-xs font-medium uppercase tracking-wider">
                  Demo access
                </span>
              </div>
            </div>

            <div className="space-y-2.5">
              {demoAccounts.map((account) => (
                <button
                  key={account.email}
                  type="button"
                  onClick={() => useDemoAccount(account.email, account.password)}
                  disabled={isLoggingIn}
                  className="w-full flex items-center justify-between p-3.5 rounded-xl border border-slate-100 bg-slate-50/50 hover:bg-slate-50 hover:border-slate-200 transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed group"
                >
                  <div className="text-left">
                    <span className="font-semibold text-slate-800 group-hover:text-emerald-700 transition-colors">
                      {account.role}
                    </span>
                    <span className="text-slate-500 text-sm ml-2">· {account.description}</span>
                  </div>
                  {isLoggingIn ? (
                    <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
                  ) : (
                    <span className="text-xs font-medium text-emerald-600 group-hover:text-emerald-700">
                      Use →
                    </span>
                  )}
                </button>
              ))}
            </div>
            <p className="text-center text-slate-400 text-xs mt-5">
              Demo accounts for testing only
            </p>
          </div>

          <p className="text-center text-slate-400 text-xs mt-6">
            DistroGH · Consignment Distribution
          </p>
        </div>
      </div>
    </div>
  )
}

function LoginPageFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50/80">
      <Loader2 className="w-10 h-10 text-emerald-600 animate-spin" aria-label="Loading" />
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginPageFallback />}>
      <LoginPageContent />
    </Suspense>
  )
}
