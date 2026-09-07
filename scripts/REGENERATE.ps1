# =============================================================================
# REGENERATE.ps1 — Palace / DistroGH migration & discrepancy regeneration catalog
# =============================================================================
#
# Run from repo root:
#   .\scripts\REGENERATE.ps1 -List                    # show all commands
#   .\scripts\REGENERATE.ps1 -Run DeliveriesFix       # run one regen by name
#
# Most commands load DATABASE_URL from .env.local (production Neon when pointed there).
# Double-check .env.local before any command that touches the database.
#
# Workbook regens write to local gitignored folders only.
# Import/run commands WRITE TO PRODUCTION — use only when you mean to import.
# =============================================================================

param(
    [Parameter()]
    [ValidateSet(
        'DeliveriesFix',
        'ReturnsFix',
        'SalesFix',
        'DiscrepancyWorkbooks',
        'DiscrepancyFixImport',
        'SalesHighlightMissing',
        'SupplementalDeliveriesDb',
        'SalesImportPhase1',
        'SalesImportPhase2',
        'SalesImportRemaining',
        'ReturnsImport',
        'ConfirmHistoricalDeliveries',
        'RecoverDeliveriesParse',
        'List'
    )]
    [string]$Run = 'List'
)

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
$env:DOTENV_CONFIG_PATH = '.env.local'

# -----------------------------------------------------------------------------
# REGEN: Migration fix workbooks (local Excel — safe to re-run anytime)
# -----------------------------------------------------------------------------

function Regen-DeliveriesFix {
    <#
    LABEL: Deliveries fix workbook
    OUTPUT: deliveries migrations/DELIVERIES_DISTRO_MAIDEN-FIXED.xlsx
    READS:  deliveries migrations/DELIVERIES_DISTRO_ MAIDEN.xlsx
            returned migration/returns-MAIDEN-FIXED.xlsx (for gap rows)
    DOES:
      - Normalizes delivery_date to ISO Excel date cells
      - Sets branch SPINTEX on all rows
      - Aligns product names to production catalog (via barcode)
      - Appends supplemental delivery rows for products that only appeared in returns
      - Rose-highlights gap rows + Review legend + review_flag column
    #>
    npx tsx -r dotenv/config scripts/fix-deliveries-migration-file.ts dotenv_config_path=.env.local
}

function Regen-ReturnsFix {
    <#
    LABEL: Returns fix workbook
    OUTPUT: returned migration/returns-MAIDEN-FIXED.xlsx
    READS:  returned migration/returns-NEW_corrected (1).xlsx
            deliveries migrations/DELIVERIES_DISTRO_MAIDEN-FIXED.xlsx (delivery dates)
    DOES:
      - Sets branch SPINTEX, normalizes return_date Excel dates
      - Aligns product names to catalog
      - Auto-fixes return dates before earliest delivery (sibling/year-typo/median-lag)
      - Flags remaining issues (amber/rose) + Review legend + review_flag
    #>
    npx tsx -r dotenv/config scripts/fix-returns-migration-file.ts dotenv_config_path=.env.local
}

function Regen-SalesFix {
    <#
    LABEL: Sales fix workbook
    OUTPUT: sales migration/migration-sales-FIXED.xlsx
    READS:  sales migration/migration-sales-template UPDATED.xlsx (or source in script)
    DOES:
      - Converts DD-MM-YYYY report_month to YYYY-MM-01
      - Sets store_name from BRANCH column (Palace outlet matching)
      - Does NOT use the full highlight/legend pattern yet (legacy script)
    #>
    npx tsx scripts/fix-sales-migration-file.ts
}

function Regen-DiscrepancyWorkbooks {
    <#
    LABEL: Stock-chain discrepancy fix workbooks
    OUTPUT: discrepancies fix/*.xlsx (8 files — start with DISCREPANCY-SUMMARY.xlsx; *-READY.xlsx = auto-only)
    READS:  production DB (Palace Spintex intakes/deliveries/sales/returns/inventory)
    DOES:
      - INTAKE-GAPS-FIX.xlsx — warehouse receiving rows to add (delivered > received)
      - DELIVERY-GAPS-FIX.xlsx — delivery rows when sales/returns exceed Spintex deliveries
      - INVENTORY-RECONCILE-FIX.xlsx — shelf inventory corrections
      - CHRONOLOGY-FIX.xlsx — date ordering issues with suggested fixes
      - Each sheet: review_flag, rose/amber highlights, Review legend
    #>
    npx tsx -r dotenv/config scripts/generate-discrepancy-fix-workbooks.ts dotenv_config_path=.env.local
}

function Regen-SalesHighlightMissing {
    <#
    LABEL: Sales product-correction workbook
    OUTPUT: sales migration/migration-sales-NEEDS-PRODUCT-CORRECTION.xlsx
    READS:  sales migration/migration-sales-template UPDATED.xlsx + production catalog
    DOES:
      - Highlights ONLY rows whose barcode is missing from production (red fill)
      - For sending to vendor/admin to fix product codes before phase 2 import
    #>
    npx tsx -r dotenv/config scripts/highlight-missing-products.ts dotenv_config_path=.env.local
}

# -----------------------------------------------------------------------------
# REGEN + DB: Supplemental data (writes to production — idempotent where noted)
# -----------------------------------------------------------------------------

function Run-DiscrepancyFixImport {
    <#
    LABEL: Discrepancy AUTO fixes → production DB
    OUTPUT: Historical migration project + supermarket_inventory updates
    READS:  discrepancies fix/*-READY.xlsx
    DOES:   intakes + deliveries via migration pipeline; inventory adjustments
    NOTE:    Idempotent via discrepancy-import-state.json
    #>
    npx tsx -r dotenv/config scripts/run-discrepancy-fix-import.ts dotenv_config_path=.env.local
}

function Regen-SupplementalDeliveriesDb {
    <#
    LABEL: Supplemental deliveries → production DB
    OUTPUT: (none — inserts into delivery_runs / delivery_run_items)
    READS:  returned migration/returns-MAIDEN-FIXED.xlsx
    DOES:
      - Inserts 5 gap delivery rows for Palace Spintex (products in returns but not deliveries)
      - Auto-confirms runs (updates supermarket_inventory)
      - IDEMPOTENT — skips barcodes that already have a delivery
    #>
    npx tsx -r dotenv/config scripts/import-supplemental-deliveries-from-returns.ts dotenv_config_path=.env.local
}

# -----------------------------------------------------------------------------
# IMPORT: Full migration pipeline (production DB — NOT a workbook regen)
# -----------------------------------------------------------------------------

function Run-SalesImportPhase1 {
    <#
    LABEL: Sales migration phase 1 import
    OUTPUT: Historical migration project in production + migration-state.json
    READS:  sales migration/migration-sales-FIXED.xlsx (excludes 22 missing barcodes)
    DOES:   Creates project → parse → validate → approve → import → reconcile
    NOTE:    Skip if phase 1 already completed (check migration-state.json)
    #>
    npx tsx -r dotenv/config scripts/run-sales-migration.ts phase1 dotenv_config_path=.env.local
}

function Run-SalesImportPhase2 {
    <#
    LABEL: Sales migration phase 2 import
    READS:  sales migration/migration-sales-NEEDS-PRODUCT-CORRECTION.xlsx
    DOES:   Imports rows whose barcodes now exist in catalog (after product fixes)
    #>
    npx tsx -r dotenv/config scripts/run-sales-migration.ts phase2 dotenv_config_path=.env.local
}

function Run-SalesImportRemaining {
    <#
    LABEL: Sales migration remaining rows import
    READS:  sales migration/migration-sales-REMAINING.xlsx
    DOES:   Imports residual rows after partial runs
    #>
    npx tsx -r dotenv/config scripts/run-sales-migration.ts remaining dotenv_config_path=.env.local
}

function Run-ReturnsImport {
    <#
    LABEL: Returns maiden full import
    OUTPUT: returns-MAIDEN-UPLOAD.xlsx (clean) + migration project in production
    READS:  returned migration/returns-MAIDEN-FIXED.xlsx
    DOES:   Strips review_flag → upload → parse → validate → approve → import → reconcile
    NOTE:    Skip if returns migration already completed
    #>
    npx tsx -r dotenv/config scripts/run-returns-migration.ts dotenv_config_path=.env.local
}

# -----------------------------------------------------------------------------
# RECOVERY: Fix stuck or incomplete migration state (production DB)
# -----------------------------------------------------------------------------

function Run-ConfirmHistoricalDeliveries {
    <#
    LABEL: Confirm all unconfirmed historical delivery runs
    DOES:   Sets confirmed_at on migration-sourced runs + pushes qty to supermarket_inventory
    USE WHEN: Deliveries imported but runs still show Pending in UI
    #>
    npx tsx -r dotenv/config scripts/confirm-historical-deliveries.ts dotenv_config_path=.env.local
}

function Run-RecoverDeliveriesParse {
    <#
    LABEL: Recover stuck deliveries maiden parse job
    DOES:   Cancels stuck parse job, re-parses active file, re-validates staging
    USE WHEN: Wizard shows validated but 0 staging rows
    #>
    npx tsx -r dotenv/config scripts/recover-deliveries-parse.ts dotenv_config_path=.env.local
}

# -----------------------------------------------------------------------------
# ANALYSIS ONLY (console output — does not regenerate files)
# -----------------------------------------------------------------------------

function Show-AnalysisCommands {
    Write-Host ''
    Write-Host '=== ANALYSIS (read-only / console — not regen) ===' -ForegroundColor DarkGray
    Write-Host '  npx tsx scripts/analyze-deliveries-migration-file.ts'
    Write-Host '  npx tsx -r dotenv/config scripts/analyze-returns-migration-file.ts dotenv_config_path=.env.local'
    Write-Host '  npx tsx -r dotenv/config scripts/analyze-sales-upload.ts dotenv_config_path=.env.local'
    Write-Host '  npx tsx -r dotenv/config scripts/analyze-stock-chain-discrepancies.ts dotenv_config_path=.env.local'
    Write-Host '  npx tsx scripts/analyze-return-date-fixes.ts'
    Write-Host '  npx tsx -r dotenv/config scripts/check-deliveries-migration.ts dotenv_config_path=.env.local'
    Write-Host ''
}

function Show-RegenerateCatalog {
    Write-Host ''
    Write-Host '=== REGENERATE CATALOG ===' -ForegroundColor Cyan
    Write-Host 'Run: .\scripts\REGENERATE.ps1 -Run <Name>' -ForegroundColor Cyan
    Write-Host ''
    Write-Host '--- Local workbook regen (safe) ---' -ForegroundColor Green
    Write-Host '  DeliveriesFix          -> deliveries migrations/DELIVERIES_DISTRO_MAIDEN-FIXED.xlsx'
    Write-Host '  ReturnsFix             -> returned migration/returns-MAIDEN-FIXED.xlsx'
    Write-Host '  SalesFix               -> sales migration/migration-sales-FIXED.xlsx'
    Write-Host '  DiscrepancyWorkbooks   -> discrepancies fix/*.xlsx (8 files: FIX + READY + summary)'
    Write-Host '  SalesHighlightMissing  -> sales migration/migration-sales-NEEDS-PRODUCT-CORRECTION.xlsx'
    Write-Host ''
    Write-Host '--- Production DB (check DATABASE_URL first) ---' -ForegroundColor Yellow
    Write-Host '  DiscrepancyFixImport       AUTO discrepancy fixes (*-READY.xlsx)'
    Write-Host '  SupplementalDeliveriesDb   Idempotent gap deliveries from returns file'
    Write-Host '  SalesImportPhase1|2|Remaining   Full sales migration pipeline'
    Write-Host '  ReturnsImport              Full returns migration pipeline'
    Write-Host '  ConfirmHistoricalDeliveries  Confirm pending historical delivery runs'
    Write-Host '  RecoverDeliveriesParse       Fix stuck parse / empty staging'
    Write-Host ''
    Show-AnalysisCommands
}

switch ($Run) {
    'List' { Show-RegenerateCatalog }
    'DeliveriesFix' { Regen-DeliveriesFix }
    'ReturnsFix' { Regen-ReturnsFix }
    'SalesFix' { Regen-SalesFix }
    'DiscrepancyWorkbooks' { Regen-DiscrepancyWorkbooks }
    'DiscrepancyFixImport' { Run-DiscrepancyFixImport }
    'SalesHighlightMissing' { Regen-SalesHighlightMissing }
    'SupplementalDeliveriesDb' { Regen-SupplementalDeliveriesDb }
    'SalesImportPhase1' { Run-SalesImportPhase1 }
    'SalesImportPhase2' { Run-SalesImportPhase2 }
    'SalesImportRemaining' { Run-SalesImportRemaining }
    'ReturnsImport' { Run-ReturnsImport }
    'ConfirmHistoricalDeliveries' { Run-ConfirmHistoricalDeliveries }
    'RecoverDeliveriesParse' { Run-RecoverDeliveriesParse }
}
