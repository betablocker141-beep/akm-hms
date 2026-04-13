import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useReactToPrint } from 'react-to-print'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { Download, Printer, CheckCircle } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'
import { supabase } from '@/lib/supabase/client'
import { formatCurrency, formatDate } from '@/lib/utils'
import { fetchActiveDoctors } from '@/lib/utils/doctorUtils'
import type { Doctor } from '@/types'

interface MonthlyRevenue { month: string; opd: number; er: number; ipd: number; us: number }
interface DoctorEarning {
  id: string; doctor_id: string; month: number; year: number
  total_opd: number; total_er: number; total_ipd: number; total_procedures: number
  gross_earnings: number; share_amount: number; paid: boolean; created_at: string
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

async function fetchRevenueSummary(year: number): Promise<MonthlyRevenue[]> {
  // Aggregate invoices by month & visit_type
  const { data } = await supabase
    .from('invoices')
    .select('visit_type, total, created_at')
    .gte('created_at', `${year}-01-01`)
    .lte('created_at', `${year}-12-31`)
    .eq('status', 'paid')

  const monthly: Record<number, MonthlyRevenue> = {}
  for (let m = 1; m <= 12; m++) {
    monthly[m] = { month: MONTHS[m - 1], opd: 0, er: 0, ipd: 0, us: 0 }
  }
  ;(data ?? []).forEach((inv) => {
    const m = new Date(inv.created_at).getMonth() + 1
    if (monthly[m]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(monthly[m] as any)[inv.visit_type] = ((monthly[m] as any)[inv.visit_type] ?? 0) + (inv.total ?? 0)
    }
  })
  return Object.values(monthly)
}

async function fetchDoctorEarnings(month: number, year: number): Promise<DoctorEarning[]> {
  const { data } = await supabase
    .from('doctor_earnings')
    .select('*')
    .eq('month', month)
    .eq('year', year)
    .order('created_at')
  return (data ?? []) as DoctorEarning[]
}


async function fetchTotals() {
  const today = new Date()
  const monthStart = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`
  const { data: monthInvoices } = await supabase
    .from('invoices')
    .select('total, paid_amount, status')
    .gte('created_at', monthStart)
  const monthRev = (monthInvoices ?? []).reduce((s, i) => s + (i.paid_amount ?? 0), 0)
  const outstanding = (monthInvoices ?? [])
    .filter(i => i.status !== 'paid')
    .reduce((s, i) => s + (i.total - i.paid_amount), 0)
  const { count: opdCount } = await supabase.from('opd_tokens').select('*', { count: 'exact', head: true }).gte('created_at', monthStart)
  const { count: erCount } = await supabase.from('er_visits').select('*', { count: 'exact', head: true }).gte('created_at', monthStart)
  const { count: ipdCount } = await supabase.from('ipd_admissions').select('*', { count: 'exact', head: true }).gte('created_at', monthStart)
  return { monthRev, outstanding, opdCount: opdCount ?? 0, erCount: erCount ?? 0, ipdCount: ipdCount ?? 0 }
}

export function AccountsPage() {
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear())
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1)
  const qc = useQueryClient()

  const { data: revenue = [] as MonthlyRevenue[], isLoading: loadingRev } = useQuery({
    queryKey: ['revenue-monthly', selectedYear],
    queryFn: () => fetchRevenueSummary(selectedYear),
  })

  const { data: earnings = [], isLoading: loadingEarnings } = useQuery({
    queryKey: ['doctor-earnings', selectedMonth, selectedYear],
    queryFn: () => fetchDoctorEarnings(selectedMonth, selectedYear),
  })

  const { data: doctors = [] } = useQuery({ queryKey: ['doctors-active'], queryFn: fetchActiveDoctors })
  const { data: totals } = useQuery({ queryKey: ['accounts-totals'], queryFn: fetchTotals })

  const markPaid = useMutation({
    mutationFn: async (id: string) => {
      await supabase.from('doctor_earnings').update({ paid: true }).eq('id', id)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['doctor-earnings'] }),
  })

  const exportExcel = () => {
    import('xlsx').then(({ utils, writeFile }) => {
      const ws = utils.json_to_sheet(earnings.map((e) => {
        const doc = doctors.find((d) => d.id === e.doctor_id)
        return {
          Doctor: doc?.name ?? e.doctor_id,
          Month: `${MONTHS[e.month - 1]} ${e.year}`,
          'OPD Revenue': e.total_opd,
          'ER Revenue': e.total_er,
          'IPD Revenue': e.total_ipd,
          'Procedures': e.total_procedures,
          'Gross Earnings': e.gross_earnings,
          'Share %': `${doc?.share_percent ?? 0}%`,
          'Share Amount': e.share_amount,
          Paid: e.paid ? 'Yes' : 'No',
        }
      }))
      const wb = utils.book_new()
      utils.book_append_sheet(wb, ws, 'Doctor Earnings')
      writeFile(wb, `AKM-Earnings-${MONTHS[selectedMonth - 1]}-${selectedYear}.xlsx`)
    })
  }

  const totalRevenue = revenue.reduce((s, r) => s + r.opd + r.er + r.ipd + r.us, 0)

  return (
    <div>
      <PageHeader
        title="Accounts & Financial Reports"
        subtitle="Revenue overview, doctor earnings, and payouts"
        actions={
          <button
            onClick={exportExcel}
            className="flex items-center gap-2 border border-gray-300 hover:bg-gray-50 px-4 py-2 rounded-lg text-sm"
          >
            <Download className="w-4 h-4" /> Export Excel
          </button>
        }
      />

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
        {[
          { label: 'Month Revenue', value: formatCurrency(totals?.monthRev ?? 0), color: 'text-maroon-600' },
          { label: 'Outstanding Dues', value: formatCurrency(totals?.outstanding ?? 0), color: 'text-red-600' },
          { label: 'OPD Visits', value: totals?.opdCount ?? '—', color: 'text-blue-600' },
          { label: 'ER Visits', value: totals?.erCount ?? '—', color: 'text-orange-600' },
          { label: 'IPD Admitted', value: totals?.ipdCount ?? '—', color: 'text-purple-600' },
        ].map((kpi) => (
          <div key={kpi.label} className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-500">{kpi.label}</p>
            <p className={`text-xl font-bold mt-1 ${kpi.color}`}>{kpi.value}</p>
          </div>
        ))}
      </div>

      {/* Year selector + chart */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-8">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-800">Monthly Revenue — {selectedYear}</h3>
          <div className="flex items-center gap-2">
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
              className="text-sm border border-gray-300 rounded-lg px-3 py-1.5"
            >
              {[2024, 2025, 2026].map((y) => <option key={y}>{y}</option>)}
            </select>
            <span className="text-sm font-semibold text-maroon-600">
              Total: {formatCurrency(totalRevenue)}
            </span>
          </div>
        </div>
        {loadingRev ? (
          <div className="flex justify-center py-8"><LoadingSpinner /></div>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={revenue}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
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

      {/* Doctor earnings */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-800">Doctor Earnings</h3>
          <div className="flex items-center gap-2">
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(Number(e.target.value))}
              className="text-sm border border-gray-300 rounded-lg px-3 py-1.5"
            >
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
              className="text-sm border border-gray-300 rounded-lg px-3 py-1.5"
            >
              {[2024, 2025, 2026].map((y) => <option key={y}>{y}</option>)}
            </select>
          </div>
        </div>

        {loadingEarnings ? (
          <div className="flex justify-center py-8"><LoadingSpinner /></div>
        ) : earnings.length === 0 ? (
          <p className="text-center py-8 text-gray-400">No earnings data for {MONTHS[selectedMonth - 1]} {selectedYear}.</p>
        ) : (
          <div className="overflow-x-auto"><table className="w-full text-sm min-w-[500px]">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Doctor</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">OPD</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">ER</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">IPD</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Procedures</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Gross</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Share</th>
                <th className="text-center px-4 py-3 font-medium text-gray-600">Paid</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {earnings.map((e) => {
                const doc = doctors.find((d) => d.id === e.doctor_id)
                return (
                  <tr key={e.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-800">
                      {doc?.name ?? '—'}
                      <span className="text-xs text-gray-400 ml-1">({doc?.share_percent ?? 0}%)</span>
                    </td>
                    <td className="px-4 py-3 text-right text-gray-600">{formatCurrency(e.total_opd)}</td>
                    <td className="px-4 py-3 text-right text-gray-600">{formatCurrency(e.total_er)}</td>
                    <td className="px-4 py-3 text-right text-gray-600">{formatCurrency(e.total_ipd)}</td>
                    <td className="px-4 py-3 text-right text-gray-600">{formatCurrency(e.total_procedures)}</td>
                    <td className="px-4 py-3 text-right font-semibold">{formatCurrency(e.gross_earnings)}</td>
                    <td className="px-4 py-3 text-right font-bold text-maroon-600">{formatCurrency(e.share_amount)}</td>
                    <td className="px-4 py-3 text-center">
                      {e.paid ? (
                        <span className="flex items-center justify-center gap-1 text-green-600 text-xs font-medium">
                          <CheckCircle className="w-4 h-4" /> Paid
                        </span>
                      ) : (
                        <button
                          onClick={() => markPaid.mutate(e.id)}
                          className="text-xs bg-maroon-50 text-maroon-600 hover:bg-maroon-100 px-3 py-1 rounded font-medium"
                        >
                          Mark Paid
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
