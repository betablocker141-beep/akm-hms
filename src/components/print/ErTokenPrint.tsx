import { formatDate, calculateAge } from '@/lib/utils'
import type { ErVisit, Patient } from '@/types'
import { TRIAGE_LABELS } from '@/types/er'

interface ErTokenPrintProps {
  visit: ErVisit
  patient?: Patient
  moName?: string
  fee?: number
}

export function ErTokenPrint({ visit, patient, moName, fee }: ErTokenPrintProps) {
  const hospitalPhone = import.meta.env.VITE_HOSPITAL_PHONE || '042-35977450'
  const triageColors: Record<number, string> = {
    1: '#DC2626', 2: '#EA580C', 3: '#CA8A04', 4: '#16A34A', 5: '#2563EB',
  }

  return (
    <div
      className="print-area bg-white font-sans"
      style={{
        width: '76mm',
        padding: '2mm 3mm',
        border: '1px solid #e5e7eb',
        borderRadius: '4px',
        fontSize: '9pt',
        boxSizing: 'border-box',
      }}
    >
      {/* Header */}
      <div className="text-center" style={{ borderBottom: '2px solid #EA580C', paddingBottom: '2mm', marginBottom: '2mm' }}>
        <p className="font-bold leading-tight" style={{ color: '#EA580C', fontSize: '11pt' }}>
          ALIM KHATOON MEDICARE
        </p>
        <p style={{ fontSize: '7.5pt', color: '#EA580C', fontWeight: 600 }}>── EMERGENCY ──</p>
      </div>

      {/* Triage badge */}
      <div
        className="text-center text-white font-bold rounded"
        style={{ backgroundColor: triageColors[visit.triage_level], fontSize: '8pt', padding: '1px 0', marginBottom: '2mm' }}
      >
        TRIAGE L{visit.triage_level} — {TRIAGE_LABELS[visit.triage_level as 1|2|3|4|5].split(' ')[0].toUpperCase()}
      </div>

      {/* Token number */}
      <div className="text-center" style={{ margin: '1mm 0' }}>
        <p style={{ fontSize: '7pt', color: '#888', textTransform: 'uppercase', letterSpacing: '0.08em' }}>ER Token</p>
        <p className="font-bold leading-none" style={{ fontSize: '24pt', color: '#EA580C', marginTop: '1px' }}>
          {visit.token_number}
        </p>
      </div>

      <div style={{ borderTop: '1px dashed #ccc', margin: '2px 0' }} />

      {/* Details */}
      <div style={{ lineHeight: 1.4 }}>
        <Row label="Patient" value={patient?.name ?? '—'} bold />
        <Row label="MRN" value={patient?.mrn ?? '—'} />
        <Row label="Age / Sex" value={patient ? `${calculateAge(patient.dob)} / ${patient.gender ?? '—'}` : '—'} />
        <Row label="Date" value={formatDate(visit.visit_date)} />
        <Row label="Complaint" value={visit.chief_complaint} />
        {moName && <Row label="MO" value={moName} />}
      </div>

      <div style={{ borderTop: '1px dashed #ccc', margin: '2px 0' }} />

      {/* Payment */}
      {fee !== undefined && fee > 0 && (
        <div style={{ background: '#fff7ed', border: '1px solid #EA580C', borderRadius: '3px', padding: '2px 5px', marginBottom: '2px' }}>
          <div className="flex justify-between items-center" style={{ fontSize: '9.5pt', fontWeight: 700, color: '#9a3412' }}>
            <span>✔ PAID</span>
            <span>Rs. {fee.toLocaleString()}</span>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="text-center" style={{ fontSize: '7.5pt', color: '#666' }}>
        <p style={{ color: '#EA580C', fontWeight: 600 }}>EMERGENCY — Please wait</p>
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