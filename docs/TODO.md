# TODO / Deferred Improvements

Backlog of identified improvements that are intentionally deferred, not forgotten.
Add an entry whenever work is deferred; move to "Done" (or delete) once shipped.

---

## Open

### FDA / facility certificate expiry alerts
- **Identified:** 2026-09-30
- **Status:** Deferred — revisit when actively onboarding new users/vendors.
- **Problem:** `vendors.facility_expiry_date` and `vendors.service_charge_expires_at` are tracked
  per-vendor but only ever rendered on that vendor's individual detail page
  (`app/dashboard/vendors/[id]/page.tsx`). There is no list-level badge, no entry in the Data
  Integrity scan (`lib/system-integrity.ts`), and no dashboard KPI — an admin only discovers an
  expired FDA certificate by opening that specific vendor's profile.
- **Evidence (as of 2026-09-30):** Vendor "KKO" had `facility_expiry_date = 2026-09-01`
  (already expired, ~29 days) while still `status = 'active'`. "farmer Torks Greeneries" was
  expiring within 10 days. Neither was visible anywhere except that vendor's own page.
- **Proposed fix (no schema changes needed — columns already exist):**
  1. Vendors list page (`app/dashboard/vendors/page.tsx`) — sortable "Cert status" badge
     (Expired / Expiring ≤30d / OK) per row.
  2. Data Integrity scan (`lib/system-integrity.ts` → `runSystemIntegrityScan`) — add an
     `error`-severity issue for expired certs on active vendors, `warn` for expiring within 30
     days, consistent with existing checks (over-delivery, orphan sales, etc.).
- **Why deferred:** Not urgent while the vendor roster is stable; higher priority once actively
  screening/onboarding new vendors, when cert-expiry hygiene matters more.
