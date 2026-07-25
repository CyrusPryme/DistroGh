export const MIGRATION_STAGES = [
  { stage: 1, key: 'create', label: 'Create Migration' },
  { stage: 2, key: 'upload', label: 'Upload Files' },
  { stage: 3, key: 'relationships', label: 'Relationship Analysis' },
  { stage: 4, key: 'validation', label: 'Validation' },
  { stage: 5, key: 'corrections', label: 'Corrections' },
  { stage: 6, key: 'preview', label: 'Preview' },
  { stage: 7, key: 'approval', label: 'Approval' },
  { stage: 8, key: 'import', label: 'Import' },
  { stage: 9, key: 'verification', label: 'Verification' },
  { stage: 10, key: 'report', label: 'Completion Report' },
] as const

export type MigrationStatus =
  | 'draft'
  | 'analysing'
  | 'awaiting_correction'
  | 'ready'
  | 'approved'
  | 'importing'
  | 'paused'
  | 'verifying'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'rolled_back'
  | 'archived'

export type MigrationEntityType =
  | 'categories'
  | 'vendors'
  | 'products'
  | 'supermarket_chains'
  | 'supermarkets'
  | 'intakes'
  | 'deliveries'
  | 'sales'
  | 'returns'
  | 'deductions'
  | 'payouts'
  | 'service_charges'
  | 'opening_balances'
  | 'vendor_documents'

export type ValidationStatus = 'pending' | 'running' | 'passed' | 'failed' | 'warnings'
export type RowValidationStatus = 'pending' | 'valid' | 'warning' | 'error' | 'corrected'
export type IntendedAction = 'create' | 'update' | 'skip' | 'merge_candidate'
export type JobType = 'analyse' | 'parse' | 'validate' | 'import' | 'reconcile' | 'rollback'
export type JobStatus = 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'

export interface MigrationProject {
  id: string
  name: string
  description: string | null
  status: MigrationStatus
  current_stage: number
  progress_pct: number
  validation_status: ValidationStatus
  rollback_available: boolean
  wizard_state: Record<string, unknown>
  dependency_graph: DependencyNode[]
  import_order: MigrationEntityType[]
  preview_summary: Record<string, unknown>
  reconciliation: Record<string, unknown>
  error_summary: Record<string, unknown>
  warning_summary: Record<string, unknown>
  files_uploaded: number
  error_count: number
  warning_count: number
  created_by: string | null
  approved_by: string | null
  created_at: string
  updated_at: string
  started_at: string | null
  last_activity_at: string
  completed_at: string | null
  archived_at: string | null
}

export interface MigrationFile {
  id: string
  migration_id: string
  entity_type: MigrationEntityType | null
  original_filename: string
  mime_type: string | null
  size_bytes: number
  checksum_sha256: string | null
  parse_status: string
  parse_error: string | null
  row_count: number
  sheet_names: string[]
  detected_columns: string[]
  uploaded_at: string
  is_active: boolean
}

export interface DependencyNode {
  entity: MigrationEntityType
  depends_on: MigrationEntityType[]
  file_ids: string[]
  rank: number
}

export interface StagingRow {
  id: string
  migration_id: string
  file_id: string | null
  entity_type: MigrationEntityType
  row_number: number
  raw_data: Record<string, unknown>
  normalized_data: Record<string, unknown>
  validation_status: RowValidationStatus
  errors: Array<{ code: string; message: string }>
  warnings: Array<{ code: string; message: string }>
  match_suggestions: Array<{ id: string; label: string; confidence: number }>
  corrections: Record<string, unknown>
  resolved_refs: Record<string, string>
  intended_action: IntendedAction
  production_id: string | null
}

export interface MigrationJob {
  id: string
  migration_id: string
  job_type: JobType
  entity_type: MigrationEntityType | null
  status: JobStatus
  progress_pct: number
  current_record: number
  total_records: number
  chunk_size: number
  last_cursor: string | null
  error_message: string | null
  result_summary: Record<string, unknown>
}
