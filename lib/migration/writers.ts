import type { PoolClient } from 'pg'
import type { MigrationEntityType } from '@/lib/migration/types'
import { toSqlDate, normalizeSaleMonthPeriod } from '@/lib/utils'
import { normalizeMomoNetwork } from '@/lib/migration/normalize'
import { resolveVendorPhones } from '@/lib/migration/vendor-fields'
import { resolveCategoryChange } from '@/lib/migration/category'
import { resolveDeliveryDestination } from '@/lib/migration/delivery-destination'
import { findExistingProvenance, recordProvenance } from '@/lib/migration/provenance'
import { writeMigrationAudit } from '@/lib/migration/audit'
import { resolveHistoricalTransportCost } from '@/lib/migration/transport-cost'

type StagingRow = {
  id: string
  file_id: string | null
  row_number: number
  normalized_data: Record<string, unknown>
  resolved_refs: Record<string, string>
  corrections: Record<string, unknown>
  intended_action: string
  production_id: string | null
}

export type WriterContext = {
  migrationId: string
  batchTag: string
  actorId?: string | null
  /** allowNewCategoryCreation defaults to true for historical migration. */
  allowNewCategoryCreation?: boolean
  /** file_id -> { checksum, sheet } for cross-project idempotency + provenance. */
  fileMeta?: Map<string, { checksum: string; sheet: string }>
}

function dataOf(row: StagingRow): Record<string, unknown> {
  return { ...row.normalized_data, ...row.corrections }
}

function s(v: unknown): string {
  return v == null ? '' : String(v).trim()
}

function n(v: unknown, fallback = 0): number {
  const x = Number(v)
  return Number.isFinite(x) ? x : fallback
}

/**
 * "Entities that always INSERT" duplicate themselves if the same source row is imported
 * twice (re-run of the same migration project on a fresh file re-upload, or a brand new
 * migration project pointed at the same spreadsheet). Guard those writers with a
 * cross-project idempotency check keyed on file checksum + sheet + row number.
 */
async function checkIdempotency(
  client: PoolClient,
  entity: MigrationEntityType,
  row: StagingRow,
  ctx: WriterContext
): Promise<string | null> {
  const meta = row.file_id ? ctx.fileMeta?.get(row.file_id) : undefined
  if (!meta) return null
  const existing = await findExistingProvenance(client, {
    entityType: entity,
    sourceFileChecksum: meta.checksum,
    sourceSheet: meta.sheet,
    sourceRowNumber: row.row_number,
  })
  return existing?.productionId ?? null
}

async function markProvenance(
  client: PoolClient,
  entity: MigrationEntityType,
  row: StagingRow,
  ctx: WriterContext,
  productionId: string | null
): Promise<void> {
  const meta = row.file_id ? ctx.fileMeta?.get(row.file_id) : undefined
  if (!meta) return
  await recordProvenance(client, {
    entityType: entity,
    sourceFileChecksum: meta.checksum,
    sourceSheet: meta.sheet,
    sourceRowNumber: row.row_number,
    migrationId: ctx.migrationId,
    productionId,
  })
}

const IDEMPOTENT_ENTITIES: Set<MigrationEntityType> = new Set([
  'deliveries', 'sales', 'intakes', 'returns', 'deductions', 'payouts',
])

async function writeRow(
  client: PoolClient,
  entity: MigrationEntityType,
  row: StagingRow,
  ctx: WriterContext
): Promise<{ productionId: string | null; action: 'create' | 'update' | 'skip' }> {
  if (row.intended_action === 'skip') return { productionId: row.production_id, action: 'skip' }
  if (row.production_id) return { productionId: row.production_id, action: 'skip' }

  if (IDEMPOTENT_ENTITIES.has(entity)) {
    const already = await checkIdempotency(client, entity, row, ctx)
    if (already) return { productionId: already, action: 'skip' }
  }

  const d = dataOf(row)

  switch (entity) {
    case 'categories': {
      const name = s(d.name)
      const existing = await client.query(
        `SELECT id FROM public.categories WHERE lower(name) = lower($1) LIMIT 1`,
        [name]
      )
      if (existing.rows[0]) return { productionId: existing.rows[0].id, action: 'update' }
      const ins = await client.query(
        `INSERT INTO public.categories (name) VALUES ($1) RETURNING id`,
        [name]
      )
      return { productionId: ins.rows[0].id, action: 'create' }
    }

    case 'vendors': {
      // Historical migrations always create/update admin-managed vendors (no portal login).
      const name = s(d.name)
      const { momoNumber, contactPhone } = resolveVendorPhones(d)
      if (!momoNumber) throw new Error(`Vendor "${name}" is missing momo_number`)
      const momoNetwork = normalizeMomoNetwork(d.momo_network)
      const contactPerson = s(d.contact_person_name || d.contact_person)
      const description = s(d.description) || null
      const reportNotes = s(d.report_delivery_notes) || null
      const existing = await client.query(
        `SELECT id FROM public.vendors WHERE deleted_at IS NULL AND lower(name) = lower($1) LIMIT 1`,
        [name]
      )
      if (existing.rows[0]) {
        await client.query(
          `UPDATE public.vendors SET
             access_mode = 'admin_managed',
             contact_person_name = COALESCE(NULLIF($2,''), contact_person_name),
             contact_phone = COALESCE(NULLIF($3,''), contact_phone),
             momo_number = COALESCE(NULLIF($4,''), momo_number),
             momo_network = COALESCE(NULLIF($5,''), momo_network),
             description = COALESCE(NULLIF($6,''), description),
             report_delivery_notes = COALESCE(NULLIF($7,''), report_delivery_notes),
             login_email = NULL,
             initial_password = NULL
           WHERE id = $1`,
          [existing.rows[0].id, contactPerson, contactPhone, momoNumber, momoNetwork, description, reportNotes]
        )
        return { productionId: existing.rows[0].id, action: 'update' }
      }
      const ins = await client.query(
        `INSERT INTO public.vendors
          (name, momo_number, momo_network, default_commission, status,
           contact_phone, description, access_mode, contact_person_name, report_delivery_notes,
           login_email, initial_password)
         VALUES ($1,$2,$3,$4,'active',$5,$6,'admin_managed',$7,$8,NULL,NULL)
         RETURNING id`,
        [
          name,
          momoNumber,
          momoNetwork,
          n(d.commission_rate ?? d.default_commission, 10),
          contactPhone,
          description,
          contactPerson || null,
          reportNotes,
        ]
      )
      return { productionId: ins.rows[0].id, action: 'create' }
    }

    case 'products': {
      let vendorId = row.resolved_refs.vendor_id
      if (!vendorId) {
        const vn = s(d.vendor_name || d.vendor)
        const v = await client.query(
          `SELECT id FROM public.vendors WHERE deleted_at IS NULL AND lower(name) = lower($1) LIMIT 1`,
          [vn]
        )
        vendorId = v.rows[0]?.id
      }
      if (!vendorId) throw new Error(`Vendor missing for product ${s(d.name)}`)

      const barcode = s(d.barcode)
      let existingProductId: string | null = null
      if (barcode) {
        const byBc = await client.query(
          `SELECT id, category FROM public.products
           WHERE deleted_at IS NULL AND lower(trim(barcode)) = lower($1) LIMIT 1`,
          [barcode]
        )
        if (byBc.rows[0]) existingProductId = byBc.rows[0].id
      }
      let existingCategory: string | null = null
      if (!existingProductId) {
        const existing = await client.query(
          `SELECT id, category FROM public.products
           WHERE deleted_at IS NULL AND vendor_id = $1 AND lower(trim(name)) = lower($2) LIMIT 1`,
          [vendorId, s(d.name)]
        )
        if (existing.rows[0]) {
          existingProductId = existing.rows[0].id
          existingCategory = existing.rows[0].category
        }
      } else {
        const cur = await client.query(`SELECT category FROM public.products WHERE id = $1`, [existingProductId])
        existingCategory = cur.rows[0]?.category ?? null
      }

      // Category rule: never replace a valid category with NULL just because the
      // incoming historical row has none; auto-override differences with full provenance.
      const categoryResult = await resolveCategoryChange(client, {
        existingCategory,
        incomingCategoryRaw: s(d.category) || null,
        allowNewCategoryCreation: ctx.allowNewCategoryCreation !== false,
      })

      if (existingProductId) {
        if (categoryResult.outcome === 'overridden' || categoryResult.outcome === 'populated') {
          await client.query(
            `UPDATE public.products SET category = $2, updated_at = now() WHERE id = $1`,
            [existingProductId, categoryResult.resolvedCategory]
          )
          await client.query(
            `INSERT INTO public.migration_category_changes
              (migration_id, product_id, staging_row_id, previous_category, new_category, outcome,
               source_file_id, source_row_number, changed_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [
              ctx.migrationId, existingProductId, row.id,
              categoryResult.previousCategory, categoryResult.resolvedCategory, categoryResult.outcome,
              row.file_id, row.row_number, ctx.actorId ?? null,
            ]
          )
          await writeMigrationAudit(client, {
            migrationId: ctx.migrationId,
            actorId: ctx.actorId,
            action: 'migration.category_overridden',
            stage: 8,
            details: {
              product_id: existingProductId,
              previous_category: categoryResult.previousCategory,
              new_category: categoryResult.resolvedCategory,
              outcome: categoryResult.outcome,
              source_row_number: row.row_number,
              source_file_id: row.file_id,
            },
          })
        }
        return { productionId: existingProductId, action: 'update' }
      }

      if (categoryResult.outcome === 'unmatchable') {
        throw new Error(`Product "${s(d.name)}" category "${s(d.category)}" could not be matched or created`)
      }

      const vendorPrice = n(d.vendor_price)
      const selling = n(d.supermarket_selling_price, vendorPrice)
      const markup = Math.max(0, selling - vendorPrice)
      const sellingPrice = selling > 0 ? selling : vendorPrice + markup
      const ins = await client.query(
        `INSERT INTO public.products
          (vendor_id, name, barcode, sku, category, vendor_price, distrogh_markup, supermarket_selling_price, selling_price)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING id`,
        [
          vendorId,
          s(d.name),
          barcode || null,
          s(d.sku) || null,
          categoryResult.resolvedCategory,
          vendorPrice,
          markup,
          selling,
          sellingPrice,
        ]
      )
      if (categoryResult.createdNewCategory) {
        await writeMigrationAudit(client, {
          migrationId: ctx.migrationId,
          actorId: ctx.actorId,
          action: 'migration.category_created',
          stage: 8,
          details: { category: categoryResult.resolvedCategory, product_name: s(d.name), source_row_number: row.row_number },
        })
      }
      return { productionId: ins.rows[0].id, action: 'create' }
    }

    case 'supermarket_chains':
      // Logical only — no table. Skipped; outlets carry chain name.
      return { productionId: null, action: 'skip' }

    case 'supermarkets': {
      const name = s(d.name || d.supermarket_name)
      const branch = s(d.branch)
      const existing = await client.query(
        `SELECT id FROM public.supermarkets
         WHERE deleted_at IS NULL
           AND lower(name) = lower($1)
           AND lower(coalesce(branch,'')) = lower($2)
         LIMIT 1`,
        [name, branch]
      )
      if (existing.rows[0]) return { productionId: existing.rows[0].id, action: 'update' }
      const ins = await client.query(
        `INSERT INTO public.supermarkets (name, branch, store_code, location, region)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [name, branch || null, s(d.store_code) || null, s(d.location) || null, s(d.region) || null]
      )
      return { productionId: ins.rows[0].id, action: 'create' }
    }

    case 'intakes': {
      let vendorId = row.resolved_refs.vendor_id
      let productId = row.resolved_refs.product_id
      if (!vendorId) {
        const v = await client.query(
          `SELECT id FROM public.vendors WHERE deleted_at IS NULL AND lower(name)=lower($1) LIMIT 1`,
          [s(d.vendor_name || d.vendor)]
        )
        vendorId = v.rows[0]?.id
      }
      if (!productId) {
        const p = await client.query(
          `SELECT id FROM public.products WHERE deleted_at IS NULL AND lower(name)=lower($1) LIMIT 1`,
          [s(d.product_name || d.product)]
        )
        productId = p.rows[0]?.id
      }
      if (!vendorId || !productId) throw new Error('Intake missing vendor/product')
      // received_date is a required column (validate.ts blocks rows missing it) — never fall back
      // to "now": a migrated historical record silently dated today is a corrupted record, not a
      // convenience default. If this is ever reached with no date, that's a validation gap, not
      // something to paper over here.
      const receivedDateStr = s(d.received_date)
      if (!receivedDateStr) throw new Error('Intake missing received_date')
      const ins = await client.query(
        `INSERT INTO public.intakes (vendor_id, product_id, quantity_received, received_date, reference)
         VALUES ($1,$2,$3,$4::date,$5) RETURNING id`,
        [
          vendorId,
          productId,
          n(d.quantity ?? d.qty),
          toSqlDate(receivedDateStr),
          s(d.notes || d.reference) || `migration:${ctx.migrationId}`,
        ]
      )
      return { productionId: ins.rows[0].id, action: 'create' }
    }

    case 'deductions': {
      let vendorId = row.resolved_refs.vendor_id
      if (!vendorId) {
        const v = await client.query(
          `SELECT id FROM public.vendors WHERE deleted_at IS NULL AND lower(name)=lower($1) LIMIT 1`,
          [s(d.vendor_name)]
        )
        vendorId = v.rows[0]?.id
      }
      if (!vendorId) throw new Error('Deduction missing vendor')
      const deductionDateStr = s(d.deduction_date)
      if (!deductionDateStr) throw new Error('Deduction missing deduction_date')
      const ins = await client.query(
        `INSERT INTO public.vendor_deductions (vendor_id, amount, reason, deduction_date, reference_type, reference_id)
         VALUES ($1,$2,$3,$4::date,$5,$6) RETURNING id`,
        [
          vendorId,
          n(d.amount),
          s(d.reason) || 'Historical deduction',
          toSqlDate(deductionDateStr),
          s(d.reference_type) || 'migration',
          s(d.reference_id) || ctx.migrationId,
        ]
      )
      return { productionId: ins.rows[0].id, action: 'create' }
    }

    case 'payouts': {
      let vendorId = row.resolved_refs.vendor_id
      if (!vendorId) {
        const v = await client.query(
          `SELECT id FROM public.vendors WHERE deleted_at IS NULL AND lower(name)=lower($1) LIMIT 1`,
          [s(d.vendor_name)]
        )
        vendorId = v.rows[0]?.id
      }
      if (!vendorId) throw new Error('Payout missing vendor')
      const paid = n(d.amount_paid ?? d.amount)
      const due = n(d.amount_due, paid)
      const payoutDateStr = s(d.payout_date) || s(d.week_start)
      if (!payoutDateStr) throw new Error('Payout missing payout_date/week_start')
      const weekStart = toSqlDate(s(d.week_start) || payoutDateStr)
      const weekEnd = toSqlDate(s(d.week_end) || weekStart)
      const status = s(d.status) || 'completed'
      const ins = await client.query(
        `INSERT INTO public.payouts
          (vendor_id, amount_due, amount_paid, week_start, week_end, status, momo_txn_id, payout_date)
         VALUES ($1,$2,$3,$4::date,$5::date,$6,$7,$8::timestamptz)
         RETURNING id`,
        [
          vendorId,
          due,
          paid,
          weekStart,
          weekEnd,
          status,
          s(d.transaction_id || d.momo_txn_id) || `MIG-${ctx.batchTag}`,
          toSqlDate(payoutDateStr),
        ]
      )
      return { productionId: ins.rows[0].id, action: 'create' }
    }

    case 'returns': {
      let productId = row.resolved_refs.product_id
      if (!productId) {
        const p = await client.query(
          `SELECT id FROM public.products WHERE deleted_at IS NULL AND lower(name)=lower($1) LIMIT 1`,
          [s(d.product_name || d.product)]
        )
        productId = p.rows[0]?.id
      }
      if (!productId) throw new Error('Return missing product')
      let supermarketId: string | null = row.resolved_refs.supermarket_id ?? null
      if (!supermarketId && s(d.supermarket_name)) {
        const sm = await client.query(
          `SELECT id FROM public.supermarkets
           WHERE deleted_at IS NULL AND lower(name)=lower($1)
             AND lower(coalesce(branch,''))=lower($2) LIMIT 1`,
          [s(d.supermarket_name), s(d.branch)]
        )
        supermarketId = sm.rows[0]?.id ?? null
      }
      if (!supermarketId) {
        const any = await client.query(
          `SELECT id FROM public.supermarkets WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1`
        )
        supermarketId = any.rows[0]?.id
      }
      if (!supermarketId) throw new Error('Return missing supermarket')
      const allowed = new Set(['expired', 'defective_product', 'defective_packaging', 'other'])
      const reason = allowed.has(s(d.reason)) ? s(d.reason) : 'other'
      // unit_price from product vendor_price
      const priceRes = await client.query(
        `SELECT vendor_price FROM public.products WHERE id = $1`,
        [productId]
      )
      const unitPrice = n(d.unit_price, n(priceRes.rows[0]?.vendor_price, 0))
      const returnDateStr = s(d.return_date)
      if (!returnDateStr) throw new Error('Return missing return_date')
      const ins = await client.query(
        `INSERT INTO public.product_returns
          (product_id, supermarket_id, quantity_returned, unit_price, return_date, reason, reason_notes)
         VALUES ($1,$2,$3,$4,$5::date,$6,$7) RETURNING id`,
        [
          productId,
          supermarketId,
          n(d.quantity ?? d.qty),
          unitPrice,
          toSqlDate(returnDateStr),
          reason,
          s(d.notes) || `migration:${ctx.migrationId}`,
        ]
      )
      return { productionId: ins.rows[0].id, action: 'create' }
    }

    case 'service_charges': {
      let vendorId = row.resolved_refs.vendor_id
      if (!vendorId) {
        const v = await client.query(
          `SELECT id FROM public.vendors WHERE deleted_at IS NULL AND lower(name)=lower($1) LIMIT 1`,
          [s(d.vendor_name)]
        )
        vendorId = v.rows[0]?.id
      }
      if (!vendorId) throw new Error('Service charge missing vendor')
      await client.query(
        `UPDATE public.vendors SET
           service_charge_paid_at = COALESCE($2::timestamptz, service_charge_paid_at),
           service_charge_expires_at = COALESCE($3::date, service_charge_expires_at),
           service_charge_years_paid = COALESCE($4, service_charge_years_paid)
         WHERE id = $1`,
        [
          vendorId,
          s(d.paid_at) || null,
          s(d.expires_at) || null,
          d.years_paid != null ? n(d.years_paid) : null,
        ]
      )
      return { productionId: vendorId, action: 'update' }
    }

    case 'vendor_documents': {
      let vendorId = row.resolved_refs.vendor_id
      if (!vendorId) {
        const v = await client.query(
          `SELECT id FROM public.vendors WHERE deleted_at IS NULL AND lower(name)=lower($1) LIMIT 1`,
          [s(d.vendor_name)]
        )
        vendorId = v.rows[0]?.id
      }
      if (!vendorId) throw new Error('Vendor document missing vendor')
      await client.query(
        `UPDATE public.vendors SET
           fda_certificate_acquired_date = COALESCE($2::date, fda_certificate_acquired_date),
           fda_certificate_expiry_date = COALESCE($3::date, fda_certificate_expiry_date)
         WHERE id = $1`,
        [vendorId, s(d.fda_certificate_acquired_date) || null, s(d.fda_certificate_expiry_date) || null]
      )
      return { productionId: vendorId, action: 'update' }
    }

    case 'opening_balances': {
      // Policy: record as a migration-tagged deduction with negative amount? Safer: skip auto-commit.
      // Opening balances stay in staging unless wizard explicitly enables commit_opening_balances.
      throw new Error('OPENING_BALANCES_REQUIRE_EXPLICIT_POLICY')
    }

    case 'deliveries': {
      // Header+lines grouped externally in processImportEntity for efficiency.
      // Single-row fallback creates a 1-item run.
      //
      // Historical routing rule: a delivery's branch is NOT a required unique business
      // destination. Some historical deliveries went to a central warehouse/distribution
      // point and were redistributed internally — that downstream hop is not part of this
      // DistroGH transaction. Resolve destination_type instead of fabricating a branch.
      let supermarketId: string | null = row.resolved_refs.supermarket_id ?? null
      let destination: Awaited<ReturnType<typeof resolveDeliveryDestination>>
      if (supermarketId) {
        destination = { destinationType: 'BRANCH', supermarketId, destinationReference: null, branchTextProvidedButUnmatched: false }
      } else {
        destination = await resolveDeliveryDestination(client, d)
        supermarketId = destination.supermarketId
      }

      let productId = row.resolved_refs.product_id
      if (!productId) {
        const p = await client.query(
          `SELECT id FROM public.products WHERE deleted_at IS NULL AND lower(name)=lower($1) LIMIT 1`,
          [s(d.product_name || d.product)]
        )
        productId = p.rows[0]?.id
      }
      if (!productId) throw new Error('Delivery missing product')

      // Transport cost: preserve exactly what the historical source recorded. NULL means
      // "the historical source did not provide a transport cost" — never coerced to 0.
      const transportCost = resolveHistoricalTransportCost(d.transport_cost)

      const deliveryDateStr = s(d.delivery_date)
      if (!deliveryDateStr) throw new Error('Delivery missing delivery_date')

      const run = await client.query(
        `INSERT INTO public.delivery_runs
          (supermarket_id, delivery_date, total_transport_cost, notes,
           source, destination_type, destination_reference,
           migration_id, source_file_id, source_row_number, migrated_by, migrated_at)
         VALUES ($1,$2::date,$3,$4,'HISTORICAL_MIGRATION',$5,$6,$7,$8,$9,$10,now())
         RETURNING id`,
        [
          supermarketId,
          toSqlDate(deliveryDateStr),
          transportCost,
          `migration:${ctx.migrationId}`,
          destination.destinationType,
          destination.destinationReference,
          ctx.migrationId,
          row.file_id,
          row.row_number,
          ctx.actorId ?? null,
        ]
      )
      await client.query(
        `INSERT INTO public.delivery_run_items (delivery_run_id, product_id, quantity_delivered)
         VALUES ($1,$2,$3)`,
        [run.rows[0].id, productId, n(d.quantity ?? d.qty)]
      )

      if (destination.destinationType !== 'BRANCH') {
        await writeMigrationAudit(client, {
          migrationId: ctx.migrationId,
          actorId: ctx.actorId,
          action: 'migration.delivery_without_branch',
          stage: 8,
          details: {
            delivery_run_id: run.rows[0].id,
            destination_type: destination.destinationType,
            destination_reference: destination.destinationReference,
            source_row_number: row.row_number,
            source_file_id: row.file_id,
          },
        })
      }
      if (transportCost == null) {
        await writeMigrationAudit(client, {
          migrationId: ctx.migrationId,
          actorId: ctx.actorId,
          action: 'migration.delivery_missing_transport_cost',
          stage: 8,
          details: { delivery_run_id: run.rows[0].id, source_row_number: row.row_number, source_file_id: row.file_id },
        })
      }

      return { productionId: run.rows[0].id, action: 'create' }
    }

    case 'sales': {
      // Prefer dedicated sales bulk path in process for matched rows.
      // Minimal writer: requires resolved product_id + supermarket_id in corrections/refs.
      const productId = row.resolved_refs.product_id || s(d.product_id)
      const supermarketId = row.resolved_refs.supermarket_id || s(d.supermarket_id)
      if (!productId || !supermarketId) {
        throw new Error('Sales row missing product_id/supermarket_id — correct in wizard first')
      }
      const qty = n(d.qty ?? d.quantity)
      // Sales are always reported and reconciled by full calendar month in this system (see
      // normalizeSaleMonthPeriod — the same helper the live day-to-day sales importer uses) —
      // re-snap here too rather than trust whatever week_start/week_end survived Corrections,
      // so a migrated sale can never end up with an off-calendar or zero-length period.
      const periodSource = s(d.week_start) || s(d.report_month)
      if (!periodSource) throw new Error('Sales row missing week_start/report_month')
      const period = normalizeSaleMonthPeriod(toSqlDate(periodSource))
      const weekStart = period.week_start
      const weekEnd = period.week_end
      const unit = n(d.unit_price ?? d.shop_unit_price)
      const total = n(d.total_sales, unit * qty)
      const vendorDue = n(d.vendor_due, 0)
      const commission = Math.max(0, total - vendorDue)
      const ins = await client.query(
        `INSERT INTO public.sales
          (product_id, supermarket_id, qty_sold, unit_price, total_sales, vendor_due, commission_amount,
           week_start, week_end, import_batch_id, imported_at, developer_fee)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::date,$9::date,$10,now(),0)
         RETURNING id`,
        [
          productId,
          supermarketId,
          qty,
          unit,
          total,
          vendorDue,
          commission,
          weekStart,
          weekEnd,
          `migration_${ctx.migrationId}`,
        ]
      )
      return { productionId: ins.rows[0].id, action: 'create' }
    }

    default:
      return { productionId: null, action: 'skip' }
  }
}

/**
 * Import one staging row into production inside an open transaction.
 * Returns production UUID or null if skipped.
 *
 * Wraps writeRow() with cross-project idempotency provenance so re-running the same
 * migration — or a brand new migration pointed at the same spreadsheet — never
 * duplicates financially-significant records (deliveries, sales, intakes, returns,
 * deductions, payouts).
 */
export async function importStagingRow(
  client: PoolClient,
  entity: MigrationEntityType,
  row: StagingRow,
  ctx: WriterContext
): Promise<{ productionId: string | null; action: 'create' | 'update' | 'skip' }> {
  const result = await writeRow(client, entity, row, ctx)
  if (IDEMPOTENT_ENTITIES.has(entity) && result.action !== 'skip') {
    await markProvenance(client, entity, row, ctx, result.productionId)
  }
  return result
}
