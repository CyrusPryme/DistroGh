export type MomoNetwork = 'MTN' | 'Vodafone' | 'AirtelTigo'

const VALID: MomoNetwork[] = ['MTN', 'Vodafone', 'AirtelTigo']

/** Map spreadsheet variants to the vendors.momo_network check constraint values. */
export function normalizeMomoNetwork(raw: unknown): MomoNetwork {
  const v = String(raw ?? '').trim()
  if (!v) return 'MTN'
  if (VALID.includes(v as MomoNetwork)) return v as MomoNetwork

  const lower = v.toLowerCase().replace(/[\s_-]+/g, '')
  if (lower.includes('mtn')) return 'MTN'
  if (lower.includes('vodafone') || lower.includes('telecel') || lower.includes('voda')) return 'Vodafone'
  if (lower.includes('airtel') || lower.includes('tigo') || lower === 'at') return 'AirtelTigo'

  return 'MTN'
}

export function momoNetworkWasNormalized(raw: unknown): boolean {
  const original = String(raw ?? '').trim()
  if (!original) return false
  if (VALID.includes(original as MomoNetwork)) return false
  return normalizeMomoNetwork(raw) !== original
}
