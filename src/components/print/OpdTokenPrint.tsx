/**
 * OPD Token Print — 76mm thermal receipt
 * @page size is set via pageStyle in useReactToPrint (76mm auto, 0 margin)
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
  const isA4 = size === 'a4'

  return (
    <div
      className="print-area bg-white font-sans"
      style={{
        width: isA4 ? '148mm' : '76mm',
        margin: '0 auto',
        padding: '3mm 4mm 3mm 4mm',
        boxSizing: 'border-box',
        fontFamily: 'Arial, sans-serif',
      }}
    >
      {/* ── Header ── */}
      <div style={{ textAlign: 'center', borderBottom: '2px solid #8B0000', paddingBottom: '2mm', marginBottom: '2mm' }}>
        <div style={{ fontWeight: 800, color: '#8B0000', fontSize: '13pt', lineHeight: 1.2 }}>
          ALIM KHATOON MEDICARE
        </div>
        <div style={{ fontSize: '9pt', color: '#555', marginTop: '1px' }}>── OPD TOKEN ──</div>
      </div>

      {/* ── Token Number ── */}
      <div style={{ textAlign: 'center', margin: '2mm 0 1mm' }}>
        <div style={{ fontSize: '8pt', color: '#999', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Token No.</div>
        <div style={{ fontSize: '36pt', fontWeight: 900, color: '#8B0000', lineHeight: 1, marginTop: '0' }}>
          {token.token_number}
        </div>
      </div>

      <div style={{ borderTop: '1px dashed #bbb', margin: '2mm 0' }} />

      {/* ── Patient Details ── */}
      <div style={{ fontSize: '10pt', lineHeight: 1.6 }}>
        <Row label="Patient"  value={patient?.name ?? '—'}                                             bold />
        <Row label="MRN"      value={patient?.mrn  ?? '—'}                                             />
        <Row label="Age/Sex"  value={patient ? `${calculateAge(patient.dob)} / ${patient.gender ?? '—'}` : '—'} />
        <Row label="Doctor"   value={doctor?.name  ?? '—'}                                             />
        <Row label="Date"     value={formatDate(token.date)}                                           />
        <Row label="Time"     value={token.time_slot ?? new Date(token.created_at).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit', hour12: true })} />
      </div>

      {/* ── Payment ── */}
      {fee !== undefined && fee > 0 && (
        <>
          <div style={{ borderTop: '1px dashed #bbb', margin: '2mm 0' }} />
          <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: '3px', padding: '2mm 3mm' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11pt', fontWeight: 700 }}>
              <span style={{ color: '#15803d' }}>✔ PAID</span>
              <span style={{ color: '#166534' }}>Rs. {fee.toLocaleString()}</span>
            </div>
          </div>
        </>
      )}

      {/* ── Footer ── */}
      <div style={{ borderTop: '1px dashed #bbb', margin: '2mm 0' }} />
      <div style={{ textAlign: 'center', fontSize: '8.5pt', color: '#666' }}>
        <div style={{ color: '#8B0000', fontWeight: 700 }}>Thank you — AKM</div>
        <div>Tel: {hospitalPhone}</div>
      </div>
    </div>
  )
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '4px' }}>
      <span style={{ color: '#555', fontWeight: 600, flexShrink: 0 }}>{label}:</span>
      <span style={{ color: bold ? '#111' : '#222', fontWeight: bold ? 700 : 400, textAlign: 'right' }}>{value}</span>
    </div>
  )
}
