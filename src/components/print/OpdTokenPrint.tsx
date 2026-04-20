import { formatDate, calculateAge } from '@/lib/utils'
import type { OpdToken, Patient, Doctor } from '@/types'

interface OpdTokenPrintProps {
  token: OpdToken
  patient?: Patient
  doctor?: Doctor
  fee?: number
  paymentMethod?: string
  receiptNo?: string
  size?: 'thermal' | 'a4'
}

export function OpdTokenPrint({ token, patient, doctor, fee, paymentMethod, receiptNo }: OpdTokenPrintProps) {
  const hospitalPhone = import.meta.env.VITE_HOSPITAL_PHONE || '042-35977450'

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
        <div style={{ textAlign: 'center', borderBottom: '2px solid #8B0000', paddingBottom: '3mm', marginBottom: '3mm' }}>
          <div style={{ fontWeight: 900, color: '#8B0000', fontSize: '15pt', lineHeight: 1.2 }}>
            ALIM KHATOON MEDICARE
          </div>
          <div style={{ fontSize: '10pt', color: '#555', marginTop: '1mm' }}>── OPD TOKEN ──</div>
        </div>

        {/* Token Number */}
        <div style={{ textAlign: 'center', margin: '2mm 0' }}>
          <div style={{ fontSize: '9pt', color: '#888', textTransform: 'uppercase', letterSpacing: '2px' }}>Token No.</div>
          <div style={{ fontSize: '42pt', fontWeight: 900, color: '#8B0000', lineHeight: 1 }}>
            {token.token_number}
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
              <td style={{ color: '#555', fontWeight: 700, paddingBottom: '1.5mm' }}>Doctor</td>
              <td style={{ color: '#333', paddingBottom: '1.5mm' }}>{doctor?.name ?? '—'}</td>
            </tr>
            <tr>
              <td style={{ color: '#555', fontWeight: 700, paddingBottom: '1.5mm' }}>Date</td>
              <td style={{ color: '#333', paddingBottom: '1.5mm' }}>{formatDate(token.date)}</td>
            </tr>
            <tr>
              <td style={{ color: '#555', fontWeight: 700 }}>Time</td>
              <td style={{ color: '#333' }}>
                {token.time_slot ?? new Date(token.created_at).toLocaleTimeString('en-PK', {
                  hour: '2-digit', minute: '2-digit', hour12: true,
                })}
              </td>
            </tr>
          </tbody>
        </table>

        {/* Payment */}
        {fee !== undefined && fee > 0 && (
          <>
            <div style={{ borderTop: '1px dashed #aaa', margin: '3mm 0' }} />
            <div style={{
              background: '#f0fdf4', border: '1px solid #86efac',
              borderRadius: '3px', padding: '2mm 3mm',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: '#15803d', fontWeight: 800, fontSize: '12pt' }}>✔ PAID</span>
                <span style={{ color: '#166534', fontWeight: 800, fontSize: '13pt' }}>Rs. {fee.toLocaleString()}</span>
              </div>
              {paymentMethod && (
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '1mm', fontSize: '9.5pt' }}>
                  <span style={{ color: '#15803d' }}>Method:</span>
                  <span style={{ color: '#166534', fontWeight: 700 }}>{paymentMethod.replace('_', ' ').toUpperCase()}</span>
                </div>
              )}
              {receiptNo && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9.5pt' }}>
                  <span style={{ color: '#15803d' }}>Txn ID:</span>
                  <span style={{ color: '#166534', fontWeight: 700 }}>{receiptNo}</span>
                </div>
              )}
            </div>
          </>
        )}

        {/* Footer */}
        <div style={{ borderTop: '1px dashed #aaa', margin: '3mm 0' }} />
        <div style={{ textAlign: 'center', fontSize: '9.5pt', color: '#666' }}>
          <div style={{ color: '#8B0000', fontWeight: 700 }}>Thank you — AKM</div>
          <div>Tel: {hospitalPhone}</div>
        </div>

      </div>
    </>
  )
}
