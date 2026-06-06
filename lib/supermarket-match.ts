export interface SupermarketLookup {
  id: string
  name: string
  branch?: string | null
  store_code?: string | null
}

function normaliseToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** Match spreadsheet BRANCH / store columns to a supermarket outlet record. */
export function matchSupermarketByBranch(
  branch: string,
  storeCode: string,
  supermarkets: SupermarketLookup[]
): SupermarketLookup | null {
  const normBranch = normaliseToken(branch)
  const normStore = normaliseToken(storeCode)

  if (normStore) {
    const byStore = supermarkets.filter((s) => normaliseToken(s.store_code ?? '') === normStore)
    if (byStore.length === 1) return byStore[0]
    if (byStore.length > 1 && normBranch) {
      const withBranch = byStore.find((s) => normaliseToken(s.branch ?? '') === normBranch)
      if (withBranch) return withBranch
    }
  }

  if (normBranch) {
    const byBranch = supermarkets.filter((s) => normaliseToken(s.branch ?? '') === normBranch)
    if (byBranch.length === 1) return byBranch[0]
  }

  return null
}
