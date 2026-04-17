/**
 * ER Token Print — 76mm thermal receipt
 * @page size is set via pageStyle in useReactToPrint (76mm auto, 0 margin)
 */
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
        margin: '0 auto',
        padding: '3mm 4mm 3mm 4mm',
        boxSizing: 'border-box',
        fontFamily: 'Arial, sans-serif',
      }}
    >
      {/* ── Header ── */}
      <div style={{ textAlign: 'center', borderBottom: '2px solid #EA580C', paddingBottom: '2mm', marginBottom: '2mm' }}>
        <div style={{ fontWeight: 800, color: '#EA580C', fontSize: '13pt', lineHeight: 1.2 }}>
          ALIM KHATOON MEDICARE
        </div>
        <div style={{ fontSize: '9pt', color: '#EA580C', fontWeight: 700, marginTop: '1px' }}>── EMERGENCY ──</div>
      </div>

      {/* ── Triage Badge ── */}
      <div style={{
        textAlign: 'center', color: '#fff', fontWeight: 800,
        backgroundColor: triageColors[visit.triage_level],
        fontSize: '10pt', padding: '2px 0', borderRadius: '3px', marginBottom: '2mm',
      }}>
        TRIAGE L{visit.triage_level} — {TRIAGE_LABELS[visit.triage_level as 1|2|3|4|5].split(' ')[0].toUpperCase()}
      </div>

      {/* ── Token Number ── */}
      <div style={{ textAlign: 'center', margin: '2mm 0 1mm' }}>
        <div style={{ fontSize: '8pt', color: '#999', textTransform: 'uppercase', letterSpacing: '0.1em' }}>ER Token</div>
        <div style={{ fontSize: '36pt', fontWeight: 900, color: '#EA580C', lineHeight: 1 }}>
          {visit.token_number}
        </div>
      </div>

      <div style={{ borderTop: '1px dashed #bbb', margin: '2mm 0' }} />

      {/* ── Patient Details ── */}
      <div style={{ fontSize: '10pt', lineHeight: 1.6 }}>
        <Row label="Patient"   value={patient?.name ?? '—'}                                                   bold />
        <Row label="MRN"       value={patient?.mrn  ?? '—'}                                                   />
        <Row label="Age/Sex"   value={patient ? `${calculateAge(patient.dob)} / ${patient.gender ?? '—'}` : '—'} />
        <Row label="Date"      value={formatDate(visit.visit_date)}                                           />
        <Row label="Complaint" value={visit.chief_complaint}                                                  />
        {moName && <Row label="MO" value={moName} />}
      </div>

      {/* ── Payment ── */}
      {fee !== undefined && fee > 0 && (
        <>
          <div style={{ borderTop: '1px dashed #bbb', margin: '2mm 0' }} />
          <div style={{ background: '#fff7ed', border: '1px solid #EA580C', borderRadius: '3px', padding: '2mm 3mm' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11pt', fontWeight: 700, color: '#9a3412' }}>
              <span>✔ PAID</span>
              <span>Rs. {fee.toLocaleString()}</span>
            </div>
          </div>
        </>
      )}

      {/* ── Footer ── */}
      <div style={{ borderTop: '1px dashed #bbb', margin: '2mm 0' }} />
      <div style={{ textAlign: 'center', fontSize: '8.5pt', color: '#666' }}>
        <div style={{ color: '#EA580C', fontWeight: 700 }}>EMERGENCY — Please wait</div>
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
