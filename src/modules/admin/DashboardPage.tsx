import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Users, ClipboardList, BedDouble, Radio, Receipt, TrendingUp } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { useAuthStore } from '@/store/authStore'
import { useSyncStore } from '@/store/syncStore'
import { formatCurrency, todayString } from '@/lib/utils'
import { supabase } from '@/lib/supabase/client'
import { db } from '@/lib/dexie/schema'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'

interface StatCardProps {
  icon: React.ElementType
  label: string
  value: string | number
  sub?: string
  color?: string
  onClick?: () => void
}

function StatCard({ icon: Icon, label, value, sub, color = 'maroon', onClick }: StatCardProps) {
  const colorMap: Record<string, string> = {
    maroon: 'bg-maroon-50 text-maroon-600',
    green:  'bg-green-50 text-green-600',
    blue:   'bg-blue-50 text-blue-600',
    purple: 'bg-purple-50 text-purple-600',
    orange: 'bg-orange-50 text-orange-600',
    gold:   'bg-amber-50 text-amber-600',
  }
  return (
    <div
      className={`bg-white rounded-xl border border-gray-200 p-5 flex items-start gap-4 ${onClick ? 'cursor-pointer hover:shadow-md transition-shadow' : ''}`}
      onClick={onClick}
    >
      <div className={`p-3 rounded-xl ${colorMap[color] ?? colorMap.maroon}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div>
        <p className="text-sm text-gray-500">{label}</p>
        <p className="text-2xl font-bold text-gray-800 mt-0.5">{value}</p>
        {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

// Last 6 calendar months (e.g. ["Nov","Dec","Jan","Feb","Mar","Apr"])
function getLast6Months() {
  const months = []
  const now = new Date()
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push({
      label: d.toLocaleString('en-US', { month: 'short' }),
      year: d.getFullYear(),
      month: d.getMonth() + 1, // 1-based
    })
  }
  return months
}

export function DashboardPage() {
  const { user } = useAuthStore()
  const { isOnline } = useSyncStore()
  const navigate = useNavigate()
  const today = todayString()

  // ── OPD today ──────────────────────────────────────────────────────────────
  const { data: opdStats } = useQuery({
    queryKey: ['dash-opd', today],
    queryFn: async () => {
      if (!isOnline) {
        const all = await db.opd_tokens.where('date').equals(today).toArray()
        return { total: all.length, pending: all.filter(t => t.status === 'confirmed').length }
      }
      const { data } = await supabase
        .from('opd_tokens')
        .select('status')
        .eq('date', today)
      const total = data?.length ?? 0
      const pending = data?.filter(t => t.status === 'confirmed').length ?? 0
      return { total, pending }
    },
    refetchInterval: 30_000,
  })

  // ── ER active ───────────────────────────────────────────────────────────────
  const { data: erStats } = useQuery({
    queryKey: ['dash-er', today],
    queryFn: async () => {
      if (!isOnline) {
        const all = await db.er_visits.where('visit_date').equals(today).toArray()
        return { total: all.filter(v => v.status === 'active').length, critical: all.filter(v => (v as any).triage === 'critical').length }
      }
      const { data } = await supabase
        .from('er_visits')
        .select('status, triage')
        .eq('visit_date', today)
        .eq('status', 'active')
      return { total: data?.length ?? 0, critical: data?.filter(v => (v as any).triage === 'critical').length ?? 0 }
    },
    refetchInterval: 30_000,
  })

  // ── IPD admitted ────────────────────────────────────────────────────────────
  const { data: ipdStats } = useQuery({
    queryKey: ['dash-ipd'],
    queryFn: async () => {
      if (!isOnline) {
        const all = await db.ipd_admissions.toArray()
        return { admitted: all.filter(a => a.status === 'admitted').length }
      }
      const { data } = await supabase
        .from('ipd_admissions')
        .select('status')
        .eq('status', 'admitted')
      return { admitted: data?.length ?? 0 }
    },
    refetchInterval: 60_000,
  })

  // ── US today ────────────────────────────────────────────────────────────────
  const { data: usStats } = useQuery({
    queryKey: ['dash-us', today],
    queryFn: async () => {
      if (!isOnline) {
        const all = await db.ultrasound_reports.where('study_date').equals(today).toArray()
        return { total: all.length, draft: all.filter(r => r.status === 'draft').length }
      }
      const { data } = await supabase
        .from('ultrasound_reports')
        .select('status')
        .eq('study_date', today)
      return { total: data?.length ?? 0, draft: data?.filter(r => r.status === 'draft').length ?? 0 }
    },
    refetchInterval: 60_000,
  })

  // ── Today's revenue ─────────────────────────────────────────────────────────
  const { data: revenueStats } = useQuery({
    queryKey: ['dash-revenue', today],
    queryFn: async () => {
      // Local-time boundaries so PKT records (UTC+5) are not shifted to wrong day
      const dayStart = new Date(`${today}T00:00:00`).toISOString()
      const dayNext  = new Date(`${today}T00:00:00`); dayNext.setDate(dayNext.getDate() + 1)
      const dayEnd   = dayNext.toISOString()
      if (!isOnline) {
        const all = await db.invoices.where('created_at').between(dayStart, dayEnd).toArray()
        const total = all.reduce((s, i) => s + Number((i as any).paid_amount ?? 0), 0)
        return { total, count: all.length }
      }
      const { data } = await supabase
        .from('invoices')
        .select('paid_amount')
        .gte('created_at', dayStart)
        .lt('created_at', dayEnd)
      const total = data?.reduce((s, i) => s + Number(i.paid_amount ?? 0), 0) ?? 0
      return { total, count: data?.length ?? 0 }
    },
    refetchInterval: 30_000,
  })

  // ── This month's revenue ────────────────────────────────────────────────────
  const { data: monthRevenue } = useQuery({
    queryKey: ['dash-month-revenue'],
    queryFn: async () => {
      const now = new Date()
      // Local-time month start so PKT records are not shifted to wrong month
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
      if (!isOnline) {
        const all = await db.invoices.where('created_at').aboveOrEqual(monthStart).toArray()
        return all.reduce((s, i) => s + Number((i as any).paid_amount ?? 0), 0)
      }
      const { data } = await supabase
        .from('invoices')
        .select('paid_amount')
        .gte('created_at', monthStart)
      return data?.reduce((s, i) => s + Number(i.paid_amount ?? 0), 0) ?? 0
    },
    refetchInterval: 60_000,
  })

  // ── Monthly chart (last 6 months) ───────────────────────────────────────────
  const last6 = useMemo(() => getLast6Months(), [])

  const { data: chartData } = useQuery({
    queryKey: ['dash-chart'],
    queryFn: async () => {
      if (!isOnline) return last6.map(m => ({ month: m.label, opd: 0, er: 0, ipd: 0, us: 0 }))

      // Fetch last 6 months data in parallel
      const results = await Promise.all(
        last6.map(async ({ label, year, month }) => {
          const startDate = `${year}-${String(month).padStart(2, '0')}-01`
          const endDate   = month === 12
            ? `${year + 1}-01-01`
            : `${year}-${String(month + 1).padStart(2, '0')}-01`

          const [opdRes, erRes, ipdRes, usRes] = await Promise.all([
            supabase.from('opd_tokens').select('id', { count: 'exact', head: true }).gte('date', startDate).lt('date', endDate),
            supabase.from('er_visits').select('id', { count: 'exact', head: true }).gte('visit_date', startDate).lt('visit_date', endDate),
            supabase.from('ipd_admissions').select('id', { count: 'exact', head: true }).gte('admit_date', startDate).lt('admit_date', endDate),
            supabase.from('ultrasound_reports').select('id', { count: 'exact', head: true }).gte('study_date', startDate).lt('study_date', endDate),
          ])

          return {
            month: label,
            opd: opdRes.count ?? 0,
            er:  erRes.count ?? 0,
            ipd: ipdRes.count ?? 0,
            us:  usRes.count ?? 0,
          }
        })
      )
      return results
    },
    staleTime: 1000 * 60 * 10, // 10 min cache
    enabled: isOnline,
  })

  const displayChart = chartData ?? last6.map(m => ({ month: m.label, opd: 0, er: 0, ipd: 0, us: 0 }))

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle={`Welcome back, ${user?.name || user?.email?.split('@')[0]}`}
      />

      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-8">
        <StatCard
          icon={ClipboardList}
          label="OPD Today"
          value={opdStats?.total ?? 0}
          sub={`${opdStats?.pending ?? 0} pending`}
          color="maroon"
          onClick={() => navigate('/opd')}
        />
        <StatCard
          icon={Users}
          label="ER Active"
          value={erStats?.total ?? 0}
          sub={`${erStats?.critical ?? 0} critical`}
          color="orange"
          onClick={() => navigate('/er')}
        />
        <StatCard
          icon={BedDouble}
          label="IPD Admitted"
          value={ipdStats?.admitted ?? 0}
          sub="active beds"
          color="blue"
          onClick={() => navigate('/ipd')}
        />
        <StatCard
          icon={Radio}
          label="US Today"
          value={usStats?.total ?? 0}
          sub={`${usStats?.draft ?? 0} draft`}
          color="purple"
          onClick={() => navigate('/ultrasound')}
        />
        <StatCard
          icon={Receipt}
          label="Today Revenue"
          value={formatCurrency(revenueStats?.total ?? 0)}
          sub={`${revenueStats?.count ?? 0} invoices`}
          color="green"
          onClick={() => navigate('/invoicing')}
        />
        <StatCard
          icon={TrendingUp}
          label="This Month"
          value={formatCurrency(monthRevenue ?? 0)}
          sub="collected"
          color="gold"
          onClick={() => navigate('/accounts')}
        />
      </div>

      {/* Chart */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-8">
        <h3 className="text-base font-semibold text-gray-800 mb-6">
          Monthly Patient Volume (Last 6 Months)
        </h3>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={displayChart} margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="month" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
            <Tooltip />
            <Legend />
            <Bar dataKey="opd" name="OPD"        fill="#8B0000" radius={[3, 3, 0, 0]} />
            <Bar dataKey="er"  name="ER"          fill="#EA580C" radius={[3, 3, 0, 0]} />
            <Bar dataKey="ipd" name="IPD"         fill="#7C3AED" radius={[3, 3, 0, 0]} />
            <Bar dataKey="us"  name="Ultrasound"  fill="#D4AF37" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'New OPD Token',    to: '/opd',            color: 'bg-maroon-500' },
          { label: 'ER Registration',  to: '/er',             color: 'bg-orange-500' },
          { label: 'IPD Admission',    to: '/ipd',            color: 'bg-blue-600'   },
          { label: 'New US Report',    to: '/ultrasound/new', color: 'bg-purple-600' },
        ].map((action) => (
          <a
            key={action.label}
            href={action.to}
            className={`${action.color} text-white text-center py-4 rounded-xl text-sm font-medium hover:opacity-90 transition-opacity`}
          >
            {action.label}
          </a>
        ))}
      </div>
    </div>
  )
}
