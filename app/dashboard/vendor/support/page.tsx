import { redirect } from 'next/navigation'

/** @deprecated Use /dashboard/support — kept for old bookmarks */
export default function VendorSupportRedirectPage() {
  redirect('/dashboard/support')
}
