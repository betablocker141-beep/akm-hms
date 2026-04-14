import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Plus, Search, User, Phone, Droplets } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'
import { supabase } from '@/lib/supabase/client'
import { db } from '@/lib/dexie/schema'
import { generateUUID, formatDate, calculateAge } from '@/lib/utils'
import { fetchWithFallback } from '@/lib/utils/fetchWithFallback'
import { useSyncStore } from '@/store/syncStore'
import type { Patient, BloodGroup, Gender } from '@/types'

const patientSchema = z.object({
  name: z.string().min(2, 'Name is required'),
  phone: z.string().min(10, 'Valid phone number required'),
  gender: z.enum(['Male', 'Female', 'Other']),
  age: z.coerce.number().min(0).max(150).optional(),
  address: z.string().optional(),
  blood_group: z.string().optional(),
})

type PatientForm = z.infer<typeof patientSchema>

function generateMRN(): string {
  const year = new Date().getFullYear().toString().slice(-2)
  const rand = Math.floor(100000 + Math.random() * 900000)
  return `AKM-${year}-${rand}`
}

async function fetchPatients(search: string): Promise<Patient[]> {
  const matchesSearch = (p: { name: string; mrn: string; phone: string }) => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      p.name.toLowerCase().includes(q) ||
      p.mrn.toLowerCase().includes(q) ||
      p.phone.includes(q)
    )
  }

  const dexieFallback = async () => {
    const all = await db.patients.orderBy('created_at').reverse().toArray()
    return all.filter(matchesSearch) as unknown as Patient[]
  }

  return fetchWithFallback(
    async () => {
      let query = supabase.from('patients').select('*').order('created_at', { ascending: false })
      if (search) query = query.or(`name.ilike.%${search}%,mrn.ilike.%${search}%,phone.ilike.%${search}%`)
      const { data, error } = await query
      if (error) throw error
      const online = (data ?? []) as Patient[]

      // Merge in pending local patients not yet pushed to Supabase.
      // They're in Dexie but invisible in the online list until sync pushes them.
      const pending = await db.patients.where('sync_status').equals('pending').toArray()
      const onlineMrns = new Set(online.map((p) => p.mrn))
      const onlyLocal = pending
        .filter((p) => !onlineMrns.has(p.mrn))
        .filter(matchesSearch)

      return [...online, ...(onlyLocal as unknown as Patient[])]
    },
    dexieFallback,
  )
}

export function PatientsPage() {
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  // Manual loading flag — never gets stuck, unlike useMutation.isPending
  const [isRegistering, setIsRegistering] = useState(false)
  const qc = useQueryClient()

  const { data: patients = [], isLoading } = useQuery({
    queryKey: ['patients', search],
    queryFn: () => fetchPatients(search),
  })

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<PatientForm>({ resolver: zodResolver(patientSchema) })

  const handleRegister = async (data: PatientForm) => {
    setIsRegistering(true)

    const localId = generateUUID()
    const mrn = generateMRN()
    const record = {
      id: localId,
      local_id: localId,
      server_id: null as string | null,
      mrn,
      name: data.name,
      phone: data.phone,
      gender: data.gender as Gender,
      dob: data.age ? `${new Date().getFullYear() - data.age}-01-01` : null,
      address: data.address || null,
      blood_group: (data.blood_group as BloodGroup) || null,
      created_at: new Date().toISOString(),
      sync_status: 'pending' as const,
    }

    // Save to Dexie — race against 3s so we never freeze even if DB is locked
    try {
      await Promise.race([
        db.patients.add(record),
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error('dexie-timeout')), 3000)
        ),
      ])
    } catch {
      // Timed out or key-clash — still close form; sync engine will sort it out
    }

    // Close the modal immediately — user sees instant feedback
    reset()
    setShowForm(false)
    setIsRegistering(false)

    // Refresh list in the background
    void qc.invalidateQueries({ queryKey: ['patients'] })

    // Push to Supabase in the background — fire and forget
    if (useSyncStore.getState().isOnline && navigator.onLine) {
      void (async () => {
        try {
          const timeout = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('timeout')), 6000)
          )
          const insert = supabase.from('patients').insert({
            mrn: record.mrn,
            name: record.name,
            phone: record.phone,
            gender: record.gender,
            dob: record.dob,
            address: record.address,
            blood_group: record.blood_group,
            created_at: record.created_at,
          }).select().single()

          const { data: saved, error } = await Promise.race([insert, timeout]) as { data: { id: string } | null; error: unknown }
          if (!error && saved) {
            await db.patients
              .where('local_id')
              .equals(localId)
              .modify({ server_id: saved.id, sync_status: 'synced' })
          }
        } catch {
          // Offline or timed out — sync engine will push when back online
        }
      })()
    }
  }

  return (
    <div>
      <PageHeader
        title="Patients"
        subtitle="Search, register, and manage patient records"
        actions={
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 bg-maroon-500 hover:bg-maroon-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Patient
          </button>
        }
      />

      {/* Search */}
      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, MRN, or phone..."
          className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-maroon-500"
        />
      </div>

      {/* New Patient Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-lg shadow-2xl">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Register New Patient</h2>
              <button
                onClick={() => { setShowForm(false); reset() }}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none"
              >
                ×
              </button>
            </div>

            <form onSubmit={handleSubmit(handleRegister)} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Full Name *</label>
                  <input
                    {...register('name')}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-maroon-500"
                    placeholder="Patient full name"
                  />
                  {errors.name && <p className="text-xs text-red-600 mt-1">{errors.name.message}</p>}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Phone *</label>
                  <input
                    {...register('phone')}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-maroon-500"
                    placeholder="03XX-XXXXXXX"
                  />
                  {errors.phone && <p className="text-xs text-red-600 mt-1">{errors.phone.message}</p>}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Gender *</label>
                  <select
                    {...register('gender')}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-maroon-500"
                  >
                    <option value="">Select</option>
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                    <option value="Other">Other</option>
                  </select>
                  {errors.gender && <p className="text-xs text-red-600 mt-1">{errors.gender.message}</p>}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Age (years)</label>
                  <input
                    {...register('age')}
                    type="number"
                    min={0}
                    max={150}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-maroon-500"
                    placeholder="e.g. 35"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Blood Group</label>
                  <select
                    {...register('blood_group')}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-maroon-500"
                  >
                    <option value="">Unknown</option>
                    {['A+','A-','B+','B-','AB+','AB-','O+','O-'].map((bg) => (
                      <option key={bg} value={bg}>{bg}</option>
                    ))}
                  </select>
                </div>

                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
                  <input
                    {...register('address')}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-maroon-500"
                    placeholder="House #, Street, Area, City"
                  />
                </div>
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
                  disabled={isRegistering}
                  className="px-4 py-2 bg-maroon-500 hover:bg-maroon-600 text-white rounded-lg text-sm font-medium disabled:opacity-50"
                >
                  {isRegistering ? 'Registering...' : 'Register Patient'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Table */}
      {isLoading ? (
        <div className="flex justify-center py-16">
          <LoadingSpinner label="Loading patients..." />
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">MRN</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Patient</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Phone</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Age / Gender</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Blood Group</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Registered</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {patients.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-gray-400">
                    {search ? 'No patients found for your search.' : 'No patients registered yet.'}
                  </td>
                </tr>
              ) : (
                patients.map((p) => (
                  <tr key={p.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs text-maroon-600 font-medium">
                      {p.mrn}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-maroon-100 flex items-center justify-center flex-shrink-0">
                          <User className="w-4 h-4 text-maroon-500" />
                        </div>
                        <span className="font-medium text-gray-800">{p.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      <div className="flex items-center gap-1">
                        <Phone className="w-3 h-3 text-gray-400" />
                        {p.phone}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {calculateAge(p.dob)} / {p.gender}
                    </td>
                    <td className="px-4 py-3">
                      {p.blood_group ? (
                        <span className="inline-flex items-center gap-1 text-red-600">
                          <Droplets className="w-3 h-3" />
                          {p.blood_group}
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {formatDate(p.created_at)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
