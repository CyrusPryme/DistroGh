import type { Pool, PoolClient } from 'pg'

type Db = Pool | PoolClient

export interface ProductIntegrityMatch {
  id: string
  name: string
  sku: string | null
  barcode: string | null
}

export interface ProductIntegrityFieldCheck {
  duplicate: boolean
  product: ProductIntegrityMatch | null
}

export interface ProductIntegrityResult {
  /** Same name and SKU as an existing product — not allowed. */
  sameProduct: ProductIntegrityFieldCheck
  /** Same name but different SKU — allowed; informational only. */
  sameNameOtherSku: ProductIntegrityFieldCheck
  barcode: ProductIntegrityFieldCheck
  canSave: boolean
}

type CheckInput = {
  name?: string
  sku?: string
  barcode?: string
  excludeProductId?: string | null
}

function normalizeSku(sku: string | null | undefined): string {
  return (sku ?? '').trim()
}

async function findByBarcode(
  db: Db,
  barcode: string,
  excludeProductId?: string | null
): Promise<ProductIntegrityMatch | null> {
  const trimmed = barcode.trim()
  if (!trimmed) return null

  const excludeClause = excludeProductId ? `and p.id <> $2::uuid` : ''
  const params: string[] = [trimmed]
  if (excludeProductId) params.push(excludeProductId)

  const { rows } = await db.query(
    `
    select p.id, p.name, p.sku, p.barcode
    from public.products p
    where p.deleted_at is null
      and trim(p.barcode) = trim($1)
      ${excludeClause}
    order by p.created_at desc
    limit 1
    `,
    params
  )

  const row = rows[0]
  if (!row) return null
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    sku: row.sku != null ? String(row.sku) : null,
    barcode: row.barcode != null ? String(row.barcode) : null,
  }
}

/** Same product = matching name and SKU (empty SKU counts as a value). */
async function findSameProduct(
  db: Db,
  name: string,
  sku: string,
  excludeProductId?: string | null
): Promise<ProductIntegrityMatch | null> {
  const trimmedName = name.trim()
  if (!trimmedName) return null

  const excludeClause = excludeProductId ? `and p.id <> $3::uuid` : ''
  const params: string[] = [trimmedName, normalizeSku(sku)]
  if (excludeProductId) params.push(excludeProductId)

  const { rows } = await db.query(
    `
    select p.id, p.name, p.sku, p.barcode
    from public.products p
    where p.deleted_at is null
      and lower(trim(p.name)) = lower(trim($1))
      and coalesce(nullif(trim(p.sku), ''), '') = $2
      ${excludeClause}
    order by p.created_at desc
    limit 1
    `,
    params
  )

  const row = rows[0]
  if (!row) return null
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    sku: row.sku != null ? String(row.sku) : null,
    barcode: row.barcode != null ? String(row.barcode) : null,
  }
}

/** Same name, different SKU — allowed duplicate name. */
async function findSameNameOtherSku(
  db: Db,
  name: string,
  sku: string,
  excludeProductId?: string | null
): Promise<ProductIntegrityMatch | null> {
  const trimmedName = name.trim()
  if (!trimmedName) return null

  const normalizedSku = normalizeSku(sku)
  const excludeClause = excludeProductId ? `and p.id <> $3::uuid` : ''
  const params: string[] = [trimmedName, normalizedSku]
  if (excludeProductId) params.push(excludeProductId)

  const { rows } = await db.query(
    `
    select p.id, p.name, p.sku, p.barcode
    from public.products p
    where p.deleted_at is null
      and lower(trim(p.name)) = lower(trim($1))
      and coalesce(nullif(trim(p.sku), ''), '') <> $2
      ${excludeClause}
    order by p.created_at desc
    limit 1
    `,
    params
  )

  const row = rows[0]
  if (!row) return null
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    sku: row.sku != null ? String(row.sku) : null,
    barcode: row.barcode != null ? String(row.barcode) : null,
  }
}

export async function checkProductIntegrity(
  db: Db,
  input: CheckInput
): Promise<ProductIntegrityResult> {
  const name = input.name?.trim() ?? ''
  const sku = normalizeSku(input.sku)
  const barcode = input.barcode?.trim() ?? ''

  const [sameProductMatch, sameNameOtherSkuMatch, barcodeMatch] = await Promise.all([
    name ? findSameProduct(db, name, sku, input.excludeProductId) : Promise.resolve(null),
    name ? findSameNameOtherSku(db, name, sku, input.excludeProductId) : Promise.resolve(null),
    barcode ? findByBarcode(db, barcode, input.excludeProductId) : Promise.resolve(null),
  ])

  return {
    sameProduct: { duplicate: !!sameProductMatch, product: sameProductMatch },
    sameNameOtherSku: {
      duplicate: !!sameNameOtherSkuMatch && !sameProductMatch,
      product: sameProductMatch ? null : sameNameOtherSkuMatch,
    },
    barcode: { duplicate: !!barcodeMatch, product: barcodeMatch },
    canSave: !sameProductMatch && !barcodeMatch,
  }
}

export function sameProductIntegrityError(result: ProductIntegrityResult): string | null {
  if (!result.sameProduct.duplicate || !result.sameProduct.product) return null
  const p = result.sameProduct.product
  const skuLabel = p.sku ? ` (SKU: ${p.sku})` : ''
  return `A product named “${p.name}”${skuLabel} already exists. Use a different SKU or name.`
}

export function barcodeIntegrityError(result: ProductIntegrityResult): string | null {
  if (!result.barcode.duplicate || !result.barcode.product) return null
  const p = result.barcode.product
  return `Barcode already used by “${p.name}”${p.sku ? ` (SKU: ${p.sku})` : ''}.`
}

export function productIntegritySaveError(result: ProductIntegrityResult): string | null {
  return sameProductIntegrityError(result) ?? barcodeIntegrityError(result)
}
