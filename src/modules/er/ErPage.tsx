import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useReactToPrint } from 'react-to-print'
import { Plus, Printer, AlertTriangle, Search, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { WAButton } from '@/components/shared/WAButton'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'
import { ErTokenPrint } from '@/components/print/ErTokenPrint'
import { supabase } from '@/lib/supabase/client'
import { db } from '@/lib/dexie/schema'
import { generateUUID, formatDate, todayString, padNumber } from '@/lib/utils'
import { fetchWithFallback } from '@/lib/utils/fetchWithFallback'
import { useSyncStore } from '@/store/syncStore'
import { useAuthStore } from '@/store/authStore'
import { waErRegistration } from '@/lib/whatsapp/links'
import type { ErVisit, Doctor, Patient } from '@/types'
import { TRIAGE_LABELS, TRIAGE_COLORS } from '@/types/er'

const erSchema = z.object({
  patient_id: z.string().min(1, 'Patient required'),
  chief_complaint: z.string().min(3, 'Chief complaint required'),
  triage_level: z.coerce.number().min(1).max(5),
  bp: z.string().optional(),
  pulse: z.coerce.number().optional(),
  temp: z.coerce.number().optional(),
  spo2: z.coerce.number().optional(),
  rr: z.coerce.number().optional(),
  doctor_id: z.string().optional(),
  notes: z.string().optional(),
  family_phone: z.string().optional(),
})

type ErForm = z.infer<typeof erSchema>

async function fetchErVisits(): Promise<ErVisit[]> {
  const today = todayString()
  return fetchWithFallback(
    async () => {
      const { data, error } = await supabase.from('er_visits').select('*').eq('visit_date', today).order('created_at', { ascending: false })
      if (error) throw error
      return data as ErVisit[]
    },
    () => db.er_visits.where('visit_date').equals(today).reverse().toArray() as unknown as Promise<ErVisit[]>,
  )
}

async function fetchDoctors(): Promise<Doctor[]> {
  const dexieFallback = async () => {
    const all = await db.doctors.toArray()
    const active = all.filter((d) => d.is_active === true)
    const seen = new Map<string, (typeof active)[0]>()
    for (const doc of active) {
      const key = doc.server_id ?? `${doc.name.toLowerCase().trim()}|${doc.phone.trim()}`
      if (!seen.has(key)) seen.set(key, doc)
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name)) as unknown as Doctor[]
  }
  return fetchWithFallback(
    async () => {
      const { data, error } = await supabase.from('doctors').select('*').eq('is_active', true).order('name')
      if (error) throw error
      return data as Doctor[]
    },
    dexieFallback,
  )
}

async function searchPatients(q: string): Promise<Patient[]> {
  if (!q || q.length < 2) return []
  return fetchWithFallback(
    async () => {
      const { data, error } = await supabase.from('patients').select('*').or(`name.ilike.%${q}%,phone.ilike.%${q}%,mrn.ilike.%${q}%`).limit(10)
      if (error) throw error
      return data as Patient[]
    },
    async () => {
      const lq = q.toLowerCase()
      const all = await db.patients.orderBy('created_at').reverse().limit(200).toArray()
      return all.filter((p) => p.name.toLowerCase().includes(lq) || p.phone.includes(lq) || p.mrn.includes(lq)) as unknown as Patient[]
    },
  )
}

export function ErPage() {
  const [showForm, setShowForm] = useState(false)
  const [selectedVisit, setSelectedVisit] = useState<ErVisit | null>(null)
  const [showPrintModal, setShowPrintModal] = useState(false)
  const [familyPhone, setFamilyPhone] = useState('')
  const [erMoName, setErMoName] = useState('Dr. Waseem')
  const [erFee, setErFee] = useState<number>(0)
  const [printMoName, setPrintMoName] = useState('Dr. Waseem')
  const [printFee, setPrintFee] = useState<number>(0)
  const [erPatientSearch, setErPatientSearch] = useState('')
  const [erSelectedPatient, setErSelectedPatient] = useState<Patient | null>(null)
  const printRef = useRef<HTMLDivElement>(null)
  const qc = useQueryClient()
  const { isOnline } = useSyncStore()
  const { user: authUser, hasPermission } = useAuthStore()
  const canEditDelete = hasPermission('canEditDelete') || !!authUser?.email?.toLowerCase().includes('waseem') || !!authUser?.name?.toLowerCase().includes('waseem')

  const { data: visits = [], isLoading } = useQuery({
    queryKey: ['er-visits-today'],
    queryFn: fetchErVisits,
    refetchInterval: 30_000,
  })

  const { data: doctors = [] } = useQuery({
    queryKey: ['doctors-active'],
    queryFn: fetchDoctors,
  })

  const { data: erPatientResults = [] } = useQuery({
    queryKey: ['er-patient-search', erPatientSearch],
    queryFn: () => searchPatients(erPatientSearch),
    enabled: erPatientSearch.length >= 2,
  })

  const { register, handleSubmit, reset, setValue, formState: { errors } } = useForm<ErForm>({
    resolver: zodResolver(erSchema),
    defaultValues: { triage_level: 3 },
  })

  const handlePrint = useReactToPrint({
    content: () => printRef.current,
    documentTitle: `ER-Token-${selectedVisit?.token_number}`,
  })

  const mutation = useMutation({
    mutationFn: async (data: ErForm) => {
      const online = useSyncStore.getState().isOnline && navigator.onLine
      const today = todayString()
      // Use Dexie count first — works offline. Supabase count is optional enhancement.
      const localCount = await db.er_visits.where('visit_date').equals(today).count()
      let tokenNumber = `ER-${padNumber(localCount + 1)}`
      if (online) {
        try {
          const { count } = await Promise.race([
            supabase.from('er_visits').select('*', { count: 'exact', head: true }).eq('visit_date', today),
            new Promise<never>((_, r) => setTimeout(() => r(new Error('timeout')), 3000)),
          ]) as { count: number | null }
          tokenNumber = `ER-${padNumber((count ?? localCount) + 1)}`
        } catch { /* use local count */ }
      }

      const localId = generateUUID()
      const record = {
        id: localId,
        local_id: localId,
        server_id: null as string | null,
        patient_id: data.patient_id,
        token_number: tokenNumber,
        visit_date: today,
        chief_complaint: data.chief_complaint,
        triage_level: data.triage_level as 1 | 2 | 3 | 4 | 5,
        bp: data.bp || null,
        pulse: data.pulse || null,
        temp: data.temp || null,
        spo2: data.spo2 || null,
        rr: data.rr || null,
        doctor_id: data.doctor_id || null,
        status: 'active' as const,
        notes: data.notes || null,
        created_at: new Date().toISOString(),
        sync_status: 'pending' as const,
      }

      await db.er_visits.add(record)

      // Fire-and-forget — UI resolves immediately after Dexie save
      if (online) {
        void (async () => {
          try {
            const timeout = new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('timeout')), 6000)
            )
            const insert = supabase.from('er_visits').insert({
              patient_id: record.patient_id,
              token_number: record.token_number,
              visit_date: record.visit_date,
              chief_complaint: record.chief_complaint,
              triage_level: record.triage_level,
              bp: record.bp,
              pulse: record.pulse,
              temp: record.temp,
              spo2: record.spo2,
              rr: record.rr,
              doctor_id: record.doctor_id,
              status: record.status,
              notes: record.notes,
              created_at: record.created_at,
            }).select().single()
            const { data: saved, error } = await Promise.race([insert, timeout]) as { data: { id: string } | null; error: unknown }
            if (!error && saved) {
              await db.er_visits.where('local_id').equals(localId).modify({ server_id: saved.id, sync_status: 'synced' })
            }
          } catch { /* stays pending */ }
        })()
      }

      setFamilyPhone(data.family_phone || '')
      return record
    },
    onSuccess: (record) => {
      qc.invalidateQueries({ queryKey: ['er-visits-today'] })
      setSelectedVisit(record as unknown as ErVisit)
      setPrintMoName(erMoName)
      setPrintFee(erFee)
      setShowPrintModal(true)
      reset()
      setErFee(0)
      setErSelectedPatient(null)
      setErPatientSearch('')
      setShowForm(false)
    },
  })

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      await db.er_visits
        .filter((v) => v.local_id === id || v.server_id === id)
        .modify({ status, sync_status: 'pending' })
      if (useSyncStore.getState().isOnline && navigator.onLine) {
        await supabase.from('er_visits').update({ status }).eq('id', id)
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['er-visits-today'] }),
  })

  const deleteVisit = useMutation({
    mutationFn: async (id: string) => {
      await db.er_visits.filter((v) => v.local_id === id || v.server_id === id).delete()
      if (useSyncStore.getState().isOnline && navigator.onLine) {
        await supabase.from('er_visits').delete().eq('id', id)
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['er-visits-today'] }),
  })

  const handleDeleteVisit = (id: string) => {
    if (!window.confirm('Are you sure you want to delete this record? This cannot be undone.')) return
    deleteVisit.mutate(id)
  }

  return (
    <div>
      <PageHeader
        title="Emergency Department"
        subtitle={`Today — ${formatDate(todayString())} | ${visits.length} ER visits`}
        actions={
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg text-sm font-medium"
          >
            <Plus className="w-4 h-4" />
            New ER Registration
          </button>
        }
      />

      {/* Triage summary */}
      <div className="grid grid-cols-5 gap-3 mb-6">
        {([1,2,3,4,5] as const).map((level) => {
          const count = visits.filter((v) => v.triage_level === level).length
          return (
            <div
              key={level}
              className={`rounded-lg p-3 text-center text-sm ${TRIAGE_COLORS[level]}`}
            >
              <p className="text-2xl font-bold">{count}</p>
              <p className="text-xs opacity-80 mt-0.5">Level {level}</p>
            </div>
          )
        })}
      </div>

      {/* Visits table */}
      {isLoading ? (
        <div className="flex justify-center py-16">
          <LoadingSpinner label="Loading ER visits..." />
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">ER Token</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Triage</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Complaint</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Vitals</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Doctor</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {visits.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-gray-400">
                    No ER visits today.
                  </td>
                </tr>
              ) : (
                visits.map((visit) => {
                  const doc = doctors.find((d) => d.id === visit.doctor_id)
                  return (
                    <tr key={visit.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <span className="font-bold text-orange-600">{visit.token_number}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-xs font-bold ${TRIAGE_COLORS[visit.triage_level as 1|2|3|4|5]}`}
                        >
                          L{visit.triage_level}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-700 max-w-xs truncate">
                        {visit.chief_complaint}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">
                        {visit.bp && <span>BP: {visit.bp}</span>}
                        {visit.pulse && <span> | P: {visit.pulse}</span>}
                        {visit.spo2 && <span> | SpO2: {visit.spo2}%</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{doc?.name ?? '—'}</td>
                      <td className="px-4 py-3">
                        <StatusBadge status={visit.status} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => { setSelectedVisit(visit); setShowPrintModal(true) }}
                            className="p-1.5 text-gray-500 hover:text-orange-500 hover:bg-orange-50 rounded"
                          >
                            <Printer className="w-4 h-4" />
                          </button>
                          {visit.status === 'active' && (
                            <>
                              <button
                                onClick={() => updateStatus.mutate({ id: visit.id, status: 'treated' })}
                                className="text-xs bg-green-50 text-green-700 hover:bg-green-100 px-2 py-1 rounded"
                              >
                                Treated
                              </button>
                              <button
                                onClick={() => updateStatus.mutate({ id: visit.id, status: 'admitted' })}
                                className="text-xs bg-blue-50 text-blue-700 hover:bg-blue-100 px-2 py-1 rounded"
                              >
                                Admit
                              </button>
                            </>
                          )}
                          {canEditDelete && (
                            <button
                              onClick={() => handleDeleteVisit(visit.id)}
                              className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded"
                              title="Delete visit"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
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

      {/* New ER Registration Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-2xl shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between sticky top-0 bg-white">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-orange-500" />
                <h2 className="text-lg font-semibold">ER Registration</h2>
              </div>
              <button
                onClick={() => { setShowForm(false); reset(); setErSelectedPatient(null); setErPatientSearch('') }}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none"
              >
                ×
              </button>
            </div>

            <form onSubmit={handleSubmit((d) => mutation.mutate(d))} className="p-6 space-y-5">
              {/* Patient Live Search */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Patient *
                </label>
                {erSelectedPatient ? (
                  <div className="flex items-center justify-between bg-orange-50 border border-orange-300 rounded-lg px-3 py-2.5">
                    <div>
                      <p className="font-semibold text-gray-800 text-sm">{erSelectedPatient.name}</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        MRN: {erSelectedPatient.mrn} &nbsp;|&nbsp; {erSelectedPatient.phone} &nbsp;|&nbsp; {erSelectedPatient.gender}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setErSelectedPatient(null)
                        setErPatientSearch('')
                        setValue('patient_id', '')
                      }}
                      className="text-gray-400 hover:text-red-500 text-sm font-medium ml-3 flex-shrink-0"
                    >
                      Change
                    </button>
                  </div>
                ) : (
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      type="text"
                      value={erPatientSearch}
                      onChange={(e) => setErPatientSearch(e.target.value)}
                      placeholder="Search by name, MRN or phone..."
                      className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                    />
                    {erPatientResults.length > 0 && (
                      <div className="absolute top-full left-0 right-0 bg-white border border-gray-200 rounded-lg shadow-xl z-20 mt-1 max-h-52 overflow-y-auto">
                        {erPatientResults.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => {
                              setErSelectedPatient(p)
                              setValue('patient_id', p.id)
                              setErPatientSearch('')
                            }}
                            className="w-full text-left px-4 py-2.5 hover:bg-orange-50 border-b border-gray-100 last:border-0 transition-colors"
                          >
                            <p className="font-medium text-sm text-gray-800">{p.name}</p>
                            <p className="text-xs text-gray-500 mt-0.5">
                              MRN: {p.mrn} &nbsp;|&nbsp; {p.phone} &nbsp;|&nbsp; {p.gender}
                            </p>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <input type="hidden" {...register('patient_id')} />
                {errors.patient_id && (
                  <p className="text-xs text-red-600 mt-1">{errors.patient_id.message}</p>
                )}
              </div>

              {/* Chief Complaint */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Chief Complaint *
                </label>
                <textarea
                  {...register('chief_complaint')}
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                  placeholder="e.g. Chest pain, breathlessness, trauma..."
                />
                {errors.chief_complaint && (
                  <p className="text-xs text-red-600 mt-1">{errors.chief_complaint.message}</p>
                )}
              </div>

              {/* Triage Level */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Triage Level *
                </label>
                <div className="grid grid-cols-5 gap-2">
                  {([1,2,3,4,5] as const).map((level) => (
                    <label
                      key={level}
                      className="cursor-pointer"
                    >
                      <input
                        type="radio"
                        {...register('triage_level')}
                        value={level}
                        className="sr-only peer"
                      />
                      <div
                        className={`text-center p-2 rounded-lg border-2 text-xs font-bold peer-checked:border-gray-800 peer-checked:ring-2 peer-checked:ring-gray-400 ${TRIAGE_COLORS[level]}`}
                      >
                        <p className="text-base">L{level}</p>
                        <p className="opacity-80 mt-0.5">
                          {['Immediate','Urgent','Less Urgent','Non-Urgent','Minor'][level - 1]}
                        </p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {/* Vitals */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Vitals</label>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { name: 'bp', label: 'BP (mmHg)', placeholder: '120/80', type: 'text' },
                    { name: 'pulse', label: 'Pulse (bpm)', placeholder: '72', type: 'number' },
                    { name: 'temp', label: 'Temp (°C)', placeholder: '37.0', type: 'number' },
                    { name: 'spo2', label: 'SpO2 (%)', placeholder: '98', type: 'number' },
                    { name: 'rr', label: 'RR (/min)', placeholder: '16', type: 'number' },
                  ].map((field) => (
                    <div key={field.name}>
                      <label className="block text-xs text-gray-500 mb-1">{field.label}</label>
                      <input
                        {...register(field.name as keyof ErForm)}
                        type={field.type}
                        step="0.1"
                        placeholder={field.placeholder}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Medical Officer */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Medical Officer (ER)
                  </label>
                  <select
                    value={erMoName}
                    onChange={(e) => setErMoName(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                  >
                    <option value="Dr. Waseem">Dr. Waseem</option>
                    <option value="Dr. Shafique">Dr. Shafique</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Family Phone (WhatsApp)
                  </label>
                  <input
                    {...register('family_phone')}
                    type="tel"
                    placeholder="03XX-XXXXXXX"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                  />
                </div>
              </div>

              {/* ER Fee */}
              <div className="bg-orange-50 border border-orange-200 rounded-lg p-3">
                <label className="block text-sm font-semibold text-orange-800 mb-1">
                  ER Fee Received (Rs.)
                </label>
                <input
                  type="number"
                  min={0}
                  value={erFee}
                  onChange={(e) => setErFee(Number(e.target.value))}
                  className="w-full px-3 py-2 border border-orange-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white"
                  placeholder="e.g. 500"
                />
                <p className="text-xs text-orange-600 mt-1">Will print as "PAYMENT PAID" on the ER token</p>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea
                  {...register('notes')}
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => { setShowForm(false); reset() }}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={mutation.isPending}
                  className="px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg text-sm font-medium disabled:opacity-50"
                >
                  {mutation.isPending ? 'Registering...' : 'Register & Issue Token'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Print Modal */}
      {showPrintModal && selectedVisit && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-sm shadow-2xl flex flex-col max-h-[92vh]">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
              <h2 className="font-semibold">ER Token</h2>
              <button
                onClick={() => setShowPrintModal(false)}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none"
              >
                ×
              </button>
            </div>
            <div className="overflow-y-auto flex-1">
              <div className="p-4">
                <div ref={printRef}>
                  <ErTokenPrint visit={selectedVisit} moName={printMoName} fee={printFee} />
                </div>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-200 space-y-3 flex-shrink-0">
              <button
                onClick={handlePrint}
                className="w-full flex items-center justify-center gap-2 bg-orange-500 hover:bg-orange-600 text-white py-2.5 rounded-lg text-sm font-medium"
              >
                <Printer className="w-4 h-4" />
                Print ER Token
              </button>

              {familyPhone && (
                <WAButton
                  href={waErRegistration({
                    patientName: 'Patient',
                    tokenNumber: selectedVisit.token_number,
                    familyPhone,
                  })}
                  label="Notify Family via WhatsApp"
                  className="w-full justify-center"
                />
              )}

              <button
                onClick={() => setShowPrintModal(false)}
                className="w-full text-sm text-gray-500 hover:text-gray-700"
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
