# Scripts

Operational and one-off utilities. Most DB scripts load `.env.local` via `dotenv/config`.

## Database (routine)

| Script | npm command | Description |
|--------|-------------|-------------|
| `db-migrate.mjs` | `npm run db:migrate` | Apply pending SQL migrations |
| `db-seed.mjs` | `npm run db:seed` | Load demo seed data |
| `db-clear-operational.mjs` | `npm run db:clear-operational` | Wipe operational data (destructive) |
| `seed-super-admin.mjs` | `npm run db:seed:super-admin` | Create initial super admin |
| `seed-developer.mjs` | `npm run db:seed:developer` | Create developer account |

## Sales migration (one-off)

Requires local workbooks under `sales migration/` — see that folder’s README.

| Script | Description |
|--------|-------------|
| `run-sales-migration.ts` | Phase 1 / 2 / remaining Palace sales import runner |
| `fix-sales-migration-file.ts` | Workbook normalization helpers |
| `analyze-sales-upload.ts` | Inspect upload columns and row counts |
| `analyze-palace-sales.mjs` | Palace sheet analysis |
| `list-unmatched-sales-products.ts` | Barcodes missing from catalog |
| `highlight-missing-products.ts` | Mark rows needing product fixes |
| `check-migration-status.ts` | Migration project status snapshot |
| `verify-migration-production.mjs` | Post-import verification |

## Migration fix workbooks (standard method)

**Doc:** [docs/MIGRATION-FIX-WORKBOOK.md](../docs/MIGRATION-FIX-WORKBOOK.md)  
**Shared lib:** `lib/migration/fix-workbook.ts`

Normalize source Excel → `*-FIXED.xlsx` with optional row highlights + `review_flag` + Review legend sheet for admin corrections.

| Entity | Analyze | Fix |
|--------|---------|-----|
| Deliveries | `analyze-deliveries-migration-file.ts` | `fix-deliveries-migration-file.ts` |
| Returns | `analyze-returns-migration-file.ts` | `fix-returns-migration-file.ts` |
| Sales | `analyze-sales-upload.ts` | `fix-sales-migration-file.ts` (extend with highlight pattern when re-run) |

Recovery / one-off: `recover-deliveries-parse.ts`, `confirm-historical-deliveries.ts`, `import-supplemental-deliveries-from-returns.ts`

## Samples / dev

| Script | npm command | Description |
|--------|-------------|-------------|
| `generate-sample-sales.mjs` | `npm run generate:sample-sales` | Sample sales Excel |
| `generate-static-sample.mjs` | `npm run generate:static-sample` | Static sample data |
| `check-migration-032.mjs` | — | One-off migration 032 check |
| `analyze-migration.mjs` | — | General migration analysis |

Run TypeScript scripts with:

```bash
npx tsx -r dotenv/config scripts/<name>.ts dotenv_config_path=.env.local
```
