# Historical Data Migration Engine — Implementation Plan

## 1. Analysis summary

### Production graph (safe import order)

```
categories → vendors → products → supermarket_chains* → supermarkets
  → intakes → delivery_runs → delivery_run_items → supermarket_inventory*
  → sales → product_returns → vendor_deductions → delivery_run_vendor_charges
  → payouts → service_charges (vendor columns) → vendor_documents (FDA columns)
```

\* Chains are logical (`supermarkets.name`); inventory is preferably derived after confirmed deliveries.

### Gaps vs production schema

| Historical concept | Production reality |
|---|---|
| Opening balances | Not modeled — staging + explicit adjustment policy |
| Supermarket chains | Derived from `supermarkets.name` |
| Vendor documents | FDA columns + Google Drive only |
| Service charge history | Current fields on `vendors` only |

### Existing reuse (do not duplicate)

| Capability | Source |
|---|---|
| Excel parse / match / rematch | `lib/excel-parser.ts` |
| Pricing / vendor due | `lib/product-pricing.ts` |
| Supermarket match | `lib/supermarket-match.ts`, `lib/supermarket-chains.ts` |
| Sales commit writer | `app/api/sales/bulk-insert/route.ts` (migration mode) |
| Correction UX patterns | `app/dashboard/sales/import/page.tsx` (ProductModal, SupermarketModal, link/rematch) |
| Audit helper | `lib/rbac/audit.ts` |

### Critical gaps to build

- Durable migration **projects** (not `sessionStorage`)
- File persistence in DB (Vercel FS is ephemeral)
- Staging layer (never write production until approval)
- Dependency analysis across multi-entity uploads
- Background job queue + chunked resume
- Reconciliation + rollback
- Wizard state in DB

---

## 2. Architecture

```
UI Wizard (stateful)
    ↓ save every action
migration_projects + wizard_state JSONB
    ↓
Upload → migration_files + migration_file_blobs
    ↓
Analyse → entity detect + dependency graph
    ↓
Parse → migration_staging_rows
    ↓
Validate / Smart match / Corrections (reuse excel-parser matchers)
    ↓
Preview + Approval
    ↓
Enqueue migration_jobs (import / reconcile / rollback)
    ↓
Worker: /api/migrations/jobs/process (chunked, resumable)
    ↓
Production writers (transactional per chunk, tracked by phase)
    ↓
Reconciliation → Completed / Failed / Rolled Back
```

### Status machine

`draft → analysing → awaiting_correction → ready → approved → importing → verifying → completed`  
Also: `paused`, `failed`, `cancelled`, `rolled_back`, `archived`

### Wizard stages (1–10)

1 create · 2 upload · 3 relationships · 4 validation · 5 corrections · 6 preview · 7 approval · 8 import · 9 verification · 10 report

---

## 3. Deliverables (this implementation)

1. Migration SQL `021_historical_migration_engine.sql`
2. Core libs under `lib/migration/`
3. APIs under `app/api/migrations/`
4. Data Management UI under `app/dashboard/data-management/`
5. Sidebar + RBAC module `historical_migrations`
6. Correction workspace reusing matchers + Product/Supermarket modals
7. Background job processor with resume
8. Tests + this technical doc

### Explicit non-goals for v1 writers

- Full production writers for every entity ship as pluggable adapters; **sales / vendors / products / categories / supermarkets / intakes / returns / deductions / payouts** are prioritized.
- Opening balances land in staging with a documented adjustment policy (vendor_deduction of type `opening_balance_adjustment` or skip until approved policy).
- FDA binary re-upload can map Drive IDs later; staging accepts metadata rows.

---

## 4. Safety rules

1. Never write production until stage ≥ approved and a job runs.
2. Every production write is transactional and idempotent via `staging_row → production_id`.
3. Refresh/logout never loses project state (all in Postgres).
4. Import runs only via jobs, not long HTTP request bodies for the full set.
5. Rollback uses recorded production IDs / soft-delete where safe.
6. Financial phases never partial-commit without phase boundary + reconciliation.

---

## 5. Implemented surface (v1)

| Area | Location |
|---|---|
| Schema | `db/migrations/021_historical_migration_engine.sql` |
| Core libs | `lib/migration/*` |
| APIs | `app/api/migrations/**` |
| UI | `app/dashboard/data-management/**` |
| RBAC module | `historical_migrations` in permissions + migration seed |
| Nav | Sidebar → **Data Management** |
| Tests | `src/test/lib/migration-entities.test.ts` |

### Reuse map

- Monthly sales correction UI remains at `/dashboard/sales/import` (linked from wizard).
- Matching/pricing libraries remain source of truth for future sales-specific staging enrichment.
- Production writers for vendors/products/supermarkets/intakes/deliveries/returns/deductions/payouts/service charges/documents are in `lib/migration/writers.ts`.
- **All migrated vendors are `access_mode = admin_managed`** (no portal login; contact person / report delivery only). Login emails in source files are ignored.
- Opening balances stay staged until an explicit policy is approved (writer throws until enabled).

### How to run a migration

1. Apply DB migration: `npm run db:migrate`
2. Open **Data Management → Historical Migrations → New Migration**
3. Upload one or more `.xlsx` / `.xls` / `.csv` files
4. Assign entity types if auto-detect is wrong
5. Analyse → Validate → Correct → Preview → Approve → Start import
6. Progress survives refresh; click **Process next job chunk** or wait for auto-poll
7. Reconciliation report → optional full rollback
