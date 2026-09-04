# Returns migration (local only)

| File | Purpose |
|------|---------|
| `returns-NEW_corrected (1).xlsx` | Original source |
| `returns-MAIDEN-FIXED.xlsx` | **Admin review file** — branch fixed, rows highlighted |

## Highlighting in `returns-MAIDEN-FIXED.xlsx`

The fix script auto-corrects return dates that precede delivery using delivery-file chronology (sibling returns, year typo +365d, or median delivery→return lag). Adjusted rows record the change in **`notes`**.

After review, remove the `review_flag` column before upload (if present).

See **[docs/MIGRATION-FIX-WORKBOOK.md](../docs/MIGRATION-FIX-WORKBOOK.md)** for the standard fix workflow used across all migration entities.

## Regenerate

```bash
npx tsx -r dotenv/config scripts/fix-returns-migration-file.ts dotenv_config_path=.env.local
```
