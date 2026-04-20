import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { useEffect } from 'react'
import { queryClient } from '@/lib/queryClient'
import { Layout } from '@/components/layout/Layout'
import { ProtectedRoute } from '@/modules/auth/ProtectedRoute'
import { LoginPage } from '@/modules/auth/LoginPage'
import { initSyncListeners } from '@/lib/sync/engine'
import { initAuthListener } from '@/store/authStore'

// Lazy-loaded module pages (improves initial load time)
import { lazy, Suspense } from 'react'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'

const Dashboard       = lazy(() => import('@/modules/admin/DashboardPage').then(m => ({ default: m.DashboardPage })))
const PatientsPage    = lazy(() => import('@/modules/patients/PatientsPage').then(m => ({ default: m.PatientsPage })))
const OpdPage         = lazy(() => import('@/modules/opd/OpdPage').then(m => ({ default: m.OpdPage })))
const OpdQueuePage    = lazy(() => import('@/modules/opd/OpdQueuePage').then(m => ({ default: m.OpdQueuePage })))
const ErPage          = lazy(() => import('@/modules/er/ErPage').then(m => ({ default: m.ErPage })))
const IpdPage         = lazy(() => import('@/modules/ipd/IpdPage').then(m => ({ default: m.IpdPage })))
const UltrasoundPage  = lazy(() => import('@/modules/ultrasound/UltrasoundPage').then(m => ({ default: m.UltrasoundPage })))
const UltrasoundReportEditor = lazy(() => import('@/modules/ultrasound/ReportEditorPage').then(m => ({ default: m.ReportEditorPage })))
const InvoicingPage   = lazy(() => import('@/modules/invoicing/InvoicingPage').then(m => ({ default: m.InvoicingPage })))
const InvoiceDetail   = lazy(() => import('@/modules/invoicing/InvoiceDetailPage').then(m => ({ default: m.InvoiceDetailPage })))
const CertificatesPage = lazy(() => import('@/modules/certificates/CertificatesPage').then(m => ({ default: m.CertificatesPage })))
const AccountsPage    = lazy(() => import('@/modules/accounts/AccountsPage').then(m => ({ default: m.AccountsPage })))
const BookingsPage    = lazy(() => import('@/modules/portal/BookingsPage').then(m => ({ default: m.BookingsPage })))
const BookAppointment = lazy(() => import('@/modules/portal/BookAppointmentPage').then(m => ({ default: m.BookAppointmentPage })))
const DoctorsPage     = lazy(() => import('@/modules/admin/DoctorsPage').then(m => ({ default: m.DoctorsPage })))
const AdminPage       = lazy(() => import('@/modules/admin/AdminPage').then(m => ({ default: m.AdminPage })))
const HrPage          = lazy(() => import('@/modules/hr/HrPage').then(m => ({ default: m.HrPage })))
const UnauthorizedPage = lazy(() => import('@/modules/auth/UnauthorizedPage').then(m => ({ default: m.UnauthorizedPage })))

function PageFallback() {
  return (
    <div className="flex items-center justify-center h-64">
      <LoadingSpinner label="Loading module..." />
    </div>
  )
}

function AppRoutes() {
  useEffect(() => {
    initSyncListeners()
    const cleanupAuth = initAuthListener()
    return cleanupAuth
  }, [])

  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        {/* Public routes */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/book-appointment" element={<BookAppointment />} />
        <Route path="/unauthorized" element={<UnauthorizedPage />} />
        <Route path="/opd/queue" element={<OpdQueuePage />} />

        {/* Protected app routes */}
        <Route element={<ProtectedRoute />}>
          <Route element={<Layout />}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/patients" element={<PatientsPage />} />

            {/* OPD */}
            <Route element={<ProtectedRoute permission="canAccessOPD" />}>
              <Route path="/opd" element={<OpdPage />} />
            </Route>

            {/* ER */}
            <Route element={<ProtectedRoute permission="canAccessER" />}>
              <Route path="/er" element={<ErPage />} />
            </Route>

            {/* IPD */}
            <Route element={<ProtectedRoute permission="canAccessIPD" />}>
              <Route path="/ipd" element={<IpdPage />} />
            </Route>

            {/* Ultrasound */}
            <Route element={<ProtectedRoute permission="canAccessUltrasound" />}>
              <Route path="/ultrasound" element={<UltrasoundPage />} />
              <Route path="/ultrasound/new" element={<UltrasoundReportEditor />} />
              <Route path="/ultrasound/:id/edit" element={<UltrasoundReportEditor />} />
            </Route>

            {/* Invoicing */}
            <Route element={<ProtectedRoute permission="canAccessInvoicing" />}>
              <Route path="/invoicing" element={<InvoicingPage />} />
              <Route path="/invoicing/:id" element={<InvoiceDetail />} />
            </Route>

            {/* Certificates */}
            <Route element={<ProtectedRoute permission="canAccessCertificates" />}>
              <Route path="/certificates" element={<CertificatesPage />} />
            </Route>

            {/* Accounts */}
            <Route element={<ProtectedRoute permission="canAccessAccounts" />}>
              <Route path="/accounts" element={<AccountsPage />} />
            </Route>

            {/* Online bookings (admin panel) */}
            <Route element={<ProtectedRoute permission="canAccessPortal" />}>
              <Route path="/bookings" element={<BookingsPage />} />
            </Route>

            {/* HR */}
            <Route element={<ProtectedRoute permission="canAccessHR" />}>
              <Route path="/hr" element={<HrPage />} />
            </Route>

            {/* Admin */}
            <Route element={<ProtectedRoute permission="canAccessAdmin" />}>
              <Route path="/admin" element={<AdminPage />} />
            </Route>

            {/* Doctors management */}
            <Route element={<ProtectedRoute permission="canManageDoctors" />}>
              <Route path="/doctors" element={<DoctorsPage />} />
            </Route>
          </Route>
        </Route>

        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Suspense>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </QueryClientProvider>
  )
}
