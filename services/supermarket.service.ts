import { apiFetch } from '@/lib/api/client'
import { Supermarket, SupermarketInventory } from '@/types'

export interface SupermarketInventoryRow {
  supermarket_id: string
  supermarket_name: string
  product_id: string
  product_name: string
  quantity: number
}

export interface SupermarketSummary extends Supermarket {
  total_sales: number
  sales_count: number
  return_count: number
  delivery_run_count: number
}

export const supermarketService = {
  async getAll(): Promise<Supermarket[]> {
    return apiFetch<Supermarket[]>('/api/supermarkets', { fallbackError: 'Failed to load supermarkets' })
  },

  async create(payload: { name: string; location: string }): Promise<Supermarket> {
    return apiFetch<Supermarket>('/api/supermarkets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      fallbackError: 'Failed to create supermarket',
    })
  },

  async getSummaries(): Promise<SupermarketSummary[]> {
    return apiFetch<SupermarketSummary[]>('/api/supermarkets/summary', {
      fallbackError: 'Failed to load supermarket summaries',
    })
  },

  async getInventoryBySupermarket(): Promise<SupermarketInventoryRow[]> {
    const rows = await apiFetch<
      {
        supermarket_id: string
        supermarket_name?: string
        product_id: string
        product_name?: string
        quantity?: number
      }[]
    >('/api/supermarkets/inventory?format=by_supermarket', {
      fallbackError: 'Failed to load supermarket inventory',
    })
    return rows.map((row) => ({
      supermarket_id: row.supermarket_id,
      supermarket_name: row.supermarket_name ?? 'Unknown',
      product_id: row.product_id,
      product_name: row.product_name ?? 'Unknown',
      quantity: Number(row.quantity ?? 0),
    }))
  },

  async getAllInventory(): Promise<SupermarketInventory[]> {
    return apiFetch<SupermarketInventory[]>('/api/supermarkets/inventory?format=all', {
      fallbackError: 'Failed to load all supermarket inventory',
    })
  },
}
