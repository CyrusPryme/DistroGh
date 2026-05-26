# DistroGH — Consignment Distribution Management System

A Next.js app for Ghana distributors to track consignment sales, manage vendors, record mobile money payouts, and run weekly Excel imports.

---

## Tech stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS |
| Database | PostgreSQL (local Docker or any hosted Postgres) |
| Auth | Custom session (JWT cookie + bcrypt passwords in Postgres) |
| Forms | React Hook Form + Zod |
| Excel | SheetJS (xlsx) |
| Charts | Recharts |

**Not used:** Supabase Auth or the Supabase JS client. Older docs mentioning Supabase are obsolete.

---

## Quick start (local)

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
```

### 3. Database (Docker)

```bash
npm run db:setup
```

This runs Postgres (`docker compose`), applies migrations in `db/migrations/`, and seeds demo data.

Optional: [Adminer](http://localhost:8080) is included for browsing the DB.

### 4. Run the app

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Demo logins (after seed)

| Role | Email | Password |
|------|-------|----------|
| Admin | `admin@example.com` | `password123` |
| Vendor | `gorce@vendor.com` | `password123` |

Change these before any real deployment.

---

## Database

- **Schema:** SQL files in `db/migrations/` (run via `npm run db:migrate`)
- **Seed:** `npm run db:seed` (demo vendors, products, sales, users)
- **Scripts:** `npm run db:up` / `db:down` for Docker only

Main concepts: vendors, products (`vendor_price` + `distrogh_markup`), sales, returns, payouts, vendor deductions (admin-only), annual service charge on vendors.

---

## Pricing model (important)

Per product:

- **Vendor price** — agreed with the vendor; they earn `qty × vendor_price`
- **DistroGH markup** — admin profit per unit (`qty × distrogh_markup`)
- **Shop price** — vendor price + markup (what supermarkets pay per unit)

```
shop_price = vendor_price + distrogh_markup
total_sales = qty × shop_price
vendor_due = qty × vendor_price
markup = qty × distrogh_markup
```

Vendor-facing screens show **agreed price / vendor due only**, not markup or admin deductions.

---

## Excel import

Expected columns (case-insensitive): product name, quantity, price.

Products must already exist in the catalog. Import runs from **Dashboard → Sales → Import Excel** (admin only).

---

## Auth & security

- Login: `POST /api/auth/login` checks `users.password_hash` with bcrypt
- Session: HTTP-only cookie signed with `AUTH_SECRET` (see `middleware.ts`, `lib/auth/session.ts`)
- Roles: `admin` and `vendor` (via `profiles` + `vendor_id`)
- API routes use `requireSession()` / `requireAdminSession()` in `lib/auth/require.ts`

**Do not commit:** `.env.local`, `uploads/` (FDA files), `node_modules/`, `.next/`

---

## Useful commands

| Command | Purpose |
|---------|---------|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run db:setup` | Docker + migrate + seed |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:seed` | Load demo data |

---

## Project layout (high level)

```
app/
  api/              # REST API routes
  dashboard/        # Admin & vendor UI
  login/
components/
lib/
  auth/             # Session & guards
  db.ts             # Postgres pool
  product-pricing.ts
  vendor-service-charge.ts
services/           # Client API wrappers
db/migrations/      # SQL migrations
scripts/            # migrate, seed, utilities
```

---

## Production notes

1. Use a managed Postgres (Neon, Railway, RDS, etc.) and set `DATABASE_URL`
2. Set a strong `AUTH_SECRET` and `NEXT_PUBLIC_APP_URL`
3. Run migrations on deploy (`npm run db:migrate`)
4. **FDA certificates** — stored in Google Drive (not local disk). Set `GOOGLE_SERVICE_ACCOUNT_JSON` and `GOOGLE_DRIVE_FDA_FOLDER_ID`; share the folder with the service account email. Uploads update Postgres with dates + a Drive view link (no in-app preview — opens in Drive for speed).
5. Run `npm run build` before deploy

Deploy targets: Vercel/Railway/Fly for the Next app + separate Postgres; or a VPS with Docker.

---

## Pushing to GitHub

Your repo’s **local** `.gitignore` controls what gets committed when you push. Choosing “no template” on GitHub only means GitHub did not add an extra ignore file to an empty repo — it is **not a problem** if this project already has `.gitignore` (it does).

Before the first push:

```bash
git check-ignore -v .env.local   # should list .gitignore
npm run build
git add .
git status                       # confirm .env.local is not staged
git commit -m "Initial commit"
git push -u origin main
```

---

## License / support

Private business software. For issues, use your team’s issue tracker or contact your developer.
