import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, FileText, Printer, Lock, Edit, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'
import { supabase } from '@/lib/supabase/client'
import { db } from '@/lib/dexie/schema'
import { formatDate, todayString } from '@/lib/utils'
import { useSyncStore } from '@/store/syncStore'
import { fetchWithFallback } from '@/lib/utils/fetchWithFallback'
import type { UltrasoundReport, Patient } from '@/types'

async function fetchReports(): Promise<UltrasoundReport[]> {
  // ── Step 1: Always load from Dexie first ────────────────────────────────
  const allLocal = await db.ultrasound_reports
    .orderBy('study_date').reverse().toArray()

  // ── Step 2: Offline — return Dexie only ─────────────────────────────────
  if (!navigator.onLine) {
    return allLocal as unknown as UltrasoundReport[]
  }

  // ── Step 3: Online — fetch Supabase and WRITE into Dexie, then re-read ──
  // This ensures Dexie is always the single source of truth for the list.
  // We never try to merge arrays in memory (that logic had ID-mismatch bugs).
  try {
    const { data, error } = await supabase
      .from('ultrasound_reports')
      .select('*')
      .order('study_date', { ascending: false })
      .limit(500)

    if (error || !data || data.length === 0) {
      // Supabase unavailable or empty — Dexie is authoritative
      return allLocal as unknown as UltrasoundReport[]
    }

    // Write every Supabase record into Dexie (upsert by server_id / local_id)
    // This is the same logic as pullTableFromSupabase but targeted and safe:
    // we never delete anything here — only add/update.
    await db.transaction('rw', db.ultrasound_reports, async () => {
      for (const record of data) {
        try {
          const byServerId = await db.ultrasound_reports
            .where('server_id').equals(record.id).first()
          const byLocalId = !byServerId
            ? await db.ultrasound_reports.where('local_id').equals(record.id).first()
            : null
          const existing = byServerId ?? byLocalId

          if (existing) {
            // Only overwrite if not a locally-pending (unsaved) edit
            if (existing.sync_status !== 'pending') {
              await db.ultrasound_reports
                .where('local_id').equals(existing.local_id)
                .modify({
                  ...record,
                  id: existing.local_id,     // keep Dexie primary key stable
                  local_id: existing.local_id,
                  server_id: record.id,
                  sync_status: 'synced',
                })
            }
          } else {
            // New record from another device — insert it
            await db.ultrasound_reports.put({
              ...record,
              id: record.id,
              local_id: record.id,
              server_id: record.id,
              sync_status: 'synced',
            })
          }
        } catch {
          // skip individual failures silently
        }
      }
    })
  } catch {
    // Network error — Dexie is authoritative
  }

  // ── Step 4: Re-read Dexie after upsert — this is the final source ───────
  const final = await db.ultrasound_reports
    .orderBy('study_date').reverse().toArray()
  return final as unknown as UltrasoundReport[]
}

export function UltrasoundPage() {
  const [filter, setFilter] = useState<'all' | 'draft' | 'final'>('all')
  const [selectedDate, setSelectedDate] = useState('')  // empty = all dates
  const qc = useQueryClient()
  const { isOnline } = useSyncStore()

  const { data: reports = [], isLoading } = useQuery({
    queryKey: ['us-reports'],
    queryFn: fetchReports,
    staleTime: 60_000,          // 60 s — don't refetch too eagerly
    gcTime: 5 * 60_000,         // keep cache alive 5 min so sync invalidations don't blank the list
    refetchOnWindowFocus: false,
  })

  // Patient map for name lookup in list
  const { data: patientsMap = {} } = useQuery<Record<string, Patient>>({
    queryKey: ['patients-map'],
    queryFn: () => fetchWithFallback(
      async () => {
        const { data, error } = await supabase.from('patients').select('id, name, mrn, dob, gender, phone')
        if (error) throw error
        return Object.fromEntries((data ?? []).map((p: Patient) => [p.id, p])) as Record<string, Patient>
      },
      async () => {
        const all = await db.patients.toArray()
        const map: Record<string, Patient> = {}
        for (const p of all) {
          map[p.local_id] = p as unknown as Patient
          if (p.server_id) map[p.server_id] = p as unknown as Patient
        }
        return map
      },
    ),
  })

  const deleteReport = useMutation({
    mutationFn: async (id: string) => {
      await db.ultrasound_reports.filter((r) => r.local_id === id || r.server_id === id).delete()
      if (useSyncStore.getState().isOnline && navigator.onLine) {
        await supabase.from('ultrasound_reports').delete().eq('id', id)
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['us-reports'] })
    },
  })

  const handleDelete = (id: string) => {
    if (!window.confirm('Are you sure you want to delete this record? This cannot be undone.')) return
    deleteReport.mutate(id)
  }

  const filtered = reports
    .filter((r) => filter === 'all' || r.status === filter)
    .filter((r) => !selectedDate || r.study_date === selectedDate)

  return (
    <div>
      <PageHeader
        title="Ultrasound Department"
        subtitle={selectedDate ? `${formatDate(selectedDate)} | ${filtered.length} report${filtered.length !== 1 ? 's' : ''}` : `${reports.length} total reports`}
        actions={
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={selectedDate}
              max={todayString()}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
            {selectedDate && (
              <button
                onClick={() => setSelectedDate('')}
                className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                All Dates
              </button>
            )}
            <Link
              to="/ultrasound/new"
              className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
            >
              <Plus className="w-4 h-4" />
              New Report
            </Link>
          </div>
        }
      />

      {/* Filter tabs */}
      <div className="flex gap-2 mb-6">
        {(['all', 'draft', 'final'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2 rounded-lg text-sm font-medium capitalize transition-colors ${
              filter === f
                ? 'bg-purple-600 text-white'
                : 'bg-white border border-gray-300 text-gray-600 hover:bg-gray-50'
            }`}
          >
            {f === 'all' ? `All (${reports.length})` : `${f} (${reports.filter(r => r.status === f).length})`}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <LoadingSpinner label="Loading reports..." />
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Date</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Patient</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Study Type</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Referring Doctor</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-gray-400">
                    {selectedDate ? `No reports found for ${formatDate(selectedDate)}.` : 'No ultrasound reports found.'}
                  </td>
                </tr>
              ) : (
                filtered.map((report) => {
                  const patientName = patientsMap[report.patient_id]?.name ?? `${report.patient_id.slice(0, 8)}…`
                  return (
                    <tr key={report.local_id ?? report.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-600">{formatDate(report.study_date)}</td>
                      <td className="px-4 py-3 text-gray-800 font-medium">
                        {patientName}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1.5 text-purple-700">
                          <FileText className="w-3.5 h-3.5" />
                          {report.study_type}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{report.referring_doctor ?? '—'}</td>
                      <td className="px-4 py-3">
                        <StatusBadge status={report.status} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Link
                            to={`/ultrasound/${report.server_id ?? report.local_id ?? report.id}/edit`}
                            className="p-1.5 text-gray-500 hover:text-purple-600 hover:bg-purple-50 rounded"
                            title={report.status === 'final' ? 'View / Unlock to edit' : 'Edit'}
                          >
                            {report.status === 'final' ? <Lock className="w-3.5 h-3.5" /> : <Edit className="w-4 h-4" />}
                          </Link>
                          <Link
                            to={`/ultrasound/${report.server_id ?? report.local_id ?? report.id}/edit`}
                            className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded"
                          >
                            <Printer className="w-4 h-4" />
                          </Link>
                          <button
                            onClick={() => handleDelete(report.local_id ?? report.id)}
                            className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded"
                            title="Delete report"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
