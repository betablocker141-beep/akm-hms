/**
 * Offline Sync Engine
 * Push pending Dexie records to Supabase when back online.
 * Uses last-write-wins strategy with conflict detection.
 * Also pulls Supabase records into Dexie for offline availability.
 */
import { db } from '@/lib/dexie/schema'
import { supabase } from '@/lib/supabase/client'
import { useSyncStore } from '@/store/syncStore'
import { generateUUID } from '@/lib/utils'
import { queryClient } from '@/lib/queryClient'
import { markSupabaseOnline } from '@/lib/utils/fetchWithFallback'

type SyncableTable = keyof typeof TABLE_MAP

const TABLE_MAP = {
  patients: 'patients',
  doctors: 'doctors',
  opd_tokens: 'opd_tokens',
  er_visits: 'er_visits',
  ipd_admissions: 'ipd_admissions',
  ipd_procedures: 'ipd_procedures',
  ultrasound_reports: 'ultrasound_reports',
  invoices: 'invoices',
  birth_certificates: 'birth_certificates',
  death_certificates: 'death_certificates',
  online_bookings: 'online_bookings',
  hr_employees: 'hr_employees',
  salary_records: 'salary_records',
} as const

// Tables that should only pull recent records (last 60 days)
const DATE_SENSITIVE_TABLES = new Set<SyncableTable>(['opd_tokens', 'er_visits'])

// Fields stored only in Dexie (not in the matching Supabase table).
// These are stripped before any push to Supabase to avoid "column does not exist" errors.
const TABLE_EXCLUDE_FIELDS: Partial<Record<SyncableTable, Set<string>>> = {
  opd_tokens: new Set(['bp', 'pulse', 'temp', 'spo2', 'rr']),
}

// Tables that contain a patient_id FK — must resolve local UUID → server UUID before push.
const TABLES_WITH_PATIENT_ID = new Set<SyncableTable>([
  'ultrasound_reports', 'invoices', 'opd_tokens', 'er_visits',
  'ipd_admissions', 'birth_certificates', 'death_certificates', 'online_bookings',
])

/** Resolve a patient_id that may be a local UUID to its Supabase server UUID. */
async function resolvePatientId(localOrServerId: string): Promise<string> {
  if (!localOrServerId) return localOrServerId
  const pat = await db.patients
    .filter((p) => p.local_id === localOrServerId || p.server_id === localOrServerId)
    .first()
  return pat?.server_id ?? localOrServerId
}

// Tables that have NO created_at column in Supabase — must NOT use created_at ordering.
const TABLES_WITHOUT_CREATED_AT = new Set<SyncableTable>(['doctors'])

// Tables where we remove stale Dexie records after each pull.
// A stale record is one with sync_status='synced' whose server_id is no longer
// in Supabase (e.g. deleted elsewhere, or duplicated via an old sync bug).
// Excluded: date-windowed tables (opd_tokens, er_visits) — we only pull 60 days
// so older records should NOT be removed from local storage.
const CLEANUP_AFTER_PULL = new Set<SyncableTable>([
  // NOTE: 'ultrasound_reports' intentionally excluded — local reports must never
  // be auto-deleted even if a Supabase SELECT returns 0 rows (e.g. policy lag).
  'patients',
  'doctors',
  'invoices',
  'birth_certificates',
  'death_certificates',
  'hr_employees',
  'salary_records',
  'online_bookings',
  'ipd_admissions',
  'ipd_procedures',
])

// ── Egress control ────────────────────────────────────────────────────────
// Pushing local changes is cheap (only pending rows, usually none) so it can
// run often. PULLING the full dataset from Supabase is the expensive part
// (egress), so we throttle it hard. Override via VITE_SYNC_PULL_MINUTES.
const PULL_INTERVAL_MS =
  (Number(import.meta.env.VITE_SYNC_PULL_MINUTES) || 5) * 60_000
const PUSH_TICK_MS = 30_000
let _lastPullAt = 0

// Guard: prevent two runSync() calls from running at the same time.
let _syncRunning = false

// Guard: prevent initSyncListeners from registering duplicate handlers when
// the AppRoutes component mounts more than once (React StrictMode, HMR).
let _listenersInitialized = false

async function syncTable(tableName: SyncableTable) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const localTable = (db as any)[tableName]
  const pending = await localTable
    .where('sync_status')
    .equals('pending')
    .toArray()

  for (const record of pending) {
    try {
      // Strip Dexie-only fields + the local `id` so we never accidentally
      // overwrite the Supabase primary key column during an UPDATE.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { local_id, sync_status, server_id, id: _id, ...rest } = record
      // Also remove any fields that exist in Dexie but have no column in Supabase
      const excludeFields = TABLE_EXCLUDE_FIELDS[tableName]
      let serverRecord = excludeFields
        ? Object.fromEntries(Object.entries(rest).filter(([k]) => !excludeFields.has(k)))
        : { ...rest }

      // Resolve patient_id local UUID → Supabase server UUID to avoid FK violations
      if (TABLES_WITH_PATIENT_ID.has(tableName) && serverRecord.patient_id) {
        serverRecord.patient_id = await resolvePatientId(serverRecord.patient_id as string)
      }

      if (record.server_id) {
        // Update existing record
        const { error } = await supabase
          .from(TABLE_MAP[tableName])
          .update(serverRecord)
          .eq('id', record.server_id)

        if (error) throw error
      } else {
        // Insert new record — use the same UUID as local so that if pull runs
        // next it will find the record by local_id = server_id = newId.
        const newId = generateUUID()
        const { error } = await supabase
          .from(TABLE_MAP[tableName])
          .insert({ ...serverRecord, id: newId })

        if (error) throw error

        // Update Dexie: set id, server_id AND sync_status so it matches Supabase.
        // Setting id = newId = server_id is critical — without this the pull's
        // duplicate-detection sees id !== server_id and may delete the record.
        await localTable.where('local_id').equals(local_id).modify({
          id: newId,
          server_id: newId,
          sync_status: 'synced',
        })
        continue
      }

      await localTable.where('local_id').equals(local_id).modify({
        sync_status: 'synced',
      })
    } catch (err) {
      console.error(`[sync] failed to push ${tableName} record ${record.local_id}:`, err)
      // Only mark unique-constraint violations as conflict (permanent, no point retrying).
      // All other errors (network, FK violations waiting on another table) stay 'pending'
      // so the next sync cycle retries them automatically.
      const code = (err as { code?: string })?.code
      if (code === '23505') {
        await (db as any)[tableName]
          .where('local_id')
          .equals(record.local_id)
          .modify({ sync_status: 'conflict' })
      }
      // else: leave sync_status as 'pending' — retry on next cycle
    }
  }
}

/**
 * Returns true if any field present in `record` differs from `existing`.
 * Used to skip needless Dexie writes (and UI refetches) when a pulled row
 * is byte-for-byte the same as what we already have locally.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function recordDiffers(existing: any, record: any): boolean {
  for (const k of Object.keys(record)) {
    const a = existing[k]
    const b = record[k]
    if (a === b) continue
    // Compare objects/arrays structurally; primitives already failed === above
    if (a && b && typeof a === 'object' && typeof b === 'object') {
      if (JSON.stringify(a) === JSON.stringify(b)) continue
    }
    return true
  }
  return false
}

/** Pull one table. Returns the number of local records actually changed. */
async function pullTableFromSupabase(tableName: SyncableTable): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const localTable = (db as any)[tableName]
  let changed = 0

  // Build the Supabase query
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query: any = supabase.from(TABLE_MAP[tableName]).select('*')

  if (TABLES_WITHOUT_CREATED_AT.has(tableName)) {
    query = query.order('id')
  } else if (DATE_SENSITIVE_TABLES.has(tableName)) {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - 60)
    query = query
      .gte('created_at', cutoff.toISOString())
      .order('created_at', { ascending: false })
      .limit(500)
  } else {
    query = query.order('created_at', { ascending: false }).limit(500)
  }

  const { data, error } = await query
  if (error) throw error
  if (!data || data.length === 0) return 0

  const CHUNK = 50
  for (let i = 0; i < data.length; i += CHUNK) {
    const chunk = data.slice(i, i + CHUNK)
    await db.transaction('rw', localTable, async () => {
      for (const record of chunk) {
        try {
          // Look up by server_id first (normal path for synced records)
          const byServerId = await localTable
            .where('server_id')
            .equals(record.id)
            .first()

          // Also look up by local_id = record.id to catch records that were
          // inserted by a previous pull with local_id = server UUID
          const byLocalId = !byServerId
            ? await localTable.where('local_id').equals(record.id).first()
            : null

          const existing = byServerId ?? byLocalId

          if (existing) {
            // Only overwrite if not pending (don't clobber unsaved local edits)
            // AND only if the server copy actually differs — this avoids
            // pointless writes + UI refetches when nothing changed.
            if (existing.sync_status !== 'pending' && recordDiffers(existing, record)) {
              changed++
              await localTable
                .where('local_id')
                .equals(existing.local_id)
                .modify({ ...record, local_id: existing.local_id, server_id: record.id, sync_status: 'synced' })
            }
            // ── SAFE duplicate cleanup ───────────────────────────────────────
            // Only delete the byLocalId record if:
            //   1. Both lookups returned different records (genuine duplicate)
            //   2. The table is NOT ultrasound_reports (too risky to auto-delete)
            //   3. The byLocalId record is synced (not a pending local edit)
            // This prevents the bug where a report disappears because the engine
            // incorrectly identifies a local record as a "stale duplicate".
            if (
              byServerId &&
              byLocalId &&
              byServerId.local_id !== byLocalId.local_id &&
              tableName !== 'ultrasound_reports' &&
              byLocalId.sync_status === 'synced'
            ) {
              changed++
              await localTable.where('local_id').equals(byLocalId.local_id).delete()
            }
          } else {
            changed++
            await localTable.put({
              ...record,
              local_id: record.id,
              server_id: record.id,
              sync_status: 'synced',
            })
          }
        } catch {
          // Skip individual record errors silently
        }
      }
    })
    // Yield to the event loop between chunks
    await new Promise<void>((res) => setTimeout(res, 0))
  }

  // Remove stale Dexie records for tables where we pulled a full dataset.
  if (CLEANUP_AFTER_PULL.has(tableName)) {
    const pulledIds = new Set((data as { id: string }[]).map((r) => r.id))
    const allLocal = await localTable.toArray()
    const stale = (allLocal as { local_id: string; server_id: string | null; sync_status: string }[])
      .filter((r) => r.sync_status === 'synced' && r.server_id && !pulledIds.has(r.server_id))
    for (const r of stale) {
      try {
        changed++
        await localTable.where('local_id').equals(r.local_id).delete()
      } catch {
        // Skip if already gone
      }
    }
  }

  return changed
}

/** Pull every table. Returns the total number of local records changed. */
async function pullFromSupabase(): Promise<number> {
  let changed = 0
  for (const table of Object.keys(TABLE_MAP) as SyncableTable[]) {
    try {
      changed += await pullTableFromSupabase(table)
    } catch {
      // Don't let one failing table break the whole pull
    }
  }
  return changed
}

export async function runSync(opts: { forcePull?: boolean } = {}) {
  if (_syncRunning) return
  _syncRunning = true

  const { setOnline, setSyncing, setLastSyncAt, setPendingCount } =
    useSyncStore.getState()

  if (!navigator.onLine) {
    setOnline(false)
    _syncRunning = false
    return
  }

  setOnline(true)
  setSyncing(true)

  try {
    // Reset any records stuck in 'conflict' (from transient failures) back to 'pending'
    // so they get retried this cycle. Only genuine unique-violation conflicts stay stuck.
    for (const table of Object.keys(TABLE_MAP) as SyncableTable[]) {
      try {
        await (db as any)[table]
          .where('sync_status').equals('conflict')
          .modify({ sync_status: 'pending' })
      } catch { /* table may not exist yet */ }
    }

    for (const table of Object.keys(TABLE_MAP) as SyncableTable[]) {
      try {
        await syncTable(table)
      } catch {
        // Silently continue syncing other tables if one fails
      }
    }

    // Count remaining pending
    let total = 0
    for (const table of Object.keys(TABLE_MAP) as SyncableTable[]) {
      try {
        total += await (db as any)[table]
          .where('sync_status')
          .equals('pending')
          .count()
      } catch {
        // Skip tables that may not exist yet
      }
    }
    setPendingCount(total)
    setLastSyncAt(new Date().toISOString())

    markSupabaseOnline()

    // Only PULL on the throttled cadence (or when explicitly forced, e.g. on
    // reconnect / first load). This is the single biggest egress saver: a full
    // 13-table pull no longer runs every 30s, only every few minutes.
    const shouldPull =
      opts.forcePull || Date.now() - _lastPullAt >= PULL_INTERVAL_MS
    if (shouldPull) {
      const changed = await pullFromSupabase()
      _lastPullAt = Date.now()
      // Refetch open pages only when the pull actually changed local data.
      // This kills the per-cycle "refetch everything" storm that re-queried
      // Supabase from every mounted page on top of the pull itself.
      if (changed > 0) {
        await queryClient.invalidateQueries({ refetchType: 'all' })
      }
    }
  } finally {
    setSyncing(false)
    _syncRunning = false
  }
}

export async function countPending(): Promise<number> {
  let total = 0
  for (const table of Object.keys(TABLE_MAP) as SyncableTable[]) {
    total += await (db as any)[table]
      .where('sync_status')
      .equals('pending')
      .count()
  }
  return total
}

/** Listen for online/offline events and trigger sync */
export function initSyncListeners() {
  if (_listenersInitialized) return
  _listenersInitialized = true

  const { setOnline } = useSyncStore.getState()

  window.addEventListener('online', async () => {
    setOnline(true)
    // Coming back online: force a full pull to reconcile immediately.
    await runSync({ forcePull: true })
  })

  window.addEventListener('offline', () => {
    setOnline(false)
    void queryClient.invalidateQueries({ refetchType: 'all' })
  })

  // Re-sync when the user returns to the tab (force a pull if it's been a
  // while), so a backgrounded tab shows fresh data the moment it's focused.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && navigator.onLine) {
      runSync({ forcePull: Date.now() - _lastPullAt >= PULL_INTERVAL_MS })
        .catch(() => { /* silent */ })
    }
  })

  if (navigator.onLine) {
    runSync({ forcePull: true })
  }

  // Background tick: pushes pending local changes (cheap) and pulls on the
  // throttled cadence. Skip entirely when the tab is hidden — no point
  // polling Supabase for a tab nobody is looking at (a major egress saver
  // since staff leave the app open all day).
  setInterval(() => {
    if (document.hidden || !navigator.onLine) return
    runSync().catch(() => { /* silent */ })
  }, PUSH_TICK_MS)
}
