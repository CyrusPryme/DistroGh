# Sales migration (local only)

This folder holds **local Excel workbooks and JSON state** for one-off Palace sales migration runs. These files are **not committed to git** (see root `.gitignore`).

## Expected files (create or restore locally)

| File | Purpose |
|------|---------|
| `migration-sales-FIXED.xlsx` | Full corrected source workbook |
| `migration-sales-PHASE1.xlsx` | Rows ready for first import pass |
| `migration-sales-PHASE2.xlsx` | Rows deferred until catalog gaps fixed |
| `migration-sales-NEEDS-PRODUCT-CORRECTION.xlsx` | Rows blocked on missing/wrong products |
| `migration-sales-REMAINING.xlsx` | Residual rows after partial runs |
| `migration-state.json` | Script checkpoint / progress state |

## Scripts

Run from repo root with `.env.local` pointing at the target database:

```bash
# Phase 1 — ready rows
npx tsx -r dotenv/config scripts/run-sales-migration.ts phase1 dotenv_config_path=.env.local

# Phase 2 — deferred rows (after catalog fixes)
npx tsx -r dotenv/config scripts/run-sales-migration.ts phase2 dotenv_config_path=.env.local

# Remaining blocked rows
npx tsx -r dotenv/config scripts/run-sales-migration.ts remaining dotenv_config_path=.env.local
```

Helper scripts: `scripts/analyze-sales-upload.ts`, `scripts/list-unmatched-sales-products.ts`, `scripts/highlight-missing-products.ts`.

**Warning:** Double-check `DATABASE_URL` before running against production (Neon).
