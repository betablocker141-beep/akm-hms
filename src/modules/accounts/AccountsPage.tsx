import { useState, useRef, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { Download, Printer, CheckCircle, CalendarDays, TrendingUp, Stethoscope } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'
import { AKMLogo } from '@/components/shared/AKMLogo'
import { supabase } from '@/lib/supabase/client'
import { db } from '@/lib/dexie/schema'
import { formatCurrency, formatDate, todayString } from '@/lib/utils'
import { fetchWithFallback } from '@/lib/utils/fetchWithFallback'
import { fetchActiveDoctors, fetchAllDoctors } from '@/lib/utils/doctorUtils'
import type { Doctor, Invoice, OpdToken, ErVisit, IpdAdmission } from '@/types'

// ── Types ────────────────────────────────────────────────────────────────────

interface MonthlyRevenue { month: string; opd: number; er: number; ipd: number; us: number }

interface ComputedEarning {
  doctor: Doctor
  total_opd: number
  total_er: number
  total_ipd: number
  total_us: number
  gross: number
  share_amount: number
  paid: boolean
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const PAYMENT_LABELS: Record<string, string> = {
  cash: 'Cash', card: 'Card', bank_transfer: 'Bank Transfer',
  jazzcash: 'JazzCash', easypaisa: 'EasyPaisa',
}
const TYPE_COLORS: Record<string, string> = {
  opd: 'bg-blue-100 text-blue-700',
  er:  'bg-orange-100 text-orange-700',
  ipd: 'bg-purple-100 text-purple-700',
  us:  'bg-yellow-100 text-yellow-700',
}

// ── Data fetchers ─────────────────────────────────────────────────────────────

async function fetchRevenueSummary(year: number): Promise<MonthlyRevenue[]> {
  const monthly: Record<number, MonthlyRevenue> = {}
  for (let m = 1; m <= 12; m++) monthly[m] = { month: MONTHS[m - 1], opd: 0, er: 0, ipd: 0, us: 0 }

  const data = await fetchWithFallback(
    async () => {
      const { data, error } = await supabase
        .from('invoices')
        .select('visit_type, paid_amount, created_at')
        .gte('created_at', `${year}-01-01`)
        .lt('created_at', `${year + 1}-01-01`)
      if (error) throw error
      return (data ?? []) as { visit_type: string; paid_amount: number; created_at: string }[]
    },
    async () => {
      const all = await db.invoices.orderBy('created_at').toArray()
      return all.filter(i => i.created_at.startsWith(String(year))) as unknown as { visit_type: string; paid_amount: number; created_at: string }[]
    },
  )

  data.forEach(inv => {
    const m = new Date(inv.created_at).getMonth() + 1
    if (monthly[m]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(monthly[m] as any)[inv.visit_type] = ((monthly[m] as any)[inv.visit_type] ?? 0) + (inv.paid_amount ?? 0)
    }
  })
  return Object.values(monthly)
}

async function fetchTotals() {
  const today = new Date()
  // Local-time month start so PKT records (UTC+5) are included correctly
  const monthStartISO = new Date(today.getFullYear(), today.getMonth(), 1).toISOString()

  // Offline fallback: read totals entirely from Dexie
  if (!navigator.onLine) {
    const allInv = await db.invoices.where('created_at').aboveOrEqual(monthStartISO).toArray()
    const monthRev = allInv.reduce((s, i) => s + Number((i as unknown as { paid_amount?: number }).paid_amount ?? 0), 0)
    const outstanding = allInv
      .filter(i => i.status !== 'paid')
      .reduce((s, i) => {
        const inv = i as unknown as { total: number; paid_amount: number }
        return s + Math.max(0, inv.total - inv.paid_amount)
      }, 0)
    const opdCount = await db.opd_tokens.where('created_at').aboveOrEqual(monthStartISO).count()
    const erCount  = await db.er_visits.where('created_at').aboveOrEqual(monthStartISO).count()
    const ipdCount = await db.ipd_admissions.where('created_at').aboveOrEqual(monthStartISO).count()
    return { monthRev, outstanding, opdCount, erCount, ipdCount }
  }

  try {
    const { data: inv } = await supabase.from('invoices').select('total, paid_amount, status').gte('created_at', monthStartISO)
    const monthRev = (inv ?? []).reduce((s, i) => s + (i.paid_amount ?? 0), 0)
    const outstanding = (inv ?? []).filter(i => i.status !== 'paid').reduce((s, i) => s + Math.max(0, i.total - i.paid_amount), 0)
    const { count: opdCount } = await supabase.from('opd_tokens').select('*', { count: 'exact', head: true }).gte('created_at', monthStartISO)
    const { count: erCount }  = await supabase.from('er_visits').select('*', { count: 'exact', head: true }).gte('created_at', monthStartISO)
    const { count: ipdCount } = await supabase.from('ipd_admissions').select('*', { count: 'exact', head: true }).gte('created_at', monthStartISO)
    return { monthRev, outstanding, opdCount: opdCount ?? 0, erCount: erCount ?? 0, ipdCount: ipdCount ?? 0 }
  } catch {
    // Network failed mid-request — fall back to Dexie
    const allInv = await db.invoices.where('created_at').aboveOrEqual(monthStartISO).toArray()
    const monthRev = allInv.reduce((s, i) => s + Number((i as unknown as { paid_amount?: number }).paid_amount ?? 0), 0)
    const outstanding = allInv
      .filter(i => i.status !== 'paid')
      .reduce((s, i) => {
        const inv = i as unknown as { total: number; paid_amount: number }
        return s + Math.max(0, inv.total - inv.paid_amount)
      }, 0)
    const opdCount = await db.opd_tokens.where('created_at').aboveOrEqual(monthStartISO).count()
    const erCount  = await db.er_visits.where('created_at').aboveOrEqual(monthStartISO).count()
    const ipdCount = await db.ipd_admissions.where('created_at').aboveOrEqual(monthStartISO).count()
    return { monthRev, outstanding, opdCount, erCount, ipdCount }
  }
}

async function fetchDailyInvoices(date: string): Promise<Invoice[]> {
  // Use local-time midnight so PKT invoices (UTC+5) are not shifted to wrong day
  const startISO = new Date(`${date}T00:00:00`).toISOString()
  const nextDay  = new Date(`${date}T00:00:00`); nextDay.setDate(nextDay.getDate() + 1)
  const endISO   = nextDay.toISOString()

  const localForDate = async () => {
    const all = await db.invoices.orderBy('created_at').toArray()
    return all.filter(i => i.created_at >= startISO && i.created_at < endISO) as unknown as Invoice[]
  }

  if (!navigator.onLine) return localForDate()

  try {
    const { data, error } = await supabase
      .from('invoices').select('*')
      .gte('created_at', startISO).lt('created_at', endISO)
      .order('created_at')
    if (error) throw error
    const online = (data ?? []) as Invoice[]

    // Merge ALL local invoices for the day — not just 'pending' — so that records
    // the sync engine marks 'conflict' don't vanish from the daily revenue view.
    const allLocal = await db.invoices.orderBy('created_at').toArray()
    const localForDay = allLocal.filter(i => i.created_at >= startISO && i.created_at < endISO)
    const onlineCreatedAts = new Set(online.map(i => i.created_at).filter(Boolean))
    const onlineServerIds  = new Set(online.map(i => i.id))
    const localOnly = localForDay.filter(l =>
      !onlineCreatedAts.has(l.created_at) &&
      !(l.server_id && onlineServerIds.has(l.server_id))
    )
    return [...online, ...(localOnly as unknown as Invoice[])]
  } catch {
    return localForDate()
  }
}

async function fetchDailyOpdTokens(date: string): Promise<OpdToken[]> {
  return fetchWithFallback(
    async () => {
      const { data, error } = await supabase
        .from('opd_tokens').select('id, token_number, patient_id, doctor_id, time_slot, status, created_at')
        .eq('date', date).order('created_at')
      if (error) throw error
      return (data ?? []) as OpdToken[]
    },
    () => db.opd_tokens.where('date').equals(date).toArray() as unknown as Promise<OpdToken[]>,
  )
}

async function fetchDailyErVisits(date: string): Promise<ErVisit[]> {
  return fetchWithFallback(
    async () => {
      const { data, error } = await supabase
        .from('er_visits').select('id, token_number, patient_id, doctor_id, triage_level, chief_complaint, status, created_at')
        .eq('visit_date', date).order('created_at')
      if (error) throw error
      return (data ?? []) as ErVisit[]
    },
    () => db.er_visits.where('visit_date').equals(date).toArray() as unknown as Promise<ErVisit[]>,
  )
}

async function fetchPatientNames(patientIds: string[]): Promise<Record<string, string>> {
  if (patientIds.length === 0) return {}
  const map: Record<string, string> = {}
  try {
    const { data } = await supabase.from('patients').select('id, name').in('id', patientIds)
    ;(data ?? []).forEach((p: { id: string; name: string }) => { map[p.id] = p.name })
  } catch {
    const all = await db.patients.toArray()
    all.forEach(p => {
      map[p.local_id] = p.name
      if (p.server_id) map[p.server_id] = p.name
    })
  }
  return map
}

async function fetchMonthInvoices(month: number, year: number): Promise<Invoice[]> {
  // Local-time boundaries so PKT invoices are not shifted to wrong month
  const startISO = new Date(year, month - 1, 1).toISOString()
  const endISO   = month === 12
    ? new Date(year + 1, 0, 1).toISOString()
    : new Date(year, month, 1).toISOString()
  return fetchWithFallback(
    async () => {
      const { data, error } = await supabase
        .from('invoices').select('patient_id, doctor_id, visit_type, paid_amount, total, created_at')
        .gte('created_at', startISO).lt('created_at', endISO)
      if (error) throw error
      return (data ?? []) as Invoice[]
    },
    async () => {
      const all = await db.invoices.orderBy('created_at').toArray()
      return all.filter(i => i.created_at >= startISO && i.created_at < endISO) as unknown as Invoice[]
    },
  )
}

async function fetchMonthOpdTokens(month: number, year: number): Promise<OpdToken[]> {
  const start = `${year}-${String(month).padStart(2, '0')}-01`
  const end   = `${year}-${String(month).padStart(2, '0')}-31`
  return fetchWithFallback(
    async () => {
      const { data, error } = await supabase
        .from('opd_tokens').select('patient_id, doctor_id, date')
        .gte('date', start).lte('date', end)
      if (error) throw error
      return (data ?? []) as OpdToken[]
    },
    async () => {
      const all = await db.opd_tokens.where('date').between(start, end, true, true).toArray()
      return all as unknown as OpdToken[]
    },
  )
}

async function fetchMonthErVisits(month: number, year: number): Promise<ErVisit[]> {
  const start = `${year}-${String(month).padStart(2, '0')}-01`
  const end   = `${year}-${String(month).padStart(2, '0')}-31`
  return fetchWithFallback(
    async () => {
      const { data, error } = await supabase
        .from('er_visits').select('patient_id, doctor_id, visit_date')
        .gte('visit_date', start).lte('visit_date', end)
      if (error) throw error
      return (data ?? []) as ErVisit[]
    },
    async () => {
      const all = await db.er_visits.toArray()
      return all.filter(v => v.visit_date >= start && v.visit_date <= end) as unknown as ErVisit[]
    },
  )
}

async function fetchIpdAdmissions(): Promise<IpdAdmission[]> {
  return fetchWithFallback(
    async () => {
      const { data, error } = await supabase
        .from('ipd_admissions').select('patient_id, admitting_doctor_id')
      if (error) throw error
      return (data ?? []) as IpdAdmission[]
    },
    () => db.ipd_admissions.toArray() as unknown as Promise<IpdAdmission[]>,
  )
}

async function fetchPaidSet(month: number, year: number): Promise<Set<string>> {
  try {
    const { data } = await supabase
      .from('doctor_earnings').select('doctor_id')
      .eq('month', month).eq('year', year).eq('paid', true)
    return new Set((data ?? []).map((r: { doctor_id: string }) => r.doctor_id))
  } catch { return new Set() }
}

async function fetchOpdTokensByRange(fromDate: string, toDate: string): Promise<OpdToken[]> {
  return fetchWithFallback(
    async () => {
      const { data, error } = await supabase
        .from('opd_tokens').select('id, token_number, patient_id, doctor_id, date, time_slot, status, created_at')
        .gte('date', fromDate).lte('date', toDate).order('date').order('created_at')
      if (error) throw error
      return (data ?? []) as OpdToken[]
    },
    async () => {
      const all = await db.opd_tokens.where('date').between(fromDate, toDate, true, true).toArray()
      return all as unknown as OpdToken[]
    },
  )
}

// ── Earnings computation ──────────────────────────────────────────────────────

function computeEarnings(
  invoices: Invoice[],
  opdTokens: OpdToken[],
  erVisits: ErVisit[],
  ipdAdmissions: IpdAdmission[],
  allDoctors: Doctor[],          // ALL doctors (active + inactive) so no invoice is dropped
  paidSet: Set<string>,
): ComputedEarning[] {
  // Doctor lookup by id — covers active AND inactive so cross-table IDs always resolve
  const doctorById = new Map<string, Doctor>()
  allDoctors.forEach(d => doctorById.set(d.id, d))

  // Cross-table maps (fallback for invoices without doctor_id)
  const opdMap = new Map<string, string>()
  opdTokens.forEach(t => {
    if (t.doctor_id) {
      opdMap.set(`${t.patient_id}:${t.date}`, t.doctor_id)
    }
  })

  const erMap = new Map<string, string>()
  erVisits.forEach(v => {
    if (v.doctor_id) {
      erMap.set(`${v.patient_id}:${v.visit_date}`, v.doctor_id)
    }
  })

  const ipdMap = new Map<string, string>()
  ipdAdmissions.forEach(a => {
    if (a.admitting_doctor_id) ipdMap.set(a.patient_id, a.admitting_doctor_id)
  })

  // Dynamic totals — initialised lazily so ANY docId found in data is counted
  const totals = new Map<string, { opd: number; er: number; ipd: number; us: number }>()
  const ensureEntry = (id: string) => {
    if (!totals.has(id)) totals.set(id, { opd: 0, er: 0, ipd: 0, us: 0 })
  }

  invoices.forEach(inv => {
    const amount = inv.paid_amount > 0 ? inv.paid_amount : (inv.total ?? 0)

    // Primary: doctor_id stored on the invoice itself
    let docId: string | undefined = (inv as Invoice & { doctor_id?: string | null }).doctor_id ?? undefined

    // Fallback: cross-table lookup (handles older records without doctor_id on invoice)
    if (!docId) {
      const dateUtc  = inv.created_at.substring(0, 10)
      const datePrev = new Date(new Date(dateUtc).getTime() + 86400000).toISOString().substring(0, 10)

      if (inv.visit_type === 'opd') {
        docId = opdMap.get(`${inv.patient_id}:${dateUtc}`)
             ?? opdMap.get(`${inv.patient_id}:${datePrev}`)
      } else if (inv.visit_type === 'er') {
        docId = erMap.get(`${inv.patient_id}:${dateUtc}`)
             ?? erMap.get(`${inv.patient_id}:${datePrev}`)
      } else if (inv.visit_type === 'ipd') {
        docId = ipdMap.get(inv.patient_id)
      }
    }

    // Skip if still no docId OR doctor is completely unknown (not in any doctor list)
    if (!docId || !doctorById.has(docId)) return

    ensureEntry(docId)
    const b = totals.get(docId)!
    if      (inv.visit_type === 'opd') b.opd += amount
    else if (inv.visit_type === 'er')  b.er  += amount
    else if (inv.visit_type === 'ipd') b.ipd += amount
    else if (inv.visit_type === 'us')  b.us  += amount
  })

  return [...totals.entries()]
    .map(([docId, t]) => {
      const doctor = doctorById.get(docId)!
      const gross = t.opd + t.er + t.ipd + t.us
      const shareBase = t.opd + t.er + t.us
      return { doctor, total_opd: t.opd, total_er: t.er, total_ipd: t.ipd, total_us: t.us, gross, share_amount: Math.round(shareBase * doctor.share_percent / 100), paid: paidSet.has(docId) }
    })
    .filter(e => e.gross > 0)
    .sort((a, b) => b.gross - a.gross)
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AccountsPage() {
  const [selectedYear,  setSelectedYear]  = useState(new Date().getFullYear())
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1)
  const [dailyDate,     setDailyDate]     = useState(todayString())
  const [drReportFrom,  setDrReportFrom]  = useState(todayString())
  const [drReportTo,    setDrReportTo]    = useState(todayString())
  const [drReportDoc,   setDrReportDoc]   = useState<string>('')
  const qc = useQueryClient()
  const printRef    = useRef<HTMLDivElement>(null)
  const drPrintRef  = useRef<HTMLDivElement>(null)

  const handlePrint = () => {
    if (!printRef.current) return
    const cssLinks = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'))
      .map(l => `<link rel="stylesheet" href="${l.href}">`)
      .join('')
    const html = printRef.current.innerHTML
    const win = window.open('', '_blank', 'width=860,height=1100')
    if (!win) return
    win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Daily-Collection-${dailyDate}</title>${cssLinks}<style>@page{size:A4 portrait;margin:10mm}body{padding:8px;background:#fff}@media print{body *{visibility:visible!important}}</style></head><body>${html}</body></html>`)
    win.document.close()
    win.focus()
    setTimeout(() => { win.print(); win.close() }, 800)
  }

  const { data: doctors = [] }    = useQuery({ queryKey: ['doctors-active'], queryFn: fetchActiveDoctors })
  const { data: allDoctors = [] } = useQuery({ queryKey: ['doctors-all'],    queryFn: fetchAllDoctors })
  const { data: totals }          = useQuery({ queryKey: ['accounts-totals'], queryFn: fetchTotals })

  const { data: revenue = [], isLoading: loadingRev } = useQuery({
    queryKey: ['revenue-monthly', selectedYear],
    queryFn:  () => fetchRevenueSummary(selectedYear),
  })

  const { data: dailyInvoices = [], isLoading: loadingDaily } = useQuery({
    queryKey: ['daily-collection', dailyDate],
    queryFn:  () => fetchDailyInvoices(dailyDate),
  })

  const { data: dailyOpdTokens = [] } = useQuery({
    queryKey: ['daily-opd-tokens', dailyDate],
    queryFn:  () => fetchDailyOpdTokens(dailyDate),
  })

  const { data: dailyErVisits = [] } = useQuery({
    queryKey: ['daily-er-visits', dailyDate],
    queryFn:  () => fetchDailyErVisits(dailyDate),
  })

  const dailyPatientIds = useMemo(
    () => [...new Set([
      ...dailyInvoices.map(i => i.patient_id),
      ...dailyOpdTokens.map(t => t.patient_id),
      ...dailyErVisits.map(v => v.patient_id),
    ])],
    [dailyInvoices, dailyOpdTokens, dailyErVisits],
  )
  const { data: patientNames = {} } = useQuery({
    queryKey: ['daily-patient-names', dailyPatientIds.sort().join(',')],
    queryFn:  () => fetchPatientNames(dailyPatientIds),
    enabled:  dailyPatientIds.length > 0,
  })

  const { data: monthInvoices  = [], isLoading: loadingMI  } = useQuery({ queryKey: ['month-invoices',   selectedMonth, selectedYear], queryFn: () => fetchMonthInvoices(selectedMonth, selectedYear) })
  const { data: monthOpdTokens = [], isLoading: loadingOPD } = useQuery({ queryKey: ['month-opd-tokens', selectedMonth, selectedYear], queryFn: () => fetchMonthOpdTokens(selectedMonth, selectedYear) })
  const { data: monthErVisits  = [] }                         = useQuery({ queryKey: ['month-er-visits',  selectedMonth, selectedYear], queryFn: () => fetchMonthErVisits(selectedMonth, selectedYear) })
  const { data: ipdAdmissions  = [] }                         = useQuery({ queryKey: ['ipd-admissions'], queryFn: fetchIpdAdmissions, staleTime: 5 * 60_000 })
  const { data: paidSet = new Set<string>() }                 = useQuery({ queryKey: ['earnings-paid', selectedMonth, selectedYear], queryFn: () => fetchPaidSet(selectedMonth, selectedYear) })

  const loadingEarnings = loadingMI || loadingOPD

  const earnings = useMemo(
    () => computeEarnings(monthInvoices, monthOpdTokens, monthErVisits, ipdAdmissions, allDoctors, paidSet),
    [monthInvoices, monthOpdTokens, monthErVisits, ipdAdmissions, allDoctors, paidSet],
  )

  const markPaid = useMutation({
    mutationFn: async (e: ComputedEarning) => {
      await supabase.from('doctor_earnings').upsert({
        doctor_id: e.doctor.id, month: selectedMonth, year: selectedYear,
        total_opd: e.total_opd, total_er: e.total_er, total_ipd: e.total_ipd,
        total_procedures: 0, gross_earnings: e.gross, share_amount: e.share_amount, paid: true,
      }, { onConflict: 'doctor_id,month,year' })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['earnings-paid'] }),
  })

  const exportExcel = () => {
    import('xlsx').then(({ utils, writeFile }) => {
      const ws = utils.json_to_sheet(earnings.map(e => ({
        Doctor: e.doctor.name, Month: `${MONTHS[selectedMonth - 1]} ${selectedYear}`,
        'OPD': e.total_opd, 'ER': e.total_er, 'IPD': e.total_ipd,
        'Gross': e.gross, 'Share %': `${e.doctor.share_percent}%`,
        'Share Amount': e.share_amount, Paid: e.paid ? 'Yes' : 'No',
      })))
      const wb = utils.book_new(); utils.book_append_sheet(wb, ws, 'Doctor Earnings')
      writeFile(wb, `AKM-Earnings-${MONTHS[selectedMonth - 1]}-${selectedYear}.xlsx`)
    })
  }

  // Daily summaries
  const dailyCollected  = dailyInvoices.reduce((s, i) => s + (i.paid_amount ?? 0), 0)
  const dailyTotal      = dailyInvoices.reduce((s, i) => s + (i.total ?? 0), 0)
  const dailyPending    = Math.max(0, dailyTotal - dailyCollected)
  const dailyByType     = dailyInvoices.reduce<Record<string, number>>((a, i) => { a[i.visit_type] = (a[i.visit_type] ?? 0) + (i.paid_amount ?? 0); return a }, {})
  const dailyByMethod   = dailyInvoices.reduce<Record<string, number>>((a, i) => { const m = i.payment_method ?? 'cash'; a[m] = (a[m] ?? 0) + (i.paid_amount ?? 0); return a }, {})

  // Doctor lookup map for daily collection
  const doctorMap = useMemo(
    () => new Map(doctors.map(d => [d.id, d])),
    [doctors],
  )

  // Cross-table fallback maps for daily collection (same approach as monthly computeEarnings)
  const dailyOpdDocMap = useMemo(() => {
    const m = new Map<string, string>()
    dailyOpdTokens.forEach(t => { if (t.doctor_id) m.set(t.patient_id, t.doctor_id) })
    return m
  }, [dailyOpdTokens])

  const dailyErDocMap = useMemo(() => {
    const m = new Map<string, string>()
    dailyErVisits.forEach(v => { if (v.doctor_id) m.set(v.patient_id, v.doctor_id) })
    return m
  }, [dailyErVisits])

  const resolveDocId = useMemo(() => (inv: Invoice, opdMap: Map<string,string>, erMap: Map<string,string>): string | undefined => {
    const direct = (inv as Invoice & { doctor_id?: string | null }).doctor_id
    if (direct) return direct
    if (inv.visit_type === 'opd') return opdMap.get(inv.patient_id)
    if (inv.visit_type === 'er')  return erMap.get(inv.patient_id)
    return undefined
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Daily doctor share breakdown
  const dailyDoctorShares = useMemo(() => {
    const map = new Map<string, { doctor: Doctor; share: number }>()
    dailyInvoices.forEach(inv => {
      if (inv.visit_type === 'ipd') return
      const docId = resolveDocId(inv, dailyOpdDocMap, dailyErDocMap)
      if (!docId) return
      const doc = doctorMap.get(docId)
      if (!doc) return
      const share = Math.round((inv.paid_amount ?? 0) * doc.share_percent / 100)
      if (share === 0) return
      const existing = map.get(docId)
      if (existing) { existing.share += share } else { map.set(docId, { doctor: doc, share }) }
    })
    return [...map.values()].sort((a, b) => b.share - a.share)
  }, [dailyInvoices, doctorMap, dailyOpdDocMap, dailyErDocMap, resolveDocId])

  // Doctor-wise OPD token report
  const { data: drReportTokens = [], isFetching: drReportLoading } = useQuery({
    queryKey: ['dr-opd-tokens', drReportFrom, drReportTo],
    queryFn: () => fetchOpdTokensByRange(drReportFrom, drReportTo),
    enabled: !!drReportFrom && !!drReportTo && drReportFrom <= drReportTo,
  })

  const drReportRows = useMemo(() => {
    const filtered = drReportDoc
      ? drReportTokens.filter(t => t.doctor_id === drReportDoc)
      : drReportTokens
    const grouped = new Map<string, { doctor: Doctor; tokens: OpdToken[] }>()
    for (const tok of filtered) {
      const docId = tok.doctor_id ?? ''
      const doc = doctors.find(d => d.id === docId)
      if (!doc) continue
      if (!grouped.has(docId)) grouped.set(docId, { doctor: doc, tokens: [] })
      grouped.get(docId)!.tokens.push(tok)
    }
    return [...grouped.values()].sort((a, b) => b.tokens.length - a.tokens.length)
  }, [drReportTokens, drReportDoc, doctors])

  const drReportPatientIds = useMemo(
    () => [...new Set(drReportTokens.map(t => t.patient_id))],
    [drReportTokens],
  )
  const { data: drPatientNames = {} } = useQuery({
    queryKey: ['dr-report-patient-names', drReportPatientIds.sort().join(',')],
    queryFn:  () => fetchPatientNames(drReportPatientIds),
    enabled:  drReportPatientIds.length > 0,
  })

  const handleDrPrint = () => {
    if (!drPrintRef.current) return
    const cssLinks = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'))
      .map(l => `<link rel="stylesheet" href="${l.href}">`).join('')
    const html = drPrintRef.current.innerHTML
    const win = window.open('', '_blank', 'width=860,height=1100')
    if (!win) return
    win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>OPD-Doctor-Report</title>${cssLinks}<style>@page{size:A4 portrait;margin:10mm}body{padding:8px;background:#fff}</style></head><body>${html}</body></html>`)
    win.document.close()
    win.focus()
    setTimeout(() => { win.print(); win.close() }, 800)
  }

  // Map visit_ref_id → paid_amount for OPD tokens fee display
  const opdInvoiceMap = useMemo(() => {
    const map = new Map<string, number>()
    dailyInvoices.forEach(inv => {
      if (inv.visit_type === 'opd' && inv.visit_ref_id && inv.paid_amount > 0) {
        map.set(inv.visit_ref_id, inv.paid_amount)
      }
    })
    return map
  }, [dailyInvoices])

  const totalRevenue = revenue.reduce((s, r) => s + r.opd + r.er + r.ipd + r.us, 0)
  const earningsTotal = earnings.reduce((s, e) => s + e.share_amount, 0)

  return (
    <div>
      <PageHeader
        title="Accounts & Financial Reports"
        subtitle="Daily collection, revenue overview, and doctor earnings"
        actions={
          <button
            onClick={exportExcel}
            className="flex items-center gap-2 border border-gray-300 hover:bg-gray-50 px-4 py-2 rounded-lg text-sm"
          >
            <Download className="w-4 h-4" /> Export Excel
          </button>
        }
      />

      {/* ── KPI Cards ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
        {[
          { label: 'Month Revenue',   value: formatCurrency(totals?.monthRev    ?? 0), color: 'text-maroon-600' },
          { label: 'Outstanding Dues',value: formatCurrency(totals?.outstanding ?? 0), color: 'text-red-600'    },
          { label: 'OPD Visits',      value: totals?.opdCount ?? '—',                  color: 'text-blue-600'   },
          { label: 'ER Visits',       value: totals?.erCount  ?? '—',                  color: 'text-orange-600' },
          { label: 'IPD Admitted',    value: totals?.ipdCount ?? '—',                  color: 'text-purple-600' },
        ].map(kpi => (
          <div key={kpi.label} className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-500">{kpi.label}</p>
            <p className={`text-xl font-bold mt-1 ${kpi.color}`}>{kpi.value}</p>
          </div>
        ))}
      </div>

      {/* ── Daily Collection ──────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-8">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <h3 className="font-semibold text-gray-800 flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-maroon-500" />
            Daily Collection Report
          </h3>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={dailyDate}
              onChange={e => setDailyDate(e.target.value)}
              className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-maroon-400"
            />
            <button
              onClick={handlePrint}
              className="flex items-center gap-2 border border-gray-300 hover:bg-gray-50 px-3 py-1.5 rounded-lg text-sm"
            >
              <Printer className="w-4 h-4" /> Print
            </button>
          </div>
        </div>

        {loadingDaily ? (
          <div className="flex justify-center py-8"><LoadingSpinner /></div>
        ) : (
          <div ref={printRef}>
            {/* ── Print-only header ── */}
            <div className="hidden print:block mb-4 text-center border-b-2 border-maroon-500 pb-3">
              <div className="flex justify-center mb-1"><AKMLogo size={40} /></div>
              <h2 className="text-base font-bold text-maroon-700">ALIM KHATOON MEDICARE</h2>
              <p className="text-sm text-gray-600 font-medium">Daily Collection Report — {formatDate(dailyDate)}</p>
            </div>

            {/* ── Summary cards (screen + print) ── */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-4 print:grid-cols-6 print:gap-2">
              <div className="rounded-lg bg-green-50 border border-green-200 p-3 lg:col-span-1">
                <p className="text-xs text-green-600 font-medium">Total Collected</p>
                <p className="text-lg font-bold text-green-700 mt-0.5">{formatCurrency(dailyCollected)}</p>
                <p className="text-xs text-green-500">{dailyInvoices.length} invoice{dailyInvoices.length !== 1 ? 's' : ''}</p>
              </div>
              <div className="rounded-lg bg-blue-50 border border-blue-200 p-3">
                <p className="text-xs text-blue-600 font-medium uppercase">OPD Tokens</p>
                <p className="text-lg font-bold text-blue-700 mt-0.5">{dailyOpdTokens.length}</p>
                <p className="text-xs text-blue-500">{formatCurrency(dailyByType['opd'] ?? 0)} collected</p>
              </div>
              <div className="rounded-lg bg-orange-50 border border-orange-200 p-3">
                <p className="text-xs text-orange-600 font-medium uppercase">ER Tokens</p>
                <p className="text-lg font-bold text-orange-700 mt-0.5">{dailyErVisits.length}</p>
                <p className="text-xs text-orange-500">{formatCurrency(dailyByType['er'] ?? 0)} collected</p>
              </div>
              <div className="rounded-lg bg-gray-50 border border-gray-200 p-3">
                <p className="text-xs text-gray-500 font-medium uppercase">IPD</p>
                <p className="text-lg font-bold text-gray-800 mt-0.5">{formatCurrency(dailyByType['ipd'] ?? 0)}</p>
              </div>
              <div className="rounded-lg bg-yellow-50 border border-yellow-200 p-3">
                <p className="text-xs text-yellow-600 font-medium uppercase">Ultrasound</p>
                <p className="text-lg font-bold text-yellow-700 mt-0.5">{formatCurrency(dailyByType['us'] ?? 0)}</p>
              </div>
              {dailyPending > 0 && (
                <div className="rounded-lg bg-red-50 border border-red-200 p-3">
                  <p className="text-xs text-red-500 font-medium">Pending</p>
                  <p className="text-lg font-bold text-red-600 mt-0.5">{formatCurrency(dailyPending)}</p>
                </div>
              )}
            </div>

            {/* ── Payment method breakdown ── */}
            {Object.keys(dailyByMethod).length > 0 && (
              <div className="flex flex-wrap gap-2 mb-4">
                {Object.entries(dailyByMethod).map(([method, amt]) => (
                  <span key={method} className="inline-flex items-center gap-1.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-full px-3 py-1 text-xs font-medium">
                    {PAYMENT_LABELS[method] ?? method}: {formatCurrency(amt)}
                  </span>
                ))}
              </div>
            )}

            {/* ── OPD Token list ── */}
            {dailyOpdTokens.length > 0 && (
              <div className="mb-5">
                <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide mb-2">
                  OPD Tokens ({dailyOpdTokens.length})
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs min-w-[500px] border border-blue-100 rounded-lg overflow-hidden">
                    <thead className="bg-blue-50">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium text-blue-700">Token #</th>
                        <th className="text-left px-3 py-2 font-medium text-blue-700">Patient</th>
                        <th className="text-left px-3 py-2 font-medium text-blue-700">Doctor</th>
                        <th className="text-left px-3 py-2 font-medium text-blue-700">Time</th>
                        <th className="text-right px-3 py-2 font-medium text-blue-700">Amount</th>
                        <th className="text-left px-3 py-2 font-medium text-blue-700">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-blue-50">
                      {dailyOpdTokens.map(tok => {
                        const doc = doctorMap.get(tok.doctor_id ?? '')
                        const fee = opdInvoiceMap.get(tok.id) ?? opdInvoiceMap.get((tok as OpdToken & { local_id?: string }).local_id ?? '') ?? opdInvoiceMap.get((tok as OpdToken & { server_id?: string }).server_id ?? '')
                        return (
                          <tr key={tok.id} className="hover:bg-blue-50/50">
                            <td className="px-3 py-1.5 font-bold text-blue-600">{tok.token_number}</td>
                            <td className="px-3 py-1.5 text-gray-700">{patientNames[tok.patient_id] ?? '—'}</td>
                            <td className="px-3 py-1.5 text-gray-600">{doc?.name.split(' ').slice(0,2).join(' ') ?? '—'}</td>
                            <td className="px-3 py-1.5 text-gray-500">{tok.time_slot ?? '—'}</td>
                            <td className="px-3 py-1.5 text-right font-medium text-green-700">{fee ? `Rs. ${fee.toLocaleString()}` : '—'}</td>
                            <td className="px-3 py-1.5 capitalize text-gray-500">{tok.status}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ── ER Token list ── */}
            {dailyErVisits.length > 0 && (
              <div className="mb-5">
                <p className="text-xs font-semibold text-orange-700 uppercase tracking-wide mb-2">
                  ER Tokens ({dailyErVisits.length})
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs min-w-[500px] border border-orange-100 rounded-lg overflow-hidden">
                    <thead className="bg-orange-50">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium text-orange-700">Token #</th>
                        <th className="text-left px-3 py-2 font-medium text-orange-700">Patient</th>
                        <th className="text-left px-3 py-2 font-medium text-orange-700">Triage</th>
                        <th className="text-left px-3 py-2 font-medium text-orange-700">Complaint</th>
                        <th className="text-left px-3 py-2 font-medium text-orange-700">Doctor</th>
                        <th className="text-left px-3 py-2 font-medium text-orange-700">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-orange-50">
                      {dailyErVisits.map(vis => {
                        const doc = doctorMap.get(vis.doctor_id ?? '')
                        return (
                          <tr key={vis.id} className="hover:bg-orange-50/50">
                            <td className="px-3 py-1.5 font-bold text-orange-600">{vis.token_number}</td>
                            <td className="px-3 py-1.5 text-gray-700">{patientNames[vis.patient_id] ?? '—'}</td>
                            <td className="px-3 py-1.5 font-bold text-orange-500">L{vis.triage_level}</td>
                            <td className="px-3 py-1.5 text-gray-600 max-w-[180px] truncate">{vis.chief_complaint}</td>
                            <td className="px-3 py-1.5 text-gray-600">{doc?.name.split(' ').slice(0,2).join(' ') ?? '—'}</td>
                            <td className="px-3 py-1.5 capitalize text-gray-500">{vis.status}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ── Invoice table ── */}
            <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2">
              Invoices ({dailyInvoices.length})
            </p>
            {dailyInvoices.length === 0 ? (
              <p className="text-center py-6 text-gray-400 text-sm">No invoices found for {formatDate(dailyDate)}.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[750px]">
                  <thead className="bg-gray-50 border-b border-gray-200 print:bg-gray-100">
                    <tr>
                      <th className="text-left px-3 py-2.5 font-medium text-gray-600">#</th>
                      <th className="text-left px-3 py-2.5 font-medium text-gray-600">Invoice</th>
                      <th className="text-left px-3 py-2.5 font-medium text-gray-600">Patient</th>
                      <th className="text-left px-3 py-2.5 font-medium text-gray-600">Type</th>
                      <th className="text-right px-3 py-2.5 font-medium text-gray-600">Total</th>
                      <th className="text-right px-3 py-2.5 font-medium text-gray-600">Paid</th>
                      <th className="text-right px-3 py-2.5 font-medium text-gray-600 print:hidden">Balance</th>
                      <th className="text-left px-3 py-2.5 font-medium text-gray-600">Method</th>
                      <th className="text-left px-3 py-2.5 font-medium text-gray-600">Doctor</th>
                      <th className="text-right px-3 py-2.5 font-medium text-gray-600">Dr Share</th>
                      <th className="text-left px-3 py-2.5 font-medium text-gray-600">Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {dailyInvoices.map((inv, idx) => {
                      const bal = (inv.total ?? 0) - (inv.paid_amount ?? 0)
                      const docId = resolveDocId(inv, dailyOpdDocMap, dailyErDocMap)
                      const doc = docId ? doctorMap.get(docId) : undefined
                      const drShare = doc ? Math.round((inv.paid_amount ?? 0) * doc.share_percent / 100) : 0
                      return (
                        <tr key={inv.id} className="hover:bg-gray-50">
                          <td className="px-3 py-2.5 text-gray-400 text-xs">{idx + 1}</td>
                          <td className="px-3 py-2.5 font-mono text-xs text-maroon-600">{inv.invoice_number}</td>
                          <td className="px-3 py-2.5 font-medium text-gray-800">
                            {patientNames[inv.patient_id] ?? `${inv.patient_id.slice(0, 8)}…`}
                          </td>
                          <td className="px-3 py-2.5">
                            <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold uppercase ${TYPE_COLORS[inv.visit_type] ?? 'bg-gray-100 text-gray-600'}`}>
                              {inv.visit_type}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-right">{formatCurrency(inv.total)}</td>
                          <td className="px-3 py-2.5 text-right text-green-600 font-medium">{formatCurrency(inv.paid_amount)}</td>
                          <td className={`px-3 py-2.5 text-right text-sm print:hidden ${bal > 0 ? 'text-red-500' : 'text-gray-400'}`}>
                            {bal > 0 ? formatCurrency(bal) : '—'}
                          </td>
                          <td className="px-3 py-2.5 text-xs text-gray-500 capitalize">
                            {PAYMENT_LABELS[inv.payment_method ?? ''] ?? inv.payment_method ?? '—'}
                          </td>
                          <td className="px-3 py-2.5 text-xs text-gray-600">
                            {doc ? (
                              <span title={`${doc.share_percent}% share`}>{doc.name.split(' ').slice(0, 2).join(' ')}</span>
                            ) : '—'}
                          </td>
                          <td className="px-3 py-2.5 text-right text-xs font-medium text-maroon-600">
                            {drShare > 0 ? formatCurrency(drShare) : '—'}
                          </td>
                          <td className="px-3 py-2.5 text-xs text-gray-400">
                            {new Date(inv.created_at).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit', hour12: true })}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot className="border-t-2 border-gray-300 bg-gray-50">
                    <tr className="font-semibold">
                      <td colSpan={4} className="px-3 py-2.5 text-gray-700">TOTAL ({dailyInvoices.length} invoices)</td>
                      <td className="px-3 py-2.5 text-right">{formatCurrency(dailyTotal)}</td>
                      <td className="px-3 py-2.5 text-right text-green-700">{formatCurrency(dailyCollected)}</td>
                      <td className={`px-3 py-2.5 text-right print:hidden ${dailyPending > 0 ? 'text-red-600' : 'text-gray-400'}`}>
                        {dailyPending > 0 ? formatCurrency(dailyPending) : '—'}
                      </td>
                      <td className="px-3 py-2.5" />
                      <td className="px-3 py-2.5" />
                      <td className="px-3 py-2.5 text-right text-maroon-600">
                        {formatCurrency(dailyDoctorShares.reduce((s, e) => s + e.share, 0))}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}

            {/* ── Daily doctor earnings breakdown ── */}
            {dailyDoctorShares.length > 0 && (
              <div className="mt-4 p-4 bg-maroon-50 border border-maroon-200 rounded-lg">
                <p className="text-xs font-semibold text-maroon-700 mb-2 uppercase tracking-wide">
                  Doctor Daily Earnings — {formatDate(dailyDate)}
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                  {dailyDoctorShares.map(({ doctor, share }) => (
                    <div key={doctor.id} className="flex justify-between items-center bg-white border border-maroon-100 rounded px-3 py-1.5 text-xs">
                      <div>
                        <span className="text-gray-700 font-medium block truncate">{doctor.name.split(' ').slice(0, 2).join(' ')}</span>
                        <span className="text-gray-400">{doctor.share_percent}% share</span>
                      </div>
                      <span className="text-maroon-600 font-bold whitespace-nowrap ml-2">{formatCurrency(share)}</span>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-maroon-500 mt-2">
                  Total doctor payouts today: <strong>{formatCurrency(dailyDoctorShares.reduce((s, e) => s + e.share, 0))}</strong>
                  {' '}— Each doctor's share % applied to their linked invoices.
                </p>
              </div>
            )}

            {/* ── Print-only footer ── */}
            <div className="hidden print:block mt-4 pt-3 border-t border-gray-300 text-xs text-gray-500 text-center">
              <div className="flex justify-center gap-4 mb-2 text-xs font-medium">
                <span>OPD Tokens: <strong>{dailyOpdTokens.length}</strong></span>
                <span>ER Tokens: <strong>{dailyErVisits.length}</strong></span>
                <span>Invoices: <strong>{dailyInvoices.length}</strong></span>
                <span>Collected: <strong>{formatCurrency(dailyCollected)}</strong></span>
                {dailyPending > 0 && <span className="text-red-600">Pending: <strong>{formatCurrency(dailyPending)}</strong></span>}
              </div>
              <div className="flex justify-center gap-4 mb-1 text-xs">
                {Object.entries(dailyByMethod).map(([m, a]) => (
                  <span key={m}>{PAYMENT_LABELS[m] ?? m}: {formatCurrency(a)}</span>
                ))}
              </div>
              {dailyDoctorShares.length > 0 && (
                <div className="flex justify-center flex-wrap gap-3 mb-1 text-xs">
                  {dailyDoctorShares.map(({ doctor, share }) => (
                    <span key={doctor.id}>{doctor.name.split(' ').slice(0, 2).join(' ')} ({doctor.share_percent}%): {formatCurrency(share)}</span>
                  ))}
                </div>
              )}
              Printed: {new Date().toLocaleString('en-PK')} · AKM Hospital Management System
            </div>
          </div>
        )}
      </div>

      {/* ── Daily Doctor Earnings (standalone screen card) ───────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-8">
        <h3 className="font-semibold text-gray-800 flex items-center gap-2 mb-4">
          <CalendarDays className="w-4 h-4 text-maroon-500" />
          Daily Doctor Earnings — {formatDate(dailyDate)}
        </h3>
        {loadingDaily ? (
          <div className="flex justify-center py-4"><LoadingSpinner /></div>
        ) : dailyDoctorShares.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-4">
            No invoices with linked doctors found for {formatDate(dailyDate)}.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-3">
              {dailyDoctorShares.map(({ doctor, share }) => (
                <div key={doctor.id} className="bg-maroon-50 border border-maroon-200 rounded-lg px-4 py-3 flex justify-between items-center">
                  <div>
                    <p className="font-semibold text-gray-800 text-sm">{doctor.name.split(' ').slice(0, 2).join(' ')}</p>
                    <p className="text-xs text-gray-400">{doctor.share_percent}% share</p>
                  </div>
                  <span className="text-maroon-600 font-bold text-base">{formatCurrency(share)}</span>
                </div>
              ))}
            </div>
            <div className="text-sm text-gray-500 border-t border-gray-100 pt-3">
              Total payouts: <strong className="text-maroon-700">{formatCurrency(dailyDoctorShares.reduce((s, e) => s + e.share, 0))}</strong>
              <span className="ml-2 text-xs text-gray-400">— each doctor's % applied to their invoices for this day</span>
            </div>
          </>
        )}
      </div>

      {/* ── Doctor-wise OPD Token Report ─────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-8">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <h3 className="font-semibold text-gray-800 flex items-center gap-2">
            <Stethoscope className="w-4 h-4 text-maroon-500" />
            OPD Tokens by Doctor
          </h3>
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="date"
              value={drReportFrom}
              onChange={e => setDrReportFrom(e.target.value)}
              className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-maroon-400"
            />
            <span className="text-gray-400 text-sm">to</span>
            <input
              type="date"
              value={drReportTo}
              onChange={e => setDrReportTo(e.target.value)}
              className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-maroon-400"
            />
            <select
              value={drReportDoc}
              onChange={e => setDrReportDoc(e.target.value)}
              className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-maroon-400"
            >
              <option value="">All Doctors</option>
              {doctors.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <button
              onClick={handleDrPrint}
              disabled={drReportRows.length === 0}
              className="flex items-center gap-1.5 border border-gray-300 hover:bg-gray-50 px-3 py-1.5 rounded-lg text-sm disabled:opacity-40"
            >
              <Printer className="w-4 h-4" /> Print
            </button>
          </div>
        </div>

        {drReportLoading ? (
          <div className="flex justify-center py-6"><LoadingSpinner /></div>
        ) : drReportRows.length === 0 ? (
          <p className="text-center py-6 text-gray-400 text-sm">No OPD tokens found for selected range.</p>
        ) : (
          <div ref={drPrintRef}>
            {/* Print header */}
            <div className="hidden print:block mb-4 text-center border-b-2 border-maroon-500 pb-3">
              <div className="flex justify-center mb-1"><AKMLogo size={40} /></div>
              <h2 className="text-base font-bold text-maroon-700">ALIM KHATOON MEDICARE</h2>
              <p className="text-sm text-gray-600 font-medium">
                OPD Tokens by Doctor — {formatDate(drReportFrom)}{drReportFrom !== drReportTo ? ` to ${formatDate(drReportTo)}` : ''}
              </p>
            </div>

            {/* Summary cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-4">
              {drReportRows.map(({ doctor, tokens }) => (
                <div key={doctor.id} className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 flex justify-between items-center">
                  <div>
                    <p className="font-semibold text-gray-800 text-sm">{doctor.name.split(' ').slice(0,2).join(' ')}</p>
                    <p className="text-xs text-gray-400">{doctor.specialty}</p>
                  </div>
                  <span className="text-blue-700 font-bold text-xl">{tokens.length}</span>
                </div>
              ))}
            </div>

            {/* Detail table */}
            {drReportRows.map(({ doctor, tokens }) => (
              <div key={doctor.id} className="mb-5">
                <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide mb-2">
                  {doctor.name} ({tokens.length} token{tokens.length !== 1 ? 's' : ''})
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs border border-blue-100 rounded-lg overflow-hidden">
                    <thead className="bg-blue-50">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium text-blue-700">Token #</th>
                        <th className="text-left px-3 py-2 font-medium text-blue-700">Patient</th>
                        <th className="text-left px-3 py-2 font-medium text-blue-700">Date</th>
                        <th className="text-left px-3 py-2 font-medium text-blue-700">Time</th>
                        <th className="text-left px-3 py-2 font-medium text-blue-700">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-blue-50">
                      {tokens.map(tok => (
                        <tr key={tok.id} className="hover:bg-blue-50/50">
                          <td className="px-3 py-1.5 font-bold text-blue-600">{tok.token_number}</td>
                          <td className="px-3 py-1.5 text-gray-700">{drPatientNames[tok.patient_id] ?? '—'}</td>
                          <td className="px-3 py-1.5 text-gray-500">{formatDate(tok.date)}</td>
                          <td className="px-3 py-1.5 text-gray-500">{tok.time_slot ?? '—'}</td>
                          <td className="px-3 py-1.5 capitalize text-gray-500">{tok.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}

            {/* Print footer */}
            <div className="hidden print:block mt-4 pt-3 border-t border-gray-300 text-xs text-gray-500 text-center">
              Total tokens: <strong>{drReportRows.reduce((s, r) => s + r.tokens.length, 0)}</strong>
              {' '}· Printed: {new Date().toLocaleString('en-PK')} · AKM Hospital Management System
            </div>
          </div>
        )}
      </div>

      {/* ── Monthly Revenue Chart ──────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-8">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h3 className="font-semibold text-gray-800 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-maroon-500" />
            Monthly Revenue — {selectedYear}
          </h3>
          <div className="flex items-center gap-2">
            <select
              value={selectedYear}
              onChange={e => setSelectedYear(Number(e.target.value))}
              className="text-sm border border-gray-300 rounded-lg px-3 py-1.5"
            >
              {[2024, 2025, 2026].map(y => <option key={y}>{y}</option>)}
            </select>
            <span className="text-sm font-semibold text-maroon-600">Total: {formatCurrency(totalRevenue)}</span>
          </div>
        </div>
        {loadingRev ? (
          <div className="flex justify-center py-8"><LoadingSpinner /></div>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={revenue}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(v: number) => formatCurrency(v)} />
              <Legend />
              <Bar dataKey="opd" name="OPD" fill="#8B0000" radius={[3,3,0,0]} />
              <Bar dataKey="er"  name="ER"  fill="#EA580C" radius={[3,3,0,0]} />
              <Bar dataKey="ipd" name="IPD" fill="#7C3AED" radius={[3,3,0,0]} />
              <Bar dataKey="us"  name="US"  fill="#D4AF37" radius={[3,3,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* ── Doctor Earnings ────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <div>
            <h3 className="font-semibold text-gray-800">Doctor Earnings</h3>
            <p className="text-xs text-gray-500 mt-0.5">Computed live from invoices linked to OPD tokens, ER visits &amp; IPD admissions</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={selectedMonth}
              onChange={e => setSelectedMonth(Number(e.target.value))}
              className="text-sm border border-gray-300 rounded-lg px-3 py-1.5"
            >
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
            <select
              value={selectedYear}
              onChange={e => setSelectedYear(Number(e.target.value))}
              className="text-sm border border-gray-300 rounded-lg px-3 py-1.5"
            >
              {[2024, 2025, 2026].map(y => <option key={y}>{y}</option>)}
            </select>
            <button
              onClick={exportExcel}
              className="flex items-center gap-1.5 border border-gray-300 hover:bg-gray-50 px-3 py-1.5 rounded-lg text-sm"
            >
              <Download className="w-4 h-4" /> Export
            </button>
          </div>
        </div>

        {loadingEarnings ? (
          <div className="flex justify-center py-8"><LoadingSpinner /></div>
        ) : earnings.length === 0 ? (
          <div className="text-center py-10 text-gray-400">
            <p className="font-medium">No earnings data for {MONTHS[selectedMonth - 1]} {selectedYear}</p>
            <p className="text-sm mt-1">Earnings are computed from invoices where a doctor is linked via OPD/ER/IPD records.</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[700px]">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Doctor</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-600">OPD</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-600">ER</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-600">IPD</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-600">Gross</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-600">Share</th>
                    <th className="text-center px-4 py-3 font-medium text-gray-600">Paid</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {earnings.map(e => (
                    <tr key={e.doctor.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-800">
                        {e.doctor.name}
                        <span className="text-xs text-gray-400 ml-1.5">({e.doctor.share_percent}%)</span>
                        <span className="text-xs text-gray-400 block">{e.doctor.specialty}</span>
                      </td>
                      <td className="px-4 py-3 text-right text-gray-600">{e.total_opd > 0 ? formatCurrency(e.total_opd) : '—'}</td>
                      <td className="px-4 py-3 text-right text-gray-600">{e.total_er  > 0 ? formatCurrency(e.total_er)  : '—'}</td>
                      <td className="px-4 py-3 text-right text-gray-600">{e.total_ipd > 0 ? formatCurrency(e.total_ipd) : '—'}</td>
                      <td className="px-4 py-3 text-right font-semibold">{formatCurrency(e.gross)}</td>
                      <td className="px-4 py-3 text-right font-bold text-maroon-600">{formatCurrency(e.share_amount)}</td>
                      <td className="px-4 py-3 text-center">
                        {e.paid ? (
                          <span className="inline-flex items-center gap-1 text-green-600 text-xs font-medium">
                            <CheckCircle className="w-4 h-4" /> Paid
                          </span>
                        ) : (
                          <button
                            onClick={() => markPaid.mutate(e)}
                            disabled={markPaid.isPending}
                            className="text-xs bg-maroon-50 text-maroon-600 hover:bg-maroon-100 px-3 py-1 rounded font-medium disabled:opacity-50"
                          >
                            Mark Paid
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 border-gray-300 bg-gray-50">
                  <tr className="font-semibold text-gray-700">
                    <td className="px-4 py-2.5">Total Payouts</td>
                    <td className="px-4 py-2.5 text-right">{formatCurrency(earnings.reduce((s,e) => s+e.total_opd, 0))}</td>
                    <td className="px-4 py-2.5 text-right">{formatCurrency(earnings.reduce((s,e) => s+e.total_er,  0))}</td>
                    <td className="px-4 py-2.5 text-right">{formatCurrency(earnings.reduce((s,e) => s+e.total_ipd, 0))}</td>
                    <td className="px-4 py-2.5 text-right">{formatCurrency(earnings.reduce((s,e) => s+e.gross,    0))}</td>
                    <td className="px-4 py-2.5 text-right text-maroon-600">{formatCurrency(earningsTotal)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="text-xs text-gray-400 mt-3">
              * US invoices are not attributed to a specific doctor. OPD amounts matched via token on same day; ER via visit on same day; IPD via admitting doctor.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
