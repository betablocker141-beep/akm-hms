import { useRef, useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useReactToPrint } from 'react-to-print'
import { Save, Printer, Lock, ChevronLeft, Wand2, Search } from 'lucide-react'
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
  const { isOnline } = useSyncStore()
  const { hasPermission, user: currentUser } = useAuthStore()
  const canFinalize = hasPermission('canFinalizeUsReports')
  const printRef = useRef<HTMLDivElement>(null)
  const [showPrint, setShowPrint] = useState(false)
  const [currentReport, setCurrentReport] = useState<UltrasoundReport | null>(null)
  const [patientSearch, setPatientSearch] = useState('')
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null)
  const [unlocked, setUnlocked] = useState(false)

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
      // Always try Dexie first — works offline and catches locally-saved pending records
      const local = await db.ultrasound_reports
        .filter((rep) => rep.local_id === id || rep.server_id === id)
        .first()
      if (!online) return local as unknown as UltrasoundReport | undefined
      // Online: fetch from Supabase, fall back to Dexie if not found there
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

  // Populate form when editing — also reload patient so the patient block
  // shows correctly after navigate() remounts the component on first save.
  useEffect(() => {
    if (!existing) return
    setValue('patient_id', existing.patient_id)
    setValue('study_type', existing.study_type)
    setValue('study_date', existing.study_date)
    setValue('referring_doctor', existing.referring_doctor ?? '')
    setValue('findings', existing.findings)
    setValue('impression', existing.impression)
    setValue('recommendations', existing.recommendations ?? '')
    setValue('history', existing.history ?? '')
    setValue('presenting_complaints', existing.presenting_complaints ?? '')
    setValue('prescription', existing.prescription ?? '')
    setCurrentReport(existing)

    // Reload the patient so it shows in the patient info block
    // (selectedPatient is reset when the component re-mounts after navigate)
    if (!selectedPatient) {
      ;(async () => {
        const { isOnline: online } = useSyncStore.getState()
        let found: Patient | undefined
        if (online) {
          const { data } = await supabase
            .from('patients')
            .select('*')
            .eq('id', existing.patient_id)
            .single()
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
      if (tmpl.history !== undefined) {
        setValue('history', tmpl.history)
      }
    }
  }

  const handlePrint = useReactToPrint({
    content: () => printRef.current,
    documentTitle: `US-Report-${currentReport?.id ?? 'new'}`,
  })

  const saveMutation = useMutation({
    mutationFn: async ({ data, finalize }: { data: ReportForm; finalize?: boolean }) => {
      const reportStatus: 'draft' | 'final' = finalize ? 'final' : (existing?.status === 'final' && unlocked ? 'final' : 'draft')

      const fields = {
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

      // Only valid Supabase columns
      const supabasePayload = { ...fields }

      if (id) {
        // --- UPDATE existing report ---
        // Preserve images_urls from the existing record — don't overwrite with []
        const { images_urls: _unused, ...fieldsWithoutImages } = fields
        await db.ultrasound_reports
          .filter((r) => r.local_id === id || r.server_id === id)
          .modify({ ...fieldsWithoutImages, sync_status: 'pending' })

        if (useSyncStore.getState().isOnline && navigator.onLine) {
          const { images_urls: _imgs, ...updatePayload } = supabasePayload
          const { data: saved, error } = await supabase
            .from('ultrasound_reports')
            .update(updatePayload)
            .eq('id', id)
            .select()
            .single()
          if (error) throw new Error(error.message)
          if (saved) {
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
        // --- INSERT new report ---
        const localId = generateUUID()
        const record = {
          id: localId,
          local_id: localId,
          server_id: null as string | null,
          ...fields,
          created_at: new Date().toISOString(),
          sync_status: 'pending' as const,
        }

        await db.ultrasound_reports.put(record)

        if (useSyncStore.getState().isOnline && navigator.onLine) {
          const { data: saved, error } = await supabase
            .from('ultrasound_reports')
            .insert(supabasePayload)
            .select()
            .single()
          if (error) {
            // Leave the local draft intact so the sync engine can retry —
            // DO NOT delete it (that was losing reports entirely).
            console.error('[us] Supabase insert failed, kept as pending:', error.message)
          } else if (saved) {
            await db.ultrasound_reports
              .where('local_id')
              .equals(localId)
              .modify({ server_id: saved.id, sync_status: 'synced' })
            setCurrentReport(saved as UltrasoundReport)
            return saved as UltrasoundReport
          }
        }

        setCurrentReport(record as unknown as UltrasoundReport)
        return record as unknown as UltrasoundReport
      }
    },
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: ['us-reports'] })
      // After creating a new report, navigate to its edit URL so subsequent
      // saves update the same record instead of creating duplicates.
      if (!id && saved?.id) {
        navigate(`/ultrasound/${saved.id}/edit`)
      }
    },
    onError: (err: Error) => {
      alert(`Save failed: ${err.message}\n\nPlease try again or contact support.`)
    },
  })

  // Finalized reports are locked — but users with finalize permission can unlock
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
            <button
              onClick={() => navigate('/ultrasound')}
              className="flex items-center gap-1.5 text-gray-600 hover:text-gray-800 text-sm border border-gray-300 px-3 py-2 rounded-lg"
            >
              <ChevronLeft className="w-4 h-4" />
              Back
            </button>
            {currentReport && (
              <button
                onClick={() => { setShowPrint(true) }}
                className="flex items-center gap-2 border border-gray-300 hover:bg-gray-50 px-3 py-2 rounded-lg text-sm"
              >
                <Printer className="w-4 h-4" />
                Print / PDF
              </button>
            )}
          </div>
        }
      />

      {existing?.status === 'final' && !unlocked && (
        <div className="mb-6 flex items-center justify-between gap-2 bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg text-sm">
          <span className="flex items-center gap-2">
            <Lock className="w-4 h-4 flex-shrink-0" />
            This report has been finalized.
          </span>
          <button
            type="button"
            onClick={() => setUnlocked(true)}
            className="ml-4 flex items-center gap-1.5 bg-green-700 hover:bg-green-800 text-white px-3 py-1.5 rounded text-xs font-medium"
          >
            <Lock className="w-3 h-3" />
            Unlock to Edit
          </button>
        </div>
      )}
      {unlocked && (
        <div className="mb-6 flex items-center gap-2 bg-yellow-50 border border-yellow-300 text-yellow-800 px-4 py-3 rounded-lg text-sm">
          <Lock className="w-4 h-4 flex-shrink-0" />
          Report unlocked for editing. Save to update (stays finalized).
        </div>
      )}

      <form
        onSubmit={handleSubmit((d) => saveMutation.mutate({ data: d }))}
        className="space-y-6"
      >
        {/* Top fields */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="font-semibold text-gray-800 mb-4">Report Details</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div className="md:col-span-3">
              <label className="block text-sm font-medium text-gray-700 mb-1">Patient *</label>
              {selectedPatient ? (
                <div className="flex items-center justify-between bg-purple-50 border border-purple-200 rounded-lg px-3 py-2">
                  <div>
                    <p className="font-medium text-gray-800 text-sm">{selectedPatient.name}</p>
                    <p className="text-xs text-gray-500">
                      MRN: {selectedPatient.mrn} | {selectedPatient.phone} | {selectedPatient.gender}
                    </p>
                  </div>
                  {!isLocked && (
                    <button
                      type="button"
                      onClick={() => { setSelectedPatient(null); setPatientSearch(''); setValue('patient_id', '') }}
                      className="text-gray-400 hover:text-red-500 text-sm ml-3"
                    >
                      Change
                    </button>
                  )}
                </div>
              ) : (
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    value={patientSearch}
                    onChange={(e) => setPatientSearch(e.target.value)}
                    disabled={isLocked}
                    placeholder="Search patient by name, MRN or phone..."
                    className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:bg-gray-50"
                  />
                  {patientResults.length > 0 && (
                    <div className="absolute top-full left-0 right-0 bg-white border border-gray-200 rounded-lg shadow-lg z-20 mt-1">
                      {patientResults.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => {
                            setSelectedPatient(p)
                            setValue('patient_id', p.id)
                            setPatientSearch('')
                          }}
                          className="w-full text-left px-4 py-2.5 hover:bg-purple-50 border-b border-gray-100 last:border-0"
                        >
                          <p className="font-medium text-sm">{p.name}</p>
                          <p className="text-xs text-gray-500">{p.mrn} | {p.phone} | {p.gender}</p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <input type="hidden" {...register('patient_id')} />
              {errors.patient_id && <p className="text-xs text-red-600 mt-1">{errors.patient_id.message}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Study Date *</label>
              <input
                {...register('study_date')}
                type="date"
                disabled={isLocked}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:bg-gray-50"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Study Type *</label>
              <select
                {...register('study_type')}
                disabled={isLocked}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:bg-gray-50"
              >
                {US_STUDY_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Referring Doctor</label>
              <input
                {...register('referring_doctor')}
                disabled={isLocked}
                placeholder="Dr. Name / Dept"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:bg-gray-50"
              />
            </div>

            <div className="flex items-end">
              {!isLocked && (
                <button
                  type="button"
                  onClick={loadTemplate}
                  className="flex items-center gap-2 text-sm bg-purple-50 text-purple-700 hover:bg-purple-100 px-3 py-2 rounded-lg border border-purple-200 w-full justify-center"
                >
                  <Wand2 className="w-4 h-4" />
                  Load Template
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Report content */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
          <h3 className="font-semibold text-gray-800">Report Content</h3>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2 uppercase tracking-wide">
              Clinical History
            </label>
            <textarea
              {...register('history')}
              disabled={isLocked}
              rows={2}
              placeholder="e.g. Known diabetic, referred for abdominal pain..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:bg-gray-50"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2 uppercase tracking-wide">
              Presenting Complaint
            </label>
            <textarea
              {...register('presenting_complaints')}
              disabled={isLocked}
              rows={2}
              placeholder="e.g. Pain abdomen, fever, vomiting..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:bg-gray-50"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2 uppercase tracking-wide">
              Prescription
            </label>
            <textarea
              {...register('prescription')}
              disabled={isLocked}
              rows={3}
              placeholder="e.g. Tab Metronidazole 500mg TDS × 5 days..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:bg-gray-50"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2 uppercase tracking-wide">
              Findings *
            </label>
            <textarea
              {...register('findings')}
              disabled={isLocked}
              rows={12}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:bg-gray-50"
            />
            {errors.findings && <p className="text-xs text-red-600 mt-1">{errors.findings.message}</p>}
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2 uppercase tracking-wide">
              Impression *
            </label>
            <textarea
              {...register('impression')}
              disabled={isLocked}
              rows={4}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:bg-gray-50"
            />
            {errors.impression && <p className="text-xs text-red-600 mt-1">{errors.impression.message}</p>}
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2 uppercase tracking-wide">
              Recommendations
            </label>
            <textarea
              {...register('recommendations')}
              disabled={isLocked}
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:bg-gray-50"
            />
          </div>

        </div>

        {/* Actions */}
        {!isLocked && (
          <div className="flex items-center gap-3 justify-end">
            <button
              type="submit"
              disabled={saveMutation.isPending}
              className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 text-white px-5 py-2.5 rounded-lg text-sm font-medium disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {saveMutation.isPending ? 'Saving...' : 'Save Draft'}
            </button>

            {canFinalize && (
              <button
                type="button"
                onClick={handleSubmit((d) => saveMutation.mutate({ data: d, finalize: true }))}
                disabled={saveMutation.isPending}
                className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-5 py-2.5 rounded-lg text-sm font-medium disabled:opacity-50"
              >
                <Lock className="w-4 h-4" />
                Finalize Report
              </button>
            )}
          </div>
        )}
      </form>

      {/* Print preview modal */}
      {showPrint && currentReport && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-3xl shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between sticky top-0 bg-white">
              <h2 className="font-semibold">Print Preview — Ultrasound Report</h2>
              <button onClick={() => setShowPrint(false)} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
            </div>
            <div className="p-4">
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
                  husbandsFatherName={currentReport?.husbands_father_name ?? undefined}
                />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex gap-3 justify-end">
              <button
                onClick={handlePrint}
                className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 text-white py-2.5 px-5 rounded-lg text-sm font-medium"
              >
                <Printer className="w-4 h-4" />
                Print / Save PDF
              </button>
              <button
                onClick={() => setShowPrint(false)}
                className="px-5 py-2.5 border border-gray-300 rounded-lg text-sm hover:bg-gray-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
