import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useReactToPrint } from 'react-to-print'
import { Plus, Printer, Trash2, Receipt, Search, FileText, Pencil, UserCircle, Stethoscope } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { WAButton } from '@/components/shared/WAButton'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'
import { InvoicePrint } from '@/components/print/InvoicePrint'
import { ReceiptPrint } from '@/components/print/ReceiptPrint'
import { supabase } from '@/lib/supabase/client'
import { db } from '@/lib/dexie/schema'
import { generateUUID, formatDate, formatCurrency, todayString, padNumber } from '@/lib/utils'
import { fetchWithFallback } from '@/lib/utils/fetchWithFallback'
import { useSyncStore } from '@/store/syncStore'
import { useAuthStore } from '@/store/authStore'
import { waInvoiceReady } from '@/lib/whatsapp/links'
import { fetchActiveDoctors } from '@/lib/utils/doctorUtils'
import type { Invoice, InvoiceItem, Patient, Doctor } from '@/types'

const itemSchema = z.object({
  description: z.string().min(1, 'Required'),
  quantity: z.coerce.number().min(1),
  unit_price: z.coerce.number().min(0),
})

const invoiceSchema = z.object({
  patient_id: z.string().min(1, 'Patient required'),
  patient_phone: z.string().optional(),
  visit_type: z.enum(['opd', 'er', 'ipd', 'us']),
  doctor_id: z.string().optional(),
  items: z.array(itemSchema).min(1, 'At least one item required'),
  discount: z.coerce.number().min(0).max(100000),
  discount_type: z.enum(['amount', 'percent']),
  payment_method: z.enum(['cash', 'card', 'bank_transfer', 'jazzcash', 'easypaisa']),
  receipt_no: z.string().optional(),
  paid_amount: z.coerce.number().min(0),
  notes: z.string().optional(),
})

type InvoiceForm = z.infer<typeof invoiceSchema>

async function fetchInvoicesByDate(date: string): Promise<Invoice[]> {
  const startISO = new Date(`${date}T00:00:00`).toISOString()
  const nextDay  = new Date(`${date}T00:00:00`); nextDay.setDate(nextDay.getDate() + 1)
  const endISO   = nextDay.toISOString()
  return fetchWithFallback(
    async () => {
      const { data, error } = await supabase
        .from('invoices').select('*')
        .gte('created_at', startISO).lt('created_at', endISO)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as Invoice[]
    },
    async () => {
      const all = await db.invoices.orderBy('created_at').reverse().toArray()
      return all.filter(i => i.created_at >= startISO && i.created_at < endISO) as unknown as Invoice[]
    },
  )
}

async function getNextInvoiceNumber(): Promise<string> {
  const year = new Date().getFullYear()
  const count = await db.invoices.count()
  const localNumber = `INV-${year}-${padNumber(count + 1, 4)}`
  if (!navigator.onLine) return localNumber
  try {
    const { data } = await Promise.race([
      supabase.rpc('get_next_invoice_number'),
      new Promise<never>((_, r) => setTimeout(() => r(new Error('timeout')), 3000)),
    ]) as { data: string | null }
    if (data) return data as string
  } catch { /* use local */ }
  return localNumber
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

export function InvoicingPage() {
  const [selectedDate, setSelectedDate] = useState(todayString())
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null)
  const [showPrintModal, setShowPrintModal] = useState(false)
  const [printMode, setPrintMode] = useState<'invoice' | 'receipt'>('invoice')
  const [patientPhone, setPatientPhone] = useState('')

  // Patient live search states
  const [patientSearch, setPatientSearch] = useState('')
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null)
  const [printPatient, setPrintPatient] = useState<Patient | null>(null)

  const printRef = useRef<HTMLDivElement>(null)
  const qc = useQueryClient()
  const { isOnline } = useSyncStore()
  const { user, hasPermission } = useAuthStore()
  const canEditDelete = hasPermission('canEditDelete') || !!user?.email?.toLowerCase().includes('waseem') || !!user?.name?.toLowerCase().includes('waseem')

  const { data: invoices = [], isLoading } = useQuery({
    queryKey: ['invoices', selectedDate],
    queryFn: () => fetchInvoicesByDate(selectedDate),
  })

  const { data: doctors = [] } = useQuery<Doctor[]>({
    queryKey: ['doctors-active'],
    queryFn: fetchActiveDoctors,
  })

  // Patient map for name + phone lookup in list
  const { data: patientsMap = {} } = useQuery<Record<string, { name: string; phone: string }>>({
    queryKey: ['patients-map-full'],
    queryFn: () => fetchWithFallback(
      async () => {
        const { data, error } = await supabase.from('patients').select('id, name, phone')
        if (error) throw error
        return Object.fromEntries((data ?? []).map((p: { id: string; name: string; phone: string }) => [p.id, { name: p.name, phone: p.phone }])) as Record<string, { name: string; phone: string }>
      },
      async () => {
        const all = await db.patients.toArray()
        return Object.fromEntries(all.map((p) => [p.local_id, { name: p.name, phone: p.phone }])) as Record<string, { name: string; phone: string }>
      },
    ),
  })

  const { data: patientResults = [] } = useQuery({
    queryKey: ['inv-patient-search', patientSearch],
    queryFn: () => searchPatients(patientSearch),
    enabled: patientSearch.length >= 2,
  })

  const { register, handleSubmit, control, watch, reset, setValue, formState: { errors } } = useForm<InvoiceForm>({
    resolver: zodResolver(invoiceSchema),
    defaultValues: {
      visit_type: 'opd',
      discount: 0,
      discount_type: 'amount',
      paid_amount: 0,
      payment_method: 'cash',
      items: [{ description: 'Consultation Fee', quantity: 1, unit_price: 500 }],
    },
  })

  const { fields, append, remove } = useFieldArray({ control, name: 'items' })

  const watchedItems = watch('items')
  const watchedDiscount = watch('discount')
  const watchedDiscountType = watch('discount_type')
  const watchedPaid = watch('paid_amount')
  const watchedMethod = watch('payment_method')
  const watchedVisitType = watch('visit_type')

  const subtotal = watchedItems.reduce(
    (sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.unit_price) || 0),
    0
  )
  const discountAmount =
    watchedDiscountType === 'percent'
      ? (subtotal * (Number(watchedDiscount) || 0)) / 100
      : Number(watchedDiscount) || 0
  const total = Math.max(0, subtotal - discountAmount)
  const balance = Math.max(0, total - (Number(watchedPaid) || 0))

  const handleInvoicePrint = useReactToPrint({
    content: () => printRef.current,
    documentTitle: `Invoice-${selectedInvoice?.invoice_number}`,
  })

  const handlePrint = () => {
    if (printMode === 'receipt') {
      if (!printRef.current) return
      const html = printRef.current.innerHTML
      const win = window.open('', '_blank', 'width=420,height=700')
      if (!win) return
      win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Receipt-${selectedInvoice?.invoice_number ?? ''}</title><style>@page{size:80mm auto;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0;width:80mm;background:#fff}</style></head><body style="margin:0;padding:0;width:80mm;background:#fff">${html}</body></html>`)
      win.document.close()
      win.focus()
      setTimeout(() => { win.print(); win.close() }, 400)
    } else {
      handleInvoicePrint()
    }
  }

  const resetForm = () => {
    reset()
    setSelectedPatient(null)
    setPatientSearch('')
    setEditingId(null)
    setShowForm(false)
  }

  const startEdit = (inv: Invoice) => {
    setEditingId(inv.id)
    // Pre-fill form fields
    setValue('patient_id', inv.patient_id)
    setValue('visit_type', inv.visit_type)
    setValue('doctor_id', inv.doctor_id ?? '')
    setValue('discount', inv.discount)
    setValue('discount_type', inv.discount_type as 'amount' | 'percent')
    setValue('payment_method', inv.payment_method as 'cash' | 'card' | 'bank_transfer' | 'jazzcash' | 'easypaisa')
    setValue('receipt_no', inv.receipt_no ?? '')
    setValue('paid_amount', inv.paid_amount)
    setValue('notes', inv.notes ?? '')
    const items = Array.isArray(inv.items)
      ? (inv.items as InvoiceItem[]).map((it) => ({
          description: it.description,
          quantity: it.quantity,
          unit_price: it.unit_price,
        }))
      : [{ description: 'Consultation Fee', quantity: 1, unit_price: 500 }]
    setValue('items', items)
    // Set patient display name if available
    const entry = patientsMap[inv.patient_id]
    const name = entry?.name
    if (name) {
      setSelectedPatient({ id: inv.patient_id, name, phone: entry.phone } as Patient)
    } else {
      setSelectedPatient(null)
    }
    setPatientSearch('')
    setShowForm(true)
  }

  const mutation = useMutation({
    mutationFn: async (data: InvoiceForm) => {
      const online = useSyncStore.getState().isOnline && navigator.onLine
      const paidAmount = Number(data.paid_amount)
      const invTotal = total
      const status = paidAmount >= invTotal ? 'paid' : paidAmount > 0 ? 'partial' : 'pending'

      if (editingId) {
        // UPDATE mode
        const items: InvoiceItem[] = data.items.map((item) => ({
          id: generateUUID(),
          invoice_id: editingId,
          description: item.description,
          quantity: Number(item.quantity),
          unit_price: Number(item.unit_price),
          total: Number(item.quantity) * Number(item.unit_price),
        }))

        const updates = {
          patient_id: data.patient_id,
          doctor_id: data.doctor_id || null,
          visit_type: data.visit_type,
          items,
          subtotal,
          discount: Number(data.discount),
          discount_type: data.discount_type,
          tax: 0,
          total: invTotal,
          paid_amount: paidAmount,
          payment_method: data.payment_method,
          receipt_no: data.receipt_no || null,
          status,
          notes: data.notes || null,
        }

        await db.invoices.filter((inv) => inv.local_id === editingId || inv.server_id === editingId).modify({ ...updates, sync_status: 'pending' })

        if (online) {
          await supabase.from('invoices').update(updates).eq('id', editingId)
        }

        const existing = await db.invoices
          .filter((inv) => inv.local_id === editingId || inv.server_id === editingId)
          .first()
        setPatientPhone(data.patient_phone || selectedPatient?.phone || '')
        return existing as unknown as Invoice
      } else {
        // INSERT mode
        const invoiceNumber = await getNextInvoiceNumber()
        const localId = generateUUID()
        const items: InvoiceItem[] = data.items.map((item) => ({
          id: generateUUID(),
          invoice_id: localId,
          description: item.description,
          quantity: Number(item.quantity),
          unit_price: Number(item.unit_price),
          total: Number(item.quantity) * Number(item.unit_price),
        }))

        const { user: currentUser } = useAuthStore.getState()
        const record: Invoice & { local_id: string; server_id: string | null; sync_status: 'pending' } = {
          id: localId,
          local_id: localId,
          server_id: null,
          patient_id: data.patient_id,
          doctor_id: data.doctor_id || null,
          visit_type: data.visit_type,
          visit_ref_id: null,
          items,
          subtotal,
          discount: Number(data.discount),
          discount_type: data.discount_type,
          tax: 0,
          total: invTotal,
          paid_amount: paidAmount,
          payment_method: data.payment_method,
          receipt_no: data.receipt_no || null,
          status,
          invoice_number: invoiceNumber,
          notes: data.notes || null,
          created_at: new Date().toISOString(),
          created_by_id: currentUser?.id ?? null,
          created_by_name: currentUser?.name ?? currentUser?.email ?? null,
          sync_status: 'pending',
        }

        await db.invoices.add(record)

        // Fire-and-forget — UI resolves immediately after Dexie save
        if (online) {
          void (async () => {
            try {
              // Resolve patient UUID: offline-selected patients use local_id
              // which isn't a valid FK in Supabase — must use server_id
              let serverPatientId = record.patient_id
              const localPat = await db.patients
                .filter((p) => p.local_id === record.patient_id || p.server_id === record.patient_id)
                .first()
              if (localPat?.server_id) serverPatientId = localPat.server_id

              const timeout = new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('timeout')), 6000)
              )
              const insert = supabase.from('invoices').insert({
                patient_id: serverPatientId,
                doctor_id: record.doctor_id,
                visit_type: record.visit_type,
                visit_ref_id: record.visit_ref_id,
                items: record.items,
                subtotal: record.subtotal,
                discount: record.discount,
                discount_type: record.discount_type,
                tax: record.tax,
                total: record.total,
                paid_amount: record.paid_amount,
                payment_method: record.payment_method,
                status: record.status,
                invoice_number: record.invoice_number,
                notes: record.notes,
                created_at: record.created_at,
                created_by_id: record.created_by_id,
                created_by_name: record.created_by_name,
              }).select().single()
              const { data: saved, error } = await Promise.race([insert, timeout]) as { data: { id: string } | null; error: unknown }
              if (!error && saved) {
                await db.invoices.where('local_id').equals(localId).modify({ server_id: saved.id, sync_status: 'synced' })
              }
            } catch (err) { console.error('[invoice] Supabase insert failed, kept as pending:', err) }
          })()
        }

        setPatientPhone(data.patient_phone || selectedPatient?.phone || '')
        return record
      }
    },
    onSuccess: (record) => {
      qc.invalidateQueries({ queryKey: ['invoices', selectedDate] })
      qc.invalidateQueries({ queryKey: ['patients-map'] })
      if (record) {
        setPrintPatient(selectedPatient)
        setSelectedInvoice(record as unknown as Invoice)
        setPrintMode('invoice')
        setShowPrintModal(true)
      }
      resetForm()
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await db.invoices.filter((inv) => inv.local_id === id || inv.server_id === id).delete()
      if (useSyncStore.getState().isOnline && navigator.onLine) {
        await supabase.from('invoices').delete().eq('id', id)
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['invoices', selectedDate] })
    },
  })

  const handleDelete = (id: string) => {
    if (!window.confirm('Are you sure you want to delete this record? This cannot be undone.')) return
    deleteMutation.mutate(id)
  }

  return (
    <div>
      <PageHeader
        title="Invoicing & Billing"
        subtitle={`${formatDate(selectedDate)} | ${invoices.length} invoice${invoices.length !== 1 ? 's' : ''}`}
        actions={
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={selectedDate}
              max={todayString()}
              onChange={(e) => setSelectedDate(e.target.value || todayString())}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-maroon-500"
            />
            {selectedDate !== todayString() && (
              <button
                onClick={() => setSelectedDate(todayString())}
                className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Today
              </button>
            )}
            <button
              onClick={() => { setEditingId(null); setShowForm(true) }}
              className="flex items-center gap-2 bg-maroon-500 hover:bg-maroon-600 text-white px-4 py-2 rounded-lg text-sm font-medium"
            >
              <Plus className="w-4 h-4" />
              New Invoice
            </button>
          </div>
        }
      />

      {/* Invoice list */}
      {isLoading ? (
        <div className="flex justify-center py-16">
          <LoadingSpinner label="Loading invoices..." />
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Invoice #</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Patient</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Visit</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Total</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Paid</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Balance</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Created By</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Date</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {invoices.length === 0 ? (
                <tr>
                  <td colSpan={10} className="text-center py-12 text-gray-400">
                    {selectedDate === todayString() ? 'No invoices yet today.' : `No invoices found for ${formatDate(selectedDate)}.`}
                  </td>
                </tr>
              ) : (
                invoices.map((inv) => {
                  const bal = inv.total - inv.paid_amount
                  const patientEntry = patientsMap[inv.patient_id]
                  const patientName = patientEntry?.name ?? `${inv.patient_id.slice(0, 8)}…`
                  const patientPhone = patientEntry?.phone ?? ''
                  return (
                    <tr key={inv.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-mono font-medium text-maroon-600">{inv.invoice_number}</td>
                      <td className="px-4 py-3 text-gray-800">{patientName}</td>
                      <td className="px-4 py-3 uppercase text-xs font-semibold text-gray-500">{inv.visit_type}</td>
                      <td className="px-4 py-3 font-medium">{formatCurrency(inv.total)}</td>
                      <td className="px-4 py-3 text-green-600">{formatCurrency(inv.paid_amount)}</td>
                      <td className="px-4 py-3 text-red-600">{bal > 0 ? formatCurrency(bal) : '—'}</td>
                      <td className="px-4 py-3"><StatusBadge status={inv.status} /></td>
                      <td className="px-4 py-3">
                        {inv.created_by_name ? (
                          <span className="flex items-center gap-1 text-xs text-gray-600">
                            <UserCircle className="w-3.5 h-3.5 text-gray-400" />
                            {inv.created_by_name}
                          </span>
                        ) : (
                          <span className="text-gray-400 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-500">{formatDate(inv.created_at)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => { setPrintPatient(null); setSelectedInvoice(inv); setPrintMode('invoice'); setShowPrintModal(true) }}
                            className="p-1.5 text-gray-500 hover:text-maroon-500 hover:bg-maroon-50 rounded"
                            title="Print Invoice (A4)"
                          >
                            <FileText className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => { setPrintPatient(null); setSelectedInvoice(inv); setPrintMode('receipt'); setShowPrintModal(true) }}
                            className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded"
                            title="Print Receipt (Slip)"
                          >
                            <Receipt className="w-4 h-4" />
                          </button>
                          {canEditDelete && (
                            <button
                              onClick={() => startEdit(inv)}
                              className="p-1.5 text-gray-500 hover:text-amber-600 hover:bg-amber-50 rounded"
                              title="Edit Invoice"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                          )}
                          {canEditDelete && (
                            <button
                              onClick={() => handleDelete(inv.id)}
                              className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded"
                              title="Delete Invoice"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                          <WAButton
                            href={waInvoiceReady({
                              patientName: patientName,
                              invoiceNumber: inv.invoice_number,
                              total: inv.total,
                              phone: patientPhone,
                            })}
                            label=""
                            size="sm"
                            className="px-2"
                          />
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

      {/* New / Edit Invoice Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-2xl shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between sticky top-0 bg-white">
              <div className="flex items-center gap-2">
                <Receipt className="w-5 h-5 text-maroon-500" />
                <h2 className="text-lg font-semibold">{editingId ? 'Edit Invoice' : 'Create Invoice'}</h2>
              </div>
              <button onClick={resetForm} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
            </div>

            <form onSubmit={handleSubmit((d) => mutation.mutate(d))} className="p-6 space-y-5">

              {/* Patient Live Search */}
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Patient *</label>
                {selectedPatient ? (
                  <div className="flex items-center justify-between bg-maroon-50 border border-maroon-200 rounded-lg px-3 py-2.5">
                    <div>
                      <p className="font-semibold text-gray-800 text-sm">{selectedPatient.name}</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {(selectedPatient as Patient).mrn ? `MRN: ${(selectedPatient as Patient).mrn} \u00a0|\u00a0 ` : ''}{(selectedPatient as Patient).phone ?? ''} {(selectedPatient as Patient).gender ? `\u00a0|\u00a0 ${(selectedPatient as Patient).gender}` : ''}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => { setSelectedPatient(null); setPatientSearch(''); setValue('patient_id', '') }}
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
                      value={patientSearch}
                      onChange={(e) => setPatientSearch(e.target.value)}
                      placeholder="Search by name, MRN or phone..."
                      className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-maroon-500"
                    />
                    {patientResults.length > 0 && (
                      <div className="absolute top-full left-0 right-0 bg-white border border-gray-200 rounded-lg shadow-xl z-20 mt-1 max-h-48 overflow-y-auto">
                        {patientResults.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => {
                              setSelectedPatient(p)
                              setValue('patient_id', p.id)
                              setPatientSearch('')
                            }}
                            className="w-full text-left px-4 py-2.5 hover:bg-maroon-50 border-b border-gray-100 last:border-0 transition-colors"
                          >
                            <p className="font-medium text-sm text-gray-800">{p.name}</p>
                            <p className="text-xs text-gray-500 mt-0.5">MRN: {p.mrn} | {p.phone} | {p.gender}</p>
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
                  <label className="block text-sm font-medium text-gray-700 mb-1">Visit Type *</label>
                  <select
                    {...register('visit_type')}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-maroon-500"
                  >
                    <option value="opd">OPD</option>
                    <option value="er">Emergency (ER)</option>
                    <option value="ipd">Indoor (IPD)</option>
                    <option value="us">Ultrasound</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Payment Method *</label>
                  <select
                    {...register('payment_method')}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-maroon-500"
                  >
                    <option value="cash">Cash</option>
                    <option value="card">Card</option>
                    <option value="bank_transfer">Bank Transfer</option>
                    <option value="jazzcash">JazzCash</option>
                    <option value="easypaisa">EasyPaisa</option>
                  </select>
                </div>
              </div>

              {/* Attending Doctor — shown for OPD / ER / IPD so earnings are computed correctly */}
              {(watchedVisitType === 'opd' || watchedVisitType === 'er' || watchedVisitType === 'ipd') && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1.5">
                    <Stethoscope className="w-3.5 h-3.5 text-maroon-500" />
                    Attending Doctor
                  </label>
                  <select
                    {...register('doctor_id')}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-maroon-500"
                  >
                    <option value="">— Select doctor (optional) —</option>
                    {doctors.map((d) => (
                      <option key={d.id} value={d.id}>{d.name} — {d.specialty}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Receipt No — shown for online/bank payments */}
              {(watchedMethod === 'jazzcash' || watchedMethod === 'easypaisa' || watchedMethod === 'bank_transfer') && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Receipt / Transaction No</label>
                  <input
                    {...register('receipt_no')}
                    className="w-full px-3 py-2 border border-maroon-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-maroon-500 bg-amber-50"
                    placeholder={watchedMethod === 'jazzcash' ? 'JazzCash transaction ID' : watchedMethod === 'easypaisa' ? 'EasyPaisa receipt no' : 'Bank receipt / reference no'}
                  />
                </div>
              )}

              {/* Line items */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium text-gray-700">Items *</label>
                  <button
                    type="button"
                    onClick={() => append({ description: '', quantity: 1, unit_price: 0 })}
                    className="text-xs text-maroon-600 hover:text-maroon-700 font-medium flex items-center gap-1"
                  >
                    <Plus className="w-3 h-3" /> Add Item
                  </button>
                </div>
                <div className="space-y-2">
                  <div className="grid grid-cols-12 gap-2 text-xs font-medium text-gray-500 px-1">
                    <div className="col-span-6">Description</div>
                    <div className="col-span-2">Qty</div>
                    <div className="col-span-3">Unit Price</div>
                    <div className="col-span-1" />
                  </div>
                  {fields.map((field, idx) => (
                    <div key={field.id} className="grid grid-cols-12 gap-2 items-center">
                      <div className="col-span-6">
                        <input
                          {...register(`items.${idx}.description`)}
                          className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-maroon-500"
                          placeholder="e.g. Consultation Fee"
                        />
                      </div>
                      <div className="col-span-2">
                        <input
                          {...register(`items.${idx}.quantity`)}
                          type="number" min="1"
                          className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-maroon-500"
                        />
                      </div>
                      <div className="col-span-3">
                        <input
                          {...register(`items.${idx}.unit_price`)}
                          type="number" min="0"
                          className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-maroon-500"
                        />
                      </div>
                      <div className="col-span-1 flex justify-center">
                        {fields.length > 1 && (
                          <button type="button" onClick={() => remove(idx)} className="text-red-400 hover:text-red-600">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Totals */}
              <div className="bg-gray-50 rounded-lg p-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Subtotal</span>
                  <span className="font-medium">{formatCurrency(subtotal)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-gray-600">Discount</span>
                  <select {...register('discount_type')} className="text-xs border border-gray-300 rounded px-2 py-1">
                    <option value="amount">Rs.</option>
                    <option value="percent">%</option>
                  </select>
                  <input {...register('discount')} type="number" min="0" className="w-24 px-2 py-1 border border-gray-300 rounded text-sm" />
                  <span className="ml-auto font-medium text-orange-600">- {formatCurrency(discountAmount)}</span>
                </div>
                <div className="flex justify-between border-t border-gray-200 pt-2 font-semibold text-base">
                  <span>Total</span>
                  <span className="text-maroon-600">{formatCurrency(total)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-gray-600">Amount Paid</span>
                  <input {...register('paid_amount')} type="number" min="0" className="w-32 px-2 py-1 border border-gray-300 rounded text-sm ml-auto" />
                </div>
                {balance > 0 && (
                  <div className="flex justify-between text-red-600 font-semibold">
                    <span>Balance Due</span>
                    <span>{formatCurrency(balance)}</span>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <input {...register('notes')} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-maroon-500" />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={resetForm} className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">Cancel</button>
                <button type="submit" disabled={mutation.isPending} className="px-4 py-2 bg-maroon-500 hover:bg-maroon-600 text-white rounded-lg text-sm font-medium disabled:opacity-50">
                  {mutation.isPending
                    ? (editingId ? 'Updating...' : 'Creating...')
                    : (editingId ? 'Update Invoice' : 'Create Invoice')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Print Modal */}
      {showPrintModal && selectedInvoice && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-3xl shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between sticky top-0 bg-white">
              <h2 className="font-semibold">
                {printMode === 'invoice' ? '📄 Invoice' : '🧾 Receipt'} — {selectedInvoice.invoice_number}
              </h2>
              <button onClick={() => setShowPrintModal(false)} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
            </div>

            {/* Mode toggle */}
            <div className="px-6 pt-4 flex gap-2">
              <button
                onClick={() => setPrintMode('invoice')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                  printMode === 'invoice'
                    ? 'bg-maroon-500 text-white border-maroon-500'
                    : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                }`}
              >
                <FileText className="w-4 h-4" />
                Invoice (A4)
              </button>
              <button
                onClick={() => setPrintMode('receipt')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                  printMode === 'receipt'
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                }`}
              >
                <Receipt className="w-4 h-4" />
                Receipt (Slip)
              </button>
            </div>

            <div className="p-4">
              <div ref={printRef}>
                {printMode === 'invoice' ? (
                  <InvoicePrint invoice={selectedInvoice} patientName={printPatient?.name ?? patientsMap[selectedInvoice.patient_id]?.name} patientMrn={printPatient?.mrn} />
                ) : (
                  <ReceiptPrint invoice={selectedInvoice} patientName={printPatient?.name ?? patientsMap[selectedInvoice.patient_id]?.name} patientMrn={printPatient?.mrn} />
                )}
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-200 flex gap-3 flex-wrap">
              <button
                onClick={handlePrint}
                className={`flex items-center gap-2 text-white py-2.5 px-5 rounded-lg text-sm font-medium ${
                  printMode === 'invoice' ? 'bg-maroon-500 hover:bg-maroon-600' : 'bg-blue-600 hover:bg-blue-700'
                }`}
              >
                <Printer className="w-4 h-4" />
                Print {printMode === 'invoice' ? 'Invoice (A4)' : 'Receipt (Slip)'}
              </button>
              <WAButton
                href={waInvoiceReady({
                  patientName: printPatient?.name ?? patientsMap[selectedInvoice.patient_id]?.name ?? 'Patient',
                  invoiceNumber: selectedInvoice.invoice_number,
                  total: selectedInvoice.total,
                  phone: patientPhone || printPatient?.phone || patientsMap[selectedInvoice.patient_id]?.phone || '',
                })}
                label="Send on WhatsApp"
              />
              <button onClick={() => setShowPrintModal(false)} className="px-5 py-2.5 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 ml-auto">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
