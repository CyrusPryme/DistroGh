# Discrepancy fix workbooks (local only)

Admin review spreadsheets generated from production cross-checks of **intakes → deliveries → sales → returns → supermarket_inventory** (Palace Spintex).

## Business rules

| Data | Rule |
|------|------|
| **Intakes** | Delivered warehouse history is authoritative — backfill missing receipts |
| **Spintex sales** | Authoritative — sold at Spintex means stock was there; missing Spintex delivery = overlooked record |
| **Palace cross-branch** | Deliveries to other Palace branches (`delivered_palace_other`) explain internal transfers — still add Spintex delivery rows for Spintex sales |
| **Shelf inventory** | Unsold delivered stock stays on shelf: `delivered − sold − returns` |

## Start here

**`DISCREPANCY-SUMMARY.xlsx`** — total vs **auto-fixed** vs **admin review** counts per category.

## Files

| File | Contents |
|------|----------|
| `DISCREPANCY-SUMMARY.xlsx` | Overview — start here |
| `*-FIX.xlsx` | All rows + **Review legend** (before/after examples) |
| `*-READY.xlsx` | **AUTO rows only** — safe to import/apply |

| Workbook | AUTO fix | ADMIN (highlighted) |
|----------|----------|---------------------|
| `INTAKE-GAPS` | Backfill/top-up when deliveries exceed recorded intake | Missing barcode or vendor |
| `DELIVERY-GAPS` | Add Spintex delivery for sold/returned qty not on Spintex delivery record | Missing barcode only |
| `INVENTORY-RECONCILE` | Set shelf stock after sales-authoritative delivery backfill | (none — all AUTO when computable) |
| `CHRONOLOGY` | Resolved by delivery/intake READY rows | Missing barcode blocks delivery |

Excel files are gitignored. Regenerate:

```bash
npx tsx -r dotenv/config scripts/generate-discrepancy-fix-workbooks.ts dotenv_config_path=.env.local
```

## Auto-fix rules

- **Intake backfill:** `gap = delivered − received`
- **Spintex delivery gap:** `gap = sold + returned − delivered_spintex` (sales authoritative)
- **Palace-other column:** context for internal branch transfers — does not remove Spintex delivery gap
- **Inventory:** `implied_expected_shelf` after delivery backfill; unsold stock stays on shelf

## Import order

1. `INTAKE-GAPS-READY.xlsx` (if any)
2. `DELIVERY-GAPS-READY.xlsx`
3. `INVENTORY-RECONCILE-READY.xlsx`
4. Regenerate to refresh remaining rows

Remove **`review_flag`**, **`fix_status`**, and context columns (`sold_spintex`, `delivered_palace_other`, etc.) before manual wizard upload — the import script strips these automatically.

## Import AUTO fixes to production

```bash
npx tsx -r dotenv/config scripts/run-discrepancy-fix-import.ts dotenv_config_path=.env.local --from-db --apply-ready
```

On success, `*-READY.xlsx` files are removed from this folder.
