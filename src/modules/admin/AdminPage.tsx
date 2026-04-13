import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Users, ShieldCheck, Database, RefreshCw, Plus, Trash2,
  BarChart3, CalendarRange, ChevronDown, AlertTriangle,
} from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'
import { supabase } from '@/lib/supabase/client'
import { countPending, runSync } from '@/lib/sync/engine'
import { db } from '@/lib/dexie/schema'
import { useSyncStore } from '@/store/syncStore'
import { formatDateTime, formatCurrency } from '@/lib/utils'
import type { AppUser, UserRole } from '@/types'

// ─── User creation schema ─────────────────────────────────────────────────────
const newUserSchema = z.object({
  email: z.string().email('Valid email required'),
  password: z.string().min(6, 'Min 6 characters'),
  name: z.string().min(1, 'Name required'),
  role: z.enum(['admin', 'receptionist', 'doctor', 'radiologist', 'accountant']),
})
type NewUserForm = z.infer<typeof newUserSchema>

const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Admin',
  receptionist: 'Receptionist',
  doctor: 'Doctor',
  radiologist: 'Radiologist',
  accountant: 'Accountant',
}

const ROLE_COLORS: Record<UserRole, string> = {
  admin: 'bg-red-100 text-red-700',
  receptionist: 'bg-blue-100 text-blue-700',
  doctor: 'bg-green-100 text-green-700',
  radiologist: 'bg-purple-100 text-purple-700',
  accountant: 'bg-amber-100 text-amber-700',
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface UserRow extends AppUser {
  name: string
}

interface CollectionRow {
  created_by_name: string | null
  total_collected: number
  invoice_count: number
}

// ─── AdminPage ────────────────────────────────────────────────────────────────
export function AdminPage() {
  const { isOnline, isSyncing, pendingCount, lastSyncAt } = useSyncStore()
  const qc = useQueryClient()
  const [activeTab, setActiveTab] = useState<'system' | 'users' | 'collection'>('system')
  const [showAddUser, setShowAddUser] = useState(false)
  const [reportDate, setReportDate] = useState(() => new Date().toISOString().slice(0, 10))

  // ── Users query ──────────────────────────────────────────────────────────
  const { data: users = [], isLoading: usersLoading } = useQuery<UserRow[]>({
    queryKey: ['admin-users'],
    queryFn: async () => {
      const { data, error } = await supabase.from('users').select('*').order('created_at')
      if (error) throw error
      return data as UserRow[]
    },
    enabled: isOnline && activeTab === 'users',
  })

  // ── User count ────────────────────────────────────────────────────────────
  const { data: userCount } = useQuery({
    queryKey: ['admin-user-count'],
    queryFn: async () => {
      const { count } = await supabase.from('users').select('*', { count: 'exact', head: true })
      return count ?? 0
    },
    enabled: isOnline,
  })

  const { data: pendingLocal } = useQuery({
    queryKey: ['pending-sync-count'],
    queryFn: countPending,
    refetchInterval: 10_000,
  })

  // ── Daily Collection Report query ─────────────────────────────────────────
  const { data: collectionData = [], isLoading: collectionLoading } = useQuery<CollectionRow[]>({
    queryKey: ['daily-collection', reportDate],
    queryFn: async () => {
      const dayStart = `${reportDate}T00:00:00.000Z`
      const dayEnd   = `${reportDate}T23:59:59.999Z`
      const { data, error } = await supabase
        .from('invoices')
        .select('created_by_name, paid_amount')
        .gte('created_at', dayStart)
        .lte('created_at', dayEnd)
      if (error) throw error
      // Group by created_by_name
      const map = new Map<string, CollectionRow>()
      for (const row of (data ?? [])) {
        const key = row.created_by_name ?? '— Unknown —'
        const existing = map.get(key)
        if (existing) {
          existing.total_collected += Number(row.paid_amount ?? 0)
          existing.invoice_count += 1
        } else {
          map.set(key, {
            created_by_name: row.created_by_name,
            total_collected: Number(row.paid_amount ?? 0),
            invoice_count: 1,
          })
        }
      }
      return Array.from(map.values()).sort((a, b) => b.total_collected - a.total_collected)
    },
    enabled: isOnline && activeTab === 'collection',
  })

  const totalCollection = collectionData.reduce((s, r) => s + r.total_collected, 0)
  const totalInvoices = collectionData.reduce((s, r) => s + r.invoice_count, 0)

  // ── Add User mutation ──────────────────────────────────────────────────────
  const {
    register,
    handleSubmit,
    reset: resetForm,
    formState: { errors, isSubmitting },
  } = useForm<NewUserForm>({
    resolver: zodResolver(newUserSchema),
    defaultValues: { role: 'receptionist' },
  })

  const addUserMutation = useMutation({
    mutationFn: async (data: NewUserForm) => {
      // 1. Create Supabase auth user (works when email confirm is OFF)
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: data.email,
        password: data.password,
        options: { data: { name: data.name } },
      })
      if (authError) throw authError
      const userId = authData.user?.id
      if (!userId) throw new Error('Failed to create auth user')

      // 2. Upsert into users table with name + role
      const { error: profileError } = await supabase.from('users').upsert({
        id: userId,
        email: data.email,
        name: data.name,
        role: data.role,
        doctor_id: null,
        created_at: new Date().toISOString(),
      })
      if (profileError) throw profileError
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-users'] })
      qc.invalidateQueries({ queryKey: ['admin-user-count'] })
      setShowAddUser(false)
      resetForm()
    },
  })

  // ── Delete User mutation ───────────────────────────────────────────────────
  const deleteUserMutation = useMutation({
    mutationFn: async (id: string) => {
      // Delete from users table (auth user stays but loses profile)
      const { error } = await supabase.from('users').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-users'] })
      qc.invalidateQueries({ queryKey: ['admin-user-count'] })
    },
  })

  const handleDeleteUser = (id: string, email: string) => {
    if (!window.confirm(`Remove user "${email}" from HMS? They will lose access immediately.`)) return
    deleteUserMutation.mutate(id)
  }

  // ── Delete ALL HMS data ────────────────────────────────────────────────────
  const [isDeleting, setIsDeleting] = useState(false)

  const DATA_TABLES = [
    'salary_records', 'ipd_procedures', 'ipd_admissions',
    'ultrasound_reports', 'invoices', 'birth_certificates',
    'death_certificates', 'online_bookings', 'opd_tokens',
    'er_visits', 'patients',
  ] as const

  const clearDexie = async () => {
    await Promise.all([
      db.patients.clear(),
      db.opd_tokens.clear(),
      db.er_visits.clear(),
      db.ipd_admissions.clear(),
      db.ipd_procedures.clear(),
      db.ultrasound_reports.clear(),
      db.invoices.clear(),
      db.birth_certificates.clear(),
      db.death_certificates.clear(),
      db.online_bookings.clear(),
      db.salary_records.clear(),
    ])
  }

  const handleClearOfflineOnly = async () => {
    if (!window.confirm('Clear all offline cached data? (Supabase data is kept. Data will re-sync next time you go online.)')) return
    await clearDexie()
    alert('Offline cache cleared.')
    window.location.reload()
  }

  const handleDeleteAllData = async () => {
    const first = window.confirm(
      '⚠️ WARNING: This will permanently delete ALL patient records, USG reports, OPD tokens, invoices, ER visits, IPD admissions, certificates, HR records, and salary data.\n\nThis CANNOT be undone.\n\nAre you sure?'
    )
    if (!first) return
    const second = window.confirm('FINAL CONFIRMATION: Delete everything and start fresh?')
    if (!second) return

    setIsDeleting(true)
    try {
      // 1. Delete from Supabase first (before clearing Dexie)
      const failed: string[] = []
      if (navigator.onLine) {
        for (const t of DATA_TABLES) {
          const { error } = await supabase.from(t).delete().neq('id', '00000000-0000-0000-0000-000000000000')
          if (error) failed.push(t)
        }
      }

      // 2. Clear Dexie regardless
      await clearDexie()

      if (failed.length > 0) {
        alert(
          `Offline data cleared ✓\n\nSome Supabase tables could not be deleted (RLS policy):\n${failed.join(', ')}\n\nTo fully delete server data, run the TRUNCATE SQL in your Supabase SQL editor.\n(Check the Admin page for the SQL statement.)`
        )
      } else {
        alert('All HMS data deleted successfully. The system is now fresh.')
      }
      window.location.reload()
    } catch (err) {
      alert('Error: ' + String(err))
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="System Administration"
        subtitle="System health, user management, and reports"
      />

      {/* Tab bar */}
      <div className="flex gap-1 mb-6 border-b border-gray-200">
        {([
          { id: 'system', label: 'System', icon: Database },
          { id: 'users', label: 'User Management', icon: Users },
          { id: 'collection', label: 'Daily Collection', icon: BarChart3 },
        ] as const).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === id
                ? 'border-maroon-500 text-maroon-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {/* ── SYSTEM TAB ── */}
      {activeTab === 'system' && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            {/* Sync status */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-center gap-3 mb-3">
                <div className={`p-2 rounded-lg ${isOnline ? 'bg-green-50' : 'bg-amber-50'}`}>
                  <Database className={`w-5 h-5 ${isOnline ? 'text-green-600' : 'text-amber-600'}`} />
                </div>
                <h3 className="font-semibold text-gray-800">Sync Status</h3>
              </div>
              <p className={`text-sm font-medium ${isOnline ? 'text-green-600' : 'text-amber-600'}`}>
                {isOnline ? 'Online — Syncing to Supabase' : 'Offline — Using Local DB'}
              </p>
              <p className="text-xs text-gray-500 mt-1">
                {(pendingLocal ?? pendingCount) > 0
                  ? `${pendingLocal ?? pendingCount} records pending sync`
                  : 'All records synced'}
              </p>
              {lastSyncAt && (
                <p className="text-xs text-gray-400 mt-1">Last sync: {formatDateTime(lastSyncAt)}</p>
              )}
              <button
                onClick={() => runSync()}
                disabled={isSyncing || !isOnline}
                className="mt-3 flex items-center gap-2 text-sm text-maroon-600 hover:text-maroon-700 disabled:text-gray-400"
              >
                <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
                {isSyncing ? 'Syncing...' : 'Sync Now'}
              </button>
            </div>

            {/* Users */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-center gap-3 mb-3">
                <div className="p-2 rounded-lg bg-blue-50">
                  <Users className="w-5 h-5 text-blue-600" />
                </div>
                <h3 className="font-semibold text-gray-800">System Users</h3>
              </div>
              <p className="text-3xl font-bold text-blue-600">{userCount ?? '—'}</p>
              <p className="text-xs text-gray-500 mt-1">Registered HMS users</p>
              <button
                onClick={() => setActiveTab('users')}
                className="mt-3 text-sm text-blue-600 hover:underline"
              >
                Manage Users →
              </button>
            </div>

            {/* Security */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-center gap-3 mb-3">
                <div className="p-2 rounded-lg bg-green-50">
                  <ShieldCheck className="w-5 h-5 text-green-600" />
                </div>
                <h3 className="font-semibold text-gray-800">Security</h3>
              </div>
              <p className="text-sm text-green-600 font-medium">RLS Enabled</p>
              <p className="text-xs text-gray-500 mt-1">
                Row Level Security active on all Supabase tables.
                Role-based access control enforced.
              </p>
            </div>
          </div>

          {/* System info */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h3 className="font-semibold text-gray-800 mb-4">System Information</h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              {[
                { label: 'Hospital', value: 'Alim Khatoon Medicare' },
                { label: 'Location', value: 'Green Town, Lahore, Pakistan' },
                { label: 'HMS Version', value: '1.0.0' },
                { label: 'Database', value: 'Supabase (PostgreSQL) + IndexedDB (Dexie)' },
                { label: 'PWA Mode', value: 'Offline-First (Workbox)' },
                { label: 'WhatsApp', value: 'WA.me Deep Links (Zero Cost)' },
                { label: 'Print', value: 'react-to-print + jsPDF' },
                { label: 'Frontend', value: 'React 18 + Vite + TypeScript + TailwindCSS' },
              ].map(({ label, value }) => (
                <div key={label} className="flex gap-3">
                  <span className="text-gray-500 font-medium min-w-[120px]">{label}:</span>
                  <span className="text-gray-800">{value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* ── DANGER ZONE ── */}
          <div className="border border-red-200 rounded-xl p-6 bg-red-50 space-y-5">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-600" />
              <h3 className="font-semibold text-red-700 text-base">Danger Zone</h3>
            </div>

            {/* Clear offline cache only */}
            <div className="bg-white rounded-lg border border-orange-200 p-4">
              <p className="text-sm font-medium text-gray-800 mb-1">Clear Offline Cache</p>
              <p className="text-xs text-gray-500 mb-3">Removes all locally cached data from this device. Supabase data is kept and will re-sync when online.</p>
              <button
                onClick={handleClearOfflineOnly}
                className="flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg text-sm font-medium"
              >
                <Database className="w-4 h-4" />
                Clear Offline Cache
              </button>
            </div>

            {/* Delete everything */}
            <div className="bg-white rounded-lg border border-red-200 p-4">
              <p className="text-sm font-medium text-gray-800 mb-1">Delete All HMS Data</p>
              <p className="text-xs text-gray-500 mb-1">
                Deletes all patients, USG reports, OPD, ER, IPD, invoices, certificates, HR &amp; salary records — online and offline. User accounts kept.
              </p>
              <p className="text-xs text-orange-700 font-medium mb-3">
                ⚠ If Supabase delete fails (RLS), run this in{' '}
                <a href="https://supabase.com/dashboard/project/lghwyzbtwrwkzjcqcnzv/sql/new" target="_blank" rel="noreferrer" className="underline">Supabase SQL Editor</a>:
              </p>
              <pre className="text-xs bg-gray-900 text-green-300 rounded p-3 overflow-x-auto mb-3 select-all">{`TRUNCATE TABLE salary_records CASCADE;
TRUNCATE TABLE ipd_procedures CASCADE;
TRUNCATE TABLE ipd_admissions CASCADE;
TRUNCATE TABLE ultrasound_reports CASCADE;
TRUNCATE TABLE invoices CASCADE;
TRUNCATE TABLE birth_certificates CASCADE;
TRUNCATE TABLE death_certificates CASCADE;
TRUNCATE TABLE online_bookings CASCADE;
TRUNCATE TABLE opd_tokens CASCADE;
TRUNCATE TABLE er_visits CASCADE;
TRUNCATE TABLE patients CASCADE;`}</pre>
              <button
                onClick={handleDeleteAllData}
                disabled={isDeleting}
                className="flex items-center gap-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white px-5 py-2.5 rounded-lg text-sm font-semibold"
              >
                <Trash2 className="w-4 h-4" />
                {isDeleting ? 'Deleting...' : 'Delete All HMS Data'}
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── USERS TAB ── */}
      {activeTab === 'users' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-800">HMS Staff Accounts</h2>
            <button
              onClick={() => setShowAddUser(true)}
              className="flex items-center gap-2 bg-maroon-500 hover:bg-maroon-600 text-white px-4 py-2 rounded-lg text-sm font-medium"
            >
              <Plus className="w-4 h-4" />
              Add User
            </button>
          </div>

          {!isOnline && (
            <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
              User management requires an internet connection.
            </div>
          )}

          {usersLoading ? (
            <div className="flex justify-center py-12">
              <LoadingSpinner label="Loading users..." />
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Name</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Email</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Role</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Joined</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {users.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="text-center py-10 text-gray-400">
                        No users found.
                      </td>
                    </tr>
                  ) : (
                    users.map((u) => (
                      <tr key={u.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium text-gray-800">{u.name || '—'}</td>
                        <td className="px-4 py-3 text-gray-600">{u.email}</td>
                        <td className="px-4 py-3">
                          <span className={`text-xs font-semibold px-2 py-1 rounded-full ${ROLE_COLORS[u.role as UserRole] ?? 'bg-gray-100 text-gray-600'}`}>
                            {ROLE_LABELS[u.role as UserRole] ?? u.role}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-500 text-xs">
                          {new Date(u.created_at).toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => handleDeleteUser(u.id, u.email)}
                            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                            title="Remove user"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Add User Modal */}
          {showAddUser && (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
              <div className="bg-white rounded-xl w-full max-w-md shadow-2xl">
                <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Users className="w-5 h-5 text-maroon-500" />
                    <h2 className="text-lg font-semibold">Add New User</h2>
                  </div>
                  <button onClick={() => setShowAddUser(false)} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
                </div>

                <form
                  onSubmit={handleSubmit((d) => addUserMutation.mutateAsync(d))}
                  className="p-6 space-y-4"
                >
                  {addUserMutation.isError && (
                    <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                      {(addUserMutation.error as Error)?.message ?? 'Failed to create user.'}
                    </div>
                  )}

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Full Name *</label>
                    <input
                      {...register('name')}
                      type="text"
                      placeholder="e.g. Dr. Waseem Akram"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-maroon-500"
                    />
                    {errors.name && <p className="text-xs text-red-600 mt-1">{errors.name.message}</p>}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Email Address *</label>
                    <input
                      {...register('email')}
                      type="email"
                      placeholder="user@akmmedicare.pk"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-maroon-500"
                    />
                    {errors.email && <p className="text-xs text-red-600 mt-1">{errors.email.message}</p>}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Password *</label>
                    <input
                      {...register('password')}
                      type="password"
                      placeholder="Min 6 characters"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-maroon-500"
                    />
                    {errors.password && <p className="text-xs text-red-600 mt-1">{errors.password.message}</p>}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Role *</label>
                    <div className="relative">
                      <select
                        {...register('role')}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-maroon-500 appearance-none"
                      >
                        <option value="receptionist">Receptionist</option>
                        <option value="doctor">Doctor</option>
                        <option value="radiologist">Radiologist</option>
                        <option value="accountant">Accountant</option>
                        <option value="admin">Admin</option>
                      </select>
                      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                    </div>
                    {errors.role && <p className="text-xs text-red-600 mt-1">{errors.role.message}</p>}
                  </div>

                  <div className="flex gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => { setShowAddUser(false); resetForm() }}
                      className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isSubmitting || addUserMutation.isPending}
                      className="flex-1 px-4 py-2 bg-maroon-500 hover:bg-maroon-600 disabled:bg-maroon-300 text-white rounded-lg text-sm font-medium"
                    >
                      {addUserMutation.isPending ? 'Creating...' : 'Create User'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── DAILY COLLECTION TAB ── */}
      {activeTab === 'collection' && (
        <div>
          <div className="flex items-center gap-4 mb-6">
            <div className="flex items-center gap-2">
              <CalendarRange className="w-5 h-5 text-gray-500" />
              <label className="text-sm font-medium text-gray-700">Report Date:</label>
              <input
                type="date"
                value={reportDate}
                onChange={(e) => setReportDate(e.target.value)}
                className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-maroon-500"
              />
            </div>
          </div>

          {!isOnline && (
            <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
              Collection report requires an internet connection.
            </div>
          )}

          {collectionLoading ? (
            <div className="flex justify-center py-12">
              <LoadingSpinner label="Loading report..." />
            </div>
          ) : (
            <>
              {/* Summary cards */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
                <div className="bg-white rounded-xl border border-gray-200 p-4">
                  <p className="text-xs text-gray-500 mb-1">Total Collected</p>
                  <p className="text-2xl font-bold text-green-600">{formatCurrency(totalCollection)}</p>
                </div>
                <div className="bg-white rounded-xl border border-gray-200 p-4">
                  <p className="text-xs text-gray-500 mb-1">Total Invoices</p>
                  <p className="text-2xl font-bold text-maroon-600">{totalInvoices}</p>
                </div>
                <div className="bg-white rounded-xl border border-gray-200 p-4">
                  <p className="text-xs text-gray-500 mb-1">Staff Members</p>
                  <p className="text-2xl font-bold text-blue-600">{collectionData.length}</p>
                </div>
              </div>

              {/* Per-user breakdown */}
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden overflow-x-auto">
                <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
                  <h3 className="font-semibold text-gray-700 text-sm">Collection by Staff — {reportDate}</h3>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="text-left px-4 py-3 font-medium text-gray-600">#</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Staff Name</th>
                      <th className="text-center px-4 py-3 font-medium text-gray-600">Invoices</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-600">Amount Collected</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-600">% Share</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {collectionData.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="text-center py-10 text-gray-400">
                          No invoices found for {reportDate}.
                        </td>
                      </tr>
                    ) : (
                      collectionData.map((row, idx) => {
                        const pct = totalCollection > 0 ? ((row.total_collected / totalCollection) * 100).toFixed(1) : '0.0'
                        return (
                          <tr key={idx} className="hover:bg-gray-50">
                            <td className="px-4 py-3 text-gray-400 text-xs">{idx + 1}</td>
                            <td className="px-4 py-3 font-medium text-gray-800">
                              {row.created_by_name ?? '— Unknown —'}
                            </td>
                            <td className="px-4 py-3 text-center text-gray-600">{row.invoice_count}</td>
                            <td className="px-4 py-3 text-right font-semibold text-green-700">
                              {formatCurrency(row.total_collected)}
                            </td>
                            <td className="px-4 py-3 text-right text-gray-500 text-xs">
                              <div className="flex items-center justify-end gap-2">
                                <div className="w-16 bg-gray-100 rounded-full h-1.5">
                                  <div
                                    className="bg-maroon-500 h-1.5 rounded-full"
                                    style={{ width: `${pct}%` }}
                                  />
                                </div>
                                {pct}%
                              </div>
                            </td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                  {collectionData.length > 0 && (
                    <tfoot>
                      <tr className="border-t-2 border-gray-200 bg-gray-50 font-bold">
                        <td colSpan={2} className="px-4 py-3 text-gray-700">TOTAL</td>
                        <td className="px-4 py-3 text-center text-gray-700">{totalInvoices}</td>
                        <td className="px-4 py-3 text-right text-green-700">{formatCurrency(totalCollection)}</td>
                        <td className="px-4 py-3 text-right text-gray-500 text-xs">100%</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
