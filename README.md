# DistroGH — Consignment Distribution Management System

A Next.js application for Ghana distributors to manage consignment operations end-to-end: vendor onboarding, product catalog, stock receiving, supermarket deliveries, weekly sales imports, returns, deductions, mobile money payouts, and full role-based access control.

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 16 (App Router, Turbopack) |
| Language | TypeScript (strict mode) |
| Styling | Tailwind CSS |
| Database | PostgreSQL (Neon / Docker / any hosted Postgres) |
| Auth | Custom JWT session (HTTP-only cookie + bcrypt) |
| Forms | React Hook Form + Zod |
| Excel | ExcelJS |
| Charts | Recharts |
| File storage | Google Drive API (FDA certificates) |

**Not used:** Supabase Auth or Supabase JS client.

---

## Quick Start (Local)

### 1. Install dependencies

```bash
git clone <your-repo-url>
cd consignment-system
npm install
```

### 2. Environment

```bash
cp .env.local.example .env.local
```

Edit `.env.local`:

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/consignment
AUTH_SECRET=use-a-long-random-string-in-production
NEXT_PUBLIC_APP_URL=http://localhost:3000

# Optional: Google Drive for FDA certificate uploads
GOOGLE_SERVICE_ACCOUNT_JSON=...
GOOGLE_DRIVE_FDA_FOLDER_ID=...
```

### 3. Database

```bash
npm run db:setup      # Docker + migrate + seed
# — or, for hosted Postgres —
npm run db:migrate    # apply pending migrations
npm run db:seed       # load demo data
```

### 4. Create Super Admin

```bash
# Set password in your environment first
$env:SUPER_ADMIN_PASS="YourPassword123!"
npm run db:seed:super-admin
```

### 5. Run the app

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Default logins (after seed)

| Role | Email | Password |
|------|-------|----------|
| Super Admin | `superadmin@distrogh.com` | *(set via seed script)* |
| Admin | `admin@example.com` | `password123` |
| Vendor | `gorce@vendor.com` | `password123` |

Change all credentials before any real deployment.

---

## Features & Modules

### Dashboard / Analytics
- KPI cards: total sales, vendors, pending payouts, returns
- Weekly revenue chart, top products, top supermarkets
- Pending delivery and payout alert badges in sidebar

### Vendor Management
- Create, edit, and soft-delete vendors
- Vendor status: `pending_verification` → `active` → `suspended`
- Per-vendor detail page: products, sales history, payouts, deductions, service charge
- FDA certificate upload to Google Drive with expiry tracking
- Vendor balance calculation (sales due − returns − deductions − paid payouts)
- Admin-managed vs. self-service vendor access modes
- Annual service charge lifecycle: unpaid → active → expiring soon → grace period → overdue

### Vendor Applications
- Public application form (no login required)
- Admin review, approve (auto-creates vendor + login), or reject
- Email uniqueness check before submission

### Vendor Deactivation Requests
- Vendors can request account deactivation from their portal
- Admins approve or reject with notes

### Products & Categories
- Product catalog with vendor association, pricing, SKU, barcode, packaging
- Wholesale price, mall retail price, MOQ fields
- Product image support (paths)
- Category management
- Integrity check for pricing inconsistencies

### Sales
- Weekly sales records linked to products and supermarkets
- Admin: view all; vendor: view own
- Filter by vendor, supermarket, date range
- Recent sales feed

### Sales Import (CSV/Excel)
- Import supermarket sales export files (Palace format and others)
- Product matching by barcode/SKU then name
- Preview before committing, with per-row warnings
- Missing product shortcut: pre-fill Add Product form from spreadsheet row
- Import history log

### Returns
- Record returned/defective items per product per supermarket
- Reasons: expired, defective product, defective packaging, other
- Admin records; vendor views own returns

### Receiving (Stock Intakes)
- Record stock received from vendors into warehouse
- On-hand stock tracking per product
- Vendor read-only view of their own receiving history

### Deliveries
- Create delivery runs: assign products + quantities to a supermarket
- Server-side stock validation (prevents delivering more than on hand)
- Confirm delivery: updates supermarket inventory
- **Transport cost allocation**: auto-split delivery cost across vendors by quantity delivered
- Editable cost split before confirming — adjust total cost and per-vendor amounts
- Confirmed delivery triggers vendor deductions for their allocated transport share
- Pending delivery count badge in sidebar

### Supermarkets & Store Stock
- Supermarket/outlet management with branch support
- Store stock view: live inventory per product per supermarket
- Supermarket summary stats

### Payouts
- Generate vendor payouts from outstanding balance
- Partial payment support with running balance
- Mobile money transaction ID recording (MoMo)
- Payout status: pending → processing → completed / failed
- Transactional safety: `SELECT FOR UPDATE` prevents race conditions and overpayments
- Pending payout alert count in sidebar
- Bulk payout creation for all vendors with outstanding balances

### Deductions
- Manual vendor deductions (admin-only)
- Automatic deductions from delivery transport charges
- Delivery run reference tracking per deduction

### Reports
- Vendor performance, sales trends, weekly revenue breakdown
- Top-performing products and supermarkets
- Printable/exportable report views

### Settings
- System-wide commission defaults
- Category management
- Product pricing configuration

### Support
- Contact/support panel accessible to both admins and vendors

### Vendor Portal (vendor-only pages)
- Personal dashboard with sales summary
- Payout history and balance
- Period statement (sales, returns, payouts by date range)
- Delivery status by supermarket (confirmed runs only)
- Profile update (contact details, company info)
- Request account deactivation
- Service charge status and payment banner

---

## Role-Based Access Control (RBAC)

### Roles

| Role | Description |
|------|-------------|
| `super_admin` | Full unrestricted access. Manages admin accounts and permissions. |
| `admin` | Standard administrator. Permissions configured individually. |
| `user` | Staff member. Read-only or limited access per assigned permissions. |
| `vendor` | Vendor portal access only (own data). |

### Permission Actions

`read` · `create` · `update` · `delete` · `export` · `approve` · `manage`

### Permission Modules (23 total)

**Core:** Dashboard, Vendors, Products, Categories, Sales, Sales Import, Returns, Receiving, Deliveries, Supermarkets, Store Stock

**Finance:** Payouts, Deductions, Reports

**Vendors:** Vendor Applications, Deactivation Requests, Vendor Documents, Service Charges

**System:** Settings, Support

**Administration:** Admin Accounts, Roles & Permissions, Audit Logs *(super_admin only)*

### How Permissions Work

1. Each admin/user has an individual permission set stored in `admin_user_permissions`
2. When creating an account, permissions default to the role template or a chosen preset
3. `super_admin` bypasses all permission checks (all permissions implicit)
4. Permissions are embedded in the JWT session cookie at login for zero-latency checks
5. Enforcement happens at **four layers**: middleware, API routes, server actions, and UI

### Role Presets

| Preset | Description |
|--------|-------------|
| Full Admin | All non-administration modules and actions |
| Operations Admin | Vendors, products, receiving, deliveries, supermarkets |
| Finance Admin | Payouts, deductions, reports, service charges |
| Sales Admin | Sales, imports, returns, reporting |
| Read Only User | Dashboard, sales, reports, supermarkets (read only) |

---

## Administration (Super Admin Only)

Accessible via **Administration** section in sidebar, visible only to super admins.

### Admin Accounts (`/dashboard/administration/admin-accounts`)
- Create, edit, suspend, reactivate, soft-delete admin/user accounts
- Fields: first name, last name, email, phone, role, status, notes, password
- Inline permission matrix editor per account
- Quick-apply role presets
- View last login, account status
- Search and filter by role/status

### Roles & Permissions (`/dashboard/administration/roles-permissions`)
- Visual permission matrix showing defaults per role
- Preset reference with descriptions
- Copy permission list to clipboard

### Audit Logs (`/dashboard/administration/audit-logs`)
- Full activity trail: login, logout, account changes, delivery confirmations, payout approvals
- Search by actor, action, module
- Filter by module, action, date range
- Paginated with 50 entries per page
- One-click CSV export
- Expandable metadata view per log entry

### Tracked Audit Events
`login` · `logout` · `create_admin_account` · `update_admin_account` · `delete_admin_account` · `reset_password` · `delivery_confirmed` · and more

---

## Database

- **Schema:** 19 migration files in `db/migrations/` (run via `npm run db:migrate`)
- **Seed:** `npm run db:seed` (demo vendors, products, sales, users)
- **Super admin seed:** `npm run db:seed:super-admin`

### Core Tables

| Table | Purpose |
|-------|---------|
| `users` | Login credentials |
| `profiles` | Role binding (admin / vendor) |
| `admin_profiles` | Admin/user extended profile with sub-role and status |
| `admin_user_permissions` | Per-user module×action grants |
| `roles` | Role definitions |
| `permissions` | Module×action catalogue |
| `role_permissions` | Default permission templates per role |
| `audit_logs` | Activity trail |
| `vendors` | Vendor master records |
| `products` | Product catalog |
| `sales` | Weekly sales records |
| `product_returns` | Return/defective records |
| `intakes` | Stock receiving records |
| `delivery_runs` | Delivery runs to supermarkets |
| `delivery_run_items` | Products in a delivery run |
| `delivery_run_vendor_charges` | Per-vendor transport cost allocation |
| `supermarkets` | Outlet registry |
| `supermarket_inventory` | Current stock per product per outlet |
| `payouts` | Vendor payout records |
| `vendor_deductions` | Individual deductions from vendor balance |
| `vendor_applications` | Onboarding applications |

---

## Pricing Model

Per product:

- **Vendor price** — agreed price; vendor earns `qty × vendor_price`
- **DistroGH markup** — DistroGH profit per unit (`qty × distrogh_markup`)
- **Shop price** — what supermarkets pay (`vendor_price + distrogh_markup`)

```
shop_price    = vendor_price + distrogh_markup
total_sales   = qty × shop_price
vendor_due    = qty × vendor_price
distrogh_cut  = qty × distrogh_markup
```

Vendor-facing screens show **vendor due only** — markup and admin deductions are never exposed.

---

## Transport Cost Allocation

When confirming a delivery run, the `total_transport_cost` is split across vendors proportionally by units delivered:

```
vendor_share% = vendor_units / total_units × 100
vendor_charge = total_transport_cost × vendor_share%
```

Admins can override both the total cost and individual vendor amounts before confirming. The allocated amounts must sum to the total before confirmation is allowed. Each allocation creates a `vendor_deduction` record that is deducted from the vendor's next payout.

---

## Auth & Security

- Login: `POST /api/auth/login` — verifies `password_hash` with bcrypt, checks admin suspension
- Session: HTTP-only JWT cookie signed with `AUTH_SECRET` (7-day expiry)
- JWT payload: `user_id`, `email`, `role`, `admin_role`, `permissions[]`, `vendor_id`
- Middleware: edge-level route protection, super_admin administration path guard
- API guards: `requireSession()`, `requireAdminSession()`, `requireSuperAdmin()`, `requirePermission(module, action)`
- Permission helper: `hasPermission(session, module, action)` — `super_admin` always returns true

**Never commit:** `.env.local`, `uploads/`, `node_modules/`, `.next/`

---

## Useful Commands

| Command | Purpose |
|---------|---------|
| `npm run dev` | Development server (Turbopack) |
| `npm run build` | Production build |
| `npm run db:setup` | Docker + migrate + seed |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:seed` | Load demo data |
| `npm run db:seed:super-admin` | Create initial super admin account |
| `npm run test` | Run unit tests (Vitest) |
| `npm run test:run` | Run tests once (CI mode) |

---

## Project Layout

```
app/
  api/
    admin/            # Super-admin management APIs (users, roles, audit-logs)
    auth/             # Login / logout
    deliveries/       # Delivery run APIs + charge allocation
    payouts/          # Payout management
    vendors/          # Vendor CRUD + balance + service charge
    …                 # Sales, returns, intakes, supermarkets, etc.
  dashboard/
    administration/   # Super-admin pages (admin-accounts, roles-permissions, audit-logs)
    deliveries/       # Delivery runs UI
    payouts/          # Payout management UI
    vendors/          # Vendor list + detail
    …                 # All other admin pages
    vendor/           # Vendor portal pages
  login/
  (landing)/
components/
  shared/             # AppLayout, FormModal, PageToast, etc.
  vendors/            # Vendor-specific components
lib/
  auth/               # session.ts, require.ts, permissions.ts
  rbac/               # audit.ts
  delivery-charges.ts
  delivery-cost-allocation.ts
  vendor-service-charge.ts
  utils.ts
services/             # Client-side API wrappers
db/migrations/        # SQL migration files (001–019)
scripts/              # db-migrate, db-seed, seed-super-admin
types/                # Shared TypeScript types
```

---

## Production Deployment

1. Use a managed Postgres (Neon, Railway, RDS) and set `DATABASE_URL`
2. Set a strong `AUTH_SECRET` (32+ random characters)
3. Set `NEXT_PUBLIC_APP_URL` to your domain
4. Run `npm run db:migrate` on deploy
5. Run `npm run db:seed:super-admin` once with a secure password
6. For FDA certificates: set `GOOGLE_SERVICE_ACCOUNT_JSON` and `GOOGLE_DRIVE_FDA_FOLDER_ID`; share the Drive folder with the service account email
7. Run `npm run build` before deploying

**Deploy targets:** Vercel / Railway / Fly.io for the Next.js app + separate managed Postgres.

---

## License / Support

Private business software. For issues, use your team's issue tracker or contact your developer.
