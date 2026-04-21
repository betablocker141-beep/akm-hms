import { useState, useRef, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Plus, Search, Printer, Eye, Trash2, Pencil } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { WAButton } from '@/components/shared/WAButton'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'
import { OpdTokenPrint } from '@/components/print/OpdTokenPrint'
import { supabase } from '@/lib/supabase/client'
import { db } from '@/lib/dexie/schema'
import type { Invoice } from '@/types'
import { generateUUID, formatDate, todayString, padNumber } from '@/lib/utils'
import { fetchWithFallback } from '@/lib/utils/fetchWithFallback'
import { useSyncStore } from '@/store/syncStore'
import { useAuthStore } from '@/store/authStore'
import {
  waOpdTokenPatient,
  waOpdTokenDoctor,
} from '@/lib/whatsapp/links'
import type { OpdToken, Patient, Doctor } from '@/types'

async function fetchDayOpdInvoices(date: string): Promise<Invoice[]> {
  const startISO = new Date(`${date}T00:00:00`).toISOString()
  const nextDay = new Date(`${date}T00:00:00`); nextDay.setDate(nextDay.getDate() + 1)
  const endISO = nextDay.toISOString()
  try {
    const { data, error } = await Promise.race([
      supabase.from('invoices').select('id, visit_ref_id, paid_amount, local_id')
        .eq('visit_type', 'opd').gte('created_at', startISO).lt('created_at', endISO),
      new Promise<never>((_, r) => setTimeout(() => r(new Error('timeout')), 3000)),
    ]) as { data: Invoice[] | null; error: unknown }
    if (!error && data) return data
  } catch { /* fall through */ }
  const all = await db.invoices.orderBy('created_at').toArray()
  return all.filter(i => i.visit_type === 'opd' && i.created_at >= startISO && i.created_at < endISO) as unknown as Invoice[]
}

const tokenSchema = z.object({
  token_number: z.string().min(1, 'Token number required'),
  patient_id: z.string().min(1, 'Patient required'),
  doctor_id: z.string().min(1, 'Doctor required'),
  date: z.string().min(1, 'Date required'),
  time_slot: z.string().min(1, 'Time required'),
  type: z.enum(['walk_in', 'online', 'whatsapp']),
  notes: z.string().optional(),
  bp: z.string().optional(),
  pulse: z.coerce.number().optional(),
  temp: z.coerce.number().optional(),
  spo2: z.coerce.number().optional(),
  rr: z.coerce.number().optional(),
})

type TokenForm = z.infer<typeof tokenSchema>

function getCurrentTime24h(): string {
  return new Date().toLocaleTimeString('en-PK', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

async function fetchTokensByDate(date: string): Promise<OpdToken[]> {
  const dexieTokens = await db.opd_tokens
    .where('date').equals(date)
    .reverse().toArray() as unknown as OpdToken[]

  if (!navigator.onLine) return dexieTokens

  try {
    const { data, error } = await Promise.race([
      supabase.from('opd_tokens').select('*').eq('date', date).order('created_at', { ascending: false }),
      new Promise<never>((_, r) => setTimeout(() => r(new Error('timeout')), 3000)),
    ]) as { data: OpdToken[] | null; error: unknown }
    if (error || !data) return dexieTokens

    const supabaseIds = new Set(data.map((t) => t.id))
    const supabaseCreatedAts = new Set(data.map((t) => t.created_at).filter(Boolean))
    const dexieOnly = dexieTokens.filter((t) => {
      const rec = t as unknown as { server_id: string | null; created_at: string }
      if (rec.server_id && supabaseIds.has(rec.server_id)) return false
      if (rec.created_at && supabaseCreatedAts.has(rec.created_at)) return false
      return true
    })
    // Deduplicate Supabase results by created_at — sync race can produce identical rows
    const seen = new Set<string>()
    const dedupedSupabase = data.filter((t) => {
      const key = t.created_at ?? t.id
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    return [...dexieOnly, ...dedupedSupabase]
  } catch {
    return dexieTokens
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

async function fetchPatients(search: string): Promise<Patient[]> {
  if (!search || search.length < 2) return []
  const dexieFallback = async () => {
    const q = search.toLowerCase()
    const all = await db.patients.orderBy('created_at').reverse().limit(200).toArray()
    return all.filter(
      (p) => p.name.toLowerCase().includes(q) || p.phone.includes(q) || p.mrn.includes(q)
    ) as unknown as Patient[]
  }
  return fetchWithFallback(
    async () => {
      const { data, error } = await supabase.from('patients').select('*').or(`name.ilike.%${search}%,phone.ilike.%${search}%,mrn.ilike.%${search}%`).limit(10)
      if (error) throw error
      return data as Patient[]
    },
    dexieFallback,
  )
}

export function OpdPage() {
  const [selectedDate, setSelectedDate] = useState(todayString())
  const [showForm, setShowForm] = useState(false)
  const [patientSearch, setPatientSearch] = useState('')
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null)
  const [selectedToken, setSelectedToken] = useState<OpdToken | null>(null)
  const [showPrintModal, setShowPrintModal] = useState(false)
  const [editingToken, setEditingToken] = useState<OpdToken | null>(null)
  const [opdFee, setOpdFee] = useState<number>(0)
  const [opdPaymentMethod, setOpdPaymentMethod] = useState<string>('cash')
  const [opdReceiptNo, setOpdReceiptNo] = useState<string>('')
  const [printFee, setPrintFee] = useState<number>(0)
  const [printPaymentMethod, setPrintPaymentMethod] = useState<string>('cash')
  const [printReceiptNo, setPrintReceiptNo] = useState<string>('')
  const [printPatient, setPrintPatient] = useState<Patient | null>(null)
  const printRef = useRef<HTMLDivElement>(null)
  const qc = useQueryClient()
  useSyncStore()
  const { user: authUser, hasPermission } = useAuthStore()
  const canEditDelete = hasPermission('canEditDelete') || !!authUser?.email?.toLowerCase().includes('waseem') || !!authUser?.name?.toLowerCase().includes('waseem')

  const isToday = selectedDate === todayString()

  const { data: tokens = [], isLoading } = useQuery({
    queryKey: ['opd-tokens', selectedDate],
    queryFn: () => fetchTokensByDate(selectedDate),
    refetchInterval: isToday ? 30_000 : false,
  })

  const { data: dayInvoices = [] } = useQuery({
    queryKey: ['opd-day-invoices', selectedDate],
    queryFn: () => fetchDayOpdInvoices(selectedDate),
    refetchInterval: isToday ? 30_000 : false,
  })

  const tokenFeeMap = useMemo(() => {
    const map = new Map<string, number>()
    for (const inv of dayInvoices) {
      if (inv.visit_ref_id && inv.paid_amount > 0) map.set(inv.visit_ref_id, inv.paid_amount)
    }
    return map
  }, [dayInvoices])

  const { data: doctors = [] } = useQuery({
    queryKey: ['doctors-active'],
    queryFn: fetchDoctors,
  })

  // Patient lookup map for the token list and print modal
  const { data: patientsMap = {} } = useQuery<Record<string, Patient>>({
    queryKey: ['patients-map'],
    queryFn: async () => {
      // Always seed the map from Dexie so local-only (unsynced) patients are
      // always resolvable, even when the app is online.
      const all = await db.patients.toArray()
      const map: Record<string, Patient> = {}
      for (const p of all) {
        map[p.local_id] = p as unknown as Patient
        if (p.server_id) map[p.server_id] = p as unknown as Patient
      }
      // Merge Supabase data on top (adds any patients not yet in local Dexie)
      try {
        const { data, error } = await supabase.from('patients').select('id, name, mrn, dob, gender, phone')
        if (!error && data) {
          for (const p of data as Patient[]) map[p.id] = p
        }
      } catch { /* stay with Dexie-only map */ }
      return map
    },
  })

  const { data: patientResults = [] } = useQuery({
    queryKey: ['patient-search', patientSearch],
    queryFn: () => fetchPatients(patientSearch),
    enabled: patientSearch.length >= 2,
  })

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors },
  } = useForm<TokenForm>({
    resolver: zodResolver(tokenSchema),
    defaultValues: {
      date: todayString(),
      type: 'walk_in',
      time_slot: getCurrentTime24h(),
    },
  })

  const handlePrint = () => {
    if (!printRef.current) return
    const html = printRef.current.innerHTML
    const win = window.open('', '_blank', 'width=420,height=700')
    if (!win) return
    win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>OPD-Token-${selectedToken?.token_number ?? ''}</title><style>@page{size:80mm auto;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0;width:80mm;background:#fff}</style></head><body style="margin:0;padding:0;width:80mm;background:#fff">${html}</body></html>`)
    win.document.close()
    win.focus()
    setTimeout(() => { win.print(); win.close() }, 400)
  }

  const openForm = () => {
    setEditingToken(null)
    reset({
      date: todayString(),
      type: 'walk_in',
      time_slot: getCurrentTime24h(),
    })
    setShowForm(true)
  }

  const openPrint = (token: OpdToken) => {
    setSelectedToken(token)
    setPrintPatient(patientsMap[token.patient_id] ?? null)
    setShowPrintModal(true)
  }

  const openEdit = (token: OpdToken) => {
    setEditingToken(token)
    const patient = patientsMap[token.patient_id] ?? null
    setSelectedPatient(patient)
    reset({
      token_number: token.token_number,
      patient_id: token.patient_id,
      doctor_id: token.doctor_id ?? '',
      date: token.date,
      time_slot: token.time_slot ?? '',
      type: (token.type as 'walk_in' | 'online' | 'whatsapp') ?? 'walk_in',
      notes: token.notes ?? '',
      bp: token.bp ?? '',
      pulse: token.pulse ?? undefined,
      temp: token.temp ?? undefined,
      spo2: token.spo2 ?? undefined,
      rr: token.rr ?? undefined,
    })
    setShowForm(true)
  }

  const updateToken = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: TokenForm }) => {
      const updates = {
        token_number: data.token_number.trim(),
        patient_id: data.patient_id,
        doctor_id: data.doctor_id,
        date: data.date,
        time_slot: data.time_slot,
        type: data.type,
        notes: data.notes || null,
        bp: data.bp || null,
        pulse: data.pulse ?? null,
        temp: data.temp ?? null,
        spo2: data.spo2 ?? null,
        rr: data.rr ?? null,
        sync_status: 'pending' as const,
      }
      await db.opd_tokens
        .filter((t) => t.local_id === id || t.server_id === id)
        .modify(updates)
      if (useSyncStore.getState().isOnline && navigator.onLine) {
        await supabase.from('opd_tokens').update({
          token_number: updates.token_number,
          patient_id: updates.patient_id,
          doctor_id: updates.doctor_id,
          date: updates.date,
          time_slot: updates.time_slot,
          type: updates.type,
          notes: updates.notes,
          bp: updates.bp,
          pulse: updates.pulse,
          temp: updates.temp,
          spo2: updates.spo2,
          rr: updates.rr,
        }).eq('id', id)
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['opd-tokens', selectedDate] })
      setShowForm(false)
      setEditingToken(null)
      reset()
      setSelectedPatient(null)
      setPatientSearch('')
    },
  })

  const mutation = useMutation({
    mutationFn: async (data: TokenForm) => {
      const online = useSyncStore.getState().isOnline && navigator.onLine
      const tokenNumber = data.token_number.trim()
      const localId = generateUUID()
      const record = {
        id: localId,
        local_id: localId,
        server_id: null as string | null,
        token_number: tokenNumber,
        patient_id: data.patient_id,
        doctor_id: data.doctor_id,
        date: data.date,
        time_slot: data.time_slot,
        status: 'confirmed' as const,
        type: data.type,
        booking_source: null,
        notes: data.notes || null,
        bp: data.bp || null,
        pulse: data.pulse || null,
        temp: data.temp || null,
        spo2: data.spo2 || null,
        rr: data.rr || null,
        created_at: new Date().toISOString(),
        // Mark synced immediately when online so the sync engine doesn't also
        // push this record (prevents duplicate inserts into Supabase).
        // Reverted to 'pending' below if the insert fails.
        sync_status: (online ? 'synced' : 'pending') as 'synced' | 'pending',
      }

      await db.opd_tokens.add(record)

      // Fire-and-forget — UI resolves immediately after Dexie save
      if (online) {
        void (async () => {
          try {
            const timeout = new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('timeout')), 6000)
            )
            const insert = supabase.from('opd_tokens').insert({
              token_number: record.token_number,
              patient_id: record.patient_id,
              doctor_id: record.doctor_id,
              date: record.date,
              time_slot: record.time_slot,
              status: record.status,
              type: record.type,
              booking_source: record.booking_source,
              notes: record.notes,
              created_at: record.created_at,
            }).select().single()
            const { data: saved, error } = await Promise.race([insert, timeout]) as { data: { id: string } | null; error: unknown }
            if (!error && saved) {
              await db.opd_tokens.where('local_id').equals(localId).modify({ server_id: saved.id, sync_status: 'synced' })
            } else {
              // Insert failed — let sync engine retry
              await db.opd_tokens.where('local_id').equals(localId).modify({ sync_status: 'pending' })
            }
          } catch {
            await db.opd_tokens.where('local_id').equals(localId).modify({ sync_status: 'pending' })
          }
        })()
      }

      return record
    },
    onSuccess: (record) => {
      // Insert directly into cache — avoids race condition where Supabase
      // refetch runs before the fire-and-forget insert has completed.
      qc.invalidateQueries({ queryKey: ['opd-tokens', todayString()] })
      // Save patient & fee BEFORE clearing them — needed for print
      setPrintPatient(selectedPatient)
      setPrintFee(opdFee)
      setPrintPaymentMethod(opdPaymentMethod)
      setPrintReceiptNo(opdReceiptNo)
      setSelectedToken(record as unknown as OpdToken)
      setShowPrintModal(true)
      reset()

      // Auto-create invoice if a fee was collected
      if (opdFee > 0) {
        void (async () => {
          try {
            const online = useSyncStore.getState().isOnline && navigator.onLine
            const invoiceNumber = await getNextInvoiceNumber()
            const localId = generateUUID()
            const inv = {
              id: localId, local_id: localId, server_id: null as string | null,
              patient_id: record.patient_id,
              doctor_id: record.doctor_id,
              visit_type: 'opd' as const,
              visit_ref_id: record.id,
              items: [{ id: generateUUID(), invoice_id: localId, description: 'OPD Consultation Fee', quantity: 1, unit_price: opdFee, total: opdFee }],
              subtotal: opdFee, discount: 0, discount_type: 'amount' as const, tax: 0,
              total: opdFee, paid_amount: opdFee,
              payment_method: opdPaymentMethod as 'cash' | 'card' | 'bank_transfer' | 'jazzcash' | 'easypaisa', receipt_no: opdReceiptNo || null,
              status: 'paid' as const, invoice_number: invoiceNumber, notes: null,
              created_at: new Date().toISOString(),
              sync_status: 'pending' as const,
            }
            await db.invoices.add(inv)
            qc.invalidateQueries({ queryKey: ['daily-collection'] })
            qc.invalidateQueries({ queryKey: ['accounts-totals'] })
            qc.invalidateQueries({ queryKey: ['dash-revenue'] })
            if (online) {
              try {
                let serverPatientId = record.patient_id
                const localPat = await db.patients.filter((p) => p.local_id === record.patient_id || p.server_id === record.patient_id).first()
                if (localPat?.server_id) serverPatientId = localPat.server_id
                const { data: saved, error } = await supabase.from('invoices').insert({
                  patient_id: serverPatientId, doctor_id: inv.doctor_id,
                  visit_type: inv.visit_type, visit_ref_id: inv.visit_ref_id,
                  items: inv.items, subtotal: inv.subtotal, discount: inv.discount,
                  discount_type: inv.discount_type, tax: inv.tax, total: inv.total,
                  paid_amount: inv.paid_amount, payment_method: inv.payment_method,
                  status: inv.status, invoice_number: inv.invoice_number,
                  notes: inv.notes, created_at: inv.created_at,
                }).select().single()
                if (!error && saved) {
                  await db.invoices.where('local_id').equals(localId).modify({ server_id: (saved as { id: string }).id, sync_status: 'synced' })
                }
              } catch { /* stay pending */ }
            }
          } catch { /* don't break UI if invoice fails */ }
        })()
      }

      setOpdFee(0)
      setOpdPaymentMethod('cash')
      setOpdReceiptNo('')
      setShowForm(false)
      setSelectedPatient(null)
      setPatientSearch('')
    },
  })

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      await db.opd_tokens
        .filter((t) => t.local_id === id || t.server_id === id)
        .modify({ status, sync_status: 'pending' })
      if (useSyncStore.getState().isOnline && navigator.onLine) {
        await supabase.from('opd_tokens').update({ status }).eq('id', id)
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['opd-tokens', selectedDate] }),
  })

  const deleteToken = useMutation({
    mutationFn: async (id: string) => {
      await db.opd_tokens.filter((t) => t.local_id === id || t.server_id === id).delete()
      if (useSyncStore.getState().isOnline && navigator.onLine) {
        await supabase.from('opd_tokens').delete().eq('id', id)
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['opd-tokens', selectedDate] }),
  })

  const handleDeleteToken = (id: string) => {
    if (!window.confirm('Are you sure you want to delete this record? This cannot be undone.')) return
    deleteToken.mutate(id)
  }

  // Get doctor/patient for selected token for WA links
  const tokenDoctor = selectedToken
    ? doctors.find((d) => d.id === selectedToken.doctor_id)
    : null

  return (
    <div>
      <PageHeader
        title="OPD Token Management"
        subtitle={`${formatDate(selectedDate)} | ${tokens.length} token${tokens.length !== 1 ? 's' : ''} issued`}
        actions={
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={selectedDate}
              max={todayString()}
              onChange={(e) => setSelectedDate(e.target.value || todayString())}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-maroon-500"
            />
            {!isToday && (
              <button
                onClick={() => setSelectedDate(todayString())}
                className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Today
              </button>
            )}
            <a
              href="/opd/queue"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 border border-gray-300 hover:bg-gray-50 px-3 py-2 rounded-lg text-sm"
            >
              <Eye className="w-4 h-4" />
              Queue Display
            </a>
            {isToday && (
              <button
                onClick={openForm}
                className="flex items-center gap-2 bg-maroon-500 hover:bg-maroon-600 text-white px-4 py-2 rounded-lg text-sm font-medium"
              >
                <Plus className="w-4 h-4" />
                New Token
              </button>
            )}
          </div>
        }
      />

      {/* Token list */}
      {isLoading ? (
        <div className="flex justify-center py-16">
          <LoadingSpinner label="Loading today's tokens..." />
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Token #</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Patient</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Doctor</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Time</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Fee</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {tokens.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-gray-400">
                    {isToday ? 'No tokens issued today. Click "New Token" to start.' : `No tokens found for ${formatDate(selectedDate)}.`}
                  </td>
                </tr>
              ) : (
                tokens.map((token) => {
                  const doc = doctors.find((d) => d.id === token.doctor_id)
                  return (
                    <tr key={token.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <span className="font-bold text-maroon-600 text-base">
                          {token.token_number}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-medium text-gray-800">
                        {patientsMap[token.patient_id]?.name ?? `${token.patient_id.slice(0, 8)}…`}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{doc?.name ?? '—'}</td>
                      <td className="px-4 py-3 text-gray-600">{token.time_slot}</td>
                      <td className="px-4 py-3">
                        {(() => {
                          const fee = tokenFeeMap.get(token.id) ?? tokenFeeMap.get(token.local_id ?? '') ?? tokenFeeMap.get(token.server_id ?? '')
                          return fee ? (
                            <span className="text-green-700 font-medium text-sm">Rs. {fee.toLocaleString()}</span>
                          ) : <span className="text-gray-300 text-sm">—</span>
                        })()}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={token.status} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => openPrint(token)}
                            className="p-1.5 text-gray-500 hover:text-maroon-500 hover:bg-maroon-50 rounded"
                            title="Print token"
                          >
                            <Printer className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => openEdit(token)}
                            className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded"
                            title="Edit token"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          {token.status === 'confirmed' && (
                            <button
                              onClick={() =>
                                updateStatus.mutate({ id: token.id, status: 'seen' })
                              }
                              className="text-xs bg-blue-100 text-blue-700 hover:bg-blue-200 px-2 py-1 rounded"
                            >
                              Mark Seen
                            </button>
                          )}
                          {token.status !== 'cancelled' && token.status !== 'seen' && (
                            <button
                              onClick={() =>
                                updateStatus.mutate({ id: token.id, status: 'cancelled' })
                              }
                              className="text-xs bg-red-50 text-red-600 hover:bg-red-100 px-2 py-1 rounded"
                            >
                              Cancel
                            </button>
                          )}
                          {canEditDelete && (
                            <button
                              onClick={() => handleDeleteToken(token.id)}
                              className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded"
                              title="Delete token"
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

      {/* New / Edit Token Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between sticky top-0 bg-white">
              <h2 className="text-lg font-semibold">
                {editingToken ? `Edit Token #${editingToken.token_number}` : 'Issue OPD Token'}
              </h2>
              <button
                onClick={() => { setShowForm(false); setEditingToken(null); reset(); setSelectedPatient(null); setPatientSearch('') }}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none"
              >
                ×
              </button>
            </div>

            <form onSubmit={handleSubmit((d) => editingToken ? updateToken.mutate({ id: editingToken.id, data: d }) : mutation.mutate(d))} className="p-6 space-y-4">
              {/* Token Number */}
              <div className="bg-maroon-50 border border-maroon-200 rounded-lg p-3">
                <label className="block text-sm font-semibold text-maroon-800 mb-1">
                  Token Number *
                </label>
                <input
                  {...register('token_number')}
                  type="text"
                  autoFocus
                  placeholder="e.g. 5  or  12  or  A-3"
                  className="w-full px-3 py-2 border border-maroon-300 rounded-lg text-lg font-bold text-center tracking-widest text-maroon-700 focus:outline-none focus:ring-2 focus:ring-maroon-500 bg-white"
                />
                {errors.token_number && (
                  <p className="text-xs text-red-600 mt-1">{errors.token_number.message}</p>
                )}
                <p className="text-xs text-maroon-600 mt-1">Reception assigns the token based on current queue</p>
              </div>

              {/* Patient search */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Patient *
                </label>
                {selectedPatient ? (
                  <div className="flex items-center justify-between bg-maroon-50 border border-maroon-200 rounded-lg px-3 py-2">
                    <div>
                      <p className="font-medium text-gray-800">{selectedPatient.name}</p>
                      <p className="text-xs text-gray-500">
                        MRN: {selectedPatient.mrn} | {selectedPatient.phone}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => { setSelectedPatient(null); setPatientSearch(''); setValue('patient_id', '') }}
                      className="text-gray-400 hover:text-red-500 text-sm"
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
                      placeholder="Search patient by name, MRN, phone..."
                      className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-maroon-500"
                    />
                    {patientResults.length > 0 && (
                      <div className="absolute top-full left-0 right-0 bg-white border border-gray-200 rounded-lg shadow-lg z-10 mt-1">
                        {patientResults.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => {
                              setSelectedPatient(p)
                              setValue('patient_id', p.id)
                            }}
                            className="w-full text-left px-4 py-2.5 hover:bg-gray-50 border-b border-gray-100 last:border-0"
                          >
                            <p className="font-medium text-sm">{p.name}</p>
                            <p className="text-xs text-gray-500">
                              {p.mrn} | {p.phone}
                            </p>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {/* Hidden input for form validation */}
                <input
                  type="hidden"
                  {...register('patient_id')}
                  value={selectedPatient?.id ?? ''}
                />
                {errors.patient_id && (
                  <p className="text-xs text-red-600 mt-1">{errors.patient_id.message}</p>
                )}
              </div>

              {/* Doctor */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Doctor *</label>
                <select
                  {...register('doctor_id')}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-maroon-500"
                >
                  <option value="">Select Doctor</option>
                  {doctors.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} — {d.specialty}
                    </option>
                  ))}
                </select>
                {errors.doctor_id && (
                  <p className="text-xs text-red-600 mt-1">{errors.doctor_id.message}</p>
                )}
              </div>

              {/* Date & Issued At */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Date *</label>
                  <input
                    {...register('date')}
                    type="date"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-maroon-500"
                  />
                  {errors.date && (
                    <p className="text-xs text-red-600 mt-1">{errors.date.message}</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Issued At *</label>
                  <input
                    {...register('time_slot')}
                    type="time"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-maroon-500"
                  />
                  {errors.time_slot && (
                    <p className="text-xs text-red-600 mt-1">{errors.time_slot.message}</p>
                  )}
                </div>
              </div>

              {/* Type */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Visit Type</label>
                <select
                  {...register('type')}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-maroon-500"
                >
                  <option value="walk_in">Walk-in</option>
                  <option value="online">Online Booking</option>
                  <option value="whatsapp">WhatsApp Booking</option>
                </select>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea
                  {...register('notes')}
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-maroon-500"
                  placeholder="Any additional notes..."
                />
              </div>

              {/* Vitals */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-3">
                <h4 className="text-sm font-semibold text-blue-800">Vitals (optional)</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">BP</label>
                    <input
                      {...register('bp')}
                      type="text"
                      placeholder="120/80"
                      className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Pulse (bpm)</label>
                    <input
                      {...register('pulse')}
                      type="number"
                      placeholder="72"
                      className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Temp °F</label>
                    <input
                      {...register('temp')}
                      type="number"
                      step="0.1"
                      placeholder="98.6"
                      className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">SpO2 %</label>
                    <input
                      {...register('spo2')}
                      type="number"
                      placeholder="98"
                      className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">RR (breaths/min)</label>
                    <input
                      {...register('rr')}
                      type="number"
                      placeholder="16"
                      className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                    />
                  </div>
                </div>
              </div>

              {/* Fee / Payment */}
              <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                <label className="block text-sm font-semibold text-green-800 mb-1">
                  Consultation Fee (Rs.)
                </label>
                <input
                  type="number"
                  min={0}
                  value={opdFee}
                  onChange={(e) => setOpdFee(Number(e.target.value))}
                  className="w-full px-3 py-2 border border-green-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
                  placeholder="e.g. 500"
                />
                {opdFee > 0 && (
                  <div className="mt-2 space-y-2">
                    <select
                      value={opdPaymentMethod}
                      onChange={(e) => setOpdPaymentMethod(e.target.value)}
                      className="w-full px-3 py-2 border border-green-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
                    >
                      <option value="cash">Cash</option>
                      <option value="jazzcash">JazzCash</option>
                      <option value="easypaisa">Easypaisa</option>
                      <option value="bank_transfer">Bank Transfer</option>
                      <option value="card">Card</option>
                    </select>
                    {['jazzcash', 'easypaisa', 'bank_transfer'].includes(opdPaymentMethod) && (
                      <input
                        type="text"
                        value={opdReceiptNo}
                        onChange={(e) => setOpdReceiptNo(e.target.value)}
                        placeholder="Transaction ID"
                        className="w-full px-3 py-2 border border-green-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
                      />
                    )}
                  </div>
                )}
                <p className="text-xs text-green-600 mt-1">This will appear as "Payment Received" on the token</p>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => { setShowForm(false); reset(); setSelectedPatient(null); setPatientSearch('') }}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={mutation.isPending || updateToken.isPending}
                  className="px-4 py-2 bg-maroon-500 hover:bg-maroon-600 text-white rounded-lg text-sm font-medium disabled:opacity-50"
                >
                  {editingToken
                    ? (updateToken.isPending ? 'Saving...' : 'Save Changes')
                    : (mutation.isPending ? 'Issuing...' : 'Issue Token & Print')
                  }
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Print Preview Modal */}
      {showPrintModal && selectedToken && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-sm shadow-2xl flex flex-col max-h-[92vh]">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
              <h2 className="font-semibold">Print Token</h2>
              <button
                onClick={() => setShowPrintModal(false)}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none"
              >
                ×
              </button>
            </div>

            {/* Scrollable body */}
            <div className="overflow-y-auto flex-1">
              {/* Print area */}
              <div className="p-4">
                <div ref={printRef}>
                  <OpdTokenPrint
                    token={selectedToken}
                    patient={printPatient ?? undefined}
                    doctor={tokenDoctor ?? undefined}
                    fee={printFee}
                    paymentMethod={printPaymentMethod}
                    receiptNo={printReceiptNo}
                  />
                </div>
              </div>
            </div>

            {/* Actions — always visible at bottom */}
            <div className="px-6 py-4 border-t border-gray-200 space-y-3 flex-shrink-0">
              <button
                onClick={handlePrint}
                className="w-full flex items-center justify-center gap-2 bg-maroon-500 hover:bg-maroon-600 text-white py-2.5 rounded-lg text-sm font-medium"
              >
                <Printer className="w-4 h-4" />
                Print Token
              </button>

              {printPatient && (
                <WAButton
                  href={waOpdTokenPatient({
                    name: printPatient.name,
                    tokenNumber: selectedToken.token_number,
                    doctor: tokenDoctor?.name ?? 'Doctor',
                    date: formatDate(selectedToken.date),
                    time: selectedToken.time_slot,
                    phone: printPatient.phone,
                  })}
                  label="WhatsApp Patient"
                  className="w-full justify-center"
                />
              )}

              {tokenDoctor?.whatsapp_number && (
                <WAButton
                  href={waOpdTokenDoctor({
                    patientName: printPatient?.name ?? 'Patient',
                    tokenNumber: selectedToken.token_number,
                    date: formatDate(selectedToken.date),
                    time: selectedToken.time_slot,
                    doctorWhatsapp: tokenDoctor.whatsapp_number,
                  })}
                  label="WhatsApp Doctor"
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
