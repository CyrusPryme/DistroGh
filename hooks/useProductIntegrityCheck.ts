'use client'

import { useEffect, useState } from 'react'
import { productService } from '@/services/product.service'
import type { ProductIntegrityResult } from '@/lib/product-integrity'

const DEBOUNCE_MS = 400

export function useProductIntegrityCheck(
  fields: { name: string; sku: string; barcode: string },
  excludeProductId?: string | null,
  enabled = true
) {
  const [result, setResult] = useState<ProductIntegrityResult | null>(null)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    if (!enabled) {
      setResult(null)
      setChecking(false)
      return
    }

    const name = fields.name.trim()
    const sku = fields.sku.trim()
    const barcode = fields.barcode.trim()

    if (!name && !sku && !barcode) {
      setResult(null)
      setChecking(false)
      return
    }

    let cancelled = false
    setChecking(true)

    const timer = window.setTimeout(() => {
      productService
        .checkIntegrity({ name, sku, barcode, excludeProductId })
        .then((data) => {
          if (!cancelled) setResult(data)
        })
        .catch(() => {
          if (!cancelled) setResult(null)
        })
        .finally(() => {
          if (!cancelled) setChecking(false)
        })
    }, DEBOUNCE_MS)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [fields.name, fields.sku, fields.barcode, excludeProductId, enabled])

  return { result, checking }
}
