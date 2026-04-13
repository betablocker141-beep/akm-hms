import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Plus, Search, User, Phone, Briefcase, Trash2,
  Banknote, CalendarRange, CheckCircle, Clock,
  TrendingDown, Gift, AlertTriangle,
} from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'
import { supabase } from '@/lib/supabase/client'
import { db } from '@/lib/dexie/schema'
import { generateUUID, formatDate, formatCurrency } from '@/lib/utils'
import { fetchWithFallback } from '@/lib/utils/fetchWithFallback'
import { useSyncStore } from '@/store/syncStore'
import type { HrEmployee, SalaryRecord } from '@/types'

// ─── Constants ────────────────────────────────────────────────────────────────

const DEPARTMENTS = [
  'Administration',
  'Nursing',
  'Emergency (ER)',
  'OPD',
  'Indoor (IPD)',
  'Ultrasound / Radiology',
  'Pharmacy',
  'Laboratory',
  'Accounts',
  'Reception',
  'Housekeeping',
  'Security',
  'Other',
]

const DESIGNATIONS = [
  'Doctor',
  'Nurse',
  'Head Nurse',
  'Receptionist',
  'Accountant',
  'Radiologist',
  'Lab Technician',
  'Pharmacist',
  'Ward Boy',
  'Sweeper',
  'Security Guard',
  'HR Officer',
  'Admin Officer',
  'Manager',
  'Other',
]

// ─── Schemas ──────────────────────────────────────────────────────────────────

const employeeSchema = z.object({
  name: z.string().min(2, 'Name is required'),
  cnic: z.string().optional(),
  phone: z.string().min(10, 'Valid phone required'),
  designation: z.string().min(1, 'Designation required'),
  department: z.string().min(1, 'Department required'),
  join_date: z.string().min(1, 'Join date required'),
  salary: z.coerce.number().min(0, 'Enter valid salary'),
  address: z.string().optional(),
  emergency_contact: z.string().optional(),
  status: z.enum(['active', 'inactive']),
})

type EmployeeForm = z.infer<typeof employeeSchema>

const salaryEditSchema = z.object({
  advance_taken: z.coerce.number().min(0),
  fine: z.coerce.number().min(0),
  bonus: z.coerce.number().min(0),
  notes: z.string().optional(),
  status: z.enum(['pending', 'paid']),
  paid_date: z.string().optional(),
})

type SalaryEditForm = z.infer<typeof salaryEditSchema>

// ─── Data helpers ─────────────────────────────────────────────────────────────

async function fetchEmployees(): Promise<HrEmployee[]> {
  return fetchWithFallback(
    async () => {
      const { data, error } = await supabase.from('hr_employees').select('*').order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as HrEmployee[]
    },
    () => db.hr_employees.orderBy('created_at').reverse().toArray() as unknown as Promise<HrEmployee[]>,
  )
}

async function fetchSalaryRecords(month: string): Promise<SalaryRecord[]> {
  return fetchWithFallback(
    async () => {
      const { data, error } = await supabase.from('salary_records').select('*').eq('month', month)
      if (error) throw error
      return (data ?? []) as SalaryRecord[]
    },
    () => db.salary_records.where('month').equals(month).toArray() as unknown as Promise<SalaryRecord[]>,
  )
}

function currentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// ─── Main Component ────────────────────────────────────────────────────────────

export function HrPage() {
  const [activeTab, setActiveTab] = useState<'employees' | 'salary'>('employees')

  return (
    <div>
      <PageHeader
        title="Human Resources"
        subtitle="Manage employees and monthly salary records"
      />

      {/* Tab Bar */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1 w-fit">
        <button
          onClick={() => setActiveTab('employees')}
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            activeTab === 'employees'
              ? 'bg-white text-maroon-700 shadow-sm'
              : 'text-gray-600 hover:text-gray-800'
          }`}
        >
          <User className="w-4 h-4" />
          Employees
        </button>
        <button
          onClick={() => setActiveTab('salary')}
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            activeTab === 'salary'
              ? 'bg-white text-maroon-700 shadow-sm'
              : 'text-gray-600 hover:text-gray-800'
          }`}
        >
          <Banknote className="w-4 h-4" />
          Salary Management
        </button>
      </div>

      {activeTab === 'employees' ? <EmployeesTab /> : <SalaryTab />}
    </div>
  )
}

// ─── Employees Tab ────────────────────────────────────────────────────────────

function EmployeesTab() {
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editEmployee, setEditEmployee] = useState<HrEmployee | null>(null)
  const qc = useQueryClient()
  const { isOnline } = useSyncStore()

  const { data: employees = [], isLoading } = useQuery({
    queryKey: ['hr-employees'],
    queryFn: fetchEmployees,
  })

  const { register, handleSubmit, reset, formState: { errors } } = useForm<EmployeeForm>({
    resolver: zodResolver(employeeSchema),
    defaultValues: { status: 'active', join_date: new Date().toISOString().slice(0, 10) },
  })

  const filtered = employees.filter((e) => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      e.name.toLowerCase().includes(q) ||
      e.designation.toLowerCase().includes(q) ||
      e.department.toLowerCase().includes(q) ||
      (e.phone ?? '').includes(q) ||
      (e.cnic ?? '').includes(q)
    )
  })

  const addMutation = useMutation({
    mutationFn: async (data: EmployeeForm) => {
      const online = useSyncStore.getState().isOnline && navigator.onLine
      const localId = generateUUID()
      const record = {
        id: localId,
        local_id: localId,
        server_id: null as string | null,
        name: data.name,
        cnic: data.cnic || null,
        phone: data.phone,
        designation: data.designation,
        department: data.department,
        join_date: data.join_date,
        salary: Number(data.salary),
        address: data.address || null,
        emergency_contact: data.emergency_contact || null,
        status: data.status,
        created_at: new Date().toISOString(),
        sync_status: 'pending' as const,
      }

      await db.hr_employees.add(record)

      if (online) {
        try {
          const { data: saved, error } = await supabase
            .from('hr_employees')
            .insert({
              name: record.name,
              cnic: record.cnic,
              phone: record.phone,
              designation: record.designation,
              department: record.department,
              join_date: record.join_date,
              salary: record.salary,
              address: record.address,
              emergency_contact: record.emergency_contact,
              status: record.status,
              created_at: record.created_at,
            })
            .select()
            .single()
          if (!error && saved) {
            await db.hr_employees
              .where('local_id')
              .equals(localId)
              .modify({ server_id: saved.id, sync_status: 'synced' })
          }
        } catch {
          // Network failed — stays pending, syncs later
        }
      }
      return record
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-employees'] })
      reset()
      setShowForm(false)
    },
  })

  const editMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: EmployeeForm }) => {
      const updates = {
        name: data.name,
        cnic: data.cnic || null,
        phone: data.phone,
        designation: data.designation,
        department: data.department,
        join_date: data.join_date,
        salary: Number(data.salary),
        address: data.address || null,
        emergency_contact: data.emergency_contact || null,
        status: data.status,
        sync_status: 'pending' as const,
      }
      await db.hr_employees.filter((e) => e.local_id === id || e.server_id === id).modify(updates)
      if (useSyncStore.getState().isOnline && navigator.onLine) {
        await supabase.from('hr_employees').update(updates).eq('id', id)
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-employees'] })
      reset()
      setShowForm(false)
      setEditEmployee(null)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (emp: HrEmployee) => {
      await db.hr_employees.filter((e) => e.local_id === emp.id || e.server_id === emp.id).delete()
      if (useSyncStore.getState().isOnline && navigator.onLine && emp.server_id) {
        await supabase.from('hr_employees').delete().eq('id', emp.server_id)
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr-employees'] }),
  })

  function openAdd() {
    setEditEmployee(null)
    reset({ status: 'active', join_date: new Date().toISOString().slice(0, 10) })
    setShowForm(true)
  }

  function openEdit(emp: HrEmployee) {
    setEditEmployee(emp)
    reset({
      name: emp.name,
      cnic: emp.cnic ?? '',
      phone: emp.phone,
      designation: emp.designation,
      department: emp.department,
      join_date: emp.join_date,
      salary: emp.salary,
      address: emp.address ?? '',
      emergency_contact: emp.emergency_contact ?? '',
      status: emp.status,
    })
    setShowForm(true)
  }

  function onSubmit(data: EmployeeForm) {
    if (editEmployee) {
      editMutation.mutate({ id: editEmployee.id, data })
    } else {
      addMutation.mutate(data)
    }
  }

  const activeCount = employees.filter((e) => e.status === 'active').length

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-500">{activeCount} active — {employees.length} total</p>
        <button
          onClick={openAdd}
          className="flex items-center gap-2 bg-maroon-500 hover:bg-maroon-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Employee
        </button>
      </div>

      {/* Search */}
      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, designation, department, CNIC, phone..."
          className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-maroon-500"
        />
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex justify-center py-16">
          <LoadingSpinner label="Loading employees..." />
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Employee</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Designation</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Department</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Phone</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Join Date</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Salary</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-gray-400">
                    {search ? 'No employees match your search.' : 'No employees added yet.'}
                  </td>
                </tr>
              ) : (
                filtered.map((emp) => (
                  <tr key={emp.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-maroon-100 flex items-center justify-center flex-shrink-0">
                          <User className="w-4 h-4 text-maroon-500" />
                        </div>
                        <div>
                          <p className="font-medium text-gray-800">{emp.name}</p>
                          {emp.cnic && <p className="text-xs text-gray-400">{emp.cnic}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 text-gray-700">
                        <Briefcase className="w-3 h-3 text-gray-400" />
                        {emp.designation}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{emp.department}</td>
                    <td className="px-4 py-3 text-gray-600">
                      <div className="flex items-center gap-1">
                        <Phone className="w-3 h-3 text-gray-400" />
                        {emp.phone}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-500">{formatDate(emp.join_date)}</td>
                    <td className="px-4 py-3 font-medium text-gray-700">
                      Rs. {emp.salary.toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        emp.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                      }`}>
                        {emp.status === 'active' ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => openEdit(emp)}
                          className="text-xs bg-blue-50 text-blue-600 hover:bg-blue-100 px-2 py-1 rounded"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => {
                            if (confirm(`Remove ${emp.name}?`)) deleteMutation.mutate(emp)
                          }}
                          className="p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Add / Edit Employee Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-2xl shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between sticky top-0 bg-white">
              <h2 className="text-lg font-semibold">{editEmployee ? 'Edit Employee' : 'Add New Employee'}</h2>
              <button
                onClick={() => { setShowForm(false); setEditEmployee(null); reset() }}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none"
              >
                ×
              </button>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Full Name *</label>
                  <input
                    {...register('name')}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-maroon-500"
                    placeholder="Employee full name"
                  />
                  {errors.name && <p className="text-xs text-red-600 mt-1">{errors.name.message}</p>}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">CNIC</label>
                  <input
                    {...register('cnic')}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-maroon-500"
                    placeholder="XXXXX-XXXXXXX-X"
                  />
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
                  <label className="block text-sm font-medium text-gray-700 mb-1">Designation *</label>
                  <select
                    {...register('designation')}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-maroon-500"
                  >
                    <option value="">Select Designation</option>
                    {DESIGNATIONS.map((d) => <option key={d}>{d}</option>)}
                  </select>
                  {errors.designation && <p className="text-xs text-red-600 mt-1">{errors.designation.message}</p>}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Department *</label>
                  <select
                    {...register('department')}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-maroon-500"
                  >
                    <option value="">Select Department</option>
                    {DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}
                  </select>
                  {errors.department && <p className="text-xs text-red-600 mt-1">{errors.department.message}</p>}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Join Date *</label>
                  <input
                    {...register('join_date')}
                    type="date"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-maroon-500"
                  />
                  {errors.join_date && <p className="text-xs text-red-600 mt-1">{errors.join_date.message}</p>}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Monthly Salary (Rs.) *</label>
                  <input
                    {...register('salary')}
                    type="number"
                    min={0}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-maroon-500"
                    placeholder="e.g. 25000"
                  />
                  {errors.salary && <p className="text-xs text-red-600 mt-1">{errors.salary.message}</p>}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                  <select
                    {...register('status')}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-maroon-500"
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive / Left</option>
                  </select>
                </div>

                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Home Address</label>
                  <input
                    {...register('address')}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-maroon-500"
                    placeholder="House #, Street, Area, City"
                  />
                </div>

                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Emergency Contact</label>
                  <input
                    {...register('emergency_contact')}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-maroon-500"
                    placeholder="Name — 03XX-XXXXXXX"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => { setShowForm(false); setEditEmployee(null); reset() }}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addMutation.isPending || editMutation.isPending}
                  className="px-4 py-2 bg-maroon-500 hover:bg-maroon-600 text-white rounded-lg text-sm font-medium disabled:opacity-50"
                >
                  {(addMutation.isPending || editMutation.isPending)
                    ? 'Saving...'
                    : editEmployee ? 'Save Changes' : 'Add Employee'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Salary Tab ───────────────────────────────────────────────────────────────

function SalaryTab() {
  const [selectedMonth, setSelectedMonth] = useState(currentMonth)
  const [editingRecord, setEditingRecord] = useState<SalaryRecord | null>(null)
  const qc = useQueryClient()
  const { isOnline } = useSyncStore()

  const { data: employees = [] } = useQuery({
    queryKey: ['hr-employees'],
    queryFn: fetchEmployees,
  })

  const { data: salaryRecords = [], isLoading } = useQuery({
    queryKey: ['salary-records', selectedMonth],
    queryFn: () => fetchSalaryRecords(selectedMonth),
  })

  // Map employee_id -> employee for quick lookup
  const empMap = new Map(employees.map((e) => [e.id, e]))

  // Generate salary records for all active employees for the selected month
  const generateMutation = useMutation({
    mutationFn: async () => {
      const online = useSyncStore.getState().isOnline && navigator.onLine
      const activeEmployees = employees.filter((e) => e.status === 'active')
      const existingIds = new Set(salaryRecords.map((r) => r.employee_id))
      const toCreate = activeEmployees.filter((e) => !existingIds.has(e.id))

      for (const emp of toCreate) {
        const localId = generateUUID()
        const record = {
          id: localId,
          local_id: localId,
          server_id: null as string | null,
          employee_id: emp.id,
          month: selectedMonth,
          basic_salary: emp.salary,
          advance_taken: 0,
          fine: 0,
          bonus: 0,
          net_salary: emp.salary,
          status: 'pending' as const,
          paid_date: null,
          notes: null,
          created_at: new Date().toISOString(),
          sync_status: 'pending' as const,
        }

        await db.salary_records.add(record)

        if (online) {
          try {
            const { data: saved, error } = await supabase
              .from('salary_records')
              .insert({
                employee_id: record.employee_id,
                month: record.month,
                basic_salary: record.basic_salary,
                advance_taken: record.advance_taken,
                fine: record.fine,
                bonus: record.bonus,
                net_salary: record.net_salary,
                status: record.status,
                paid_date: record.paid_date,
                notes: record.notes,
                created_at: record.created_at,
              })
              .select()
              .single()
            if (!error && saved) {
              await db.salary_records
                .where('local_id')
                .equals(localId)
                .modify({ server_id: saved.id, sync_status: 'synced' })
            }
          } catch {
            // Keep as pending sync
          }
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['salary-records', selectedMonth] })
    },
  })

  // Mark a record as paid
  const markPaidMutation = useMutation({
    mutationFn: async (record: SalaryRecord) => {
      const updates = {
        status: 'paid' as const,
        paid_date: new Date().toISOString().slice(0, 10),
        sync_status: 'pending' as const,
      }
      await db.salary_records
        .filter((r) => r.local_id === record.id || r.server_id === record.id)
        .modify(updates)
      if (useSyncStore.getState().isOnline && navigator.onLine && record.server_id) {
        try {
          await supabase
            .from('salary_records')
            .update({ status: 'paid', paid_date: updates.paid_date })
            .eq('id', record.server_id)
        } catch {
          // Will sync later
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['salary-records', selectedMonth] })
    },
  })

  // Edit salary record (advance, fine, bonus, notes, status)
  const { register: regEdit, handleSubmit: handleEditSubmit, reset: resetEdit, formState: { errors: editErrors } } =
    useForm<SalaryEditForm>({ resolver: zodResolver(salaryEditSchema) })

  const editMutation = useMutation({
    mutationFn: async ({ record, data }: { record: SalaryRecord; data: SalaryEditForm }) => {
      const net = record.basic_salary + data.bonus - data.advance_taken - data.fine
      const updates = {
        advance_taken: data.advance_taken,
        fine: data.fine,
        bonus: data.bonus,
        net_salary: net,
        notes: data.notes || null,
        status: data.status,
        paid_date: data.status === 'paid' ? (data.paid_date || new Date().toISOString().slice(0, 10)) : null,
        sync_status: 'pending' as const,
      }
      await db.salary_records
        .filter((r) => r.local_id === record.id || r.server_id === record.id)
        .modify(updates)
      if (useSyncStore.getState().isOnline && navigator.onLine && record.server_id) {
        try {
          await supabase
            .from('salary_records')
            .update({
              advance_taken: updates.advance_taken,
              fine: updates.fine,
              bonus: updates.bonus,
              net_salary: updates.net_salary,
              notes: updates.notes,
              status: updates.status,
              paid_date: updates.paid_date,
            })
            .eq('id', record.server_id)
        } catch {
          // Will sync later
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['salary-records', selectedMonth] })
      setEditingRecord(null)
    },
  })

  function openEdit(record: SalaryRecord) {
    setEditingRecord(record)
    resetEdit({
      advance_taken: record.advance_taken,
      fine: record.fine,
      bonus: record.bonus,
      notes: record.notes ?? '',
      status: record.status,
      paid_date: record.paid_date ?? '',
    })
  }

  // Summary calculations
  const totalPayroll = salaryRecords.reduce((s, r) => s + r.net_salary, 0)
  const totalPaid = salaryRecords.filter((r) => r.status === 'paid').reduce((s, r) => s + r.net_salary, 0)
  const totalPending = salaryRecords.filter((r) => r.status === 'pending').reduce((s, r) => s + r.net_salary, 0)
  const totalFines = salaryRecords.reduce((s, r) => s + r.fine, 0)
  const totalAdvances = salaryRecords.reduce((s, r) => s + r.advance_taken, 0)

  const alreadyGenerated = salaryRecords.length > 0
  const activeEmployees = employees.filter((e) => e.status === 'active')
  const notGenerated = activeEmployees.filter((e) => !salaryRecords.find((r) => r.employee_id === e.id))

  return (
    <div>
      {/* Controls Row */}
      <div className="flex items-center gap-4 mb-6">
        <div className="flex items-center gap-2">
          <CalendarRange className="w-4 h-4 text-gray-500" />
          <label className="text-sm font-medium text-gray-700">Month:</label>
          <input
            type="month"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-maroon-500"
          />
        </div>
        <button
          onClick={() => generateMutation.mutate()}
          disabled={generateMutation.isPending || notGenerated.length === 0}
          className="flex items-center gap-2 bg-maroon-500 hover:bg-maroon-600 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          {generateMutation.isPending
            ? 'Generating...'
            : alreadyGenerated
            ? `Generate for ${notGenerated.length} remaining`
            : 'Generate Salaries'}
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-5 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-2 mb-1">
            <Banknote className="w-4 h-4 text-maroon-500" />
            <span className="text-xs text-gray-500 font-medium">Total Payroll</span>
          </div>
          <p className="text-lg font-bold text-gray-800">{formatCurrency(totalPayroll)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle className="w-4 h-4 text-green-500" />
            <span className="text-xs text-gray-500 font-medium">Paid</span>
          </div>
          <p className="text-lg font-bold text-green-700">{formatCurrency(totalPaid)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-2 mb-1">
            <Clock className="w-4 h-4 text-orange-500" />
            <span className="text-xs text-gray-500 font-medium">Pending</span>
          </div>
          <p className="text-lg font-bold text-orange-700">{formatCurrency(totalPending)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-2 mb-1">
            <TrendingDown className="w-4 h-4 text-red-500" />
            <span className="text-xs text-gray-500 font-medium">Total Fines</span>
          </div>
          <p className="text-lg font-bold text-red-700">{formatCurrency(totalFines)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle className="w-4 h-4 text-yellow-500" />
            <span className="text-xs text-gray-500 font-medium">Advances</span>
          </div>
          <p className="text-lg font-bold text-yellow-700">{formatCurrency(totalAdvances)}</p>
        </div>
      </div>

      {/* Salary Table */}
      {isLoading ? (
        <div className="flex justify-center py-16">
          <LoadingSpinner label="Loading salary records..." />
        </div>
      ) : salaryRecords.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <Banknote className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">No salary records for {selectedMonth}</p>
          <p className="text-sm text-gray-400 mt-1">
            Click "Generate Salaries" to create records for all active employees.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Employee</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Designation</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Basic</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Advance</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Fine</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">
                  <span className="flex items-center gap-1 justify-end">
                    <Gift className="w-3 h-3" />
                    Bonus
                  </span>
                </th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Net Salary</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {salaryRecords.map((rec) => {
                const emp = empMap.get(rec.employee_id)
                return (
                  <tr key={rec.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-maroon-100 flex items-center justify-center flex-shrink-0">
                          <User className="w-3.5 h-3.5 text-maroon-500" />
                        </div>
                        <span className="font-medium text-gray-800">{emp?.name ?? '—'}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{emp?.designation ?? '—'}</td>
                    <td className="px-4 py-3 text-right text-gray-700">{formatCurrency(rec.basic_salary)}</td>
                    <td className="px-4 py-3 text-right">
                      {rec.advance_taken > 0 ? (
                        <span className="text-yellow-700 font-medium">{formatCurrency(rec.advance_taken)}</span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {rec.fine > 0 ? (
                        <span className="text-red-600 font-medium">{formatCurrency(rec.fine)}</span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {rec.bonus > 0 ? (
                        <span className="text-green-600 font-medium">{formatCurrency(rec.bonus)}</span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-gray-800">
                      {formatCurrency(rec.net_salary)}
                    </td>
                    <td className="px-4 py-3">
                      {rec.status === 'paid' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                          <CheckCircle className="w-3 h-3" />
                          Paid
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-700">
                          <Clock className="w-3 h-3" />
                          Pending
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {rec.status === 'pending' && (
                          <button
                            onClick={() => markPaidMutation.mutate(rec)}
                            disabled={markPaidMutation.isPending}
                            className="text-xs bg-green-50 text-green-700 hover:bg-green-100 px-2 py-1 rounded font-medium"
                          >
                            Mark Paid
                          </button>
                        )}
                        <button
                          onClick={() => openEdit(rec)}
                          className="text-xs bg-blue-50 text-blue-600 hover:bg-blue-100 px-2 py-1 rounded"
                        >
                          Edit
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Edit Salary Modal */}
      {editingRecord && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-md shadow-2xl">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">Edit Salary Record</h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  {empMap.get(editingRecord.employee_id)?.name ?? '—'} — {editingRecord.month}
                </p>
              </div>
              <button
                onClick={() => setEditingRecord(null)}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none"
              >
                ×
              </button>
            </div>

            <form
              onSubmit={handleEditSubmit((data) => editMutation.mutate({ record: editingRecord, data }))}
              className="p-6 space-y-4"
            >
              <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-600">
                <span className="font-medium">Basic Salary:</span> {formatCurrency(editingRecord.basic_salary)}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Advance Taken (Rs.)
                  </label>
                  <input
                    {...regEdit('advance_taken')}
                    type="number"
                    min={0}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-maroon-500"
                  />
                  {editErrors.advance_taken && (
                    <p className="text-xs text-red-600 mt-1">{editErrors.advance_taken.message}</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Fine / Deduction (Rs.)
                  </label>
                  <input
                    {...regEdit('fine')}
                    type="number"
                    min={0}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-maroon-500"
                  />
                  {editErrors.fine && (
                    <p className="text-xs text-red-600 mt-1">{editErrors.fine.message}</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Bonus (Rs.)
                  </label>
                  <input
                    {...regEdit('bonus')}
                    type="number"
                    min={0}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-maroon-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                  <select
                    {...regEdit('status')}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-maroon-500"
                  >
                    <option value="pending">Pending</option>
                    <option value="paid">Paid</option>
                  </select>
                </div>

                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Paid Date</label>
                  <input
                    {...regEdit('paid_date')}
                    type="date"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-maroon-500"
                  />
                </div>

                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                  <textarea
                    {...regEdit('notes')}
                    rows={2}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-maroon-500"
                    placeholder="Optional notes..."
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingRecord(null)}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={editMutation.isPending}
                  className="px-4 py-2 bg-maroon-500 hover:bg-maroon-600 text-white rounded-lg text-sm font-medium disabled:opacity-50"
                >
                  {editMutation.isPending ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
