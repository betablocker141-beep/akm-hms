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

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: `
        @page { size: A4 portrait; margin: 0; }
        @media print {
          html, body { margin: 0 !important; padding: 0 !important; }
        }
      `}} />

      <div
        className="print-area bg-white font-sans"
        style={{
          width: '210mm',
          minHeight: '297mm',
          margin: '0 auto',
          padding: '14mm 16mm',
          fontFamily: 'Inter, Arial, sans-serif',
          fontSize: '11pt',
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
        }}
      >

        {/* ── HEADER ── logo left | hospital name center | report label right ── */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
          borderBottom: '3px solid #8B0000',
          paddingBottom: '12px',
          marginBottom: '16px',
        }}>
          <AKMLogo size={56} />

          <div style={{ flex: 1, textAlign: 'center' }}>
            <h1 style={{ fontSize: '18pt', fontWeight: 700, color: '#8B0000', margin: 0, fontStyle: 'italic' }}>
              Alim Khatoon Medicare
            </h1>
            <p style={{ fontSize: '9.5pt', color: '#555', margin: '2px 0 0' }}>{hospitalAddress}</p>
            <p style={{ fontSize: '9.5pt', color: '#555', margin: 0 }}>
              Tel: {hospitalPhone}&nbsp;&nbsp;|&nbsp;&nbsp;{hospitalEmail}
            </p>
          </div>

          <div style={{ textAlign: 'right', minWidth: '110px' }}>
            <h2 style={{ fontSize: '13pt', fontWeight: 700, color: '#8B0000', margin: 0 }}>
              ULTRASOUND
            </h2>
            <h3 style={{ fontSize: '10pt', fontWeight: 600, color: '#8B0000', margin: '2px 0 0' }}>
              REPORT
            </h3>
            <p style={{ fontSize: '9pt', color: '#666', margin: '4px 0 0' }}>
              {formatDate(report.study_date)}
            </p>
          </div>
        </div>

        {/* ── PATIENT INFO + STUDY INFO ── */}
        <div style={{
          display: 'flex',
          gap: '32px',
          marginBottom: '16px',
          fontSize: '10pt',
          padding: '10px 12px',
          border: '1px solid #e5e7eb',
          borderRadius: '4px',
          backgroundColor: '#fafafa',
        }}>
          {/* Left: patient details */}
          <div style={{ flex: 1 }}>
            <p style={{ fontWeight: 600, color: '#555', marginBottom: '5px', fontSize: '8.5pt', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Patient
            </p>
            <p style={{ fontWeight: 700, color: '#111', margin: '0 0 2px' }}>
              {patientName ?? '——————————————'}
            </p>
            {husbandsFatherName && (
              <p style={{ color: '#555', margin: '0 0 2px' }}>
                W/O – D/O – S/O: <strong>{husbandsFatherName}</strong>
              </p>
            )}
            {patientMrn && (
              <p style={{ color: '#555', margin: '0 0 2px' }}>
                MRN: <strong style={{ color: '#8B0000' }}>{patientMrn}</strong>
              </p>
            )}
            <p style={{ color: '#555', margin: '0 0 2px' }}>
              Age / Gender:{' '}
              <strong>{patientAge ?? '——'}</strong>
            </p>
            {patientPhone && (
              <p style={{ color: '#555', margin: '0 0 2px' }}>Phone: <strong>{patientPhone}</strong></p>
            )}
            {patientAddress && (
              <p style={{ color: '#555', margin: 0 }}>Address: {patientAddress}</p>
            )}
          </div>

          {/* Right: study details */}
          <div style={{ textAlign: 'right', minWidth: '160px' }}>
            <p style={{ fontWeight: 600, color: '#555', marginBottom: '5px', fontSize: '8.5pt', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Study Details
            </p>
            <p style={{ color: '#555', margin: '0 0 2px' }}>
              Date: <strong>{formatDate(report.study_date)}</strong>
            </p>
            {report.referring_doctor && (
              <p style={{ color: '#555', margin: '0 0 2px' }}>
                Ref. Doctor: <strong>{report.referring_doctor}</strong>
              </p>
            )}
            {report.status === 'draft' && (
              <p style={{ color: '#B45309', fontWeight: 700, margin: '4px 0 0', fontSize: '9pt' }}>
                ⚠ DRAFT
              </p>
            )}
          </div>
        </div>

        {/* ── STUDY TITLE ── */}
        <div style={{ textAlign: 'center', margin: '6px 0 12px' }}>
          <span style={{
            fontWeight: 700,
            textDecoration: 'underline',
            fontSize: '12pt',
            color: '#111',
            letterSpacing: '0.02em',
          }}>
            {studyTitle}
          </span>
        </div>

        {/* ── FINDINGS ── */}
        <div style={{ flex: 1 }}>
          <div style={{
            whiteSpace: 'pre-wrap',
            fontSize: '10.5pt',
            lineHeight: 1.7,
            color: '#1a1a1a',
            marginBottom: '10px',
          }}>
            {report.findings}
          </div>

          {/* Impression / Conclusion */}
          {report.impression && (
            <div style={{ marginBottom: '10px' }}>
              <p style={{
                fontWeight: 700,
                textDecoration: 'underline',
                fontSize: '10.5pt',
                marginBottom: '4px',
                color: '#111',
              }}>
                CONCLUSION
              </p>
              <div style={{ whiteSpace: 'pre-wrap', fontSize: '10.5pt', lineHeight: 1.65, color: '#1a1a1a' }}>
                {report.impression}
              </div>
            </div>
          )}

          {/* History */}
          {report.history && (
            <div style={{ marginBottom: '6px', fontSize: '10pt' }}>
              <strong>* History: </strong>
              <span style={{ whiteSpace: 'pre-wrap' }}>{report.history}</span>
            </div>
          )}

          {/* Presenting complaints */}
          {report.presenting_complaints && (
            <div style={{ marginBottom: '6px', fontSize: '10pt' }}>
              <strong>* Presenting Complaints: </strong>
              <span style={{ whiteSpace: 'pre-wrap' }}>{report.presenting_complaints}</span>
            </div>
          )}

          {/* Prescription */}
          {report.prescription && (
            <div style={{ marginBottom: '6px', fontSize: '10pt' }}>
              <strong>* Prescription: </strong>
              <span style={{ whiteSpace: 'pre-wrap' }}>{report.prescription}</span>
            </div>
          )}

          {/* Signature row */}
          <div style={{
            display: 'flex',
            justifyContent: 'flex-end',
            marginTop: '24px',
            marginBottom: '6px',
          }}>
            <div style={{ textAlign: 'center', minWidth: '200px' }}>
              <div style={{
                borderBottom: '1.5px solid #555',
                marginBottom: '4px',
                paddingBottom: '2px',
                minWidth: '180px',
                fontSize: '10.5pt',
                fontWeight: 600,
                color: '#111',
              }}>
                {radiologistName ?? ''}
              </div>
              <p style={{ fontSize: '9pt', color: '#555', margin: 0 }}>Radiologist / Reporting Doctor</p>
            </div>
          </div>

          {/* Printed by */}
          {printedBy && (
            <div style={{ fontSize: '8pt', color: '#888', textAlign: 'right' }}>
              Printed by: {printedBy} &nbsp;({printDateTime})
            </div>
          )}
        </div>

        {/* ── FOOTER ── same as InvoicePrint ── */}
        <div style={{
          borderTop: '1px solid #e5e7eb',
          marginTop: '20px',
          paddingTop: '10px',
          textAlign: 'center',
          fontSize: '9pt',
          color: '#888',
        }}>
          <p style={{ fontWeight: 600, color: '#8B0000', marginBottom: '3px' }}>
            Thank you for choosing Alim Khatoon Medicare
          </p>
          <p style={{ margin: 0 }}>
            {hospitalAddress} &nbsp;|&nbsp; Tel: {hospitalPhone} &nbsp;|&nbsp; {hospitalEmail}
          </p>
          <p style={{ margin: '4px 0 0', fontSize: '8pt', color: '#aaa' }}>
            This report is not for medicolegal proceedings and not valid for any court of law.
          </p>
        </div>

      </div>
    </>
  )
}
