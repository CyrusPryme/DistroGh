# Payouts historical migration (local only)

Local Excel workbooks and JSON state for importing **historical MoMo vendor payouts** in **multiple batches**. Not committed to git (see root `.gitignore`).

## Multi-batch workflow

1. Fill each batch using the same template columns (`payouts-TEMPLATE.xlsx` or copy from a prior batch).
2. Save as **`migration-payouts-template 1st.xlsx`**, **`2nd.xlsx`**, **`3rd.xlsx`**, etc. in this folder.
3. Validate, then import **one file at a time** (oldest pending file is picked automatically).

| Batch | Status |
|-------|--------|
| `migration-payouts-template 1st.xlsx` | ✅ Imported — 53 payouts |

Progress is tracked in `payouts-migration-state.json` (filenames already imported are skipped).

## Template columns

| Column | Required | Notes |
|--------|----------|--------|
| `vendor_name` | Yes | Must match production vendor name exactly |
| `amount_paid` | Yes | GHS actually sent via MoMo |
| `payout_date` | Yes | Date payment was made (ISO or Excel date) |
| `amount_due` | No | Defaults to `amount_paid` if blank |
| `week_start` / `week_end` | No | Payout week; default from `payout_date` |
| `status` | No | `completed` (default), `pending`, or `failed` |
| `transaction_id` | No | MoMo reference; auto `MIG-…` if blank |

**Important:** Only import **real payments** that happened. Empty trailing rows are skipped automatically.

## Scripts

From repo root with `.env.local` pointed at target DB:

```bash
# Generate empty template (vendor dropdown from production)
npx tsx -r dotenv/config scripts/generate-payouts-template.ts dotenv_config_path=.env.local

# Validate next pending batch (or a specific file)
npx tsx -r dotenv/config scripts/analyze-payouts-migration-file.ts dotenv_config_path=.env.local
npx tsx -r dotenv/config scripts/analyze-payouts-migration-file.ts dotenv_config_path=.env.local --file "payouts migration/migration-payouts-template 2nd.xlsx"

# Import next pending batch
npx tsx -r dotenv/config scripts/run-payouts-migration.ts dotenv_config_path=.env.local

# Import a specific file
npx tsx -r dotenv/config scripts/run-payouts-migration.ts dotenv_config_path=.env.local --file "payouts migration/migration-payouts-template 2nd.xlsx"
```

Each batch creates its own Historical Migration project in production. Cumulative totals are in `payouts-migration-state.json`.

**Warning:** Double-check `DATABASE_URL` before running against production.
