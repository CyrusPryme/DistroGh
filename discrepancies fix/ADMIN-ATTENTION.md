# Admin attention — stock chain review

Generated: 2026-09-09

After applying **SYSTEM CORRECT FARMER TORKS 2** and follow-up auto-reconciliation, most quantity gaps are cleared. What remains is mostly **date ordering** — not missing stock.

## Quick status

| Area | Needs admin? | What it means |
|------|--------------|---------------|
| Intake gaps (warehouse receipts) | **No** (0 rows) | Received vs delivered quantities match for all flagged products |
| Delivery gaps (to Spintex) | **No** (0 rows) | Delivered amounts align with sales/returns |
| Shelf stock at Spintex | **No** (0 rows) | On-shelf counts match expected (delivered − sold − returns) |
| Date order (chronology) | **Review** (15 auto + 2 admin) | Some dates appear “out of order” — see below |

**Start with:** open `DISCREPANCY-SUMMARY.xlsx` in this folder, then `CHRONOLOGY-FIX.xlsx` for details.

---

## What “chronology” means (simple)

The system expects this order in time:

1. **Received** at DistroGH warehouse (intake)
2. **Delivered** to Palace Spintex
3. **Sold** at the supermarket

When you **correct intake or delivery dates** in an admin spreadsheet, the quantities can be right while dates still look “wrong” to the computer. That is what most remaining rows are.

**Important:** We applied your date corrections on purpose. The chronology sheet is a **warning list**, not a list of missing products.

---

## Chronology — auto rows (15)

These are **informational**. Do **not** auto-apply chronology backdating — it would undo your Farmer Torks / admin date fixes.

- **AFRIZONE MARKET GINGER HONEY FL** — The system shows stock was **delivered before it was recorded as received** at the warehouse. Delivery date (2025-06-01) is earlier than the intake date (2025-08-27). This often happens after correcting intake dates in the admin sheet. **Usually safe to ignore** if you intentionally moved the intake date.
- **AKOMA DRY ROASTED CASHEWS 50G** — The system shows stock was **delivered before it was recorded as received** at the warehouse. Delivery date (2025-10-02) is earlier than the intake date (2025-11-12). This often happens after correcting intake dates in the admin sheet. **Usually safe to ignore** if you intentionally moved the intake date.
- **CHOCHO ANTIBACTERIAL SOAP 100G** — The system shows stock was **delivered before it was recorded as received** at the warehouse. Delivery date (2025-06-01) is earlier than the intake date (2025-08-18). This often happens after correcting intake dates in the admin sheet. **Usually safe to ignore** if you intentionally moved the intake date.
- **CHOCHO CREAM LARGE 110G** — The system shows stock was **delivered before it was recorded as received** at the warehouse. Delivery date (2025-07-02) is earlier than the intake date (2025-08-18). This often happens after correcting intake dates in the admin sheet. **Usually safe to ignore** if you intentionally moved the intake date.
- **CHOCHO CREAM SMALL 29G** — The system shows stock was **delivered before it was recorded as received** at the warehouse. Delivery date (2025-07-02) is earlier than the intake date (2025-08-18). This often happens after correcting intake dates in the admin sheet. **Usually safe to ignore** if you intentionally moved the intake date.
- **CHOCHO HAND FOOT CREAM 70G** — The system shows stock was **delivered before it was recorded as received** at the warehouse. Delivery date (2025-06-01) is earlier than the intake date (2025-08-18). This often happens after correcting intake dates in the admin sheet. **Usually safe to ignore** if you intentionally moved the intake date.
- **HAUSA KOKO NUTRIGOLD MILD FLOUR** — The system shows stock was **delivered before it was recorded as received** at the warehouse. Delivery date (2025-06-01) is earlier than the intake date (2025-07-15). This often happens after correcting intake dates in the admin sheet. **Usually safe to ignore** if you intentionally moved the intake date.
- **NATURE FROM ADDYS BENTONITE CLA** — The system shows stock was **delivered before it was recorded as received** at the warehouse. Delivery date (2025-09-01) is earlier than the intake date (2025-10-16). This often happens after correcting intake dates in the admin sheet. **Usually safe to ignore** if you intentionally moved the intake date.
- **NATURE FROM ADDYS CHARCOAL POWDER** — The system shows stock was **delivered before it was recorded as received** at the warehouse. Delivery date (2025-09-01) is earlier than the intake date (2025-10-16). This often happens after correcting intake dates in the admin sheet. **Usually safe to ignore** if you intentionally moved the intake date.
- **NUTRIGOLD PUFF MIX 500G** — The system shows stock was **delivered before it was recorded as received** at the warehouse. Delivery date (2025-06-01) is earlier than the intake date (2025-07-15). This often happens after correcting intake dates in the admin sheet. **Usually safe to ignore** if you intentionally moved the intake date.
- **NUTRIGOLD PURE HONEY 500ML** — The system shows stock was **delivered before it was recorded as received** at the warehouse. Delivery date (2025-06-01) is earlier than the intake date (2025-07-15). This often happens after correcting intake dates in the admin sheet. **Usually safe to ignore** if you intentionally moved the intake date.
- **NUTRIGOLD WHEATSO CEREAL LEGUME** — The system shows stock was **delivered before it was recorded as received** at the warehouse. Delivery date (2025-06-01) is earlier than the intake date (2025-07-15). This often happens after correcting intake dates in the admin sheet. **Usually safe to ignore** if you intentionally moved the intake date.
- **NYAME ANOA DRIED MANGO 30G** — The system shows stock was **delivered before it was recorded as received** at the warehouse. Delivery date (2025-12-02) is earlier than the intake date (2025-12-06). This often happens after correcting intake dates in the admin sheet. **Usually safe to ignore** if you intentionally moved the intake date.
- **PALS DARK COCOA POWDER 400G** — The system shows stock was **delivered before it was recorded as received** at the warehouse. Delivery date (2025-09-01) is earlier than the intake date (2025-11-13). This often happens after correcting intake dates in the admin sheet. **Usually safe to ignore** if you intentionally moved the intake date.
- **PALS HONEY 365ML** — The system shows stock was **delivered before it was recorded as received** at the warehouse. Delivery date (2025-07-02) is earlier than the intake date (2025-08-27). This often happens after correcting intake dates in the admin sheet. **Usually safe to ignore** if you intentionally moved the intake date.

## Chronology — admin review (2)

- **ADEPA BUTTER CEREAL LEGUME FLOU** — Sales were recorded **before** a delivery to Spintex (2025-10-08 sale vs 2025-10-01 delivery). Sales data is trusted; the system may suggest moving the delivery date earlier. **Review only if** the delivery date in your records is definitely correct.
- **MA RECIPY T-GIN CINNAMON INFUSI** — Sales were recorded **before** a delivery to Spintex (2025-10-30 sale vs 2025-10-01 delivery). Sales data is trusted; the system may suggest moving the delivery date earlier. **Review only if** the delivery date in your records is definitely correct.

---

## Items skipped from SYSTEM CORRECT FARMER TORKS 2

These were in your spreadsheet but already fixed or not applicable:

| Product | Why skipped |
|---------|-------------|
| ADEPA Butter Cereal Legume Flou (500G rows) | Duplicate deletes already done in an earlier correction |
| Pals Honey 250ML (delete ×24) | Already removed; qty fix applied on another row |
| Akoma Cashews 50G (×1519 delete / ×200 insert) | Large duplicate already gone; correct intake exists |
| Chocho Royal Herbal Shower Gel (duplicate insert) | Intake already on file |
| McPhilix Kelewele Plantain Chip (42→40) | No intake with qty 42; active intake is already 40 |

---

## Workbook files in this folder

| File | Use |
|------|-----|
| `DISCREPANCY-SUMMARY.xlsx` | One-page overview |
| `CHRONOLOGY-FIX.xlsx` | Date-order review (only file with open items) |
| `INTAKE-GAPS-FIX.xlsx` | Empty — no intake quantity gaps |
| `DELIVERY-GAPS-FIX.xlsx` | Empty — no delivery quantity gaps |
| `INVENTORY-RECONCILE-FIX.xlsx` | Empty — no shelf adjustments needed |
| `SYSTEM CORRECT FARMER TORKS 2.xlsx` | Your source corrections (applied) |

There are **no `*-READY.xlsx` files** right now — nothing safe to bulk-import until new gaps appear.

## If you need to regenerate after more edits

```bash
npx tsx -r dotenv/config scripts/generate-discrepancy-fix-workbooks.ts dotenv_config_path=.env.local
```
