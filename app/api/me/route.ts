import { NextResponse } from 'next/server'
import { readSessionCookie } from '@/lib/auth/session'
import { getDbPool } from '@/lib/db'
import { enforceVendorServiceCharge } from '@/lib/vendor-service-charge-enforce'
import {
  getServiceChargeBanner,
  getServiceChargeLifecycle,
  getServiceChargePaymentStatus,
} from '@/lib/vendor-service-charge'

export async function GET() {
  const session = await readSessionCookie()
  if (!session) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  let serviceCharge: Record<string, unknown> | null = null

  if (session.role === 'vendor' && session.vendor_id) {
    const pool = getDbPool()
    const vendor = await enforceVendorServiceCharge(pool, session.vendor_id)
    if (vendor) {
      const lifecycle = getServiceChargeLifecycle(vendor)
      const banner = getServiceChargeBanner(vendor)
      serviceCharge = {
        payment_status: getServiceChargePaymentStatus(vendor),
        lifecycle,
        paid_at: vendor.service_charge_paid_at ?? null,
        expires_at: vendor.service_charge_expires_at ?? null,
        suspended_reason: vendor.suspended_reason ?? null,
        banner,
      }
    }
  }

  return NextResponse.json({
    success: true,
    data: {
      ...session,
      service_charge: serviceCharge,
    },
  })
}
