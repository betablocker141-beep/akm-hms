import { useRef, useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useReactToPrint } from 'react-to-print'
import { Save, Printer, Lock, ChevronLeft, Wand2, Search, AlertCircle } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'
import { UltrasoundReportPrint } from '@/components/print/UltrasoundReportPrint'
import { supabase } from '@/lib/supabase/client'
import { db } from '@/lib/dexie/schema'
import { generateUUID, todayString, calculateAge } from '@/lib/utils'
import { useSyncStore } from '@/store/syncStore'
import { useAuthStore } from '@/store/authStore'
import { US_TEMPLATES } from '@/lib/ultrasound/templates'
import { US_STUDY_TYPES } from '@/types'
import type { UltrasoundReport, UsStudyType, Patient } from '@/types'

// Columns present in Dexie but NOT yet in the live Supabase schema.
// Strip these from every insert/update to prevent 400 Bad Request errors.
// After running add_missing_columns.sql in Supabase, remove this set.
const DEXIE_ONLY_FIELDS = new Set([
  'husbands_father_name',
  'history',
  'presenting_complaints',
  'prescription',
])

function stripDexieOnlyFields<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([k]) => !DEXIE_ONLY_FIELDS.has(k))
  ) as Partial<T>
}

async function searchPatients(q: string): Promise<Patient[]> {
  if (!q || q.length < 2) return []
  const { isOnline } = useSyncStore.getState()
  if (!isOnline) {
    const all = await db.patients.limit(50).toArray()
    const lq = q.toLowerCase()
    return all.filter(
      (p) => p.name.toLowerCase().includes(lq) || p.phone.includes(lq) || p.mrn.includes(lq)
    ) as unknown as Patient[]
  }
  const { data, error } = await supabase
    .from('patients')
    .select('*')
    .or(`name.ilike.%${q}%,phone.ilike.%${q}%,mrn.ilike.%${q}%`)
    .limit(10)
  if (error) throw error
  return data as Patient[]
}

const reportSchema = z.object({
  patient_id: z.string().min(1, 'Patient required'),
  study_type: z.string().min(1, 'Study type required'),
  study_date: z.string().min(1, 'Date required'),
  referring_doctor: z.string().optional(),
  findings: z.string().min(5, 'Findings required'),
  impression: z.string().min(3, 'Impression required'),
  recommendations: z.string().optional(),
  history: z.string().optional(),
  presenting_complaints: z.string().optional(),
  prescription: z.string().optional(),
})

type ReportForm = z.infer<typeof reportSchema>

export function ReportEditorPage() {
  const { id } = useParams<{ id?: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { hasPermission, user: currentUser } = useAuthStore()
  const canFinalize = hasPermission('canFinalizeUsReports')
  const printRef = useRef<HTMLDivElement>(null)
  const [showPrint, setShowPrint] = useState(false)
  const [currentReport, setCurrentReport] = useState<UltrasoundReport | null>(null)
  const [patientSearch, setPatientSearch] = useState('')
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null)
  const [unlocked, setUnlocked] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const { data: patientResults = [] } = useQuery({
    queryKey: ['us-patient-search', patientSearch],
    queryFn: () => searchPatients(patientSearch),
    enabled: patientSearch.length >= 2,
  })

  const { data: existing, isLoading } = useQuery({
    queryKey: ['us-report', id],
    queryFn: async () => {
      if (!id) return null
      const { isOnline: online } = useSyncStore.getState()
      const local = await db.ultrasound_reports
        .filter((rep) => rep.local_id === id || rep.server_id === id)
        .first()
      if (!online) return local as unknown as UltrasoundReport | undefined
      try {
        const { data, error } = await supabase.from('ultrasound_reports').select('*').eq('id', id).single()
        if (error || !data) return local as unknown as UltrasoundReport | undefined
        return data as UltrasoundReport
      } catch {
        return local as unknown as UltrasoundReport | undefined
      }
    },
    enabled: !!id,
  })

  const { register, handleSubmit, setValue, watch, formState: { errors } } = useForm<ReportForm>({
    resolver: zodResolver(reportSchema),
    defaultValues: {
      study_date: todayString(),
      study_type: 'Abdominal',
      findings: US_TEMPLATES['Abdominal'].findings,
      impression: US_TEMPLATES['Abdominal'].impression,
      recommendations: US_TEMPLATES['Abdominal'].recommendations,
    },
  })

  useEffect(() => {
    if (!existing) return
    setValue('patient_id', existing.patient_id)
    setValue('study_type', existing.study_type)
    setValue('study_date', existing.study_date)
    setValue('referring_doctor', existing.referring_doctor ?? '')
    setValue('findings', existing.findings)
    setValue('impression', existing.impression)
    setValue('recommendations', existing.recommendations ?? '')
    setValue('history', (existing as any).history ?? '')
    setValue('presenting_complaints', (existing as any).presenting_complaints ?? '')
    setValue('prescription', (existing as any).prescription ?? '')
    setCurrentReport(existing)

    if (!selectedPatient) {
      ;(async () => {
        const { isOnline: online } = useSyncStore.getState()
        let found: Patient | undefined
        if (online) {
          const { data } = await supabase.from('patients').select('*').eq('id', existing.patient_id).single()
          if (data) found = data as Patient
        }
        if (!found) {
          const local = await db.patients
            .filter((p) => p.server_id === existing.patient_id || p.local_id === existing.patient_id)
            .first()
          if (local) found = local as unknown as Patient
        }
        if (found) setSelectedPatient(found)
      })()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing?.id])

  const studyType = watch('study_type') as UsStudyType

  const loadTemplate = () => {
    const tmpl = US_TEMPLATES[studyType]
    if (tmpl) {
      setValue('findings', tmpl.findings)
      setValue('impression', tmpl.impression)
      setValue('recommendations', tmpl.recommendations)
      if (tmpl.history !== undefined) setValue('history', tmpl.history)
    }
  }

  const handlePrint = useReactToPrint({
    content: () => printRef.current,
    documentTitle: `US-Report-${currentReport?.id ?? 'new'}`,
  })

  const saveMutation = useMutation({
    mutationFn: async ({ data, finalize }: { data: ReportForm; finalize?: boolean }) => {
      setSaveError(null)
      const reportStatus: 'draft' | 'final' = finalize
        ? 'final'
        : existing?.status === 'final' && unlocked ? 'final' : 'draft'

      // Resolve patient UUID: local UUID → Supabase server UUID for FK safety
      let supabasePatientId = data.patient_id
      const localPatientRow = await db.patients
        .filter((p) => p.local_id === data.patient_id || p.server_id === data.patient_id)
        .first()
      if (localPatientRow?.server_id) supabasePatientId = localPatientRow.server_id

      // All fields — stored fully in Dexie
      const allFields = {
        patient_id: data.patient_id,
        study_type: data.study_type as UsStudyType,
        study_date: data.study_date,
        referring_doctor: data.referring_doctor || null,
        radiologist_id: null as string | null,
        findings: data.findings,
        impression: data.impression,
        recommendations: data.recommendations || null,
        images_urls: [] as string[],
        status: reportStatus,
        history: data.history || null,
        presenting_complaints: data.presenting_complaints || null,
        prescription: data.prescription || null,
        husbands_father_name: null as string | null,
      }

      // Supabase payload: remove columns not in live DB + use server patient UUID
      const supabasePayload = {
        ...stripDexieOnlyFields(allFields),
        patient_id: supabasePatientId,
      }

      if (id) {
        // ── UPDATE ──────────────────────────────────────────────────────────
        const { images_urls: _unused, ...dexieUpdate } = allFields
        await db.ultrasound_reports
          .filter((r) => r.local_id === id || r.server_id === id)
          .modify({ ...dexieUpdate, sync_status: 'pending' })

        if (useSyncStore.getState().isOnline && navigator.onLine) {
          const { images_urls: _imgs, ...updatePayload } = supabasePayload as any
          const { data: saved, error } = await supabase
            .from('ultrasound_reports')
            .update(updatePayload)
            .eq('id', id)
            .select()
            .single()
          if (error) {
            setSaveError(`Cloud sync failed: ${error.message}`)
            console.error('[us] update error', error)
          } else if (saved) {
            await db.ultrasound_reports
              .filter((r) => r.local_id === id || r.server_id === id)
              .modify({ server_id: saved.id, sync_status: 'synced' })
            setCurrentReport(saved as UltrasoundReport)
            return saved as UltrasoundReport
          }
        }

        const updated = await db.ultrasound_reports
          .filter((r) => r.local_id === id || r.server_id === id)
          .first()
        setCurrentReport(updated as unknown as UltrasoundReport)
        return updated as unknown as UltrasoundReport

      } else {
        // ── INSERT ──────────────────────────────────────────────────────────
        const localId = generateUUID()
        const dexieRecord = {
          id: localId,
          local_id: localId,
          server_id: null as string | null,
          ...allFields,
          created_at: new Date().toISOString(),
          sync_status: 'pending' as const,
        }

        // Save locally first — report is safe regardless of network outcome
        await db.ultrasound_reports.put(dexieRecord)

        if (useSyncStore.getState().isOnline && navigator.onLine) {
          const { data: saved, error } = await supabase
            .from('ultrasound_reports')
            .insert(supabasePayload)
            .select()
            .single()

          if (error) {
            // Data is safe in Dexie. Show warning but do NOT throw — let navigation proceed.
            setSaveError(`Saved locally. Cloud sync failed: ${error.message} — will retry automatically.`)
            console.error('[us] insert error', error)
            return dexieRecord as unknown as UltrasoundReport
          }

          if (saved) {
            // Align Dexie id with server UUID to prevent deduplication bugs
            await db.ultrasound_reports
              .where('local_id').equals(localId)
              .modify({ id: saved.id, server_id: saved.id, sync_status: 'synced' })
            setCurrentReport(saved as UltrasoundReport)
            return saved as UltrasoundReport
          }
        }

        setCurrentReport(dexieRecord as unknown as UltrasoundReport)
        return dexieRecord as unknown as UltrasoundReport
      }
    },
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: ['us-reports'] })
      if (!id && saved?.id) {
        navigate(`/ultrasound/${saved.id}/edit`)
      }
    },
    onError: (err: Error) => {
      setSaveError(`Save failed: ${err.message}`)
    },
  })

  const isLocked = existing?.status === 'final' && !unlocked

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <LoadingSpinner label="Loading report..." />
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title={id ? 'Edit Ultrasound Report' : 'New Ultrasound Report'}
        subtitle={unlocked ? 'Finalized report — editing unlocked' : isLocked ? 'This report is finalized.' : 'Fill in findings and impression'}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => navigate('/ultrasound')}
              className="flex items-center gap-1.5 text-gray-600 hover:text-gray-800 text-sm border border-gray-300 px-3 py-2 rounded-lg">
              <ChevronLeft className="w-4 h-4" /> Back
            </button>
            {currentReport && (
              <button onClick={() => setShowPrint(true)}
                className="flex items-center gap-2 border border-gray-300 hover:bg-gray-50 px-3 py-2 rounded-lg text-sm">
                <Printer className="w-4 h-4" /> Print / PDF
              </button>
            )}
          </div>
        }
      />

      {existing?.status === 'final' && !unlocked && (
        <div className="mb-6 flex items-center justify-between gap-2 bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg text-sm">
          <span className="flex items-center gap-2"><Lock className="w-4 h-4 flex-shrink-0" /> This report has been finalized.</span>
          <button type="button" onClick={() => setUnlocked(true)}
            className="ml-4 flex items-center gap-1.5 bg-green-700 hover:bg-green-800 text-white px-3 py-1.5 rounded text-xs font-medium">
            <Lock className="w-3 h-3" /> Unlock to Edit
          </button>
        </div>
      )}

      {unlocked && (
        <div className="mb-6 flex items-center gap-2 bg-yellow-50 border border-yellow-300 text-yellow-800 px-4 py-3 rounded-lg text-sm">
          <Lock className="w-4 h-4 flex-shrink-0" /> Report unlocked for editing. Save to update (stays finalized).
        </div>
      )}

      {saveError && (
        <div className="mb-4 flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{saveError}</span>
        </div>
      )}

      <form className="space-y-6">
        {!id && (
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h3 className="font-semibold text-gray-800 mb-4">Patient</h3>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input type="text" placeholder="Search by name, phone, or MRN…" value={patientSearch}
                onChange={(e) => setPatientSearch(e.target.value)}
                className="w-full pl-9 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
            </div>
            {patientResults.length > 0 && (
              <ul className="mt-2 border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-48 overflow-y-auto">
                {patientResults.map((p) => (
                  <li key={p.id} className="px-4 py-2.5 hover:bg-purple-50 cursor-pointer text-sm"
                    onClick={() => { setValue('patient_id', p.id); setSelectedPatient(p); setPatientSearch('') }}>
                    <span className="font-medium text-gray-800">{p.name}</span>
                    <span className="ml-2 text-gray-500 text-xs">{p.mrn} · {p.phone}</span>
                  </li>
                ))}
              </ul>
            )}
            {selectedPatient && (
              <div className="mt-3 p-3 bg-purple-50 rounded-lg text-sm text-purple-800">✓ {selectedPatient.name} — {selectedPatient.mrn}</div>
            )}
            {errors.patient_id && <p className="mt-1 text-xs text-red-600">{errors.patient_id.message}</p>}
            <input type="hidden" {...register('patient_id')} />
          </div>
        )}

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="font-semibold text-gray-800 mb-4">Study Details</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Study Type</label>
              <select {...register('study_type')} disabled={isLocked}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:bg-gray-50">
                {US_STUDY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Study Date</label>
              <input type="date" {...register('study_date')} disabled={isLocked}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:bg-gray-50" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Referring Doctor</label>
              <input type="text" {...register('referring_doctor')} disabled={isLocked} placeholder="Dr. Name"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:bg-gray-50" />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="font-semibold text-gray-800 mb-4">Clinical History</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">History</label>
              <textarea {...register('history')} disabled={isLocked} rows={3}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:bg-gray-50 font-mono" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Presenting Complaints</label>
              <textarea {...register('presenting_complaints')} disabled={isLocked} rows={3}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:bg-gray-50 font-mono" />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-800">Findings</h3>
            {!isLocked && (
              <button type="button" onClick={loadTemplate}
                className="flex items-center gap-1.5 text-xs text-purple-600 hover:text-purple-800 border border-purple-200 px-3 py-1.5 rounded-lg hover:bg-purple-50">
                <Wand2 className="w-3.5 h-3.5" /> Load Template
              </button>
            )}
          </div>
          <textarea {...register('findings')} disabled={isLocked} rows={12}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:bg-gray-50 font-mono" />
          {errors.findings && <p className="mt-1 text-xs text-red-600">{errors.findings.message}</p>}
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="font-semibold text-gray-800 mb-4">Impression</h3>
          <textarea {...register('impression')} disabled={isLocked} rows={4}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:bg-gray-50 font-mono" />
          {errors.impression && <p className="mt-1 text-xs text-red-600">{errors.impression.message}</p>}
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="font-semibold text-gray-800 mb-4">Recommendations</h3>
          <textarea {...register('recommendations')} disabled={isLocked} rows={3}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:bg-gray-50 font-mono" />
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="font-semibold text-gray-800 mb-4">Prescription</h3>
          <textarea {...register('prescription')} disabled={isLocked} rows={3}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:bg-gray-50 font-mono" />
        </div>

        {!isLocked && (
          <div className="flex items-center justify-end gap-3 pb-6">
            <button type="button" onClick={handleSubmit((d) => saveMutation.mutate({ data: d }))}
              disabled={saveMutation.isPending}
              className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 text-white px-5 py-2.5 rounded-lg text-sm font-medium disabled:opacity-50">
              <Save className="w-4 h-4" />
              {saveMutation.isPending ? 'Saving...' : 'Save Draft'}
            </button>
            {canFinalize && (
              <button type="button" onClick={handleSubmit((d) => saveMutation.mutate({ data: d, finalize: true }))}
                disabled={saveMutation.isPending}
                className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-5 py-2.5 rounded-lg text-sm font-medium disabled:opacity-50">
                <Lock className="w-4 h-4" /> Finalize Report
              </button>
            )}
          </div>
        )}
      </form>

      {showPrint && currentReport && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          {/* Outer card: flex column, NO overflow here — overflow lives on the inner scroll div */}
          <div className="bg-white rounded-xl w-full max-w-3xl shadow-2xl flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between flex-shrink-0 bg-white">
              <h2 className="font-semibold">Print Preview — Ultrasound Report</h2>
              <button onClick={() => setShowPrint(false)} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
            </div>
            {/* ↓ Scrollable body — overflow-y goes HERE, not on the outer card */}
            <div className="overflow-y-auto flex-1 p-4">
              <div ref={printRef}>
                <UltrasoundReportPrint
                  report={currentReport}
                  patientName={selectedPatient?.name}
                  patientMrn={selectedPatient?.mrn}
                  patientAge={selectedPatient?.dob ? `${calculateAge(selectedPatient.dob)} yrs / ${selectedPatient.gender}` : selectedPatient?.gender}
                  patientPhone={selectedPatient?.phone}
                  patientAddress={selectedPatient?.address ?? ''}
                  patientGender={selectedPatient?.gender}
                  printedBy={currentUser?.name ?? currentUser?.email ?? 'Staff'}
                  husbandsFatherName={(currentReport as any)?.husbands_father_name ?? undefined}
                />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex gap-3 justify-end flex-shrink-0">
              <button onClick={handlePrint}
                className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 text-white py-2.5 px-5 rounded-lg text-sm font-medium">
                <Printer className="w-4 h-4" /> Print / Save PDF
              </button>
              <button onClick={() => setShowPrint(false)}
                className="px-5 py-2.5 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
