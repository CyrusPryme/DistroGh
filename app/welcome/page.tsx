'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Building2, Mail, CheckCircle, ArrowRight } from 'lucide-react'
import { fetchClientSession } from '@/lib/client/session'
import { cn } from '@/lib/utils'

export default function WelcomePage() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const router = useRouter()

  useEffect(() => {
    // Check if user is authenticated and has vendor role
    async function checkVendorStatus() {
      const session = await fetchClientSession()
      if (session?.role === 'vendor' && session.vendor_id) {
        setSuccess(true)
      } else {
        router.push('/login')
      }
    }
    
    checkVendorStatus()
  }, [])

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {})
    router.push('/login')
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-red-50 to-pink-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Mail className="w-8 h-8 text-red-600" />
          </div>
          <h1 className="text-2xl font-bold text-red-800 mb-4">Setup Required</h1>
          <p className="text-red-600 mb-6">We couldn't verify your vendor account. Please contact support.</p>
          <button
            onClick={() => router.push('/login')}
            className="w-full px-6 py-3 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg transition-colors"
          >
            Return to Login
          </button>
        </div>
      </div>
    )
  }

  if (success) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-50 to-emerald-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center">
          <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle className="w-10 h-10 text-green-600" />
          </div>
          
          <h1 className="text-3xl font-bold text-gray-900 mb-4">Welcome to DistroGH!</h1>
          <p className="text-xl text-gray-600 mb-6">
            Your vendor account has been successfully created and is ready to use.
          </p>
          
          <div className="bg-blue-50 rounded-lg p-6 mb-6">
            <h2 className="text-lg font-semibold text-blue-900 mb-2">What's Next?</h2>
            <div className="space-y-4">
              <button
                onClick={() => router.push('/dashboard')}
                className="w-full flex items-center justify-center gap-3 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
              >
                <Building2 className="w-5 h-5" />
                Go to Dashboard
              </button>
              
              <button
                onClick={handleLogout}
                className="w-full flex items-center justify-center gap-3 px-6 py-3 bg-gray-200 hover:bg-gray-300 text-gray-700 font-medium rounded-lg transition-colors"
              >
                <Mail className="w-5 h-5" />
                Set Up Your Store
              </button>
            </div>
          </div>
          
          <div className="text-center">
            <p className="text-sm text-gray-500">
              You can always return here to set up your store details, add products, and manage your sales.
            </p>
          </div>
        </div>
      </div>
    )
  }

  // Fallback for non-vendors or unauthenticated users
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center">
        <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-6">
          <Building2 className="w-8 h-8 text-blue-600" />
        </div>
        
        <h1 className="text-3xl font-bold text-gray-900 mb-4">Vendor Account Required</h1>
        <p className="text-xl text-gray-600 mb-6">
          This page is for approved vendors only. Please check your email for setup instructions.
        </p>
        
        <button
          onClick={() => router.push('/login')}
          className="w-full px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
        >
          Return to Login
        </button>
      </div>
    </div>
  )
}
