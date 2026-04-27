import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useReactToPrint } from 'react-to-print'
import { Plus, BedDouble, Printer } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { WAButton } from '@/components/shared/WAButton'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'
import { DischargeSummaryPrint } from '@/components/print/DischargeSummaryPrint'
import { supabase } from '@/lib/supabase/client'
import { db } from '@/lib/dexie/schema'
import { generateUUID, formatDate, todayString } from '@/lib/utils'
import { fetchWithFallback } from '@/lib/utils/fetchWithFallback'
import { useSyncStore } from '@/store/syncStore'
import { waIpdAdmission, waIpdDischarge } from '@/lib/whatsapp/links'
import type { IpdAdmission, Doctor, Patient } from '@/types'
import { WARDS, WARD_BEDS } from '@/types/ipd'
import { cn } from '@/lib/utils'

const admitSchema = z.object({
  patient_id: z.string().min(1, 'Patient required'),
  ward: z.string().min(1, 'Ward required'),
  bed_number: z.string().min(1, 'Bed number required'),
  admitting_doctor_id: z.string().min(1, 'Doctor required'),
  diagnosis: z.string().optional(),
  patient_phone: z.string().optional(),
})
type AdmitForm = z.infer<typeof admitSchema>

async function fetchAdmissions(): Promise<IpdAdmission[]> {
  const dexieAdmissions = await db.ipd_admissions
    .where('status').equals('admitted').toArray() as unknown as IpdAdmission[]

  if (!navigator.onLine) return dexieAdmissions

  try {
    const { data, error } = await Promise.race([
      supabase.from('ipd_admissions').select('*').eq('status', 'admitted').order('admit_date', { ascending: false }),
      new Promise<never>((_, r) => setTimeout(() => r(new Error('timeout')), 3000)),
    ]) as { data: IpdAdmission[] | null; error: unknown }
    if (error || !data) return dexieAdmissions

    // Merge: include local-only (pending/unsynced) admissions not yet in Supabase
    const supabaseIds = new Set(data.map((a) => a.id))
    const supabaseCreatedAts = new Set(data.map((a) => a.created_at).filter(Boolean))
    const dexieOnly = dexieAdmissions.filter((a) => {
      const rec = a as unknown as { server_id: string | null; created_at: string }
      if (rec.server_id && supabaseIds.has(rec.server_id)) return false
      if (rec.created_at && supabaseCreatedAts.has(rec.created_at)) return false
      return true
    })
    return [...dexieOnly, ...data]
  } catch {
    return dexieAdmissions
  }
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

export function IpdPage() {
  const [showForm, setShowForm] = useState(false)
  const [selectedWard, setSelectedWard] = useState<string>(WARDS[0])
  const [selectedAdmission, setSelectedAdmission] = useState<IpdAdmission | null>(null)
  const [showPrintModal, setShowPrintModal] = useState(false)
  const [patientPhone, setPatientPhone] = useState('')

  // Patient search state
  const [patientSearch, setPatientSearch] = useState('')
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null)

  const printRef = useRef<HTMLDivElement>(null)
  const qc = useQueryClient()
  const { isOnline } = useSyncStore()

  const { data: admissions = [], isLoading } = useQuery({
    queryKey: ['ipd-admissions'],
    queryFn: fetchAdmissions,
    refetchInterval: 60_000,
  })

  const { data: doctors = [] } = useQuery({
    queryKey: ['doctors-active'],
    queryFn: fetchDoctors,
  })

  // Patient name lookup map
  const { data: patientsMap = {} } = useQuery<Record<string, Patient>>({
    queryKey: ['patients-map'],
    queryFn: () => fetchWithFallback(
      async () => {
        const { data, error } = await supabase.from('patients').select('id, name, mrn, dob, gender, phone')
        if (error) throw error
        return Object.fromEntries((data ?? []).map((p) => [p.id, p as unknown as Patient])) as Record<string, Patient>
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

  const { data: patientResults = [] } = useQuery({
    queryKey: ['ipd-patient-search', patientSearch],
    queryFn: () => searchPatients(patientSearch),
    enabled: patientSearch.length >= 2,
  })

  const { register, handleSubmit, reset, setValue, formState: { errors } } = useForm<AdmitForm>({
    resolver: zodResolver(admitSchema),
    defaultValues: { ward: WARDS[0] },
  })

  const handlePrint = useReactToPrint({
    content: () => printRef.current,
    documentTitle: `Discharge-Summary`,
  })

  const occupiedBeds = admissions
    .filter((a) => a.ward === selectedWard)
    .map((a) => a.bed_number)

  const mutation = useMutation({
    mutationFn: async (data: AdmitForm) => {
      const online = useSyncStore.getState().isOnline && navigator.onLine
      const localId = generateUUID()
      const record = {
        id: localId,
        local_id: localId,
        server_id: null as string | null,
        patient_id: data.patient_id,
        admit_date: todayString(),
        discharge_date: null,
        ward: data.ward,
        bed_number: data.bed_number,
        admitting_doctor_id: data.admitting_doctor_id,
        diagnosis: data.diagnosis || null,
        status: 'admitted' as const,
        created_at: new Date().toISOString(),
        sync_status: 'pending' as const,
      }

      // Save to Dexie first — always works offline
      await db.ipd_admissions.add(record)

      // Fire-and-forget Supabase sync
      if (online) {
        void (async () => {
          try {
            const timeout = new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('timeout')), 6000)
            )
            const insert = supabase.from('ipd_admissions').insert({
              patient_id: record.patient_id,
              admit_date: record.admit_date,
              discharge_date: record.discharge_date,
              ward: record.ward,
              bed_number: record.bed_number,
              admitting_doctor_id: record.admitting_doctor_id,
              diagnosis: record.diagnosis,
              status: record.status,
              created_at: record.created_at,
            }).select().single()
            const { data: saved, error } = await Promise.race([insert, timeout]) as { data: { id: string } | null; error: unknown }
            if (!error && saved) {
              await db.ipd_admissions.where('local_id').equals(localId).modify({ server_id: saved.id, sync_status: 'synced' })
            }
          } catch { /* stays pending, sync engine will retry */ }
        })()
      }

      setPatientPhone(data.patient_phone || '')
      return record
    },
    onSuccess: (record) => {
      qc.invalidateQueries({ queryKey: ['ipd-admissions'] })
      setSelectedAdmission(record as unknown as IpdAdmission)
      reset()
      setSelectedPatient(null)
      setPatientSearch('')
      setShowForm(false)
    },
  })

  const discharge = useMutation({
    mutationFn: async (admission: IpdAdmission) => {
      const today = todayString()
      await db.ipd_admissions
        .filter((a) => a.local_id === admission.id || a.server_id === admission.id)
        .modify({ status: 'discharged', discharge_date: today, sync_status: 'pending' })
      if (useSyncStore.getState().isOnline && navigator.onLine) {
        void supabase.from('ipd_admissions').update({ status: 'discharged', discharge_date: today }).eq('id', admission.id)
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ipd-admissions'] }),
  })

  return (
    <div>
      <PageHeader
        title="Indoor Patient Department (IPD)"
        subtitle={`${admissions.length} patients currently admitted`}
        actions={
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
          >
            <Plus className="w-4 h-4" />
            Admit Patient
          </button>
        }
      />

      {/* Bed Grid */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <div className="flex items-center gap-3 mb-4">
          <h3 className="font-semibold text-gray-800">Bed Availability</h3>
          <select
            value={selectedWard}
            onChange={(e) => setSelectedWard(e.target.value)}
            className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {WARDS.map((w) => <option key={w}>{w}</option>)}
          </select>
          <div className="ml-auto flex items-center gap-4 text-xs text-gray-500">
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded border-2 border-green-500 inline-block" />
              Available
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded border-2 border-red-400 bg-red-50 inline-block" />
              Occupied
            </span>
          </div>
        </div>

        <div className="grid grid-cols-5 md:grid-cols-10 gap-2">
          {Array.from({ length: WARD_BEDS[selectedWard] ?? 1 }, (_, i) => {
            const prefix = selectedWard === 'General Ward' ? 'GEN' : selectedWard.replace('Room ', 'R')
            const bedNum = `${prefix}-${String(i + 1).padStart(2, '0')}`
            const isOccupied = occupiedBeds.includes(bedNum)
            return (
              <div
                key={bedNum}
                className={cn(
                  'rounded-lg p-2 text-center text-xs font-medium flex flex-col items-center gap-1',
                  isOccupied ? 'bed-occupied' : 'bed-available'
                )}
              >
                <BedDouble className="w-4 h-4" />
                <span>{bedNum}</span>
              </div>
            )
          })}
        </div>

        <p className="text-xs text-gray-500 mt-3">
          {occupiedBeds.length}/{WARD_BEDS[selectedWard] ?? 1} occupied in {selectedWard}
        </p>
      </div>

      {/* Admissions table */}
      {isLoading ? (
        <div className="flex justify-center py-16">
          <LoadingSpinner label="Loading admissions..." />
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Patient</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Ward / Bed</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Doctor</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Admit Date</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Diagnosis</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {admissions.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-gray-400">
                    No patients currently admitted.
                  </td>
                </tr>
              ) : (
                admissions.map((adm) => {
                  const doc = doctors.find((d) => d.id === adm.admitting_doctor_id)
                  return (
                    <tr key={adm.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-800 font-medium">
                        {patientsMap[adm.patient_id]?.name ?? `${adm.patient_id.slice(0, 8)}…`}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {adm.ward} / <strong>{adm.bed_number}</strong>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{doc?.name ?? '—'}</td>
                      <td className="px-4 py-3 text-gray-600">{formatDate(adm.admit_date)}</td>
                      <td className="px-4 py-3 text-gray-600 max-w-xs truncate">
                        {adm.diagnosis ?? '—'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => { setSelectedAdmission(adm); setShowPrintModal(true) }}
                            className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded"
                          >
                            <Printer className="w-4 h-4" />
                          </button>
                          <WAButton
                            href={waIpdAdmission({
                              patientName: patientsMap[adm.patient_id]?.name ?? 'Patient',
                              ward: adm.ward,
                              bed: adm.bed_number,
                              admitDate: formatDate(adm.admit_date),
                              phone: patientPhone || '03000000000',
                            })}
                            label="Notify"
                            size="sm"
                          />
                          <button
                            onClick={() => discharge.mutate(adm)}
                            className="text-xs bg-red-50 text-red-600 hover:bg-red-100 px-2 py-1 rounded"
                          >
                            Discharge
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

      {/* Admit Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between sticky top-0 bg-white">
              <h2 className="text-lg font-semibold">Admit Patient</h2>
              <button onClick={() => { setShowForm(false); setSelectedPatient(null); setPatientSearch(''); reset() }} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
            </div>
            <form onSubmit={handleSubmit((d) => mutation.mutate(d))} className="p-6 space-y-4">

              {/* Patient Search */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Patient *</label>
                {selectedPatient ? (
                  <div className="flex items-center justify-between px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg text-sm">
                    <div>
                      <span className="font-medium text-blue-800">{selectedPatient.name}</span>
                      <span className="text-blue-600 ml-2 text-xs">{selectedPatient.mrn} · {selectedPatient.phone}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => { setSelectedPatient(null); setPatientSearch(''); setValue('patient_id', '') }}
                      className="text-blue-400 hover:text-blue-600 text-lg leading-none ml-2"
                    >×</button>
                  </div>
                ) : (
                  <div className="relative">
                    <input
                      type="text"
                      value={patientSearch}
                      onChange={(e) => setPatientSearch(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Search by name, MRN or phone..."
                    />
                    {patientResults.length > 0 && (
                      <div className="absolute z-10 top-full left-0 right-0 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                        {patientResults.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => {
                              setSelectedPatient(p)
                              setValue('patient_id', p.id)
                              setPatientSearch('')
                            }}
                            className="w-full text-left px-3 py-2 hover:bg-blue-50 text-sm border-b border-gray-100 last:border-0"
                          >
                            <div className="font-medium text-gray-800">{p.name}</div>
                            <div className="text-xs text-gray-500">{p.mrn} · {p.phone}</div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <input type="hidden" {...register('patient_id')} />
                {errors.patient_id && <p className="text-xs text-red-600 mt-1">{errors.patient_id.message}</p>}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Ward *</label>
                  <select
                    {...register('ward')}
                    onChange={(e) => { register('ward').onChange(e); setSelectedWard(e.target.value) }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {WARDS.map((w) => <option key={w}>{w}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Bed Number *</label>
                  <input
                    {...register('bed_number')}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="e.g. GEN-01"
                  />
                  {errors.bed_number && <p className="text-xs text-red-600 mt-1">{errors.bed_number.message}</p>}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Admitting Doctor *</label>
                <select
                  {...register('admitting_doctor_id')}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select Doctor</option>
                  {doctors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
                {errors.admitting_doctor_id && <p className="text-xs text-red-600 mt-1">{errors.admitting_doctor_id.message}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Diagnosis</label>
                <input
                  {...register('diagnosis')}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Provisional or confirmed diagnosis"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Patient / Family Phone</label>
                <input
                  {...register('patient_phone')}
                  type="tel"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="03XX-XXXXXXX"
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => { setShowForm(false); setSelectedPatient(null); setPatientSearch(''); reset() }} className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">
                  Cancel
                </button>
                <button type="submit" disabled={mutation.isPending} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium disabled:opacity-50">
                  {mutation.isPending ? 'Admitting...' : 'Admit Patient'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Discharge Summary Print Modal */}
      {showPrintModal && selectedAdmission && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-sm shadow-2xl">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="font-semibold">Discharge Summary</h2>
              <button onClick={() => setShowPrintModal(false)} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
            </div>
            <div className="p-4 overflow-y-auto max-h-96">
              <div ref={printRef}>
                <DischargeSummaryPrint
                  admission={selectedAdmission}
                  doctor={doctors.find((d) => d.id === selectedAdmission.admitting_doctor_id)}
                />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-200 space-y-3">
              <button
                onClick={handlePrint}
                className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white py-2.5 rounded-lg text-sm font-medium"
              >
                <Printer className="w-4 h-4" />
                Print Summary
              </button>
              <WAButton
                href={waIpdDischarge({
                  patientName: patientsMap[selectedAdmission.patient_id]?.name ?? 'Patient',
                  dischargeDate: formatDate(todayString()),
                  phone: patientPhone || '03000000000',
                })}
                label="WhatsApp Discharge Notice"
                className="w-full justify-center"
              />
              <button onClick={() => setShowPrintModal(false)} className="w-full text-sm text-gray-500 hover:text-gray-700">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
