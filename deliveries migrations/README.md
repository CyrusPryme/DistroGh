# Deliveries migration (local only)

This folder holds **local Excel workbooks** for the Palace / DistroGH deliveries historical migration. These files are **not committed to git** (see root `.gitignore`).

## Files

| File | Purpose |
|------|---------|
| `DELIVERIES_DISTRO_ MAIDEN.xlsx` | Original source export (153 rows, Palace SPINTEX) |
| `DELIVERIES_DISTRO_MAIDEN-FIXED.xlsx` | **158 rows** — original 153 + 5 supplemental from returns gaps (rose highlighted) |

## What the fix script does

Run from repo root:

```bash
npx tsx -r dotenv/config scripts/fix-deliveries-migration-file.ts dotenv_config_path=.env.local
```

| Fix | Detail |
|-----|--------|
| Dates | `"November 24, 2025"` → `2025-11-24` (Excel date cells) |
| Headers | Strips template ` *` markers; removes stray blank column |
| Product names | Aligns to production catalog via barcode |
| Returns gaps | Appends 5 delivery rows derived from `returns-MAIDEN-FIXED.xlsx` (rose highlight) |
| Sheet name | `Data` (matches migration template parser) |
| Admin review | Review legend sheet; row highlights when issues found (see below) |

Standard workflow: **[docs/MIGRATION-FIX-WORKBOOK.md](../docs/MIGRATION-FIX-WORKBOOK.md)** (`lib/migration/fix-workbook.ts`).

## Upload checklist

1. Open **Historical Migrations** → **DELIVERIES MAIDEN** (or create a new deliveries project).
2. Set entity type to **Deliveries** if not auto-detected.
3. Upload **`DELIVERIES_DISTRO_MAIDEN-FIXED.xlsx`** (not the original file).
4. Click **Parse files** — expect **153 rows**.
5. Run validation — expect **0 errors**; warnings for missing transport cost are normal for historical data.
6. Ensure **MAIDEN INTAKE** has completed before starting import (deliveries depend on intakes).

## Analysis scripts

```bash
npx tsx scripts/analyze-deliveries-migration-file.ts
npx tsx -r dotenv/config scripts/check-deliveries-migration.ts dotenv_config_path=.env.local
npx tsx scripts/inspect-deliveries-xlsx.ts "deliveries migrations/DELIVERIES_DISTRO_MAIDEN-FIXED.xlsx"
```

**Warning:** Double-check `DATABASE_URL` before running DB-connected scripts against production (Neon).
