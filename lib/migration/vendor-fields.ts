/** Normalize spreadsheet header keys for matching. */
export function normFieldKey(key: string): string {
  return key.trim().toLowerCase().replace(/[\s_-]+/g, '')
}

const MOMO_NUMBER_KEYS = new Set([
  'momonumber',
  'momono',
  'momonum',
  'mobilemoney',
  'mobilemoneynumber',
  'mobilemoneyno',
  'mmnumber',
  'mmno',
  'walletnumber',
  'walletno',
  'momo',
])

const CONTACT_PHONE_KEYS = new Set([
  'contactphone',
  'contactnumber',
  'contactno',
  'contact',
  'telephone',
  'tel',
  'landline',
  'officephone',
  'businessphone',
])

/** Generic phone/mobile — contact unless a dedicated momo column exists on the row. */
const GENERIC_PHONE_KEYS = new Set(['phone', 'mobile', 'phonenumber', 'mobilenumber', 'cell', 'cellphone'])

export function normalizePhoneNumber(raw: unknown): string {
  const v = String(raw ?? '').trim()
  if (!v) return ''
  const digits = v.replace(/[^\d+]/g, '')
  return digits.startsWith('+') ? digits : digits.replace(/^\+/, '')
}

/**
 * Map spreadsheet column variants onto canonical vendor fields.
 * Keeps momo_number and contact_phone separate.
 */
export function normalizeVendorRowData(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...data }

  let momoFromAlias = ''
  let contactFromAlias = ''
  let genericPhone = ''

  for (const [key, value] of Object.entries(data)) {
    const k = normFieldKey(key)
    const val = normalizePhoneNumber(value)
    if (!val) continue

    if (MOMO_NUMBER_KEYS.has(k)) {
      if (!momoFromAlias) momoFromAlias = val
      continue
    }
    if (CONTACT_PHONE_KEYS.has(k)) {
      if (!contactFromAlias) contactFromAlias = val
      continue
    }
    if (GENERIC_PHONE_KEYS.has(k)) {
      if (!genericPhone) genericPhone = val
    }
  }

  // Canonical fields already present on row take precedence
  const existingMomo = normalizePhoneNumber(out.momo_number)
  const existingContact = normalizePhoneNumber(out.contact_phone ?? out.phone)

  if (!existingMomo) {
    out.momo_number = momoFromAlias || ''
  } else {
    out.momo_number = existingMomo
  }

  if (!existingContact) {
    // Generic "phone" is contact only when we also have an explicit momo column value
    out.contact_phone = contactFromAlias || (momoFromAlias ? genericPhone : '')
  } else {
    out.contact_phone = existingContact
  }

  // Legacy template used "phone" — if momo still empty but generic phone exists, treat as momo
  // only when no dedicated contact column was found (common single-column legacy sheets).
  if (!String(out.momo_number || '').trim() && genericPhone && !contactFromAlias && !momoFromAlias) {
    out.momo_number = genericPhone
    out.contact_phone = ''
  } else if (!String(out.contact_phone || '').trim() && genericPhone && String(out.momo_number || '').trim()) {
    out.contact_phone = genericPhone
  }

  if (out.contact_person_name == null && out.contact_person != null) {
    out.contact_person_name = out.contact_person
  }

  delete out.phone
  return out
}

export function resolveVendorPhones(data: Record<string, unknown>): {
  momoNumber: string
  contactPhone: string | null
} {
  const normalized = normalizeVendorRowData(data)
  const momoNumber = normalizePhoneNumber(normalized.momo_number)
  const contactPhone = normalizePhoneNumber(normalized.contact_phone) || null
  return { momoNumber, contactPhone }
}

export function validateVendorPhones(data: Record<string, unknown>): {
  errors: Array<{ code: string; message: string }>
  warnings: Array<{ code: string; message: string }>
  normalized: Record<string, unknown>
} {
  const normalized = normalizeVendorRowData(data)
  const errors: Array<{ code: string; message: string }> = []
  const warnings: Array<{ code: string; message: string }> = []

  const momo = normalizePhoneNumber(normalized.momo_number)
  const contact = normalizePhoneNumber(normalized.contact_phone)

  normalized.momo_number = momo
  normalized.contact_phone = contact

  if (!momo) {
    errors.push({
      code: 'MISSING_MOMO_NUMBER',
      message: 'momo_number is required (MoMo wallet for payouts). Use column momo_number or Mobile Money Number.',
    })
  } else if (momo.length < 10) {
    errors.push({
      code: 'INVALID_MOMO_NUMBER',
      message: 'momo_number must be at least 10 digits',
    })
  }

  if (!contact) {
    warnings.push({
      code: 'MISSING_CONTACT_PHONE',
      message: 'contact_phone is recommended for reaching the vendor (separate from MoMo wallet).',
    })
  } else if (contact.length < 10) {
    warnings.push({
      code: 'INVALID_CONTACT_PHONE',
      message: 'contact_phone looks too short — check the contact number column',
    })
  }

  if (momo && contact && momo === contact) {
    warnings.push({
      code: 'SAME_MOMO_AND_CONTACT',
      message: 'momo_number and contact_phone are identical — confirm both columns are correct',
    })
  }

  return { errors, warnings, normalized }
}
