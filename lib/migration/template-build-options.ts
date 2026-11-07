import type { Pool } from 'pg'
import type { TemplateBuildOptions } from '@/lib/migration/template-xlsx'
import { fetchActiveVendorNames } from '@/lib/migration/template-vendors'
import { fetchActiveProductNames } from '@/lib/migration/template-products'
import {
  fetchSupermarketBranchLabels,
  fetchSupermarketChainNames,
} from '@/lib/migration/template-supermarkets'
import { fetchActiveCategoryNames } from '@/lib/migration/template-categories'

/** Load all live dropdown data for migration templates (always fetch — cheap queries, avoids per-entity gaps). */
export async function fetchMigrationTemplateBuildOptions(db: Pool): Promise<TemplateBuildOptions> {
  const [vendorNames, productNames, supermarketBranchLabels, supermarketNames, categoryNames] =
    await Promise.all([
      fetchActiveVendorNames(db),
      fetchActiveProductNames(db),
      fetchSupermarketBranchLabels(db),
      fetchSupermarketChainNames(db),
      fetchActiveCategoryNames(db),
    ])
  return {
    vendorNames,
    productNames,
    supermarketBranchLabels,
    supermarketNames,
    categoryNames,
  }
}
