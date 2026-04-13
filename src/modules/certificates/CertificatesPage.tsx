import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useReactToPrint } from 'react-to-print'
import { Plus, Printer, Baby, Skull, Pencil, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'
import { BirthCertificatePrint } from '@/components/print/BirthCertificatePrint'
import { DeathCertificatePrint } from '@/components/print/DeathCertificatePrint'
import { supabase } from '@/lib/supabase/client'
import { db } from '@/lib/dexie/schema'
import { generateUUID, formatDate, todayString, padNumber } from '@/lib/utils'
import { fetchWithFallback } from '@/lib/utils/fetchWithFallback'
import { useSyncStore } from '@/store/syncStore'
import { useAuthStore } from '@/store/authStore'
import type { BirthCertificate, DeathCertificate, Doctor } from '@/types'

const birthSchema = z.object({
  baby_name: z.string().min(2, 'Baby name required'),
  dob: z.string().min(1, 'Date of birth required'),
  time_of_birth: z.string().min(1, 'Time required'),
  gender: z.enum(['Male', 'Female']),
  weight_kg: z.coerce.number().optional(),
  mother_name: z.string().min(2, 'Mother name required'),
  mother_cnic: z.string().optional(),
  father_name: z.string().min(2, 'Father name required'),
  father_cnic: z.string().optional(),
  doctor_id: z.string().min(1, 'Doctor required'),
  ward: z.string().optional(),
  address: z.string().min(3, 'Address is required'),
})

const deathSchema = z.object({
  patient_name: z.string().min(2, 'Patient name required'),
  patient_cnic: z.string().optional(),
  dod: z.string().min(1, 'Date of death required'),
  time_of_death: z.string().min(1, 'Time required'),
  cause_of_death_primary: z.string().min(3, 'Primary cause required'),
  cause_of_death_contributing: z.string().optional(),
  doctor_id: z.string().min(1, 'Doctor required'),
})

type BirthForm = z.infer<typeof birthSchema>
type DeathForm = z.infer<typeof deathSchema>

async function fetchDoctors(): Promise<Doctor[]> {
  const dexieFallback = async () => {
    const all = await db.doctors.toArray()
    return all.filter((d) => d.is_active === true) as unknown as Doctor[]
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

async function getSerial(prefix: string, count: number): Promise<string> {
  const year = new Date().getFullYear()
  return `${prefix}-${year}-${padNumber(count + 1, 4)}`
}

export function CertificatesPage() {
  const [activeTab, setActiveTab] = useState<'birth' | 'death'>('birth')
  const [showBirthForm, setShowBirthForm] = useState(false)
  const [showDeathForm, setShowDeathForm] = useState(false)
  const [editingBirthId, setEditingBirthId] = useState<string | null>(null)
  const [selectedBirth, setSelectedBirth] = useState<BirthCertificate | null>(null)
  const [selectedDeath, setSelectedDeath] = useState<DeathCertificate | null>(null)
  const [showBirthPrint, setShowBirthPrint] = useState(false)
  const [showDeathPrint, setShowDeathPrint] = useState(false)
  const birthPrintRef = useRef<HTMLDivElement>(null)
  const deathPrintRef = useRef<HTMLDivElement>(null)
  const qc = useQueryClient()
  const { isOnline } = useSyncStore()
  const { user: authUser, hasPermission } = useAuthStore()
  const canEditDelete = hasPermission('canEditDelete') || !!authUser?.email?.toLowerCase().includes('waseem') || !!authUser?.name?.toLowerCase().includes('waseem')

  const { data: doctors = [] } = useQuery({ queryKey: ['doctors-active'], queryFn: fetchDoctors })

  const { data: birthCerts = [], isLoading: loadingBirth } = useQuery({
    queryKey: ['birth-certificates'],
    queryFn: () => fetchWithFallback(
      async () => {
        const { data, error } = await supabase.from('birth_certificates').select('*').order('created_at', { ascending: false }).limit(50)
        if (error) throw error
        return (data ?? []) as BirthCertificate[]
      },
      () => db.birth_certificates.orderBy('created_at').reverse().limit(50).toArray() as unknown as Promise<BirthCertificate[]>,
    ),
  })

  const { data: deathCerts = [], isLoading: loadingDeath } = useQuery({
    queryKey: ['death-certificates'],
    queryFn: () => fetchWithFallback(
      async () => {
        const { data, error } = await supabase.from('death_certificates').select('*').order('created_at', { ascending: false }).limit(50)
        if (error) throw error
        return (data ?? []) as DeathCertificate[]
      },
      () => db.death_certificates.orderBy('created_at').reverse().limit(50).toArray() as unknown as Promise<DeathCertificate[]>,
    ),
  })

  const birthForm = useForm<BirthForm>({ resolver: zodResolver(birthSchema), defaultValues: { dob: todayString(), gender: 'Male' } })
  const deathForm = useForm<DeathForm>({ resolver: zodResolver(deathSchema), defaultValues: { dod: todayString() } })

  const handleBirthPrint = useReactToPrint({ content: () => birthPrintRef.current, documentTitle: `BirthCert-${selectedBirth?.serial_number}` })
  const handleDeathPrint = useReactToPrint({ content: () => deathPrintRef.current, documentTitle: `DeathCert-${selectedDeath?.serial_number}` })

  const startEditBirth = (cert: BirthCertificate) => {
    setEditingBirthId(cert.id)
    birthForm.setValue('baby_name', cert.baby_name)
    birthForm.setValue('dob', cert.dob)
    birthForm.setValue('time_of_birth', cert.time_of_birth)
    birthForm.setValue('gender', cert.gender as 'Male' | 'Female')
    birthForm.setValue('weight_kg', cert.weight_kg ?? undefined)
    birthForm.setValue('mother_name', cert.mother_name)
    birthForm.setValue('mother_cnic', cert.mother_cnic ?? '')
    birthForm.setValue('father_name', cert.father_name)
    birthForm.setValue('father_cnic', cert.father_cnic ?? '')
    birthForm.setValue('doctor_id', cert.doctor_id)
    birthForm.setValue('ward', cert.ward ?? '')
    birthForm.setValue('address', cert.address ?? '')
    setShowBirthForm(true)
  }

  const birthMutation = useMutation({
    mutationFn: async (data: BirthForm) => {
      const online = useSyncStore.getState().isOnline && navigator.onLine
      if (editingBirthId) {
        // UPDATE mode
        const updates = {
          baby_name: data.baby_name,
          dob: data.dob,
          time_of_birth: data.time_of_birth,
          gender: data.gender as 'Male' | 'Female',
          weight_kg: data.weight_kg || null,
          mother_name: data.mother_name,
          mother_cnic: data.mother_cnic || null,
          father_name: data.father_name,
          father_cnic: data.father_cnic || null,
          doctor_id: data.doctor_id,
          ward: data.ward || null,
          address: data.address,
        }
        await db.birth_certificates.filter((c) => c.local_id === editingBirthId || c.server_id === editingBirthId).modify({ ...updates, sync_status: 'pending' })
        if (online) {
          await supabase.from('birth_certificates').update(updates).eq('id', editingBirthId)
        }
        const existing = await db.birth_certificates.get(editingBirthId)
        return existing as unknown as BirthCertificate
      } else {
        // INSERT mode
        const localId = generateUUID()
        const serial = await getSerial('BC', birthCerts.length)
        const record = {
          id: localId, local_id: localId, server_id: null as string | null,
          serial_number: serial, patient_id: null,
          baby_name: data.baby_name, dob: data.dob, time_of_birth: data.time_of_birth,
          gender: data.gender as 'Male' | 'Female',
          weight_kg: data.weight_kg || null,
          mother_name: data.mother_name, mother_cnic: data.mother_cnic || null,
          father_name: data.father_name, father_cnic: data.father_cnic || null,
          doctor_id: data.doctor_id, ward: data.ward || null,
          address: data.address,
          created_at: new Date().toISOString(), sync_status: 'pending' as const,
        }
        await db.birth_certificates.add(record)
        if (online) {
          try {
            const { data: saved, error } = await supabase.from('birth_certificates').insert({
              serial_number: record.serial_number,
              patient_id: record.patient_id,
              baby_name: record.baby_name,
              dob: record.dob,
              time_of_birth: record.time_of_birth,
              gender: record.gender,
              weight_kg: record.weight_kg,
              mother_name: record.mother_name,
              mother_cnic: record.mother_cnic,
              father_name: record.father_name,
              father_cnic: record.father_cnic,
              doctor_id: record.doctor_id,
              ward: record.ward,
              created_at: record.created_at,
            }).select().single()
            if (!error && saved) await db.birth_certificates.where('local_id').equals(localId).modify({ server_id: saved.id, sync_status: 'synced' })
          } catch {
            // Network failed — stays pending, syncs later
          }
        }
        return record as unknown as BirthCertificate
      }
    },
    onSuccess: (record) => {
      qc.invalidateQueries({ queryKey: ['birth-certificates'] })
      if (record) {
        setSelectedBirth(record)
        setShowBirthPrint(true)
      }
      setShowBirthForm(false)
      setEditingBirthId(null)
      birthForm.reset()
    },
  })

  const deathMutation = useMutation({
    mutationFn: async (data: DeathForm) => {
      const online = useSyncStore.getState().isOnline && navigator.onLine
      const localId = generateUUID()
      const serial = await getSerial('DC', deathCerts.length)
      const record = {
        id: localId, local_id: localId, server_id: null as string | null,
        serial_number: serial, patient_id: null,
        patient_name: data.patient_name, patient_cnic: data.patient_cnic || null,
        dod: data.dod, time_of_death: data.time_of_death,
        cause_of_death_primary: data.cause_of_death_primary,
        cause_of_death_contributing: data.cause_of_death_contributing || null,
        doctor_id: data.doctor_id,
        created_at: new Date().toISOString(), sync_status: 'pending' as const,
      }
      await db.death_certificates.add(record)
      if (online) {
        try {
          const { data: saved, error } = await supabase.from('death_certificates').insert({
            serial_number: record.serial_number,
            patient_id: record.patient_id,
            patient_name: record.patient_name,
            patient_cnic: record.patient_cnic,
            dod: record.dod,
            time_of_death: record.time_of_death,
            cause_of_death_primary: record.cause_of_death_primary,
            cause_of_death_contributing: record.cause_of_death_contributing,
            doctor_id: record.doctor_id,
            created_at: record.created_at,
          }).select().single()
          if (!error && saved) await db.death_certificates.where('local_id').equals(localId).modify({ server_id: saved.id, sync_status: 'synced' })
        } catch {
          // Network failed — stays pending, syncs later
        }
      }
      return record
    },
    onSuccess: (record) => {
      qc.invalidateQueries({ queryKey: ['death-certificates'] })
      setSelectedDeath(record as unknown as DeathCertificate)
      setShowDeathPrint(true); setShowDeathForm(false); deathForm.reset()
    },
  })

  const deleteBirth = useMutation({
    mutationFn: async (id: string) => {
      await db.birth_certificates.filter((c) => c.local_id === id || c.server_id === id).delete()
      if (useSyncStore.getState().isOnline && navigator.onLine) {
        await supabase.from('birth_certificates').delete().eq('id', id)
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['birth-certificates'] }),
  })

  const deleteDeath = useMutation({
    mutationFn: async (id: string) => {
      await db.death_certificates.filter((c) => c.local_id === id || c.server_id === id).delete()
      if (useSyncStore.getState().isOnline && navigator.onLine) {
        await supabase.from('death_certificates').delete().eq('id', id)
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['death-certificates'] }),
  })

  const handleDeleteBirth = (id: string) => {
    if (!window.confirm('Are you sure you want to delete this record? This cannot be undone.')) return
    deleteBirth.mutate(id)
  }

  const handleDeleteDeath = (id: string) => {
    if (!window.confirm('Are you sure you want to delete this record? This cannot be undone.')) return
    deleteDeath.mutate(id)
  }

  return (
    <div>
      <PageHeader
        title="Birth & Death Certificates"
        subtitle="Issue and print official certificates"
        actions={
          <div className="flex gap-2">
            <button onClick={() => { setEditingBirthId(null); setShowBirthForm(true) }} className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-medium">
              <Baby className="w-4 h-4" /> New Birth Cert
            </button>
            <button onClick={() => setShowDeathForm(true)} className="flex items-center gap-2 bg-gray-700 hover:bg-gray-800 text-white px-4 py-2 rounded-lg text-sm font-medium">
              <Skull className="w-4 h-4" /> New Death Cert
            </button>
          </div>
        }
      />

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        <button onClick={() => setActiveTab('birth')} className={`px-4 py-2 rounded-lg text-sm font-medium ${activeTab === 'birth' ? 'bg-green-600 text-white' : 'bg-white border border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
          Birth Certificates ({birthCerts.length})
        </button>
        <button onClick={() => setActiveTab('death')} className={`px-4 py-2 rounded-lg text-sm font-medium ${activeTab === 'death' ? 'bg-gray-700 text-white' : 'bg-white border border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
          Death Certificates ({deathCerts.length})
        </button>
      </div>

      {/* Tables */}
      {activeTab === 'birth' ? (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Serial #</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Baby Name</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">DOB / Time</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Parents</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loadingBirth ? (
                <tr><td colSpan={5} className="py-12 text-center"><LoadingSpinner /></td></tr>
              ) : birthCerts.length === 0 ? (
                <tr><td colSpan={5} className="py-12 text-center text-gray-400">No birth certificates issued yet.</td></tr>
              ) : birthCerts.map((cert) => (
                <tr key={cert.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-sm text-green-600 font-medium">{cert.serial_number}</td>
                  <td className="px-4 py-3 font-medium text-gray-800">{cert.baby_name} <span className="text-gray-400 text-xs">({cert.gender})</span></td>
                  <td className="px-4 py-3 text-gray-600">{formatDate(cert.dob)} {cert.time_of_birth}</td>
                  <td className="px-4 py-3 text-gray-600 text-xs">F: {cert.father_name}<br/>M: {cert.mother_name}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button onClick={() => { setSelectedBirth(cert); setShowBirthPrint(true) }} className="p-1.5 text-gray-500 hover:text-green-600 hover:bg-green-50 rounded" title="Print">
                        <Printer className="w-4 h-4" />
                      </button>
                      {canEditDelete && (
                        <button onClick={() => startEditBirth(cert)} className="p-1.5 text-gray-500 hover:text-amber-600 hover:bg-amber-50 rounded" title="Edit">
                          <Pencil className="w-4 h-4" />
                        </button>
                      )}
                      {canEditDelete && (
                        <button onClick={() => handleDeleteBirth(cert.id)} className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded" title="Delete">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Serial #</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Patient</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Date / Time</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Cause of Death</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loadingDeath ? (
                <tr><td colSpan={5} className="py-12 text-center"><LoadingSpinner /></td></tr>
              ) : deathCerts.length === 0 ? (
                <tr><td colSpan={5} className="py-12 text-center text-gray-400">No death certificates issued yet.</td></tr>
              ) : deathCerts.map((cert) => (
                <tr key={cert.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-sm text-gray-600 font-medium">{cert.serial_number}</td>
                  <td className="px-4 py-3 font-medium text-gray-800">{cert.patient_name}</td>
                  <td className="px-4 py-3 text-gray-600">{formatDate(cert.dod)} {cert.time_of_death}</td>
                  <td className="px-4 py-3 text-gray-600 max-w-xs truncate">{cert.cause_of_death_primary}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button onClick={() => { setSelectedDeath(cert); setShowDeathPrint(true) }} className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded" title="Print">
                        <Printer className="w-4 h-4" />
                      </button>
                      {canEditDelete && (
                        <button onClick={() => handleDeleteDeath(cert.id)} className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded" title="Delete">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Birth Form Modal */}
      {showBirthForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-2xl shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between sticky top-0 bg-white">
              <div className="flex items-center gap-2"><Baby className="w-5 h-5 text-green-600" /><h2 className="text-lg font-semibold">{editingBirthId ? 'Edit Birth Certificate' : 'Birth Certificate'}</h2></div>
              <button onClick={() => { setShowBirthForm(false); setEditingBirthId(null); birthForm.reset() }} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
            </div>
            <form onSubmit={birthForm.handleSubmit((d) => birthMutation.mutate(d))} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2"><label className="block text-sm font-medium text-gray-700 mb-1">Baby's Full Name *</label>
                  <input {...birthForm.register('baby_name')} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                  {birthForm.formState.errors.baby_name && <p className="text-xs text-red-600 mt-1">{birthForm.formState.errors.baby_name.message}</p>}
                </div>
                <div><label className="block text-sm font-medium text-gray-700 mb-1">Date of Birth *</label>
                  <input {...birthForm.register('dob')} type="date" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                </div>
                <div><label className="block text-sm font-medium text-gray-700 mb-1">Time of Birth *</label>
                  <input {...birthForm.register('time_of_birth')} type="time" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                </div>
                <div><label className="block text-sm font-medium text-gray-700 mb-1">Gender *</label>
                  <select {...birthForm.register('gender')} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                    <option value="Male">Male</option><option value="Female">Female</option>
                  </select>
                </div>
                <div><label className="block text-sm font-medium text-gray-700 mb-1">Weight (kg)</label>
                  <input {...birthForm.register('weight_kg')} type="number" step="0.01" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                </div>
                <div><label className="block text-sm font-medium text-gray-700 mb-1">Mother's Name *</label>
                  <input {...birthForm.register('mother_name')} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                  {birthForm.formState.errors.mother_name && <p className="text-xs text-red-600 mt-1">{birthForm.formState.errors.mother_name.message}</p>}
                </div>
                <div><label className="block text-sm font-medium text-gray-700 mb-1">Mother's CNIC</label>
                  <input {...birthForm.register('mother_cnic')} placeholder="XXXXX-XXXXXXX-X" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                </div>
                <div><label className="block text-sm font-medium text-gray-700 mb-1">Father's Name *</label>
                  <input {...birthForm.register('father_name')} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                  {birthForm.formState.errors.father_name && <p className="text-xs text-red-600 mt-1">{birthForm.formState.errors.father_name.message}</p>}
                </div>
                <div><label className="block text-sm font-medium text-gray-700 mb-1">Father's CNIC</label>
                  <input {...birthForm.register('father_cnic')} placeholder="XXXXX-XXXXXXX-X" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                </div>
                <div><label className="block text-sm font-medium text-gray-700 mb-1">Attending Doctor *</label>
                  <select {...birthForm.register('doctor_id')} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                    <option value="">Select Doctor</option>
                    {doctors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                  {birthForm.formState.errors.doctor_id && <p className="text-xs text-red-600 mt-1">{birthForm.formState.errors.doctor_id.message}</p>}
                </div>
                <div><label className="block text-sm font-medium text-gray-700 mb-1">Ward</label>
                  <input {...birthForm.register('ward')} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500" placeholder="e.g. Maternity Ward" />
                </div>
                <div className="col-span-2"><label className="block text-sm font-medium text-gray-700 mb-1">Home Address *</label>
                  <input {...birthForm.register('address')} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500" placeholder="House #, Street, Area, City" />
                  {birthForm.formState.errors.address && <p className="text-xs text-red-600 mt-1">{birthForm.formState.errors.address.message}</p>}
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => { setShowBirthForm(false); setEditingBirthId(null); birthForm.reset() }} className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">Cancel</button>
                <button type="submit" disabled={birthMutation.isPending} className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium disabled:opacity-50">
                  {birthMutation.isPending
                    ? (editingBirthId ? 'Updating...' : 'Issuing...')
                    : (editingBirthId ? 'Update Certificate' : 'Issue Certificate')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Death Form Modal */}
      {showDeathForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between sticky top-0 bg-white">
              <div className="flex items-center gap-2"><Skull className="w-5 h-5 text-gray-600" /><h2 className="text-lg font-semibold">Death Certificate</h2></div>
              <button onClick={() => { setShowDeathForm(false); deathForm.reset() }} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
            </div>
            <form onSubmit={deathForm.handleSubmit((d) => deathMutation.mutate(d))} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2"><label className="block text-sm font-medium text-gray-700 mb-1">Patient Full Name *</label>
                  <input {...deathForm.register('patient_name')} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-500" />
                  {deathForm.formState.errors.patient_name && <p className="text-xs text-red-600 mt-1">{deathForm.formState.errors.patient_name.message}</p>}
                </div>
                <div><label className="block text-sm font-medium text-gray-700 mb-1">CNIC</label>
                  <input {...deathForm.register('patient_cnic')} placeholder="XXXXX-XXXXXXX-X" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-500" />
                </div>
                <div><label className="block text-sm font-medium text-gray-700 mb-1">Date of Death *</label>
                  <input {...deathForm.register('dod')} type="date" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-500" />
                </div>
                <div><label className="block text-sm font-medium text-gray-700 mb-1">Time of Death *</label>
                  <input {...deathForm.register('time_of_death')} type="time" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-500" />
                </div>
                <div className="col-span-2"><label className="block text-sm font-medium text-gray-700 mb-1">Primary Cause of Death *</label>
                  <textarea {...deathForm.register('cause_of_death_primary')} rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-500" />
                  {deathForm.formState.errors.cause_of_death_primary && <p className="text-xs text-red-600 mt-1">{deathForm.formState.errors.cause_of_death_primary.message}</p>}
                </div>
                <div className="col-span-2"><label className="block text-sm font-medium text-gray-700 mb-1">Contributing Cause</label>
                  <textarea {...deathForm.register('cause_of_death_contributing')} rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-500" />
                </div>
                <div className="col-span-2"><label className="block text-sm font-medium text-gray-700 mb-1">Attending Doctor *</label>
                  <select {...deathForm.register('doctor_id')} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-500">
                    <option value="">Select Doctor</option>
                    {doctors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                  {deathForm.formState.errors.doctor_id && <p className="text-xs text-red-600 mt-1">{deathForm.formState.errors.doctor_id.message}</p>}
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => { setShowDeathForm(false); deathForm.reset() }} className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">Cancel</button>
                <button type="submit" disabled={deathMutation.isPending} className="px-4 py-2 bg-gray-700 hover:bg-gray-800 text-white rounded-lg text-sm font-medium disabled:opacity-50">
                  {deathMutation.isPending ? 'Issuing...' : 'Issue Certificate'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Birth Print Modal */}
      {showBirthPrint && selectedBirth && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-3xl shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between sticky top-0 bg-white">
              <h2 className="font-semibold">Birth Certificate — {selectedBirth.serial_number}</h2>
              <button onClick={() => setShowBirthPrint(false)} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
            </div>
            <div className="p-4"><div ref={birthPrintRef}><BirthCertificatePrint cert={selectedBirth} doctor={doctors.find(d => d.id === selectedBirth.doctor_id)} /></div></div>
            <div className="px-6 py-4 border-t border-gray-200 flex gap-3 justify-end">
              <button onClick={handleBirthPrint} className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white py-2.5 px-5 rounded-lg text-sm font-medium"><Printer className="w-4 h-4" /> Print</button>
              <button onClick={() => setShowBirthPrint(false)} className="px-5 py-2.5 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Death Print Modal */}
      {showDeathPrint && selectedDeath && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-3xl shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between sticky top-0 bg-white">
              <h2 className="font-semibold">Death Certificate — {selectedDeath.serial_number}</h2>
              <button onClick={() => setShowDeathPrint(false)} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
            </div>
            <div className="p-4"><div ref={deathPrintRef}><DeathCertificatePrint cert={selectedDeath} doctor={doctors.find(d => d.id === selectedDeath.doctor_id)} /></div></div>
            <div className="px-6 py-4 border-t border-gray-200 flex gap-3 justify-end">
              <button onClick={handleDeathPrint} className="flex items-center gap-2 bg-gray-700 hover:bg-gray-800 text-white py-2.5 px-5 rounded-lg text-sm font-medium"><Printer className="w-4 h-4" /> Print</button>
              <button onClick={() => setShowDeathPrint(false)} className="px-5 py-2.5 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
