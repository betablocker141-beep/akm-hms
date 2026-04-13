import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Plus, UserCheck, Edit, ToggleLeft, ToggleRight, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'
import { supabase } from '@/lib/supabase/client'
import { db } from '@/lib/dexie/schema'
import { generateUUID } from '@/lib/utils'
import { useSyncStore } from '@/store/syncStore'
import { fetchAllDoctors } from '@/lib/utils/doctorUtils'
import type { Doctor } from '@/types'

const doctorSchema = z.object({
  name: z.string().min(2, 'Name required'),
  specialty: z.string().min(2, 'Specialty required'),
  phone: z.string().min(10, 'Phone required'),
  whatsapp_number: z.string().optional(),
  share_percent: z.coerce.number().min(0).max(100),
})

type DoctorForm = z.infer<typeof doctorSchema>

export function DoctorsPage() {
  const [showForm, setShowForm] = useState(false)
  const [editDoctor, setEditDoctor] = useState<Doctor | null>(null)
  const qc = useQueryClient()
  const { isOnline } = useSyncStore()

  const { data: doctors = [], isLoading } = useQuery({ queryKey: ['doctors-all'], queryFn: fetchAllDoctors })

  const { register, handleSubmit, reset, setValue, formState: { errors } } = useForm<DoctorForm>({
    resolver: zodResolver(doctorSchema),
    defaultValues: { share_percent: 40 },
  })

  const openEdit = (doc: Doctor) => {
    setEditDoctor(doc)
    setValue('name', doc.name)
    setValue('specialty', doc.specialty)
    setValue('phone', doc.phone)
    setValue('whatsapp_number', doc.whatsapp_number ?? '')
    setValue('share_percent', doc.share_percent)
    setShowForm(true)
  }

  const mutation = useMutation({
    mutationFn: async (data: DoctorForm) => {
      const online = useSyncStore.getState().isOnline && navigator.onLine
      if (editDoctor) {
        const updated = {
          name: data.name,
          specialty: data.specialty,
          phone: data.phone,
          whatsapp_number: data.whatsapp_number || null,
          share_percent: data.share_percent,
        }
        // Update Dexie locally first
        await db.doctors.filter((d) => d.local_id === editDoctor.id || d.server_id === editDoctor.id).modify({ ...updated, sync_status: 'pending' })
        // Then push to Supabase — use server_id if available, else doc.id IS the Supabase id
        const serverId = editDoctor.server_id ?? editDoctor.id
        if (online) {
          await supabase.from('doctors').update(updated).eq('id', serverId)
          await db.doctors.filter((d) => d.local_id === editDoctor.id || d.server_id === serverId).modify({ sync_status: 'synced' })
        }
      } else {
        // Guard against duplicates — skip if same name+phone already exists in Dexie
        const existing = await db.doctors.filter(
          (d) => d.name.toLowerCase().trim() === data.name.toLowerCase().trim() &&
                 d.phone.trim() === data.phone.trim()
        ).first()
        if (existing) return // already saved, don't add again

        const localId = generateUUID()
        const record = {
          id: localId, local_id: localId, server_id: null as string | null,
          name: data.name, specialty: data.specialty, phone: data.phone,
          whatsapp_number: data.whatsapp_number || null,
          share_percent: data.share_percent, is_active: true, sync_status: 'pending' as const,
        }
        await db.doctors.add(record)
        if (online) {
          try {
            // Only send actual DB columns — never send local_id / server_id / sync_status
            const { data: saved, error } = await supabase.from('doctors').insert({
              name: record.name,
              specialty: record.specialty,
              phone: record.phone,
              whatsapp_number: record.whatsapp_number,
              share_percent: record.share_percent,
              is_active: record.is_active,
            }).select().single()
            if (!error && saved) {
              await db.doctors.where('local_id').equals(localId).modify({ server_id: saved.id, sync_status: 'synced' })
            }
          } catch {
            // Network failed — stays pending, syncs later
          }
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctors-all'] })
      qc.invalidateQueries({ queryKey: ['doctors-active'] })
      setShowForm(false); setEditDoctor(null); reset()
    },
  })

  const toggleActive = useMutation({
    mutationFn: async (doc: Doctor) => {
      const newVal = !doc.is_active
      // server_id is set when record was synced; doc.id from Supabase IS the server id
      const serverId = doc.server_id ?? doc.id
      await db.doctors.filter((d) => d.local_id === doc.id || d.server_id === serverId).modify({ is_active: newVal, sync_status: 'pending' })
      if (useSyncStore.getState().isOnline && navigator.onLine) {
        await supabase.from('doctors').update({ is_active: newVal }).eq('id', serverId)
        await db.doctors.filter((d) => d.local_id === doc.id || d.server_id === serverId).modify({ sync_status: 'synced' })
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['doctors-all'] }),
  })

  const deleteDoctor = useMutation({
    mutationFn: async (doc: Doctor) => {
      const serverId = doc.server_id ?? doc.id
      await db.doctors.filter((d) => d.local_id === doc.id || d.server_id === serverId).delete()
      if (useSyncStore.getState().isOnline && navigator.onLine) {
        await supabase.from('doctors').delete().eq('id', serverId)
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctors-all'] })
      qc.invalidateQueries({ queryKey: ['doctors-active'] })
    },
  })

  return (
    <div>
      <PageHeader
        title="Doctors"
        subtitle="Manage doctors, specialties, and share percentages"
        actions={
          <button onClick={() => { setEditDoctor(null); reset(); setShowForm(true) }} className="flex items-center gap-2 bg-maroon-500 hover:bg-maroon-600 text-white px-4 py-2 rounded-lg text-sm font-medium">
            <Plus className="w-4 h-4" /> Add Doctor
          </button>
        }
      />

      {isLoading ? (
        <div className="flex justify-center py-16"><LoadingSpinner /></div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Doctor</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Specialty</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Phone</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">WhatsApp</th>
                <th className="text-center px-4 py-3 font-medium text-gray-600">Share %</th>
                <th className="text-center px-4 py-3 font-medium text-gray-600">Status</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {doctors.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-12 text-gray-400">No doctors added yet.</td></tr>
              ) : doctors.map((doc) => (
                <tr key={doc.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 bg-maroon-100 rounded-full flex items-center justify-center flex-shrink-0">
                        <UserCheck className="w-4 h-4 text-maroon-500" />
                      </div>
                      <span className="font-medium text-gray-800">{doc.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{doc.specialty}</td>
                  <td className="px-4 py-3 text-gray-600">{doc.phone}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{doc.whatsapp_number ?? '—'}</td>
                  <td className="px-4 py-3 text-center font-bold text-maroon-600">{doc.share_percent}%</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${doc.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {doc.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button onClick={() => openEdit(doc)} className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded" title="Edit">
                        <Edit className="w-4 h-4" />
                      </button>
                      <button onClick={() => toggleActive.mutate(doc)} className="p-1.5 text-gray-500 hover:text-maroon-500 rounded" title={doc.is_active ? 'Deactivate' : 'Activate'}>
                        {doc.is_active ? <ToggleRight className="w-5 h-5 text-green-500" /> : <ToggleLeft className="w-5 h-5 text-gray-400" />}
                      </button>
                      <button
                        onClick={() => {
                          if (confirm(`Delete ${doc.name}? This cannot be undone.`)) deleteDoctor.mutate(doc)
                        }}
                        className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded"
                        title="Delete doctor"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add/Edit Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-md shadow-2xl">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-lg font-semibold">{editDoctor ? 'Edit Doctor' : 'Add Doctor'}</h2>
              <button onClick={() => { setShowForm(false); setEditDoctor(null); reset() }} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
            </div>
            <form onSubmit={handleSubmit((d) => mutation.mutate(d))} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Full Name *</label>
                <input {...register('name')} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-maroon-500" />
                {errors.name && <p className="text-xs text-red-600 mt-1">{errors.name.message}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Specialty *</label>
                <input {...register('specialty')} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-maroon-500" placeholder="e.g. General Medicine, Gynecology" />
                {errors.specialty && <p className="text-xs text-red-600 mt-1">{errors.specialty.message}</p>}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Phone *</label>
                  <input {...register('phone')} type="tel" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-maroon-500" placeholder="03XX-XXXXXXX" />
                  {errors.phone && <p className="text-xs text-red-600 mt-1">{errors.phone.message}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">WhatsApp #</label>
                  <input {...register('whatsapp_number')} type="tel" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-maroon-500" placeholder="92XXXXXXXXXX" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Revenue Share % *</label>
                <input {...register('share_percent')} type="number" min="0" max="100" step="1" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-maroon-500" />
                {errors.share_percent && <p className="text-xs text-red-600 mt-1">{errors.share_percent.message}</p>}
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => { setShowForm(false); setEditDoctor(null); reset() }} className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">Cancel</button>
                <button type="submit" disabled={mutation.isPending} className="px-4 py-2 bg-maroon-500 hover:bg-maroon-600 text-white rounded-lg text-sm font-medium disabled:opacity-50">
                  {mutation.isPending ? 'Saving...' : editDoctor ? 'Update' : 'Add Doctor'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
