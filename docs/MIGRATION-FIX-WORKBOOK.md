# Migration fix workbook workflow

Standard method for preparing historical migration Excel files before upload. Used for **deliveries**, **returns**, and future entity fixes (sales, intakes, etc.).

## Output file pattern

| Item | Convention |
|------|------------|
| Folder | `<entity> migration/` or `returned migration/` (local only, gitignored) |
| Output name | `<ENTITY>-MAIDEN-FIXED.xlsx` |
| Script | `scripts/fix-<entity>-migration-file.ts` |
| Analysis | `scripts/analyze-<entity>-migration-file.ts` |

## What every fix script does

1. **Parse** source workbook via `parseWorkbook()` (same parser as the wizard).
2. **Normalize** data programmatically:
   - Dates → ISO `YYYY-MM-DD` Excel date cells
   - Branch / supermarket fields (e.g. `SPINTEX` for Palace Spintex)
   - Product names from production catalog via barcode
   - Drop or flag unrecoverable rows
3. **Cross-check** against production DB when `DATABASE_URL` is set.
4. **Flag rows** that need human review — do not silently drop ambiguous data.
5. **Write** `*-FIXED.xlsx` via `writeFixedMigrationWorkbook()` in `lib/migration/fix-workbook.ts`.

## Admin review workbook structure

### Data sheet
- All migration template columns (normalized)
- Optional **`review_flag`** column (plain-English issue description)
- Row background fills for flagged rows

### Review legend sheet
- Color key + meaning + required admin action

### Highlight colors (standard)

| Fill | Use for | Example |
|------|---------|---------|
| **Amber** | Date / chronology issue | Return before earliest delivery |
| **Rose** | Missing prerequisite in production | Product never delivered |
| **Both** | Two issue classes on one row | Rare overlap |
| **Red** | Hard blocker | Missing barcode in catalog |

## Admin handoff

1. Open `*-FIXED.xlsx`.
2. Fix all highlighted rows (use `review_flag` text).
3. **Delete the `review_flag` column** before upload (parser ignores it, but keeps the file clean).
4. Upload to Historical Migrations wizard → Parse → Validate → Import.

## Implementing a new fix script

```typescript
import {
  buildReviewFlag,
  loadCatalogByBarcode,
  migrationStr,
  printFixSummary,
  writeFixedMigrationWorkbook,
  type MigrationReviewHighlight,
  type MigrationReviewLegendRow,
} from '@/lib/migration/fix-workbook'

const LEGEND: MigrationReviewLegendRow[] = [
  {
    colorLabel: 'Amber (yellow)',
    meaning: '…',
    adminAction: '…',
  },
]

// Build fixed rows + attach review_flag in getHighlight
await writeFixedMigrationWorkbook({
  outputPath: OUTPUT,
  dataColumns: ['product_name', 'quantity', …],
  dateColumns: ['return_date'],
  rows: fixedRows,
  legend: LEGEND,
  getHighlight: (row) => { … return { kind: 'amber', reviewFlag: buildReviewFlag('FIX DATE', detail) } },
  columnWidths: { product_name: 42, barcode: 16 },
})

printFixSummary({ title: 'RETURNS FIX SUMMARY', … })
```

## Existing scripts

| Entity | Fix script | Fixed output |
|--------|------------|--------------|
| Deliveries | `fix-deliveries-migration-file.ts` | `deliveries migrations/DELIVERIES_DISTRO_MAIDEN-FIXED.xlsx` |
| Returns | `fix-returns-migration-file.ts` | `returned migration/returns-MAIDEN-FIXED.xlsx` |
| Sales | `fix-sales-migration-file.ts` | (predates highlight pattern — extend when re-run) |

Run any fix script:

```bash
npx tsx -r dotenv/config scripts/fix-<entity>-migration-file.ts dotenv_config_path=.env.local
```

**Always verify `DATABASE_URL`** points at the intended database before running DB-connected fixes.
