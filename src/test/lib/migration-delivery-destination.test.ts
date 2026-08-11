import { describe, expect, it } from 'vitest'
import { resolveDeliveryDestination } from '@/lib/migration/delivery-destination'
import { createMockClient } from './mock-pg-client'

describe('resolveDeliveryDestination', () => {
  it('Scenario 1 — historical delivery with a matching branch → BRANCH, real supermarket id, never fabricated', async () => {
    const client = createMockClient([
      { match: /FROM public\.supermarkets/, respond: () => ({ rows: [{ id: 'sm-1' }] }) },
    ])
    const result = await resolveDeliveryDestination(client, {
      supermarket_name: 'Shop X',
      branch: 'Accra Mall',
    })
    expect(result).toEqual({
      destinationType: 'BRANCH',
      supermarketId: 'sm-1',
      destinationReference: null,
      branchTextProvidedButUnmatched: false,
    })
  })

  it('Scenario 2 — historical delivery without a branch, but destination identifiable (central warehouse) → WAREHOUSE, no fabricated branch', async () => {
    const client = createMockClient([{ match: /FROM public\.supermarkets/, respond: () => ({ rows: [] }) }])
    const result = await resolveDeliveryDestination(client, {
      supermarket_name: 'Shop X',
      branch: null,
      destination_type: 'WAREHOUSE',
      destination_reference: 'Central Warehouse',
    })
    expect(result.destinationType).toBe('WAREHOUSE')
    expect(result.supermarketId).toBeNull()
    expect(result.destinationReference).toBe('Central Warehouse')
  })

  it('accepts an unmatched supermarket name as a warehouse/distribution reference rather than fabricating a branch', async () => {
    const client = createMockClient([{ match: /FROM public\.supermarkets/, respond: () => ({ rows: [] }) }])
    const result = await resolveDeliveryDestination(client, {
      supermarket_name: 'Unknown Shop Co',
      branch: null,
    })
    expect(result.destinationType).toBe('WAREHOUSE')
    expect(result.supermarketId).toBeNull()
    expect(result.destinationReference).toBe('Unknown Shop Co')
  })

  it('Scenario — completely unidentifiable destination → UNKNOWN_HISTORICAL, still accepted, never fabricated', async () => {
    const client = createMockClient([{ match: /FROM public\.supermarkets/, respond: () => ({ rows: [] }) }])
    const result = await resolveDeliveryDestination(client, {})
    expect(result).toEqual({
      destinationType: 'UNKNOWN_HISTORICAL',
      supermarketId: null,
      destinationReference: null,
      branchTextProvidedButUnmatched: false,
    })
  })

  it('preserves valid branch information present in the source instead of discarding it', async () => {
    const client = createMockClient([
      {
        match: /FROM public\.supermarkets/,
        respond: ({ params }) => {
          expect(params).toEqual(['Shop X', 'North Branch'])
          return { rows: [{ id: 'sm-42' }] }
        },
      },
    ])
    const result = await resolveDeliveryDestination(client, { supermarket_name: 'Shop X', branch: 'North Branch' })
    expect(result.destinationType).toBe('BRANCH')
    expect(result.supermarketId).toBe('sm-42')
  })

  it('flags branch text that was supplied but could not be matched to a real branch', async () => {
    const client = createMockClient([{ match: /FROM public\.supermarkets/, respond: () => ({ rows: [] }) }])
    const result = await resolveDeliveryDestination(client, {
      supermarket_name: 'Shop X',
      branch: 'Nonexistent Branch',
      destination_type: 'DISTRIBUTION_POINT',
      destination_reference: 'North Depot',
    })
    expect(result.destinationType).toBe('DISTRIBUTION_POINT')
    expect(result.branchTextProvidedButUnmatched).toBe(true)
  })
})
