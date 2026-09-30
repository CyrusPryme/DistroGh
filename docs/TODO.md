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

---

## Accepted risk (not a to-do — documented so it isn't re-flagged without context)

### `exceljs` → `uuid@8.3.2` audit warning (GHSA-w5hq-g745-h8pq, moderate)
- **Identified:** 2026-09-30, during `npm audit` triage.
- **Decision:** Leave as-is. Do not downgrade `exceljs` to 3.4.0 (the only "fix" npm offers) —
  that's a major-version regression to a heavily-used runtime dependency (migration engine,
  sales import parsing, template generation, report exports).
- **Why it's safe to leave:** The vulnerability requires a caller to pass a pre-allocated `buf`
  argument to uuid's `v3`/`v5`/`v6` functions. Checked `node_modules/exceljs/lib` directly —
  the only `uuid` usage in the entire package is
  `const { v4: uuidv4 } = require('uuid')` in `cf-rule-ext-xform.js` (conditional-formatting
  extension rules), calling plain `uuid.v4()` with no buffer argument. The vulnerable code path
  is never reached by exceljs. `npm audit` flags this because it can't see how the dependency is
  actually *used*, only that a vulnerable version exists in the tree.
- **Revisit if:** exceljs ships a release that bumps its own `uuid` dependency past `^8.x`
  (check `npm view exceljs@latest dependencies` periodically), or if exceljs's uuid usage ever
  changes to pass a buffer argument (re-check `node_modules/exceljs/lib/**/*.js` for `uuid`
  imports if upgrading exceljs for any other reason).
