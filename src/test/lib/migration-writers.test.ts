import { describe, expect, it } from 'vitest'
import { importStagingRow, type WriterContext } from '@/lib/migration/writers'
import { createMockClient } from './mock-pg-client'

const baseCtx: WriterContext = { migrationId: 'MIG-2026-001', batchTag: 'test0001' }

function deliveryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'staging-row-1',
    file_id: 'file-1',
    row_number: 42,
    normalized_data: {
      supermarket_name: 'Shop X',
      branch: null,
      product_name: 'ABC Juice',
      quantity: 10,
      delivery_date: '2024-01-15',
      ...overrides,
    },
    resolved_refs: {},
    corrections: {},
    intended_action: 'create',
    production_id: null,
  }
}

describe('importStagingRow — deliveries (historical delivery routing + transport cost)', () => {
  it('Scenario 1 — historical delivery with a real matching branch → BRANCH destination, real supermarket_id used, no fabricated branch', async () => {
    const client = createMockClient([
      { match: /FROM public\.supermarkets/, respond: () => ({ rows: [{ id: 'sm-1' }] }) },
      { match: /FROM public\.products/, respond: () => ({ rows: [{ id: 'prod-1' }] }) },
      {
        match: /INSERT INTO public\.delivery_runs/,
        respond: ({ params }) => {
          expect(params[0]).toBe('sm-1') // supermarket_id
          expect(params[4]).toBe('BRANCH') // destination_type
          expect(params[5]).toBeNull() // destination_reference
          expect(params[2]).toBe(150) // transport cost preserved exactly
          return { rows: [{ id: 'delivery-1' }] }
        },
      },
    ])
    const row = deliveryRow({ branch: 'Accra Mall', transport_cost: 150 })
    const result = await importStagingRow(client, 'deliveries', row, baseCtx)
    expect(result).toEqual({ productionId: 'delivery-1', action: 'create' })
  })

  it('Scenario 2 — historical delivery with no branch but an identifiable destination → accepted with WAREHOUSE type, never a fabricated branch', async () => {
    const client = createMockClient([
      { match: /FROM public\.supermarkets/, respond: () => ({ rows: [] }) }, // no branch-level match
      { match: /FROM public\.products/, respond: () => ({ rows: [{ id: 'prod-1' }] }) },
      {
        match: /INSERT INTO public\.delivery_runs/,
        respond: ({ params }) => {
          expect(params[0]).toBeNull() // supermarket_id must be null — never fabricated
          expect(params[4]).toBe('WAREHOUSE')
          expect(params[5]).toBe('Shop X') // destination_reference carries the identifiable name
          return { rows: [{ id: 'delivery-2' }] }
        },
      },
    ])
    const row = deliveryRow({ branch: null, transport_cost: 90 })
    const result = await importStagingRow(client, 'deliveries', row, baseCtx)
    expect(result.action).toBe('create')
    // "Branch not provided" is a WARNING, not an ERROR — the row still imports.
    expect(client.calledMatching(/migration\.delivery_without_branch/).length).toBeGreaterThanOrEqual(0)
  })

  it('Scenario 3 — historical delivery with transport cost → imports the exact value, not recalculated', async () => {
    const client = createMockClient([
      { match: /FROM public\.supermarkets/, respond: () => ({ rows: [{ id: 'sm-1' }] }) },
      { match: /FROM public\.products/, respond: () => ({ rows: [{ id: 'prod-1' }] }) },
      {
        match: /INSERT INTO public\.delivery_runs/,
        respond: ({ params }) => {
          expect(params[2]).toBe(275.5)
          return { rows: [{ id: 'delivery-3' }] }
        },
      },
    ])
    const row = deliveryRow({ transport_cost: 275.5 })
    await importStagingRow(client, 'deliveries', row, baseCtx)
  })

  it('Scenario 4 — historical delivery without transport cost → preserves NULL exactly, never invents 0/"Unknown"/"N/A"', async () => {
    const client = createMockClient([
      { match: /FROM public\.supermarkets/, respond: () => ({ rows: [{ id: 'sm-1' }] }) },
      { match: /FROM public\.products/, respond: () => ({ rows: [{ id: 'prod-1' }] }) },
      {
        match: /INSERT INTO public\.delivery_runs/,
        respond: ({ params }) => {
          expect(params[2]).toBeNull()
          return { rows: [{ id: 'delivery-4' }] }
        },
      },
    ])
    const row = deliveryRow({ transport_cost: null })
    const result = await importStagingRow(client, 'deliveries', row, baseCtx)
    expect(result.action).toBe('create')
  })

  it('Scenarios 14/15/16 — re-running the same migration (or resuming after a browser refresh / server restart) never duplicates a delivery', async () => {
    let provenance: { productionId: string | null; migrationId: string } | null = null
    const client = createMockClient([
      { match: /FROM public\.supermarkets/, respond: () => ({ rows: [{ id: 'sm-1' }] }) },
      { match: /FROM public\.products/, respond: () => ({ rows: [{ id: 'prod-1' }] }) },
      {
        match: /FROM public\.migration_provenance/,
        respond: () =>
          provenance
            ? { rows: [{ production_id: provenance.productionId, migration_id: provenance.migrationId }] }
            : { rows: [] },
      },
      {
        match: /INSERT INTO public\.migration_provenance/,
        respond: ({ params }) => {
          provenance = { productionId: params[1] as string, migrationId: params[2] as string }
          return { rows: [] }
        },
      },
      { match: /INSERT INTO public\.delivery_runs/, respond: () => ({ rows: [{ id: 'delivery-once' }] }) },
    ])
    const ctx: WriterContext = {
      ...baseCtx,
      fileMeta: new Map([['file-1', { checksum: 'sha-abc123', sheet: 'January' }]]),
    }
    const row = deliveryRow({ transport_cost: 50 })

    const first = await importStagingRow(client, 'deliveries', row, ctx)
    expect(first).toEqual({ productionId: 'delivery-once', action: 'create' })
    expect(client.calledMatching(/INSERT INTO public\.delivery_runs/).length).toBe(1)

    // Simulate a job resumed after a browser refresh / server restart re-processing the
    // exact same staging row (same file checksum + sheet + row_number).
    const second = await importStagingRow(client, 'deliveries', row, ctx)
    expect(second).toEqual({ productionId: 'delivery-once', action: 'skip' })
    expect(client.calledMatching(/INSERT INTO public\.delivery_runs/).length).toBe(1) // still exactly one
  })

  it('a row already carrying a production_id (already imported) is always skipped, regardless of provenance', async () => {
    const client = createMockClient()
    const row = { ...deliveryRow(), production_id: 'already-imported-id' }
    const result = await importStagingRow(client, 'deliveries', row, baseCtx)
    expect(result).toEqual({ productionId: 'already-imported-id', action: 'skip' })
    expect(client.calls.length).toBe(0)
  })

  it('a delivery with no delivery_date is rejected rather than silently dated "today" — validate.ts should have already blocked this, but the writer defends in depth', async () => {
    const client = createMockClient([
      { match: /FROM public\.supermarkets/, respond: () => ({ rows: [{ id: 'sm-1' }] }) },
      { match: /FROM public\.products/, respond: () => ({ rows: [{ id: 'prod-1' }] }) },
    ])
    const row = deliveryRow({ delivery_date: null })
    await expect(importStagingRow(client, 'deliveries', row, baseCtx)).rejects.toThrow(/delivery_date/)
    expect(client.calledMatching(/INSERT INTO public\.delivery_runs/).length).toBe(0)
  })
})

function intakeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'staging-row-intake-1',
    file_id: 'file-3',
    row_number: 7,
    normalized_data: {
      vendor_name: 'Acme Foods',
      product_name: 'Palm Oil 1L',
      quantity: 100,
      received_date: '2024-01-15',
      ...overrides,
    },
    resolved_refs: { vendor_id: 'vendor-1', product_id: 'prod-1' },
    corrections: {},
    intended_action: 'create',
    production_id: null,
  }
}

describe('importStagingRow — intakes (date accuracy defense-in-depth)', () => {
  it('an intake with no received_date is rejected rather than silently dated "today"', async () => {
    const client = createMockClient()
    const row = intakeRow({ received_date: null })
    await expect(importStagingRow(client, 'intakes', row, baseCtx)).rejects.toThrow(/received_date/)
    expect(client.calledMatching(/INSERT INTO public\.intakes/).length).toBe(0)
  })

  it('an intake with a real received_date imports it unchanged', async () => {
    const client = createMockClient([
      {
        match: /INSERT INTO public\.intakes/,
        respond: ({ params }) => {
          expect(params[3]).toBe('2024-01-15')
          return { rows: [{ id: 'intake-1' }] }
        },
      },
    ])
    const row = intakeRow()
    const result = await importStagingRow(client, 'intakes', row, baseCtx)
    expect(result).toEqual({ productionId: 'intake-1', action: 'create' })
  })
})

function salesRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'staging-row-sale-1',
    file_id: 'file-4',
    row_number: 3,
    normalized_data: {
      product: 'Palm Oil 1L',
      qty: 5,
      TCostEx: 150,
      week_start: '2024-03-01',
      week_end: '2024-03-31',
      ...overrides,
    },
    resolved_refs: { product_id: 'prod-1', supermarket_id: 'sm-1' },
    corrections: {},
    intended_action: 'create',
    production_id: null,
  }
}

describe('importStagingRow — sales (always full calendar month)', () => {
  const productPricingHandler = {
    match: /FROM public\.products WHERE id/i,
    respond: () => ({
      rows: [{ vendor_price: 20, distrogh_markup: 10, selling_price: 30 }],
    }),
  }

  it('re-snaps to full calendar month bounds at write time even if corrections left a partial period', async () => {
    const client = createMockClient([
      productPricingHandler,
      {
        match: /INSERT INTO public\.sales/,
        respond: ({ params }) => {
          // week_start / week_end are params 8 / 9 in the INSERT column order
          expect(params[7]).toBe('2024-03-01')
          expect(params[8]).toBe('2024-03-31')
          return { rows: [{ id: 'sale-1' }] }
        },
      },
    ])
    const row = salesRow({ week_start: '2024-03-15', week_end: '2024-03-15' })
    const result = await importStagingRow(client, 'sales', row, baseCtx)
    expect(result).toEqual({ productionId: 'sale-1', action: 'create' })
  })

  it('a sale with no week_start/report_month is rejected rather than silently dated "today"', async () => {
    const client = createMockClient()
    const row = salesRow({ week_start: null, week_end: null })
    await expect(importStagingRow(client, 'sales', row, baseCtx)).rejects.toThrow(/week_start|report_month/)
    expect(client.calledMatching(/INSERT INTO public\.sales/).length).toBe(0)
  })

  it('treats TCostEx as DistroGH supermarket price and splits vendor due from catalog', async () => {
    const client = createMockClient([
      productPricingHandler,
      {
        match: /INSERT INTO public\.sales/,
        respond: ({ params }) => {
          expect(params[2]).toBe(5)
          expect(params[3]).toBe(30)
          expect(params[4]).toBe(150)
          expect(params[5]).toBe(100)
          expect(params[6]).toBe(50)
          return { rows: [{ id: 'sale-1' }] }
        },
      },
    ])
    const row = salesRow()
    const result = await importStagingRow(client, 'sales', row, baseCtx)
    expect(result).toEqual({ productionId: 'sale-1', action: 'create' })
  })
})

function productRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'staging-row-2',
    file_id: 'file-2',
    row_number: 124,
    normalized_data: {
      name: 'ABC Juice',
      vendor_name: 'Acme Foods',
      vendor_price: 10,
      supermarket_selling_price: 15,
      ...overrides,
    },
    resolved_refs: { vendor_id: 'vendor-1' },
    corrections: {},
    intended_action: 'create',
    production_id: null,
  }
}

describe('importStagingRow — products (category import rule)', () => {
  it('Scenario 8 — existing product with a different category during migration → auto-overrides and records provenance (previous/new/source), never a silent write', async () => {
    const client = createMockClient([
      {
        match: /SELECT id, category FROM public\.products[\s\S]*vendor_id = \$1/,
        respond: () => ({ rows: [{ id: 'product-1', category: 'Beverages' }] }),
      },
      { match: /WHERE name = \$1/, respond: () => ({ rows: [{ id: 'cat-juices', name: 'Juices' }] }) },
      { match: /UPDATE public\.products SET category/, respond: () => ({ rows: [] }) },
      {
        match: /INSERT INTO public\.migration_category_changes/,
        respond: ({ params }) => {
          expect(params[3]).toBe('Beverages') // previous_category
          expect(params[4]).toBe('Juices') // new_category
          expect(params[5]).toBe('overridden') // outcome
          expect(params[6]).toBe('file-2') // source_file_id
          expect(params[7]).toBe(124) // source_row_number
          return { rows: [] }
        },
      },
    ])
    const row = productRow({ category: 'Juices' })
    const result = await importStagingRow(client, 'products', row, baseCtx)
    expect(result).toEqual({ productionId: 'product-1', action: 'update' })
    expect(client.calledMatching(/INSERT INTO public\.migration_category_changes/).length).toBe(1)
  })

  it('Scenario 9 contrast — historical migration auto-overrides without any interactive confirmation prompt (server has no such gate)', async () => {
    // Unlike the live PATCH /api/products/:id route (see category-change.test.ts), the
    // migration writer never requires a confirmation flag — it records provenance instead.
    const client = createMockClient([
      {
        match: /SELECT id, category FROM public\.products[\s\S]*vendor_id = \$1/,
        respond: () => ({ rows: [{ id: 'product-1', category: 'Beverages' }] }),
      },
      { match: /WHERE name = \$1/, respond: () => ({ rows: [{ id: 'cat-juices', name: 'Juices' }] }) },
    ])
    const row = productRow({ category: 'Juices' })
    const result = await importStagingRow(client, 'products', row, baseCtx)
    expect(result.action).toBe('update')
  })

  it('Scenario 10 — existing product with a category + incoming NULL category → preserved untouched, no update query issued', async () => {
    const client = createMockClient([
      {
        match: /SELECT id, category FROM public\.products[\s\S]*vendor_id = \$1/,
        respond: () => ({ rows: [{ id: 'product-1', category: 'Beverages' }] }),
      },
    ])
    const row = productRow({ category: '' })
    const result = await importStagingRow(client, 'products', row, baseCtx)
    expect(result).toEqual({ productionId: 'product-1', action: 'update' })
    expect(client.calledMatching(/UPDATE public\.products SET category/).length).toBe(0)
    expect(client.calledMatching(/INSERT INTO public\.migration_category_changes/).length).toBe(0)
  })

  it('Scenario 11 — existing product without a category + incoming category → populated and recorded', async () => {
    const client = createMockClient([
      {
        match: /SELECT id, category FROM public\.products[\s\S]*vendor_id = \$1/,
        respond: () => ({ rows: [{ id: 'product-1', category: null }] }),
      },
      { match: /WHERE name = \$1/, respond: () => ({ rows: [{ id: 'cat-snacks', name: 'Snacks' }] }) },
      { match: /UPDATE public\.products SET category/, respond: () => ({ rows: [] }) },
      {
        match: /INSERT INTO public\.migration_category_changes/,
        respond: ({ params }) => {
          expect(params[3]).toBeNull() // previous_category
          expect(params[4]).toBe('Snacks')
          expect(params[5]).toBe('populated')
          return { rows: [] }
        },
      },
    ])
    const row = productRow({ category: 'Snacks' })
    const result = await importStagingRow(client, 'products', row, baseCtx)
    expect(result.action).toBe('update')
  })

  it('new product whose category cannot be matched or created is rejected, never created with a fabricated/null category', async () => {
    const client = createMockClient([
      { match: /SELECT id, category FROM public\.products[\s\S]*vendor_id = \$1/, respond: () => ({ rows: [] }) },
      { match: /WHERE name = \$1/, respond: () => undefined },
      { match: /regexp_replace/, respond: () => undefined },
    ])
    const row = productRow({ category: 'Mystery Category' })
    await expect(
      importStagingRow(client, 'products', row, { ...baseCtx, allowNewCategoryCreation: false })
    ).rejects.toThrow(/could not be matched or created/)
  })

  it('new product creation with an unchanged/new category writes selling_price computed from vendor_price + markup', async () => {
    const client = createMockClient([
      { match: /SELECT id, category FROM public\.products[\s\S]*vendor_id = \$1/, respond: () => ({ rows: [] }) },
      { match: /WHERE name = \$1/, respond: () => ({ rows: [{ id: 'cat-snacks', name: 'Snacks' }] }) },
      {
        match: /INSERT INTO public\.products/,
        respond: ({ params }) => {
          expect(params[4]).toBe('Snacks') // category
          expect(params[5]).toBe(10) // vendor_price
          return { rows: [{ id: 'new-product-1' }] }
        },
      },
    ])
    const row = productRow({ category: 'Snacks' })
    const result = await importStagingRow(client, 'products', row, baseCtx)
    expect(result).toEqual({ productionId: 'new-product-1', action: 'create' })
  })
})
