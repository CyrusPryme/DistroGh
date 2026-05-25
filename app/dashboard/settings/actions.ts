'use server'

import { getDbPool } from '@/lib/db'
import { requireAdminSession } from '@/lib/auth/require'

export async function createCategory(name: string): Promise<{ id: string } | { error: string }> {
  try {
    await requireAdminSession()
  } catch {
    return { error: 'Only admins can add categories' }
  }

  const trimmed = name?.trim()
  if (!trimmed || trimmed.length > 100) {
    return { error: 'Category name must be 1–100 characters' }
  }

  const pool = getDbPool()
  try {
    const { rows } = await pool.query(
      `
      insert into public.categories (name)
      values ($1)
      returning id
      `,
      [trimmed]
    )
    return { id: rows[0].id }
  } catch (e: any) {
    if (e?.code === '23505') return { error: 'A category with this name already exists' }
    return { error: e?.message ?? 'Failed to create category' }
  }
}

export async function updateCategory(id: string, newName: string): Promise<{ ok: true } | { error: string }> {
  try {
    await requireAdminSession()
  } catch {
    return { error: 'Only admins can edit categories' }
  }

  const trimmed = newName?.trim()
  if (!trimmed || trimmed.length > 100) {
    return { error: 'Category name must be 1–100 characters' }
  }

  const pool = getDbPool()
  try {
    const prev = await pool.query(`select name from public.categories where id = $1::uuid limit 1`, [id])
    const prevName: string | null = (prev.rows[0]?.name ?? null) as any
    if (!prevName) return { error: 'Category not found' }

    await pool.query(
      `
      update public.categories
      set name = $1, updated_at = now()
      where id = $2::uuid
      `,
      [trimmed, id]
    )

    if (prevName !== trimmed) {
      await pool.query(
        `
        update public.products
        set category = $1, updated_at = now()
        where category = $2
        `,
        [trimmed, prevName]
      )
    }

    return { ok: true }
  } catch (e: any) {
    if (e?.code === '23505') return { error: 'A category with this name already exists' }
    return { error: e?.message ?? 'Failed to update category' }
  }
}

export async function deleteCategory(id: string): Promise<{ ok: true } | { error: string }> {
  try {
    await requireAdminSession()
  } catch {
    return { error: 'Only admins can delete categories' }
  }

  const pool = getDbPool()
  try {
    const prev = await pool.query(`select name from public.categories where id = $1::uuid limit 1`, [id])
    const prevName: string | null = (prev.rows[0]?.name ?? null) as any
    if (!prevName) return { error: 'Category not found' }

    await pool.query(
      `
      update public.products
      set category = null, updated_at = now()
      where category = $1
      `,
      [prevName]
    )
    await pool.query(`delete from public.categories where id = $1::uuid`, [id])
    return { ok: true }
  } catch (e: any) {
    return { error: e?.message ?? 'Failed to delete category' }
  }
}

export async function updateSystemSetting(
  key: string,
  value: unknown
): Promise<{ ok: true } | { error: string }> {
  try {
    await requireAdminSession()
  } catch {
    return { error: 'Only admins can update settings' }
  }

  const pool = getDbPool()
  try {
    await pool.query(
      `
      insert into public.system_settings (key, value, updated_at)
      values ($1, $2, now())
      on conflict (key) do update set value = excluded.value, updated_at = now()
      `,
      [key, value]
    )
    return { ok: true }
  } catch (e: any) {
    return { error: e?.message ?? 'Failed to update setting' }
  }
}
