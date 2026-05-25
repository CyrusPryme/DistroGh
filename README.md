# DistroGH — Consignment Distribution Management System

A production-grade Next.js 14 system for Ghana distributors to track consignment sales, manage vendor relationships, and process mobile money payouts.

---

## 🚀 Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript |
| Styling | TailwindCSS + custom design system |
| Components | shadcn/ui + custom |
| Database | Supabase (PostgreSQL) |
| Auth | Supabase Auth |
| Forms | React Hook Form + Zod |
| Excel Parse | SheetJS (xlsx) |
| Charts | Recharts |
| File Upload | react-dropzone |

---

## 📁 Project Structure

```
/app
  /dashboard          → KPI dashboard with charts
  /vendors            → Vendor list + detail pages
  /products           → Product catalog
  /sales              → Sales records with filters
  /sales/import       → Excel upload + preview + import
  /payouts            → Vendor payout management
  /reports            → Analytics and charts
  /login              → Auth page

/components
  /shared             → AppLayout (sidebar + nav)
  /dashboard          → KPICard
  /vendors            → VendorModal
  /products           → ProductModal

/lib
  utils.ts            → formatGHS, cn, dates, etc.
  excel-parser.ts     → SheetJS parser with product matching
  validations.ts      → Zod schemas

/services
  vendor.service.ts   → Vendor CRUD + balance queries
  product.service.ts  → Product CRUD
  sales.service.ts    → Sales queries + aggregations
  payout.service.ts   → Payout lifecycle management
  supermarket.service.ts

/supabase
  client.ts           → Browser Supabase client
  server.ts           → Server-side clients
  migrations.sql      → Full database schema + RLS

/types
  index.ts            → All TypeScript types
```

---

## ⚡ Quick Start

### 1. Clone and install

```bash
git clone <your-repo>
cd consignment-system
npm install
```

### 2. Set up Supabase

1. Create a project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor** and run the entire contents of `supabase/migrations.sql`
3. Enable **Email Auth** in Authentication → Providers
4. Create your admin user in Authentication → Users

### 3. Configure environment

```bash
cp .env.local.example .env.local
```

Edit `.env.local`:
```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

> **Where to find keys:** Supabase Dashboard → Project Settings → API

### 4. Run development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and sign in with your admin credentials.

---

## 🗄️ Database Setup

The `supabase/migrations.sql` file creates:

- **vendors** — Vendor registry with MoMo details
- **products** — Product catalog linked to vendors
- **supermarkets** — Retail outlet registry (5 Ghana locations pre-loaded)
- **sales** — Sales transaction records with computed totals
- **payouts** — Vendor payout lifecycle tracking

**Views created:**
- `vendor_balances` — Aggregated earnings vs payments per vendor
- `weekly_revenue` — Weekly sales rollup for reporting

**Row Level Security:** All tables are protected. Only authenticated users can access data.

---

## 📊 Excel Import Format

Expected columns (case-insensitive):

| Column | Required | Notes |
|--------|----------|-------|
| Product | ✅ | Must match product name in system |
| Qty | ✅ | Quantity sold |
| Price | ✅ | Unit selling price |

**Product name matching:**
- Exact match first
- Fuzzy substring match as fallback
- Unmatched products shown in preview but skipped

**Download a sample template** from the Import Sales page.

---

## 💰 Business Calculations

For each sale row:

```
total_sales = qty_sold × unit_price
commission_amount = total_sales × (commission_percent / 100)
vendor_due = total_sales - commission_amount
```

Commission percent is pulled from the product record at import time, ensuring vendor-specific rates are correctly applied.

---

## 📱 MoMo Payout Workflow

1. Import weekly Excel sales → system calculates `vendor_due`
2. Dashboard shows outstanding vendor balances
3. Admin navigates to **Payouts** → sees vendors with balance
4. Click **Pay Now** → system creates payout record
5. Admin processes via actual MoMo app
6. Returns to system → enters **MoMo Transaction ID**
7. Payout marked **Completed** → balance reconciled

**Bulk payout:** Create payout records for all vendors with outstanding balance in one click.

---

## 🎨 Design System

Ghana Fintech aesthetic:
- **Brand green:** `#16a34a` (Ghana forest green)
- **Ghana accent strip:** Green | Gold | Red tricolor
- **Typography:** Sora (display) + DM Sans (body) + JetBrains Mono (numbers)
- **Cards:** White, `rounded-xl`, subtle shadow
- **Background:** Warm slate-50

---

## 🔒 Security Notes

- All routes protected by middleware (redirects to `/login` if not authenticated)
- Supabase RLS policies ensure data isolation
- No service role key exposed client-side
- Form validation on both client (Zod) and encouraged server-side

---

## 🧩 Adding shadcn/ui Components

This project uses shadcn/ui component patterns. To add more:

```bash
npx shadcn@latest add <component>
```

---

## 🚢 Production Deployment

```bash
npm run build
npm start
```

Or deploy to **Vercel** (recommended):
1. Push to GitHub
2. Connect to Vercel
3. Add environment variables in Vercel dashboard
4. Deploy

---

## 📈 Extending the System

### Add a new supermarket
```typescript
import { supermarketService } from '@/services/supermarket.service'
await supermarketService.create({ name: 'Melcom Plus', location: 'Kumasi, Ashanti' })
```

### Add a product via API
```typescript
import { productService } from '@/services/product.service'
await productService.create({
  name: 'Indomie Onion 70g',
  vendor_id: 'uuid-here',
  selling_price: 1.80,
  commission_percent: 12,
})
```

---

## 🤝 Support

For bugs or feature requests, file an issue. For business customization, contact your development team.

---

*Built for real Ghana distribution businesses. Handles real money. Accuracy is non-negotiable.*
