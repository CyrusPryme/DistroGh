# Regeneration scripts catalog

Single reference for all **regenerate / re-run** commands. Windows: use **`scripts/REGENERATE.ps1`**. Bash: copy commands from sections below.

```powershell
# List all labeled commands
.\scripts\REGENERATE.ps1 -List

# Run one regen by name
.\scripts\REGENERATE.ps1 -Run DeliveriesFix
.\scripts\REGENERATE.ps1 -Run DiscrepancyWorkbooks
```

Always verify **`DATABASE_URL`** in `.env.local` before any DB-connected command.

Standard runner prefix:

```bash
npx tsx -r dotenv/config scripts/<script>.ts dotenv_config_path=.env.local
```

---

## Local workbook regen (safe — gitignored output folders)

### `DeliveriesFix` — `fix-deliveries-migration-file.ts`

**Output:** `deliveries migrations/DELIVERIES_DISTRO_MAIDEN-FIXED.xlsx`

Rebuilds the Palace deliveries admin review file from the source export. Normalizes dates to Excel date cells, sets branch **SPINTEX**, aligns product names to the production catalog, appends 5 supplemental rows from the returns file for products missing from deliveries, and adds rose highlights + Review legend + `review_flag`.

```bash
npx tsx -r dotenv/config scripts/fix-deliveries-migration-file.ts dotenv_config_path=.env.local
```

---

### `ReturnsFix` — `fix-returns-migration-file.ts`

**Output:** `returned migration/returns-MAIDEN-FIXED.xlsx`

Rebuilds the returns admin review file. Sets **SPINTEX**, normalizes dates, aligns catalog names, auto-fixes return dates that precede delivery (sibling return / +365d year typo / median delivery→return lag), flags remaining issues.

```bash
npx tsx -r dotenv/config scripts/fix-returns-migration-file.ts dotenv_config_path=.env.local
```

---

### `SalesFix` — `fix-sales-migration-file.ts`

**Output:** `sales migration/migration-sales-FIXED.xlsx`

Converts Palace `DD-MM-YYYY` dates to `YYYY-MM-01`, sets `store_name` from **BRANCH** for supermarket matching. Legacy script (no highlight/legend sheet yet).

```bash
npx tsx scripts/fix-sales-migration-file.ts
```

---

### `DiscrepancyWorkbooks` — `generate-discrepancy-fix-workbooks.ts`

**Output:** `discrepancies fix/` (open **DISCREPANCY-SUMMARY.xlsx** first)

Cross-checks production intakes → deliveries → sales → returns → `supermarket_inventory` for Palace Spintex. Classifies each row as **AUTO** (safe fix) or **ADMIN REVIEW** (highlighted):

| File | Purpose |
|------|---------|
| `DISCREPANCY-SUMMARY.xlsx` | Overview: total / auto / admin counts + fix order |
| `*-FIX.xlsx` | All rows (AUTO + highlighted ADMIN) |
| `*-READY.xlsx` | AUTO rows only — safe to import/apply |
| `INTAKE-GAPS-*` | Warehouse receiving top-ups |
| `DELIVERY-GAPS-*` | Supplemental deliveries |
| `INVENTORY-RECONCILE-*` | Shelf inventory corrections |
| `CHRONOLOGY-FIX.xlsx` | Date ordering (AUTO resolved by READY delivery/intake rows) |

```bash
npx tsx -r dotenv/config scripts/generate-discrepancy-fix-workbooks.ts dotenv_config_path=.env.local
```

---

### `SalesHighlightMissing` — `highlight-missing-products.ts`

**Output:** `sales migration/migration-sales-NEEDS-PRODUCT-CORRECTION.xlsx`

Re-highlights only rows whose barcode is missing from production (red fill) for vendor product correction before phase 2 sales import.

```bash
npx tsx -r dotenv/config scripts/highlight-missing-products.ts dotenv_config_path=.env.local
```

---

## Production DB writes (not workbook regen — use deliberately)

---

### `DiscrepancyFixImport` — `run-discrepancy-fix-import.ts`

Imports AUTO rows from `discrepancies fix/*-READY.xlsx` into production: intakes + deliveries via Historical Migration pipeline, then sets `supermarket_inventory` from `INVENTORY-RECONCILE-READY.xlsx`. Idempotent via `discrepancy-import-state.json`.

```bash
npx tsx -r dotenv/config scripts/run-discrepancy-fix-import.ts dotenv_config_path=.env.local
```

---

### `SupplementalDeliveriesDb` — `import-supplemental-deliveries-from-returns.ts`

Inserts 5 gap delivery rows for Palace Spintex from the returns file. Auto-confirms and updates store inventory. **Idempotent** — skips barcodes that already have deliveries.

```bash
npx tsx -r dotenv/config scripts/import-supplemental-deliveries-from-returns.ts dotenv_config_path=.env.local
```

---

### `SalesImportPhase1` / `Phase2` / `Remaining` — `run-sales-migration.ts`

Full Historical Migration pipeline (parse → validate → approve → import → reconcile). Writes to production.

```bash
npx tsx -r dotenv/config scripts/run-sales-migration.ts phase1 dotenv_config_path=.env.local
npx tsx -r dotenv/config scripts/run-sales-migration.ts phase2 dotenv_config_path=.env.local
npx tsx -r dotenv/config scripts/run-sales-migration.ts remaining dotenv_config_path=.env.local
```

---

### `ReturnsImport` — `run-returns-migration.ts`

Builds clean upload workbook from `returns-MAIDEN-FIXED.xlsx` and runs full returns maiden import. Skip if already completed.

```bash
npx tsx -r dotenv/config scripts/run-returns-migration.ts dotenv_config_path=.env.local
```

---

## Recovery (production DB — fix stuck migration state)

### `ConfirmHistoricalDeliveries` — `confirm-historical-deliveries.ts`

Confirms all unconfirmed historical delivery runs and pushes quantities to `supermarket_inventory`.

```bash
npx tsx -r dotenv/config scripts/confirm-historical-deliveries.ts dotenv_config_path=.env.local
```

---

### `RecoverDeliveriesParse` — `recover-deliveries-parse.ts`

Cancels stuck parse job, re-parses the active deliveries file, re-validates staging. Use when wizard shows validated but **0 staging rows**.

```bash
npx tsx -r dotenv/config scripts/recover-deliveries-parse.ts dotenv_config_path=.env.local
```

---

## Analysis only (console — does not regenerate files)

| Script | What it prints |
|--------|----------------|
| `analyze-deliveries-migration-file.ts` | Local deliveries workbook structure |
| `analyze-returns-migration-file.ts` | Returns workbook + production cross-check |
| `analyze-sales-upload.ts` | Sales upload validation vs catalog |
| `analyze-stock-chain-discrepancies.ts` | Intakes/deliveries/sales/returns quantity gaps |
| `analyze-return-date-fixes.ts` | Return vs delivery date fix proposals |
| `check-deliveries-migration.ts` | Deliveries file vs production DB |

---

## Typical regen order after source data changes

1. `ReturnsFix`
2. `DeliveriesFix` (reads fixed returns for gap rows)
3. `DiscrepancyWorkbooks` (after imports, to refresh gap analysis)

Remove **`review_flag`** column from any migration upload sheet before Historical Migrations wizard import.
