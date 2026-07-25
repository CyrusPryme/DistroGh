import type { Pool } from 'pg'
import { buildDependencyGraph } from '@/lib/migration/entities'
import { listMigrationFiles } from '@/lib/migration/files'
import { parseAllActiveFiles } from '@/lib/migration/parse'
import { validateMigrationStaging } from '@/lib/migration/validate'
import { claimNextJob, updateJobProgress } from '@/lib/migration/jobs'
import { importStagingRow } from '@/lib/migration/writers'
import { updateMigrationProject, getMigrationProject, isMigrationAborted } from '@/lib/migration/projects'
import { writeMigrationAudit } from '@/lib/migration/audit'
import type { MigrationEntityType } from '@/lib/migration/types'

async function runAnalyse(pool: Pool, migrationId: string, actorId?: string | null) {
  await updateMigrationProject(pool, migrationId, { status: 'analysing', current_stage: 3 }, actorId)
  const files = await listMigrationFiles(pool, migrationId)
  const byEntity = new Map<MigrationEntityType, string[]>()
  for (const f of files) {
    if (!f.entity_type) continue
    const list = byEntity.get(f.entity_type) ?? []
    list.push(f.id)
    byEntity.set(f.entity_type, list)
  }
  const present = [...byEntity.entries()].map(([entity, file_ids]) => ({ entity, file_ids }))
  const { graph, importOrder } = buildDependencyGraph(present)
  await updateMigrationProject(
    pool,
    migrationId,
    {
      dependency_graph: graph,
      import_order: importOrder,
      current_stage: 3,
      wizard_state: { stage: 3, analysed_at: new Date().toISOString(), import_order: importOrder },
      progress_pct: 15,
    },
    actorId,
    'migration.analysed'
  )
  return { graph, importOrder }
}

async function runParse(pool: Pool, migrationId: string, actorId?: string | null) {
  await updateMigrationProject(pool, migrationId, { status: 'analysing', current_stage: 3 }, actorId)
  const results = await parseAllActiveFiles(pool, migrationId, actorId)
  await runAnalyse(pool, migrationId, actorId)
  return results
}

async function runImportChunk(pool: Pool, jobId: string, migrationId: string, entityType: MigrationEntityType) {
  const project = await getMigrationProject(pool, migrationId)
  if (!project || isMigrationAborted(project)) {
    await updateJobProgress(pool, jobId, {
      status: 'cancelled',
      error_message: 'Migration was cancelled',
    })
    return { done: true, processed: 0, cancelled: true }
  }

  const jobRes = await pool.query(`SELECT * FROM public.migration_jobs WHERE id = $1`, [jobId])
  const job = jobRes.rows[0]
  const chunkSize = Number(job.chunk_size || 250)
  const cursor = Number(job.last_cursor || 0)

  const { rows } = await pool.query(
    `SELECT id, normalized_data, resolved_refs, corrections, intended_action, production_id, row_number
     FROM public.migration_staging_rows
     WHERE migration_id = $1
       AND entity_type = $2
       AND production_id IS NULL
       AND validation_status IN ('valid','warning','corrected')
       AND intended_action <> 'skip'
       AND row_number > $3
     ORDER BY row_number ASC
     LIMIT $4`,
    [migrationId, entityType, cursor, chunkSize]
  )

  if (!rows.length) {
    await updateJobProgress(pool, jobId, {
      status: 'completed',
      progress_pct: 100,
      result_summary: { done: true },
    })
    return { done: true, processed: 0 }
  }

  const client = await pool.connect()
  let lastRow = cursor
  let created = 0
  let updated = 0
  let skipped = 0
  const productionIds: string[] = []

  try {
    await client.query('BEGIN')
    for (const row of rows) {
      try {
        const result = await importStagingRow(
          client,
          entityType,
          {
            id: row.id,
            normalized_data: row.normalized_data,
            resolved_refs: row.resolved_refs ?? {},
            corrections: row.corrections ?? {},
            intended_action: row.intended_action,
            production_id: row.production_id,
          },
          { migrationId, batchTag: jobId.slice(0, 8) }
        )
        if (result.action === 'create') created++
        if (result.action === 'update') updated++
        if (result.action === 'skip') skipped++
        if (result.productionId) {
          productionIds.push(result.productionId)
          await client.query(
            `UPDATE public.migration_staging_rows
             SET production_id = $2, imported_at = now(), import_phase = $3, updated_at = now()
             WHERE id = $1`,
            [row.id, result.productionId, entityType]
          )
        }
        lastRow = row.row_number
      } catch (e) {
        // Opening balances policy skip
        if (e instanceof Error && e.message === 'OPENING_BALANCES_REQUIRE_EXPLICIT_POLICY') {
          skipped++
          lastRow = row.row_number
          continue
        }
        throw e
      }
    }

    await client.query(
      `INSERT INTO public.migration_phase_results
        (migration_id, phase, entity_type, expected_count, imported_count, updated_count, skipped_count, status, production_ids, started_at, completed_at)
       VALUES ($1,'import',$2,$3,$4,$5,$6,'balanced',$7::uuid[], now(), now())
       ON CONFLICT (migration_id, phase, entity_type) DO UPDATE SET
         imported_count = public.migration_phase_results.imported_count + EXCLUDED.imported_count,
         updated_count = public.migration_phase_results.updated_count + EXCLUDED.updated_count,
         skipped_count = public.migration_phase_results.skipped_count + EXCLUDED.skipped_count,
         production_ids = public.migration_phase_results.production_ids || EXCLUDED.production_ids,
         completed_at = now()`,
      [migrationId, entityType, rows.length, created, updated, skipped, productionIds]
    )

    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }

  const total = Number(job.total_records) || 1
  const current = Math.min(total, Number(job.current_record || 0) + rows.length)
  const pct = Math.min(99, Math.round((current / total) * 1000) / 10)

  const afterProject = await getMigrationProject(pool, migrationId)
  if (!afterProject || isMigrationAborted(afterProject)) {
    await updateJobProgress(pool, jobId, {
      current_record: current,
      progress_pct: pct,
      last_cursor: String(lastRow),
      status: 'cancelled',
      error_message: 'Migration was cancelled',
    })
    return { done: true, processed: rows.length, cancelled: true }
  }

  await updateJobProgress(pool, jobId, {
    current_record: current,
    progress_pct: pct,
    last_cursor: String(lastRow),
    status: 'queued', // re-queue for next chunk
  })

  // unlock so claim can pick again
  await pool.query(
    `UPDATE public.migration_jobs SET status = 'queued', locked_at = NULL, locked_by = NULL WHERE id = $1`,
    [jobId]
  )

  return { done: false, processed: rows.length }
}

async function runReconcile(pool: Pool, migrationId: string) {
  const { rows } = await pool.query(
    `SELECT entity_type,
            COUNT(*) FILTER (WHERE validation_status IN ('valid','warning','corrected')) AS expected,
            COUNT(*) FILTER (WHERE production_id IS NOT NULL) AS imported
     FROM public.migration_staging_rows
     WHERE migration_id = $1
     GROUP BY entity_type`,
    [migrationId]
  )

  const reconciliation: Record<string, unknown> = {}
  let allBalanced = true
  for (const r of rows) {
    const expected = Number(r.expected)
    const imported = Number(r.imported)
    const balanced = expected === imported
    if (!balanced) allBalanced = false
    reconciliation[r.entity_type] = { expected, imported, status: balanced ? 'balanced' : 'mismatch' }
  }

  await updateMigrationProject(pool, migrationId, {
    reconciliation,
    status: allBalanced ? 'completed' : 'verifying',
    current_stage: allBalanced ? 10 : 9,
    progress_pct: allBalanced ? 100 : 95,
    rollback_available: true,
    completed_at: allBalanced ? new Date().toISOString() : null,
    wizard_state: { stage: allBalanced ? 10 : 9, reconciled_at: new Date().toISOString() },
  })

  return { reconciliation, allBalanced }
}

async function runRollback(pool: Pool, migrationId: string, actorId?: string | null) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // Soft-delete imported sales/payouts/returns/intakes/deliveries by production ids from phase results
    const { rows: phases } = await client.query(
      `SELECT entity_type, production_ids FROM public.migration_phase_results WHERE migration_id = $1`,
      [migrationId]
    )

    const softDeleteTables: Partial<Record<MigrationEntityType, string>> = {
      sales: 'sales',
      payouts: 'payouts',
      returns: 'product_returns',
      intakes: 'intakes',
      deliveries: 'delivery_runs',
      products: 'products',
      vendors: 'vendors',
      supermarkets: 'supermarkets',
    }

    let affected = 0
    for (const phase of phases) {
      const ids: string[] = phase.production_ids ?? []
      if (!ids.length) continue
      const entity = phase.entity_type as MigrationEntityType
      const table = softDeleteTables[entity]
      if (table) {
        const res = await client.query(
          `UPDATE public.${table} SET deleted_at = now() WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`,
          [ids]
        )
        affected += res.rowCount ?? 0
      }
      if (entity === 'deductions') {
        const res = await client.query(`DELETE FROM public.vendor_deductions WHERE id = ANY($1::uuid[])`, [ids])
        affected += res.rowCount ?? 0
      }
    }

    await client.query(
      `UPDATE public.migration_staging_rows SET production_id = NULL, imported_at = NULL WHERE migration_id = $1`,
      [migrationId]
    )
    await client.query(
      `INSERT INTO public.migration_rollback_log (migration_id, scope, rows_affected, details, performed_by)
       VALUES ($1,'full',$2,$3::jsonb,$4)`,
      [migrationId, affected, JSON.stringify({ phases: phases.length }), actorId ?? null]
    )
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }

  await updateMigrationProject(pool, migrationId, {
    status: 'rolled_back',
    rollback_available: false,
    current_stage: 10,
    progress_pct: 100,
  }, actorId, 'migration.rolled_back')
}

/**
 * Process up to `maxJobs` claimed jobs. Safe to call repeatedly (resume).
 */
export async function processMigrationJobs(pool: Pool, opts?: { maxJobs?: number; workerId?: string }) {
  const maxJobs = opts?.maxJobs ?? 3
  const workerId = opts?.workerId ?? `worker-${process.pid}`
  const results = []

  for (let i = 0; i < maxJobs; i++) {
    const job = await claimNextJob(pool, workerId)
    if (!job) break

    const project = await getMigrationProject(pool, job.migration_id)
    if (!project || isMigrationAborted(project)) {
      await updateJobProgress(pool, job.id, {
        status: 'cancelled',
        error_message: 'Migration was cancelled',
      })
      results.push({ jobId: job.id, type: job.job_type, cancelled: true })
      continue
    }

    try {
      if (job.job_type === 'analyse') {
        const r = await runAnalyse(pool, job.migration_id)
        await updateJobProgress(pool, job.id, { status: 'completed', progress_pct: 100, result_summary: r as unknown as Record<string, unknown> })
      } else if (job.job_type === 'parse') {
        const r = await runParse(pool, job.migration_id)
        await updateJobProgress(pool, job.id, { status: 'completed', progress_pct: 100, result_summary: { files: r.length } })
      } else if (job.job_type === 'validate') {
        const r = await validateMigrationStaging(pool, job.migration_id)
        await updateJobProgress(pool, job.id, { status: 'completed', progress_pct: 100, result_summary: r })
      } else if (job.job_type === 'import') {
        await updateMigrationProject(pool, job.migration_id, { status: 'importing', current_stage: 8 })
        const entity = job.entity_type
        if (!entity) throw new Error('Import job missing entity_type')

        // Set total if needed
        if (!job.total_records) {
          const { rows } = await pool.query(
            `SELECT COUNT(*)::int AS c FROM public.migration_staging_rows
             WHERE migration_id = $1 AND entity_type = $2 AND production_id IS NULL
               AND validation_status IN ('valid','warning','corrected')`,
            [job.migration_id, entity]
          )
          await updateJobProgress(pool, job.id, { total_records: rows[0].c })
        }

        const chunk = await runImportChunk(pool, job.id, job.migration_id, entity)
        results.push({ jobId: job.id, type: job.job_type, ...chunk })
        continue
      } else if (job.job_type === 'reconcile') {
        const r = await runReconcile(pool, job.migration_id)
        await updateJobProgress(pool, job.id, { status: 'completed', progress_pct: 100, result_summary: r as unknown as Record<string, unknown> })
      } else if (job.job_type === 'rollback') {
        await runRollback(pool, job.migration_id)
        await updateJobProgress(pool, job.id, { status: 'completed', progress_pct: 100 })
      }

      results.push({ jobId: job.id, type: job.job_type, done: true })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Job failed'
      await updateJobProgress(pool, job.id, { status: 'failed', error_message: msg })
      const failedProject = await getMigrationProject(pool, job.migration_id)
      await updateMigrationProject(pool, job.migration_id, {
        status: 'failed',
        error_summary: {
          ...(failedProject?.error_summary ?? {}),
          import_error: msg,
          failed_job_id: job.id,
          failed_job_type: job.job_type,
          failed_at: new Date().toISOString(),
        },
      })
      await writeMigrationAudit(pool, {
        migrationId: job.migration_id,
        action: 'migration.job_failed',
        details: { job_id: job.id, error: msg },
      })
      results.push({ jobId: job.id, type: job.job_type, error: msg })
    }
  }

  return results
}

export async function buildPreviewSummary(pool: Pool, migrationId: string) {
  const { rows } = await pool.query(
    `SELECT entity_type,
            COUNT(*) AS total,
            COUNT(*) FILTER (WHERE intended_action = 'create') AS to_create,
            COUNT(*) FILTER (WHERE intended_action = 'update') AS to_update,
            COUNT(*) FILTER (WHERE intended_action = 'skip') AS to_skip,
            COUNT(*) FILTER (WHERE validation_status = 'error') AS errors,
            COUNT(*) FILTER (WHERE validation_status = 'warning') AS warnings
     FROM public.migration_staging_rows
     WHERE migration_id = $1
     GROUP BY entity_type`,
    [migrationId]
  )
  const project = await getMigrationProject(pool, migrationId)
  const summary = {
    entities: rows,
    import_order: project?.import_order ?? [],
    generated_at: new Date().toISOString(),
  }
  await updateMigrationProject(pool, migrationId, {
    preview_summary: summary,
    current_stage: 6,
    wizard_state: { stage: 6, preview_at: summary.generated_at },
  })
  return summary
}
