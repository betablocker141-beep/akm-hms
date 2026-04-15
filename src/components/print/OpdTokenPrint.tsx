/**
 * OPD Token Print Template — compact thermal version (saves ~40% paper)
 */
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

  return (
    <div
      className="print-area bg-white font-sans"
      style={{
        width: size === 'thermal' ? '72mm' : '148mm',
        padding: '3mm',
        border: '1px solid #e5e7eb',
        borderRadius: '4px',
        fontSize: '9pt',
      }}
    >
      {/* Header */}
      <div className="text-center pb-1.5 mb-1.5" style={{ borderBottom: '2px solid #8B0000' }}>
        <p className="font-bold leading-tight" style={{ color: '#8B0000', fontSize: '10pt' }}>
          ALIM KHATOON MEDICARE
        </p>
        <p style={{ fontSize: '7pt', color: '#555' }}>── OPD TOKEN ──</p>
      </div>

      {/* Token number */}
      <div className="text-center my-1.5">
        <p style={{ fontSize: '7pt', color: '#888', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Token</p>
        <p className="font-bold leading-none mt-0.5" style={{ fontSize: '28pt', color: '#8B0000' }}>
          {token.token_number}
        </p>
      </div>

      <div style={{ borderTop: '1px dashed #ccc', margin: '4px 0' }} />

      {/* Details */}
      <div style={{ lineHeight: 1.45 }}>
        <Row label="Patient" value={patient?.name ?? '—'} bold />
        <Row label="MRN" value={patient?.mrn ?? '—'} />
        <Row label="Age/Sex" value={patient ? `${calculateAge(patient.dob)} / ${patient.gender}` : '—'} />
        <Row label="Doctor" value={doctor?.name ?? '—'} />
        <Row label="Date" value={formatDate(token.date)} />
        <Row
          label="Time"
          value={token.time_slot ?? new Date(token.created_at).toLocaleTimeString('en-PK', {
            hour: '2-digit', minute: '2-digit', hour12: true,
          })}
        />
      </div>

      {/* Payment */}
      {fee !== undefined && fee > 0 && (
        <>
          <div style={{ borderTop: '1px dashed #ccc', margin: '4px 0' }} />
          <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: '3px', padding: '3px 6px' }}>
            <div className="flex justify-between items-center" style={{ fontSize: '9pt', fontWeight: 700 }}>
              <span style={{ color: '#15803d' }}>✔ Paid</span>
              <span style={{ color: '#166534' }}>Rs. {fee.toLocaleString()}</span>
            </div>
          </div>
        </>
      )}

      {/* Footer */}
      <div style={{ borderTop: '1px dashed #ccc', margin: '4px 0' }} />
      <div className="text-center" style={{ fontSize: '7.5pt', color: '#666' }}>
        <p style={{ color: '#8B0000', fontWeight: 600 }}>Thank you — AKM</p>
        <p>Tel: {hospitalPhone}</p>
      </div>
    </div>
  )
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex justify-between gap-1" style={{ fontSize: '8.5pt' }}>
      <span style={{ color: bold ? '#374151' : '#6b7280', fontWeight: bold ? 600 : 500, flexShrink: 0 }}>{label}:</span>
      <span style={{ color: bold ? '#111827' : '#1f2937', fontWeight: bold ? 600 : 400, textAlign: 'right' }}>{value}</span>
    </div>
  )
}
