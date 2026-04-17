/**
 * Public-facing online appointment booking page.
 * No login required. Zero-cost WhatsApp confirmation flow.
 */
import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { AKMLogo } from '@/components/shared/AKMLogo'
import { supabase } from '@/lib/supabase/client'
import { generateUUID, todayString } from '@/lib/utils'
import { waHospitalLink } from '@/lib/whatsapp/links'
import type { Doctor } from '@/types'

// ── Doctor timing config — matched by lowercase name fragment ─────────────────
interface DoctorTimingConfig {
  match: string
  timings: string       // short display string for doctor card
  days: string          // availability days
  slots: string[]       // available booking slots
  note?: string
  fridaySlots?: string[] // override slots for Friday (Dr Fouzia)
  sessions?: { label: string; time: string; color: string }[] // separate session badges
}

const DOCTOR_TIMING_CONFIG: DoctorTimingConfig[] = [
  {
    match: 'fozia',
    timings: 'Noon 12:30–2:30 PM · Evening 7–10 PM',
    days: 'Mon–Sat (Fri: Evening only)',
    sessions: [
      { label: '🌤 Noon Session', time: '12:30 PM – 2:30 PM', color: 'bg-amber-50 border-amber-200 text-amber-800' },
      { label: '🌙 Evening Session', time: '7:00 PM – 10:00 PM', color: 'bg-indigo-50 border-indigo-200 text-indigo-800' },
    ],
    slots: [
      'Noon: 12:30 PM', 'Noon: 01:00 PM', 'Noon: 01:30 PM', 'Noon: 02:00 PM',
      'Evening: 07:00 PM', 'Evening: 07:30 PM', 'Evening: 08:00 PM',
      'Evening: 08:30 PM', 'Evening: 09:00 PM', 'Evening: 09:30 PM',
    ],
    fridaySlots: [
      'Evening: 07:00 PM', 'Evening: 07:30 PM', 'Evening: 08:00 PM',
      'Evening: 08:30 PM', 'Evening: 09:00 PM', 'Evening: 09:30 PM',
    ],
    note: 'Friday: Evening session only (7–10 PM)',
  },
  {
    match: 'ghazala',
    timings: 'Noon 2–4 PM · Evening 8–11 PM',
    days: 'Daily',
    slots: [
      'Noon: 02:00 PM', 'Noon: 02:30 PM', 'Noon: 03:00 PM', 'Noon: 03:30 PM',
      'Evening: 08:00 PM', 'Evening: 08:30 PM', 'Evening: 09:00 PM',
      'Evening: 09:30 PM', 'Evening: 10:00 PM', 'Evening: 10:30 PM',
    ],
  },
  {
    match: 'shazia',
    timings: 'Evening 6–7 PM',
    days: 'Daily',
    slots: ['Evening: 06:00 PM', 'Evening: 06:30 PM'],
  },
  {
    match: 'jamal',
    timings: 'Evening 8–9 PM',
    days: 'Daily',
    slots: ['Evening: 08:00 PM', 'Evening: 08:30 PM'],
  },
  {
    match: 'furqan',
    timings: 'Evening 8–10 PM',
    days: 'Daily',
    slots: [
      'Evening: 08:00 PM', 'Evening: 08:30 PM',
      'Evening: 09:00 PM', 'Evening: 09:30 PM',
    ],
  },
  {
    match: 'atqua',
    timings: 'Evening 6–9 PM',
    days: 'Daily',
    slots: [
      'Evening: 06:00 PM', 'Evening: 06:30 PM', 'Evening: 07:00 PM',
      'Evening: 07:30 PM', 'Evening: 08:00 PM', 'Evening: 08:30 PM',
    ],
  },
  {
    match: 'umar',
    timings: 'Mon 8–10 PM · On Call anytime',
    days: 'Monday + On Call',
    slots: [
      'Evening: 08:00 PM', 'Evening: 08:30 PM',
      'Evening: 09:00 PM', 'Evening: 09:30 PM',
    ],
    note: 'Also available on call any time',
  },
  {
    match: 'nouman',
    timings: 'Evening 9–10 PM',
    days: 'Daily',
    slots: ['Evening: 09:00 PM', 'Evening: 09:30 PM'],
  },
  {
    match: 'shafique',
    timings: '8 PM – 8 AM (Night Duty)',
    days: 'Daily',
    slots: [
      'Evening: 08:00 PM', 'Evening: 08:30 PM', 'Evening: 09:00 PM', 'Evening: 09:30 PM',
      'Evening: 10:00 PM', 'Evening: 10:30 PM', 'Evening: 11:00 PM', 'Evening: 11:30 PM',
      'Night: 12:00 AM', 'Night: 12:30 AM', 'Night: 01:00 AM', 'Night: 01:30 AM',
    ],
    note: 'Available through the night until 8 AM',
  },
  {
    match: 'waseem akram',
    timings: '8 AM – 8 PM',
    days: 'Mon–Sat (Closed Sunday)',
    slots: [
      'Morning: 08:00 AM', 'Morning: 08:30 AM', 'Morning: 09:00 AM', 'Morning: 09:30 AM',
      'Morning: 10:00 AM', 'Morning: 10:30 AM', 'Morning: 11:00 AM', 'Morning: 11:30 AM',
      'Noon: 12:00 PM', 'Noon: 12:30 PM', 'Noon: 01:00 PM', 'Noon: 01:30 PM',
      'Noon: 02:00 PM', 'Noon: 02:30 PM', 'Noon: 03:00 PM', 'Noon: 03:30 PM',
      'Evening: 04:00 PM', 'Evening: 04:30 PM', 'Evening: 05:00 PM', 'Evening: 05:30 PM',
      'Evening: 06:00 PM', 'Evening: 06:30 PM', 'Evening: 07:00 PM', 'Evening: 07:30 PM',
    ],
  },
]

// All slots shown when no specific doctor is selected
const ALL_SLOTS = [
  'Noon: 12:30 PM', 'Noon: 01:00 PM', 'Noon: 01:30 PM', 'Noon: 02:00 PM',
  'Noon: 02:30 PM', 'Noon: 03:00 PM', 'Noon: 03:30 PM',
  'Evening: 04:00 PM', 'Evening: 04:30 PM', 'Evening: 05:00 PM', 'Evening: 05:30 PM',
  'Evening: 06:00 PM', 'Evening: 06:30 PM', 'Evening: 07:00 PM', 'Evening: 07:30 PM',
  'Evening: 08:00 PM', 'Evening: 08:30 PM', 'Evening: 09:00 PM', 'Evening: 09:30 PM',
  'Evening: 10:00 PM', 'Evening: 10:30 PM',
]

function getDoctorConfig(name: string): DoctorTimingConfig | undefined {
  return DOCTOR_TIMING_CONFIG.find((c) => name.toLowerCase().includes(c.match))
}

function getSlotsForDoctor(
  doctorId: string | undefined,
  doctors: Pick<Doctor, 'id' | 'name' | 'specialty'>[],
  date: string,
): string[] {
  if (!doctorId) return ALL_SLOTS
  const doctor = doctors.find((d) => d.id === doctorId)
  if (!doctor) return ALL_SLOTS
  const config = getDoctorConfig(doctor.name)
  if (!config) return ALL_SLOTS
  // Friday: use fridaySlots override if defined
  if (config.fridaySlots) {
    const day = new Date(date + 'T12:00:00').getDay() // 5 = Friday (PKT safe with noon time)
    if (day === 5) return config.fridaySlots
  }
  return config.slots
}

// ── Zod schema ────────────────────────────────────────────────────────────────
const bookingSchema = z.object({
  patient_name: z.string().min(2, 'Full name required'),
  phone: z.string().min(10, 'Valid Pakistani phone number required'),
  doctor_id: z.string().optional(),
  department: z.enum(['opd', 'ultrasound']),
  preferred_date: z.string().min(1, 'Date required'),
  preferred_time_slot: z.string().min(1, 'Time slot required'),
  chief_complaint: z.string().optional(),
  is_new_patient: z.boolean().optional(),
})

type BookingForm = z.infer<typeof bookingSchema>

interface ConfirmedBooking {
  name: string; phone: string; doctor: string; date: string; slot: string; dept: string
}

// ── Component ─────────────────────────────────────────────────────────────────
export function BookAppointmentPage() {
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [confirmed, setConfirmed] = useState<ConfirmedBooking | null>(null)

  const { data: doctors = [] } = useQuery({
    queryKey: ['doctors-public'],
    queryFn: async () => {
      const { data } = await supabase
        .from('doctors')
        .select('id, name, specialty')
        .eq('is_active', true)
        .order('name')
      return (data ?? []) as Pick<Doctor, 'id' | 'name' | 'specialty'>[]
    },
  })

  const { register, handleSubmit, watch, formState: { errors } } = useForm<BookingForm>({
    resolver: zodResolver(bookingSchema),
    defaultValues: {
      department: 'opd',
      preferred_date: todayString(),
      is_new_patient: false,
    },
  })

  const dept = watch('department')
  const selectedDoctorId = watch('doctor_id')
  const selectedDate = watch('preferred_date') || todayString()

  const filteredDoctors = dept === 'ultrasound'
    ? doctors.filter((d) => d.specialty?.toLowerCase().includes('radio') || d.specialty?.toLowerCase().includes('ultra'))
    : doctors

  const availableSlots = getSlotsForDoctor(selectedDoctorId, doctors, selectedDate)

  const mutation = useMutation({
    mutationFn: async (data: BookingForm) => {
      const doc = doctors.find((d) => d.id === data.doctor_id)
      const { error } = await supabase.from('online_bookings').insert({
        id: generateUUID(),
        patient_name: data.patient_name,
        phone: data.phone,
        doctor_id: data.doctor_id || null,
        department: data.department,
        preferred_date: data.preferred_date,
        preferred_time_slot: data.preferred_time_slot,
        chief_complaint: data.chief_complaint || null,
        is_new_patient: data.is_new_patient ?? false,
        status: 'pending',
        rejection_reason: null,
        token_id: null,
      })
      if (error) throw error
      return {
        name: data.patient_name,
        phone: data.phone,
        doctor: doc?.name ?? 'Any Available Doctor',
        date: data.preferred_date,
        slot: data.preferred_time_slot,
        dept: data.department === 'opd' ? 'OPD' : 'Ultrasound',
      }
    },
    onSuccess: (result) => {
      setConfirmed(result)
      setStep(3)
    },
  })

  const waConfirmLink = confirmed
    ? waHospitalLink(
        `Appointment Request\nName: ${confirmed.name}\nDoctor: ${confirmed.doctor}\nDate: ${confirmed.date}\nTime: ${confirmed.slot}\nDept: ${confirmed.dept}`
      )
    : '#'

  const hospitalPhone = import.meta.env.VITE_HOSPITAL_PHONE || '+92-42-XXXXXXX'

  return (
    <div className="min-h-screen bg-gradient-to-b from-maroon-50 to-white">
      {/* Header */}
      <header className="bg-maroon-500 text-white py-6 px-4 text-center">
        <div className="flex justify-center mb-3">
          <AKMLogo size={64} />
        </div>
        <h1 className="text-2xl font-bold">Alim Khatoon Medicare</h1>
        <p className="text-white/70 text-sm mt-1">Green Town, Lahore, Pakistan</p>
        <p className="text-white/90 font-semibold mt-1">Book an Appointment</p>
      </header>

      {/* Emergency 24/7 Banner */}
      <div className="max-w-xl mx-auto px-4 pt-6">
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-red-600 to-red-700 text-white shadow-lg">
          <div className="absolute inset-0 opacity-10"
            style={{ backgroundImage: 'repeating-linear-gradient(45deg, #fff 0, #fff 1px, transparent 0, transparent 50%)', backgroundSize: '8px 8px' }}
          />
          <div className="relative flex items-center gap-4 px-5 py-4">
            <div className="flex-shrink-0 w-12 h-12 bg-white/20 rounded-full flex items-center justify-center text-2xl animate-pulse">
              🚨
            </div>
            <div className="flex-1">
              <p className="font-bold text-lg leading-tight">Emergency — Available 24/7</p>
              <p className="text-white/85 text-sm mt-0.5">
                For emergencies, do not book online — walk in or call immediately.
              </p>
            </div>
            <a
              href={`tel:${hospitalPhone}`}
              className="flex-shrink-0 bg-white text-red-600 font-bold text-sm px-4 py-2 rounded-xl hover:bg-red-50 transition-colors shadow"
            >
              Call Now
            </a>
          </div>
        </div>
      </div>

      {/* Our Doctors */}
      {doctors.length > 0 && (
        <div className="max-w-xl mx-auto px-4 pt-8 pb-2">
          <h2 className="text-base font-bold text-gray-800 mb-3 text-center">Our Doctors &amp; Timings</h2>
          <div className="space-y-2">
            {doctors.map((d) => {
              const config = getDoctorConfig(d.name)
              return (
                <div key={d.id} className="bg-white border border-gray-200 rounded-xl p-3 flex items-start gap-3 shadow-sm">
                  <div className="w-10 h-10 rounded-full bg-maroon-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="text-maroon-600 font-bold text-sm">{d.name.charAt(0)}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-gray-800">{d.name}</p>
                      {config?.days && (
                        <span className="text-xs bg-maroon-50 text-maroon-600 px-2 py-0.5 rounded-full font-medium flex-shrink-0">
                          {config.days}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500">{d.specialty}</p>
                    {config?.sessions ? (
                      <div className="flex flex-wrap gap-1.5 mt-1.5">
                        {config.sessions.map(s => (
                          <span key={s.label} className={`inline-flex items-center gap-1 text-xs font-semibold border rounded-lg px-2 py-1 ${s.color}`}>
                            {s.label} <span className="opacity-70">·</span> {s.time}
                          </span>
                        ))}
                      </div>
                    ) : config ? (
                      <p className="text-xs text-maroon-700 font-medium mt-0.5">🕐 {config.timings}</p>
                    ) : null}
                    {config?.note && (
                      <p className="text-xs text-orange-600 mt-0.5 font-medium">⚠ {config.note}</p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="max-w-xl mx-auto px-4 py-8">
        {/* Step 3 — Confirmation */}
        {step === 3 && confirmed ? (
          <div className="text-center">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-gray-800 mb-2">Request Received!</h2>
            <p className="text-gray-600 mb-6">
              Your appointment request has been received. Please send us a WhatsApp message to confirm your slot.
            </p>

            <div className="bg-gray-50 rounded-xl border border-gray-200 p-4 text-left text-sm mb-6 space-y-2">
              <p><strong>Name:</strong> {confirmed.name}</p>
              <p><strong>Department:</strong> {confirmed.dept}</p>
              <p><strong>Doctor:</strong> {confirmed.doctor}</p>
              <p><strong>Date:</strong> {confirmed.date}</p>
              <p><strong>Time:</strong> {confirmed.slot}</p>
            </div>

            <a
              href={waConfirmLink}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-3 bg-[#25D366] hover:bg-[#20b558] text-white font-semibold py-4 px-6 rounded-xl text-base w-full transition-colors mb-4"
            >
              <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/>
              </svg>
              Confirm via WhatsApp
            </a>

            <p className="text-sm text-gray-500">
              Or call us: <a href={`tel:${hospitalPhone}`} className="text-maroon-600 font-semibold">{hospitalPhone}</a>
            </p>
          </div>

        ) : (
          /* Booking Form */
          <form onSubmit={handleSubmit((d) => mutation.mutate(d))} className="space-y-5">
            {/* Department */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-3">Step 1 — Select Department</label>
              <div className="grid grid-cols-2 gap-3">
                {(['opd', 'ultrasound'] as const).map((d) => (
                  <label key={d} className="cursor-pointer">
                    <input type="radio" {...register('department')} value={d} className="sr-only peer" />
                    <div className="border-2 rounded-xl p-4 text-center peer-checked:border-maroon-500 peer-checked:bg-maroon-50 hover:bg-gray-50 transition-colors">
                      <p className="font-semibold text-gray-800">{d === 'opd' ? 'OPD Appointment' : 'Ultrasound'}</p>
                      <p className="text-xs text-gray-500 mt-1">{d === 'opd' ? 'General / Specialist' : 'All US studies'}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* Patient details */}
            <div className="space-y-4">
              <label className="block text-sm font-semibold text-gray-700">Step 2 — Your Details</label>

              <div>
                <label className="block text-sm text-gray-600 mb-1">Full Name *</label>
                <input {...register('patient_name')} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-maroon-500" placeholder="Your full name" />
                {errors.patient_name && <p className="text-xs text-red-600 mt-1">{errors.patient_name.message}</p>}
              </div>

              <div>
                <label className="block text-sm text-gray-600 mb-1">Phone Number *</label>
                <input {...register('phone')} type="tel" className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-maroon-500" placeholder="03XX-XXXXXXX" />
                {errors.phone && <p className="text-xs text-red-600 mt-1">{errors.phone.message}</p>}
              </div>

              <div>
                <label className="block text-sm text-gray-600 mb-1">Select Doctor</label>
                <select {...register('doctor_id')} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-maroon-500">
                  <option value="">Any Available Doctor</option>
                  {filteredDoctors.map((d) => {
                    const config = getDoctorConfig(d.name)
                    return (
                      <option key={d.id} value={d.id}>
                        {d.name}{config ? ` — ${config.timings}` : ` — ${d.specialty}`}
                      </option>
                    )
                  })}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Preferred Date *</label>
                  <input
                    {...register('preferred_date')}
                    type="date"
                    min={todayString()}
                    className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-maroon-500"
                  />
                  {errors.preferred_date && <p className="text-xs text-red-600 mt-1">{errors.preferred_date.message}</p>}
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Time Slot *</label>
                  <select {...register('preferred_time_slot')} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-maroon-500">
                    <option value="">Select</option>
                    {availableSlots.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                  {errors.preferred_time_slot && <p className="text-xs text-red-600 mt-1">{errors.preferred_time_slot.message}</p>}
                </div>
              </div>

              {/* Timing hint when a doctor is selected */}
              {selectedDoctorId && (() => {
                const doc = doctors.find(d => d.id === selectedDoctorId)
                const config = doc ? getDoctorConfig(doc.name) : undefined
                if (!config) return null
                return (
                  <div className="bg-maroon-50 border border-maroon-100 rounded-lg px-3 py-2 text-xs text-maroon-700">
                    <span className="font-semibold">{doc!.name}</span> — {config.days}
                    {config.sessions ? (
                      <div className="flex flex-wrap gap-1.5 mt-1.5">
                        {config.sessions.map(s => (
                          <span key={s.label} className={`inline-flex items-center gap-1 text-xs font-semibold border rounded-lg px-2 py-1 ${s.color}`}>
                            {s.label} · {s.time}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span> — {config.timings}</span>
                    )}
                    {config.note && <span className="block text-orange-600 font-medium mt-0.5">⚠ {config.note}</span>}
                  </div>
                )
              })()}

              <div>
                <label className="block text-sm text-gray-600 mb-1">Reason / Complaint</label>
                <textarea {...register('chief_complaint')} rows={3} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-maroon-500" placeholder="Briefly describe your complaint..." />
              </div>

              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input {...register('is_new_patient')} type="checkbox" className="rounded border-gray-300 text-maroon-500" />
                I am a new patient
              </label>
            </div>

            {mutation.isError && (
              <p className="text-sm text-red-600 bg-red-50 px-4 py-2 rounded-lg">
                Something went wrong. Please try again or call us.
              </p>
            )}

            <button
              type="submit"
              disabled={mutation.isPending}
              className="w-full bg-maroon-500 hover:bg-maroon-600 disabled:bg-maroon-300 text-white font-semibold py-3 rounded-xl transition-colors"
            >
              {mutation.isPending ? 'Submitting...' : 'Submit Appointment Request →'}
            </button>

            <p className="text-center text-sm text-gray-500">
              Need immediate help? Call{' '}
              <a href={`tel:${hospitalPhone}`} className="text-maroon-600 font-semibold">{hospitalPhone}</a>
            </p>
          </form>
        )}
      </div>

      <footer className="text-center py-6 text-xs text-gray-400 border-t border-gray-200">
        © 2026 Alim Khatoon Medicare · Green Town, Lahore · All rights reserved
      </footer>
    </div>
  )
}
