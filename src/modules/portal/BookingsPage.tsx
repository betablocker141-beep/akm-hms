/**
 * Admin panel — Pending Online Bookings
 * Receptionist confirms/rejects, then uses WA quick-send buttons.
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, X, MessageCircle, Copy, ExternalLink } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { WAButton } from '@/components/shared/WAButton'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'
import { supabase } from '@/lib/supabase/client'
import { formatDate } from '@/lib/utils'
import {
  waBookingConfirmedPatient,
  waBookingConfirmedDoctor,
  waBookingRejectedPatient,
} from '@/lib/whatsapp/links'
import type { OnlineBooking, Doctor } from '@/types'

interface ConfirmedAction {
  booking: OnlineBooking
  tokenNumber: string
  doctor?: Doctor
}

async function fetchBookings(): Promise<OnlineBooking[]> {
  const { data, error } = await supabase
    .from('online_bookings')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data as OnlineBooking[]
}

async function fetchDoctors(): Promise<Doctor[]> {
  const { data } = await supabase.from('doctors').select('*').eq('is_active', true).order('name')
  return (data ?? []) as Doctor[]
}

export function BookingsPage() {
  const [filter, setFilter] = useState<'all' | 'pending' | 'confirmed' | 'rejected'>('pending')
  const [rejectId, setRejectId] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [confirmedAction, setConfirmedAction] = useState<ConfirmedAction | null>(null)
  const [tokenInputBooking, setTokenInputBooking] = useState<OnlineBooking | null>(null)
  const [manualToken, setManualToken] = useState('')
  const qc = useQueryClient()

  const { data: bookings = [], isLoading } = useQuery({ queryKey: ['online-bookings'], queryFn: fetchBookings, refetchInterval: 30_000 })
  const { data: doctors = [] } = useQuery({ queryKey: ['doctors-active'], queryFn: fetchDoctors })

  const filtered = filter === 'all' ? bookings : bookings.filter((b) => b.status === filter)

  const confirmMutation = useMutation({
    mutationFn: async ({ booking, tokenNumber }: { booking: OnlineBooking; tokenNumber: string }) => {
      const { error } = await supabase
        .from('online_bookings')
        .update({ status: 'confirmed' })
        .eq('id', booking.id)
      if (error) throw error
      return { booking, tokenNumber, doctor: doctors.find((d) => d.id === booking.doctor_id) }
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['online-bookings'] })
      setTokenInputBooking(null)
      setManualToken('')
      setConfirmedAction(result)
    },
    onError: (err) => {
      alert('Failed to confirm booking: ' + String(err))
    },
  })

  const rejectMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      await supabase.from('online_bookings').update({ status: 'rejected', rejection_reason: reason || null }).eq('id', id)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['online-bookings'] })
      setRejectId(null)
      setRejectReason('')
    },
  })

  const pendingCount = bookings.filter((b) => b.status === 'pending').length
  const bookingUrl = `${window.location.origin}/book-appointment`
  const [copied, setCopied] = useState(false)

  const copyLink = () => {
    navigator.clipboard.writeText(bookingUrl).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div>
      <PageHeader
        title="Online Bookings"
        subtitle={pendingCount > 0 ? `${pendingCount} pending approval` : 'No pending bookings'}
      />

      {/* Patient booking link card */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <p className="text-sm font-semibold text-blue-800 mb-1 flex items-center gap-1.5">
            <Link className="w-4 h-4" /> Patient Booking Link
          </p>
          <p className="text-xs text-blue-600 mb-2">Share this URL with patients to book appointments online.</p>
          <code className="text-xs font-mono text-blue-700 bg-blue-100 px-2 py-1 rounded">{bookingUrl}</code>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <button
            onClick={copyLink}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            <Copy className="w-4 h-4" />
            {copied ? 'Copied!' : 'Copy Link'}
          </button>
          <a
            href={bookingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 border border-blue-300 text-blue-700 hover:bg-blue-100 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            <ExternalLink className="w-4 h-4" /> Preview
          </a>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 mb-6">
        {(['pending', 'confirmed', 'rejected', 'all'] as const).map((f) => {
          const count = f === 'all' ? bookings.length : bookings.filter(b => b.status === f).length
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-2 rounded-lg text-sm font-medium capitalize transition-colors ${
                filter === f ? 'bg-maroon-500 text-white' : 'bg-white border border-gray-300 text-gray-600 hover:bg-gray-50'
              } ${f === 'pending' && count > 0 ? 'ring-2 ring-amber-400' : ''}`}
            >
              {f} ({count})
            </button>
          )
        })}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><LoadingSpinner label="Loading bookings..." /></div>
      ) : (
        <div className="space-y-3">
          {filtered.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 py-12 text-center text-gray-400">
              No {filter !== 'all' ? filter : ''} bookings.
            </div>
          ) : filtered.map((booking) => {
            const doc = doctors.find((d) => d.id === booking.doctor_id)
            return (
              <div key={booking.id} className="bg-white rounded-xl border border-gray-200 p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="font-semibold text-gray-800">{booking.patient_name}</h3>
                      <StatusBadge status={booking.status} />
                      <span className="text-xs font-semibold text-purple-600 uppercase">{booking.department}</span>
                      {booking.is_new_patient && (
                        <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded">New Patient</span>
                      )}
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm text-gray-600">
                      <div><span className="text-gray-400">Phone: </span>{booking.phone}</div>
                      <div><span className="text-gray-400">Doctor: </span>{doc?.name ?? 'Any'}</div>
                      <div><span className="text-gray-400">Date: </span>{formatDate(booking.preferred_date)}</div>
                      <div><span className="text-gray-400">Time: </span>{booking.preferred_time_slot}</div>
                    </div>
                    {booking.chief_complaint && (
                      <p className="text-sm text-gray-500 mt-2 italic">"{booking.chief_complaint}"</p>
                    )}
                    {booking.rejection_reason && (
                      <p className="text-sm text-red-500 mt-1">Rejection: {booking.rejection_reason}</p>
                    )}
                    <p className="text-xs text-gray-400 mt-2">
                      Received: {formatDate(booking.created_at)}
                    </p>
                  </div>

                  {/* Actions */}
                  {booking.status === 'pending' && (
                    <div className="flex flex-col gap-2 flex-shrink-0">
                      <button
                        onClick={() => { setTokenInputBooking(booking); setManualToken('') }}
                        className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
                      >
                        <Check className="w-4 h-4" /> Assign Token
                      </button>
                      <button
                        onClick={() => setRejectId(booking.id)}
                        className="flex items-center gap-2 bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 px-4 py-2 rounded-lg text-sm"
                      >
                        <X className="w-4 h-4" /> Reject
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Manual token assignment modal */}
      {tokenInputBooking && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-sm shadow-2xl p-6">
            <h2 className="font-semibold text-gray-800 mb-1">Assign Token Number</h2>
            <p className="text-sm text-gray-500 mb-4">
              Enter the token number for <strong>{tokenInputBooking.patient_name}</strong>. Reception decides the number based on current queue.
            </p>
            <input
              type="text"
              value={manualToken}
              onChange={(e) => setManualToken(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && manualToken.trim()) {
                  confirmMutation.mutate({ booking: tokenInputBooking, tokenNumber: manualToken.trim() })
                }
              }}
              autoFocus
              placeholder="e.g. 5  or  A-12  or  OPD-07"
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 mb-4 text-center text-lg font-bold tracking-widest"
            />
            <div className="flex gap-3">
              <button
                onClick={() => { setTokenInputBooking(null); setManualToken('') }}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (manualToken.trim()) {
                    confirmMutation.mutate({ booking: tokenInputBooking, tokenNumber: manualToken.trim() })
                  }
                }}
                disabled={!manualToken.trim() || confirmMutation.isPending}
                className="flex-1 flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
              >
                <Check className="w-4 h-4" />
                {confirmMutation.isPending ? 'Confirming...' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reject reason modal */}
      {rejectId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-md shadow-2xl p-6">
            <h2 className="font-semibold text-gray-800 mb-4">Reject Booking</h2>
            <label className="block text-sm text-gray-700 mb-1">Reason (optional)</label>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500 mb-4"
              placeholder="e.g. Doctor not available on that date..."
            />
            <div className="flex gap-3 justify-end">
              <button onClick={() => setRejectId(null)} className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">Cancel</button>
              <button
                onClick={() => {
                  const b = bookings.find((bk) => bk.id === rejectId)
                  rejectMutation.mutate({ id: rejectId, reason: rejectReason })
                  if (b) {
                    window.open(waBookingRejectedPatient({ name: b.patient_name, phone: b.phone, reason: rejectReason }), '_blank')
                  }
                }}
                disabled={rejectMutation.isPending}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm disabled:opacity-50"
              >
                Reject & Notify
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmed — WA quick-send */}
      {confirmedAction && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-md shadow-2xl p-6">
            <div className="text-center mb-4">
              <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <Check className="w-6 h-6 text-green-600" />
              </div>
              <h2 className="font-semibold text-gray-800">Token Confirmed!</h2>
              <p className="text-sm text-gray-500 mt-1">
                Token <strong>{confirmedAction.tokenNumber}</strong> issued for {confirmedAction.booking.patient_name}
              </p>
            </div>

            <div className="space-y-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Send WhatsApp Notifications:</p>

              <WAButton
                href={waBookingConfirmedPatient({
                  name: confirmedAction.booking.patient_name,
                  tokenNumber: confirmedAction.tokenNumber,
                  doctor: confirmedAction.doctor?.name ?? 'Doctor',
                  date: formatDate(confirmedAction.booking.preferred_date),
                  time: confirmedAction.booking.preferred_time_slot,
                  phone: confirmedAction.booking.phone,
                })}
                label={`Notify Patient: ${confirmedAction.booking.patient_name}`}
                className="w-full justify-center"
              />

              {confirmedAction.doctor?.whatsapp_number && (
                <WAButton
                  href={waBookingConfirmedDoctor({
                    patientName: confirmedAction.booking.patient_name,
                    tokenNumber: confirmedAction.tokenNumber,
                    date: formatDate(confirmedAction.booking.preferred_date),
                    time: confirmedAction.booking.preferred_time_slot,
                    doctorWhatsapp: confirmedAction.doctor.whatsapp_number,
                  })}
                  label={`Notify Doctor: ${confirmedAction.doctor.name}`}
                  className="w-full justify-center"
                />
              )}

              <button
                onClick={() => setConfirmedAction(null)}
                className="w-full text-sm text-gray-500 hover:text-gray-700 py-2"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
