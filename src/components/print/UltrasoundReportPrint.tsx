import { AKMLogo } from '@/components/shared/AKMLogo'
import { formatDate } from '@/lib/utils'
import type { UltrasoundReport, UsStudyType } from '@/types'

interface UltrasoundReportPrintProps {
  report: UltrasoundReport
  patientName?: string
  patientAge?: string
  patientMrn?: string
  patientPhone?: string
  patientAddress?: string
  patientGender?: string
  radiologistName?: string
  printedBy?: string
  husbandsFatherName?: string
}

function getStudyTitle(studyType: UsStudyType | string): string {
  switch (studyType) {
    case 'Pelvic':
    case 'Pelvis':       return 'PELVIC ULTRASOUND EXAMINATION'
    case 'Pelvic TVS':   return 'PELVIC ULTRASOUND EXAMINATION T.V.S'
    case 'Abdominal':
    case 'Abdomen':      return 'ABDOMINAL ULTRASOUND EXAMINATION'
    case 'Obstetric':    return 'OBSTETRIC ULTRASOUND EXAMINATION'
    case 'Breast':       return 'BREAST ULTRASOUND EXAMINATION'
    default:             return `${studyType.toUpperCase()} ULTRASOUND EXAMINATION`
  }
}

export function UltrasoundReportPrint({
  report,
  patientName,
  patientAge,
  patientMrn,
  patientPhone,
  patientAddress,
  radiologistName,
  printedBy,
  husbandsFatherName,
}: UltrasoundReportPrintProps) {
  const hospitalPhone   = import.meta.env.VITE_HOSPITAL_PHONE   || '042-35977450'
  const hospitalAddress = import.meta.env.VITE_HOSPITAL_ADDRESS || '362-6-C2, Green Town, Lahore'
  const hospitalEmail   = import.meta.env.VITE_HOSPITAL_EMAIL   || 'alimkhatoon@gmail.com'

  const printDateTime = new Date().toLocaleString('en-PK', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  })

  const studyTitle = getStudyTitle(report.study_type)
  const LR = '14mm'  // left / right padding

  return (
    <>
      {/*
        Embed @page directly in the component so it is ALWAYS present
        when this component renders — no reliance on index.css load order.
        Forces A4, removes browser margins.
      */}
      <style dangerouslySetInnerHTML={{ __html: `
        @page { size: A4 portrait; margin: 0; }
      `}} />

      {/*
        Outer wrapper:
        • width  = 210mm  (A4 width)
        • height = 297mm  (A4 height — FIXED so flex: 1 children work)
        • overflow: hidden prevents any content spilling to page 2
        All layout is inline — no CSS class order issues.
      */}
      <div
        className="print-area"
        style={{
          width: '210mm',
          height: '297mm',
          margin: '0 auto',
          background: '#fff',
          fontFamily: 'Arial, sans-serif',
          fontSize: '10pt',
          color: '#111',
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* ── 1. Maroon top bar — full width ─────────────── */}
        <div style={{ background: '#8B0000', height: '7px', flexShrink: 0 }} />

        {/* ── 2. Letterhead ──────────────────────────────── */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          padding: `7mm ${LR} 5mm ${LR}`,
          flexShrink: 0,
          gap: '16px',
        }}>
          {/* Logo */}
          <div style={{ flexShrink: 0 }}>
            <AKMLogo size={76} />
          </div>

          {/* Hospital name + address — fills the full remaining width */}
          <div style={{ flex: 1 }}>
            <div style={{
              fontStyle: 'italic',
              fontWeight: 'bold',
              fontSize: '22pt',
              lineHeight: 1.1,
              color: '#8B0000',
              marginBottom: '4px',
            }}>
              Alim Khatoon Medicare
            </div>
            <div style={{ fontSize: '9pt', color: '#444', lineHeight: 1.55 }}>
              {hospitalAddress}
            </div>
            <div style={{ fontSize: '9pt', color: '#444', lineHeight: 1.55 }}>
              Tel:&nbsp;{hospitalPhone}&nbsp;&nbsp;|&nbsp;&nbsp;Email:&nbsp;{hospitalEmail}
            </div>
          </div>
        </div>

        {/* ── 3. Full-width double-rule separator ─────────── */}
        <div style={{ padding: `0 ${LR}`, flexShrink: 0 }}>
          <div style={{ borderTop: '3px solid #8B0000' }} />
          <div style={{ borderTop: '1px solid #D4AF37', marginTop: '2px', marginBottom: '5mm' }} />
        </div>

        {/* ── 4. Body — fills all remaining height ─────────── */}
        {/*
          flex: 1           → takes all space between header and footer
          display: flex     → inner column layout
          flexDirection: column
          overflow: hidden  → clips overflowing text instead of making page 2
        */}
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          padding: `0 ${LR}`,
          overflow: 'hidden',
        }}>

          {/* Patient info box */}
          <div style={{
            border: '1px solid #999',
            padding: '5px 10px',
            marginBottom: '7px',
            fontSize: '9.5pt',
            lineHeight: 1.55,
            flexShrink: 0,
          }}>
            <div style={{ display: 'flex', gap: '20px' }}>
              <div style={{ flex: 1 }}>
                <div><strong>Name: </strong>{patientName ?? '——————————————————'}</div>
                <div><strong>MR#: </strong>{patientMrn ?? '——————'}</div>
                {husbandsFatherName && (
                  <div><strong>W/O - D/O - S/O: </strong>{husbandsFatherName}</div>
                )}
                <div><strong>Age/Gender: </strong>{patientAge ?? '——— / ———'}</div>
                {patientPhone   && <div><strong>Phone: </strong>{patientPhone}</div>}
                {patientAddress && <div><strong>Address: </strong>{patientAddress}</div>}
              </div>
              <div style={{ minWidth: '140px', textAlign: 'right' }}>
                <div><strong>Date: </strong>{formatDate(report.study_date)}</div>
                {report.referring_doctor && (
                  <div><strong>Doctor: </strong>{report.referring_doctor}</div>
                )}
              </div>
            </div>
            <div style={{ borderTop: '1px solid #ccc', marginTop: '4px' }} />
          </div>

          {/* Study title */}
          <div style={{ textAlign: 'center', marginBottom: '8px', flexShrink: 0 }}>
            <span style={{ fontWeight: 'bold', textDecoration: 'underline', fontSize: '11pt' }}>
              {studyTitle}
            </span>
          </div>

          {/*
            Findings section — flex: 1 makes it grow to fill all
            remaining vertical space between the title and the conclusion.
            This is what pushes the footer to the bottom of the page.
          */}
          <div style={{
            flex: 1,
            whiteSpace: 'pre-wrap',
            fontSize: '10pt',
            lineHeight: 1.65,
            marginBottom: '8px',
            overflow: 'hidden',
          }}>
            {report.findings}
          </div>

          {/* Conclusion */}
          {report.impression && (
            <div style={{ marginBottom: '8px', flexShrink: 0 }}>
              <div style={{ fontWeight: 'bold', textDecoration: 'underline', fontSize: '10.5pt', marginBottom: '3px' }}>
                CONCLUSION
              </div>
              <div style={{ whiteSpace: 'pre-wrap', fontSize: '10pt', lineHeight: 1.6 }}>
                {report.impression}
              </div>
            </div>
          )}

          {/* History */}
          {report.history && (
            <div style={{ marginBottom: '6px', fontSize: '10pt', flexShrink: 0 }}>
              <strong>*History: </strong>
              <span style={{ whiteSpace: 'pre-wrap' }}>{report.history}</span>
            </div>
          )}

          {/* Presenting complaints */}
          {report.presenting_complaints && (
            <div style={{ marginBottom: '6px', fontSize: '10pt', flexShrink: 0 }}>
              <strong>*Presenting Complaints: </strong>
              <span style={{ whiteSpace: 'pre-wrap' }}>{report.presenting_complaints}</span>
            </div>
          )}

          {/* Prescription */}
          {report.prescription && (
            <div style={{ marginBottom: '6px', fontSize: '10pt', flexShrink: 0 }}>
              <strong>*Prescription: </strong>
              <span style={{ whiteSpace: 'pre-wrap' }}>{report.prescription}</span>
            </div>
          )}

          {/* Signature line */}
          <div style={{ marginTop: '16px', marginBottom: '6px', fontSize: '10pt', flexShrink: 0 }}>
            <strong>Dr. Name: </strong>
            <span style={{ borderBottom: '1px solid #555', paddingBottom: '1px', minWidth: '160px', display: 'inline-block' }}>
              {radiologistName ?? ''}
            </span>
          </div>

          {/* Printed by */}
          {printedBy && (
            <div style={{ fontSize: '8pt', color: '#666', marginBottom: '4px', flexShrink: 0 }}>
              <strong>Printed By:</strong> {printedBy} &nbsp;({printDateTime})
            </div>
          )}
        </div>

        {/* ── 5. Footer — pinned to page bottom by flex column ─ */}
        <div style={{
          flexShrink: 0,
          borderTop: '1px solid #8B0000',
          margin: `6px ${LR} 0 ${LR}`,
          paddingTop: '4px',
          paddingBottom: '7mm',
          textAlign: 'center',
          fontSize: '7.5pt',
          color: '#666',
          lineHeight: 1.5,
        }}>
          <div>This report is not for medicolegal proceedings and not valid for any court of law.</div>
          <div>Expert opinion from a Radiologist is required for medicolegal cases.</div>
          {report.status === 'draft' && (
            <div style={{ color: '#B45309', fontWeight: 700, marginTop: '3px' }}>
              DRAFT — NOT FOR CLINICAL USE
            </div>
          )}
        </div>

      </div>
    </>
  )
}
