import { formatDate, calculateAge } from '@/lib/utils'
import type { ErVisit, Patient } from '@/types'
import { TRIAGE_LABELS } from '@/types/er'

interface ErTokenPrintProps {
  visit: ErVisit
  patient?: Patient
  moName?: string
  fee?: number
  paymentMethod?: string
  receiptNo?: string
}

export function ErTokenPrint({ visit, patient, moName, fee, paymentMethod, receiptNo }: ErTokenPrintProps) {
  const hospitalPhone = import.meta.env.VITE_HOSPITAL_PHONE || '042-35977450'
  const triageColors: Record<number, string> = {
    1: '#DC2626', 2: '#EA580C', 3: '#CA8A04', 4: '#16A34A', 5: '#2563EB',
  }

  return (
    <>
      {/* Force thermal paper size — injected directly into print iframe */}
      <style dangerouslySetInnerHTML={{ __html: `
        @page {
          size: 80mm auto !important;
          margin: 0 !important;
        }
        html, body {
          margin: 0 !important;
          padding: 0 !important;
          width: 80mm !important;
          background: #fff !important;
        }
      `}} />

      <div style={{
        width: '100%',
        padding: '4mm 4mm 4mm 4mm',
        boxSizing: 'border-box',
        fontFamily: 'Arial, Helvetica, sans-serif',
        backgroundColor: '#fff',
        color: '#000',
      }}>

        {/* Header */}
        <div style={{ textAlign: 'center', borderBottom: '2px solid #EA580C', paddingBottom: '3mm', marginBottom: '3mm' }}>
          <div style={{ fontWeight: 900, color: '#EA580C', fontSize: '15pt', lineHeight: 1.2 }}>
            ALIM KHATOON MEDICARE
          </div>
          <div style={{ fontSize: '10pt', color: '#EA580C', fontWeight: 700, marginTop: '1mm' }}>── EMERGENCY ──</div>
        </div>

        {/* Triage Badge */}
        <div style={{
          textAlign: 'center', color: '#fff', fontWeight: 900,
          backgroundColor: triageColors[visit.triage_level],
          fontSize: '11pt', padding: '2mm 0', borderRadius: '3px',
          marginBottom: '3mm', letterSpacing: '1px',
        }}>
          TRIAGE L{visit.triage_level} — {TRIAGE_LABELS[visit.triage_level as 1|2|3|4|5].split(' ')[0].toUpperCase()}
        </div>

        {/* Token Number */}
        <div style={{ textAlign: 'center', margin: '2mm 0' }}>
          <div style={{ fontSize: '9pt', color: '#888', textTransform: 'uppercase', letterSpacing: '2px' }}>ER Token</div>
          <div style={{ fontSize: '42pt', fontWeight: 900, color: '#EA580C', lineHeight: 1 }}>
            {visit.token_number}
          </div>
        </div>

        <div style={{ borderTop: '1px dashed #aaa', margin: '3mm 0' }} />

        {/* Details */}
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11pt' }}>
          <tbody>
            <tr>
              <td style={{ color: '#555', fontWeight: 700, paddingBottom: '1.5mm', width: '38%' }}>Patient</td>
              <td style={{ fontWeight: 800, color: '#111', paddingBottom: '1.5mm' }}>{patient?.name ?? '—'}</td>
            </tr>
            <tr>
              <td style={{ color: '#555', fontWeight: 700, paddingBottom: '1.5mm' }}>MRN</td>
              <td style={{ color: '#333', paddingBottom: '1.5mm' }}>{patient?.mrn ?? '—'}</td>
            </tr>
            <tr>
              <td style={{ color: '#555', fontWeight: 700, paddingBottom: '1.5mm' }}>Age / Sex</td>
              <td style={{ color: '#333', paddingBottom: '1.5mm' }}>
                {patient ? `${calculateAge(patient.dob)} / ${patient.gender ?? '—'}` : '—'}
              </td>
            </tr>
            <tr>
              <td style={{ color: '#555', fontWeight: 700, paddingBottom: '1.5mm' }}>Date</td>
              <td style={{ color: '#333', paddingBottom: '1.5mm' }}>{formatDate(visit.visit_date)}</td>
            </tr>
            <tr>
              <td style={{ color: '#555', fontWeight: 700, paddingBottom: '1.5mm' }}>Complaint</td>
              <td style={{ color: '#333', paddingBottom: '1.5mm' }}>{visit.chief_complaint}</td>
            </tr>
            {moName && (
              <tr>
                <td style={{ color: '#555', fontWeight: 700 }}>MO</td>
                <td style={{ color: '#333' }}>{moName}</td>
              </tr>
            )}
          </tbody>
        </table>

        {/* Payment */}
        {fee !== undefined && fee > 0 && (
          <>
            <div style={{ borderTop: '1px dashed #aaa', margin: '3mm 0' }} />
            <div style={{
              background: '#fff7ed', border: '1px solid #EA580C',
              borderRadius: '3px', padding: '2mm 3mm',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: '#9a3412', fontWeight: 800, fontSize: '12pt' }}>✔ PAID</span>
                <span style={{ color: '#9a3412', fontWeight: 800, fontSize: '13pt' }}>Rs. {fee.toLocaleString()}</span>
              </div>
              {paymentMethod && (
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '1mm', fontSize: '9.5pt' }}>
                  <span style={{ color: '#9a3412' }}>Method:</span>
                  <span style={{ color: '#9a3412', fontWeight: 700 }}>{paymentMethod.replace('_', ' ').toUpperCase()}</span>
                </div>
              )}
              {receiptNo && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9.5pt' }}>
                  <span style={{ color: '#9a3412' }}>Txn ID:</span>
                  <span style={{ color: '#9a3412', fontWeight: 700 }}>{receiptNo}</span>
                </div>
              )}
            </div>
          </>
        )}

        {/* Footer */}
        <div style={{ borderTop: '1px dashed #aaa', margin: '3mm 0' }} />
        <div style={{ textAlign: 'center', fontSize: '9.5pt', color: '#666' }}>
          <div style={{ color: '#EA580C', fontWeight: 700 }}>EMERGENCY — Please wait</div>
          <div>Tel: {hospitalPhone}</div>
        </div>

      </div>
    </>
  )
}
