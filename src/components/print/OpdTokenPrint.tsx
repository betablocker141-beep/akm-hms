/**
 * OPD Token Print Template
 * Works for both thermal 80mm and A4.
 * Include this inside a ref passed to react-to-print.
 */
import { AKMLogo } from '@/components/shared/AKMLogo'
import { formatDate, calculateAge } from '@/lib/utils'
import type { OpdToken, Patient, Doctor } from '@/types'

interface OpdTokenPrintProps {
  token: OpdToken
  patient?: Patient
  doctor?: Doctor
  fee?: number
  size?: 'thermal' | 'a4'
}

export function OpdTokenPrint({ token, patient, doctor, fee, size = 'thermal' }: OpdTokenPrintProps) {
  const hospitalPhone = import.meta.env.VITE_HOSPITAL_PHONE || '042-35977450'
  const hospitalAddress = import.meta.env.VITE_HOSPITAL_ADDRESS || '362-6-C2, Green Town, Lahore'

  const hasVitals =
    (token.bp != null && token.bp !== '') ||
    (token.pulse != null) ||
    (token.temp != null) ||
    (token.spo2 != null) ||
    (token.rr != null)

  return (
    <div
      className="print-area bg-white font-sans"
      style={{
        width: size === 'thermal' ? '72mm' : '148mm',
        padding: '6mm',
        border: '1px solid #e5e7eb',
        borderRadius: '4px',
      }}
    >
      {/* Header */}
      <div className="text-center border-b-2 border-maroon-500 pb-3 mb-3">
        <div className="flex justify-center mb-2">
          <AKMLogo size={40} />
        </div>
        <h2 className="text-sm font-bold text-maroon-500 leading-tight">
          ALIM KHATOON MEDICARE
        </h2>
        <p className="text-xs text-gray-600">{hospitalAddress}</p>
        <p className="text-xs text-gray-500">Tel: {hospitalPhone}</p>
        <p className="text-xs font-semibold text-maroon-500 mt-0.5">
          ── OUTPATIENT DEPARTMENT ──
        </p>
      </div>

      {/* Token number — big */}
      <div className="text-center my-4">
        <p className="text-xs text-gray-500 uppercase tracking-widest">Token Number</p>
        <p className="text-4xl font-bold text-maroon-500 leading-none mt-1">
          {token.token_number}
        </p>
      </div>

      {/* Divider */}
      <div className="border-t border-dashed border-gray-300 my-3" />

      {/* Details */}
      <div className="space-y-1.5 text-xs">
        <DetailRow label="Patient" value={patient?.name ?? '—'} bold />
        <DetailRow label="Age" value={patient ? `${calculateAge(patient.dob)} / ${patient.gender}` : '—'} bold />
        <DetailRow label="MRN" value={patient?.mrn ?? '—'} />
        <DetailRow label="Doctor" value={doctor?.name ?? '—'} />
        <DetailRow label="Specialty" value={doctor?.specialty ?? '—'} />
        <DetailRow label="Date" value={formatDate(token.date)} />
        <DetailRow
          label="Issued At"
          value={token.time_slot ?? new Date(token.created_at).toLocaleTimeString('en-PK', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
          })}
        />
        <DetailRow label="Type" value={token.type.replace('_', ' ')} />
      </div>

      {/* Vitals */}
      {hasVitals && (
        <>
          <div className="border-t border-dashed border-gray-300 my-3" />
          <div className="mb-2">
            <p className="text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Vitals</p>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              {token.bp != null && token.bp !== '' && (
                <div className="flex justify-between">
                  <span className="text-gray-500">BP:</span>
                  <span className="font-medium">{token.bp} mmHg</span>
                </div>
              )}
              {token.pulse != null && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Pulse:</span>
                  <span className="font-medium">{token.pulse} bpm</span>
                </div>
              )}
              {token.temp != null && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Temp:</span>
                  <span className="font-medium">{token.temp} °F</span>
                </div>
              )}
              {token.spo2 != null && (
                <div className="flex justify-between">
                  <span className="text-gray-500">SpO2:</span>
                  <span className="font-medium">{token.spo2}%</span>
                </div>
              )}
              {token.rr != null && (
                <div className="flex justify-between">
                  <span className="text-gray-500">RR:</span>
                  <span className="font-medium">{token.rr}/min</span>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Divider */}
      <div className="border-t border-dashed border-gray-300 my-3" />

      {/* Payment */}
      {fee !== undefined && fee > 0 && (
        <div className="bg-green-50 border border-green-200 rounded px-3 py-2 mb-3">
          <div className="flex justify-between items-center text-xs font-semibold">
            <span className="text-green-700">✔ Payment Received</span>
            <span className="text-green-800 text-sm">Rs. {fee.toLocaleString()}</span>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="text-center text-xs text-gray-500 space-y-0.5">
        <p className="font-medium text-maroon-500">Thank you for visiting Alim Khatoon Medicare</p>
        <p>Helpline: {hospitalPhone}</p>
        <p className="text-gray-400 mt-1">
          Issued: {new Date().toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>
    </div>
  )
}

function DetailRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex justify-between gap-2">
      <span className={`flex-shrink-0 ${bold ? 'text-gray-700 font-semibold' : 'text-gray-500 font-medium'}`}>{label}:</span>
      <span className={`text-right ${bold ? 'text-gray-900 font-semibold' : 'text-gray-800'}`}>{value}</span>
    </div>
  )
}
