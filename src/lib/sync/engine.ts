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

// Tables that have NO created_at column in Supabase — must NOT use created_at ordering.
// Pulling these without ordering/limit fetches all rows (fine for small reference tables).
const TABLES_WITHOUT_CREATED_AT = new Set<SyncableTable>(['doctors'])

// Tables where we remove stale Dexie records after each pull.
// A stale record is one with sync_status='synced' whose server_id is no longer
// in Supabase (e.g. deleted elsewhere, or duplicated via an old sync bug).
// Excluded: date-windowed tables (opd_tokens, er_visits) — we only pull 60 days
// so older records should NOT be removed from local storage.
const CLEANUP_AFTER_PULL = new Set<SyncableTable>([
  'ultrasound_reports',
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

// Guard: prevent two runSync() calls from running at the same time.
// Without this, the online event + setInterval could race and create duplicate records.
let _syncRunning = false

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
      const serverRecord = excludeFields
        ? Object.fromEntries(Object.entries(rest).filter(([k]) => !excludeFields.has(k)))
        : rest

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

        // Update Dexie: set server_id AND update id field so it matches Supabase
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
      await (db as any)[tableName]
        .where('local_id')
        .equals(record.local_id)
        .modify({ sync_status: 'conflict' })
    }
  }
}

async function pullTableFromSupabase(tableName: SyncableTable) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const localTable = (db as any)[tableName]

  // Build the Supabase query — tables without created_at (e.g. doctors) must
  // NOT use created_at ordering or they silently fail and never sync.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query: any = supabase.from(TABLE_MAP[tableName]).select('*')

  if (TABLES_WITHOUT_CREATED_AT.has(tableName)) {
    // Small reference tables — fetch all rows, order by id (always exists)
    query = query.order('id')
  } else if (DATE_SENSITIVE_TABLES.has(tableName)) {
    // Only last 60 days for high-volume date-keyed tables
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
  if (!data || data.length === 0) return

  // Process in chunks of 50 to avoid long-running IndexedDB transactions
  // that would block concurrent writes (e.g. patient registration offline)
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
            if (existing.sync_status !== 'pending') {
              await localTable
                .where('local_id')
                .equals(existing.local_id)
                .modify({ ...record, local_id: existing.local_id, server_id: record.id, sync_status: 'synced' })
            }
            // If BOTH lookups returned a record and they're different, we have a
            // duplicate — delete the extra one now.
            if (byServerId && byLocalId && byServerId.local_id !== byLocalId.local_id) {
              await localTable.where('local_id').equals(byLocalId.local_id).delete()
            }
          } else {
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
    // Yield to the event loop between chunks so other DB ops can proceed
    await new Promise<void>((res) => setTimeout(res, 0))
  }

  // Remove stale Dexie records for tables where we pulled a full (or near-full)
  // dataset. A record is stale if it was previously synced but its server_id is
  // no longer present in Supabase — e.g. deleted on another device.
  if (CLEANUP_AFTER_PULL.has(tableName)) {
    const pulledIds = new Set((data as { id: string }[]).map((r) => r.id))
    // Collect synced Dexie records whose server_id isn't in the pulled set
    const allLocal = await localTable.toArray()
    const stale = (allLocal as { local_id: string; server_id: string | null; sync_status: string }[])
      .filter((r) => r.sync_status === 'synced' && r.server_id && !pulledIds.has(r.server_id))
    for (const r of stale) {
      try {
        await localTable.where('local_id').equals(r.local_id).delete()
      } catch {
        // Skip if already gone
      }
    }
  }
}

async function pullFromSupabase() {
  for (const table of Object.keys(TABLE_MAP) as SyncableTable[]) {
    try {
      await pullTableFromSupabase(table)
    } catch {
      // Don't let one failing table break the whole pull
    }
  }
}

export async function runSync() {
  // Prevent concurrent runs (online event + setInterval could both fire)
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

    // Mark Supabase as reachable (resets the circuit breaker in fetchWithFallback)
    markSupabaseOnline()

    // Pull Supabase records into Dexie for offline availability
    await pullFromSupabase()
    await queryClient.invalidateQueries({ refetchType: 'all' })
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
  const { setOnline } = useSyncStore.getState()

  window.addEventListener('online', async () => {
    setOnline(true)
    await runSync()
    // Extra invalidation after sync so UI updates without any manual refresh
    await queryClient.invalidateQueries({ refetchType: 'all' })
  })

  window.addEventListener('offline', () => {
    setOnline(false)
    // Re-run all active queries so they switch to Dexie fallback immediately
    void queryClient.invalidateQueries({ refetchType: 'all' })
  })

  // Initial sync if online
  if (navigator.onLine) {
    runSync()
  }

  // Periodic background sync every 30 s — keeps data fresh without any page
  // refresh. If offline, runSync() returns early; when back online it syncs.
  setInterval(() => {
    runSync().catch(() => { /* silent */ })
  }, 30_000)
}
