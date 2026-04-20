import { AKMLogo } from '@/components/shared/AKMLogo'
import { formatCurrency } from '@/lib/utils'
import type { Invoice } from '@/types'

interface ReceiptPrintProps {
  invoice: Invoice
  patientName?: string
  patientMrn?: string
}

export function ReceiptPrint({ invoice, patientName, patientMrn }: ReceiptPrintProps) {
  const hospitalPhone = import.meta.env.VITE_HOSPITAL_PHONE || '042-35977450'
  const hospitalAddress = import.meta.env.VITE_HOSPITAL_ADDRESS || '362-6-C2, Green Town, Lahore'
  const balance = invoice.total - invoice.paid_amount
  const issuedAt = new Date(invoice.created_at).toLocaleTimeString('en-PK', {
    hour: '2-digit', minute: '2-digit', hour12: true,
  })
  const issuedDate = new Date(invoice.created_at).toLocaleDateString('en-PK', {
    day: '2-digit', month: 'short', year: 'numeric',
  })

  return (
    <div
      style={{
        width: '100%',
        padding: '4mm 4mm',
        fontFamily: 'Arial, Helvetica, sans-serif',
        fontSize: '10pt',
        boxSizing: 'border-box',
        backgroundColor: '#fff',
      }}
    >
      {/* Header */}
      <div style={{ textAlign: 'center', borderBottom: '1.5px solid #8B0000', paddingBottom: '6px', marginBottom: '6px' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '3px' }}>
          <AKMLogo size={34} />
        </div>
        <p style={{ fontWeight: 700, color: '#8B0000', fontSize: '12pt', margin: 0 }}>ALIM KHATOON MEDICARE</p>
        <p style={{ fontSize: '8.5pt', color: '#555', margin: '2px 0' }}>{hospitalAddress}</p>
        <p style={{ fontSize: '8.5pt', color: '#555', margin: 0 }}>Tel: {hospitalPhone}</p>
        <div style={{ marginTop: '5px', background: '#8B0000', color: 'white', padding: '3px 0', borderRadius: '3px', fontWeight: 700, fontSize: '11pt', letterSpacing: '1px' }}>
          RECEIPT
        </div>
      </div>

      {/* Receipt meta */}
      <div style={{ borderBottom: '1px dashed #ccc', paddingBottom: '5px', marginBottom: '5px', fontSize: '9.5pt' }}>
        <Row label="Receipt #" value={invoice.invoice_number} bold />
        <Row label="Date" value={`${issuedDate}  ${issuedAt}`} />
        <Row label="Patient" value={patientName ?? '—'} bold />
        {patientMrn && <Row label="MRN" value={patientMrn} />}
        <Row label="Visit" value={invoice.visit_type.toUpperCase()} />
        <Row label="Payment" value={invoice.payment_method?.replace('_', ' ').toUpperCase() ?? '—'} />
        {invoice.receipt_no && <Row label="Txn No" value={invoice.receipt_no} />}
      </div>

      {/* Items */}
      <div style={{ borderBottom: '1px dashed #ccc', paddingBottom: '5px', marginBottom: '5px' }}>
        {(Array.isArray(invoice.items) ? invoice.items : []).map((item, idx) => (
          <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px', fontSize: '9.5pt' }}>
            <span style={{ flex: 1, paddingRight: '4px' }}>
              {item.description}
              {item.quantity > 1 && <span style={{ color: '#888' }}> ×{item.quantity}</span>}
            </span>
            <span style={{ fontWeight: 500 }}>{formatCurrency(item.total)}</span>
          </div>
        ))}
      </div>

      {/* Totals */}
      <div style={{ borderBottom: '1px dashed #ccc', paddingBottom: '5px', marginBottom: '6px', fontSize: '9.5pt' }}>
        {invoice.discount > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#EA580C' }}>
            <span>Discount:</span>
            <span>- {formatCurrency(invoice.discount_type === 'percent' ? (invoice.subtotal * invoice.discount / 100) : invoice.discount)}</span>
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: '11pt', color: '#8B0000', marginTop: '3px' }}>
          <span>TOTAL:</span>
          <span>{formatCurrency(invoice.total)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#16A34A', fontWeight: 600 }}>
          <span>Paid:</span>
          <span>{formatCurrency(invoice.paid_amount)}</span>
        </div>
        {balance > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#DC2626', fontWeight: 700 }}>
            <span>Balance Due:</span>
            <span>{formatCurrency(balance)}</span>
          </div>
        )}
        {balance <= 0 && (
          <div style={{ textAlign: 'center', marginTop: '4px', color: '#16A34A', fontWeight: 700, fontSize: '10pt' }}>
            ✔ FULLY PAID
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{ textAlign: 'center', fontSize: '8.5pt', color: '#888' }}>
        <p style={{ fontWeight: 600, color: '#8B0000', margin: '0 0 2px' }}>Thank you for choosing Alim Khatoon Medicare</p>
        <p style={{ margin: 0 }}>Tel: {hospitalPhone}</p>
      </div>
    </div>
  )
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
      <span style={{ color: '#555' }}>{label}:</span>
      <span style={{ fontWeight: bold ? 700 : 400, color: '#111', textAlign: 'right' }}>{value}</span>
    </div>
  )
}