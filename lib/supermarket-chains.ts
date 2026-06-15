import type { Supermarket } from '@/types'

/** Retailer chain names (supermarkets.name) — one chain can have many branch outlets. */
export function getSupermarketChainNames(supermarkets: Supermarket[]): string[] {
  return [...new Set(supermarkets.map((s) => s.name.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b)
  )
}

export function supermarketsInChain(supermarkets: Supermarket[], chainName: string): Supermarket[] {
  const norm = chainName.trim().toLowerCase()
  if (!norm) return []
  return supermarkets.filter((s) => s.name.trim().toLowerCase() === norm)
}
