/**
 * OPD Token Print Template — 76mm thermal receipt (compact)
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
        width: size === 'thermal' ? '76mm' : '148mm',
        padding: '2mm 3mm',
        border: '1px solid #e5e7eb',
        borderRadius: '4px',
        fontSize: '9pt',
        boxSizing: 'border-box',
      }}
    >
      {/* Header */}
      <div className="text-center" style={{ borderBottom: '2px solid #8B0000', paddingBottom: '2mm', marginBottom: '2mm' }}>
        <p className="font-bold leading-tight" style={{ color: '#8B0000', fontSize: '11pt' }}>
          ALIM KHATOON MEDICARE
        </p>
        <p style={{ fontSize: '7.5pt', color: '#555' }}>── OPD TOKEN ──</p>
      </div>

      {/* Token number */}
      <div className="text-center" style={{ margin: '1mm 0' }}>
        <p style={{ fontSize: '7pt', color: '#888', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Token No.</p>
        <p className="font-bold leading-none" style={{ fontSize: '24pt', color: '#8B0000', marginTop: '1px' }}>
          {token.token_number}
        </p>
      </div>

      <div style={{ borderTop: '1px dashed #ccc', margin: '2px 0' }} />

      {/* Details */}
      <div style={{ lineHeight: 1.4 }}>
        <Row label="Patient" value={patient?.name ?? '—'} bold />
        <Row label="MRN" value={patient?.mrn ?? '—'} />
        <Row label="Age / Sex" value={patient ? `${calculateAge(patient.dob)} / ${patient.gender ?? '—'}` : '—'} />
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
          <div style={{ borderTop: '1px dashed #ccc', margin: '2px 0' }} />
          <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: '3px', padding: '2px 5px' }}>
            <div className="flex justify-between items-center" style={{ fontSize: '9.5pt', fontWeight: 700 }}>
              <span style={{ color: '#15803d' }}>✔ Paid</span>
              <span style={{ color: '#166534' }}>Rs. {fee.toLocaleString()}</span>
            </div>
          </div>
        </>
      )}

      {/* Footer */}
      <div style={{ borderTop: '1px dashed #ccc', margin: '2px 0' }} />
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