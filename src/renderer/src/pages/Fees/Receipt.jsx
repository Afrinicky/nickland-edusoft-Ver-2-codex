// Nickland Edusoft — The receipt, on the screen.
//
// A parent who has just handed over money watches the counter until they are
// given something. Producing a PDF and opening a preview window takes long
// enough for that pause to become a conversation, so the receipt is drawn
// here, immediately, at the size it will print — and the print button then
// produces the same document as a PDF.
//
// ── Why it is 80mm wide on screen ───────────────────────────────────────────
//
// Because that is what comes out of the printer. A receipt previewed at page
// width and printed on a roll is two different documents, and the difference
// is always discovered by a parent holding one that has been cut in half.
// The preview is drawn at the configured paper's real width, so what is on
// the screen is what is in the hand.
import React from 'react';
import { fmtCedi } from '../../lib/format.js';

const PAPER = {
  roll80: { width: 80, roll: true, label: '80 mm thermal roll' },
  roll58: { width: 58, roll: true, label: '58 mm thermal roll' },
  A4: { width: 210, roll: false, label: 'A4' },
  A5: { width: 148, roll: false, label: 'A5' },
  Letter: { width: 216, roll: false, label: 'Letter' },
};

// Screen millimetres. A CSS pixel is 1/96in, a millimetre 1/25.4in, so one
// millimetre is 96/25.4 ≈ 3.78px — the receipt is drawn at its true size.
const MM = 96 / 25.4;

export default function Receipt({ receipt, onPrint, onClose, busy }) {
  if (!receipt) return null;
  const paper = PAPER[receipt.paper_size] || PAPER.roll80;
  const roll = paper.roll;
  const school = receipt.school || {};
  const width = Math.round(paper.width * MM);

  const lines = (receipt.lines || []).filter(([, v]) => v !== undefined && v !== null && v !== '');

  return (
    <div className="card" style={{ display: 'grid', gap: 12, justifyItems: 'center' }}>
      <div className="row gap-2 no-print" style={{ width: '100%', alignItems: 'center' }}>
        <div>
          <div className="card-title">Receipt {receipt.receipt_number}</div>
          <div className="text-sm text-muted">
            {paper.label} · {receipt.date_long} {receipt.time}
          </div>
        </div>
        <div className="flex-1"></div>
        <button className="btn btn-primary" disabled={busy} onClick={onPrint}>
          {busy ? 'Preparing…' : '🖨 Print the receipt'}
        </button>
        {onClose && <button className="btn btn-ghost" onClick={onClose}>Done</button>}
      </div>

      {/* The receipt itself, at the width it prints at. */}
      <div className="receipt-preview" style={{
        width, maxWidth: '100%', background: '#fff', color: '#111',
        padding: roll ? '3mm' : '10mm',
        border: '1px solid var(--border)', borderRadius: 4,
        fontFamily: "'Segoe UI', Arial, sans-serif",
        fontSize: roll ? 10 : 12, lineHeight: 1.35,
        boxShadow: '0 1px 6px rgba(0,0,0,0.12)',
      }}>
        {/* Header */}
        <div style={{
          textAlign: roll ? 'center' : 'left',
          borderBottom: roll ? '1px dashed #999' : `2px solid ${school.primary || '#1B3A6B'}`,
          paddingBottom: 6, marginBottom: 8,
          display: roll ? 'block' : 'flex', gap: 12, alignItems: 'center',
        }}>
          {school.logo && (
            <img src={school.logo} alt="" style={{ height: roll ? 34 : 52, display: roll ? 'inline' : 'block' }} />
          )}
          <div>
            <div style={{
              fontWeight: 800, color: school.primary || '#1B3A6B',
              fontSize: roll ? 12 : 17, letterSpacing: 0.3,
            }}>{school.name}</div>
            {!roll && school.motto && (
              <div style={{ fontStyle: 'italic', color: school.accent || '#C9961A', fontSize: 10 }}>
                “{school.motto}”
              </div>
            )}
            {!roll && <div style={{ fontSize: 10, color: '#444' }}>{school.address}</div>}
            <div style={{ fontSize: roll ? 9 : 10, color: '#444' }}>
              {[school.phone, !roll && school.email].filter(Boolean).join(' | ')}
            </div>
          </div>
        </div>

        <div style={{
          textAlign: 'center', fontWeight: 700, padding: 4, margin: '6px 0',
          background: roll ? '#000' : (school.primary || '#1B3A6B'), color: '#fff',
          fontSize: roll ? 11 : 14,
        }}>{receipt.title}</div>

        <Rows roll={roll}>
          <Row k="Receipt No." v={receipt.receipt_number} strong accent={school.accent} />
          <Row k="Date" v={`${receipt.date_long} ${receipt.time}`} />
          <Row k="Student" v={receipt.student_name} />
          <Row k="Index No." v={receipt.student_index} />
          {receipt.student_class && <Row k="Class" v={receipt.student_class} />}
          {receipt.term && <Row k="Term" v={`${receipt.term} ${receipt.academic_year || ''}`.trim()} />}
          <Row k="Paid For" v={receipt.purpose_label} strong />
        </Rows>

        <div style={{ border: `1.5px solid ${school.primary || '#1B3A6B'}`, marginTop: 8 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              <tr>
                <td style={{ padding: '4px 6px' }}>Amount Paid</td>
                <td style={{
                  padding: '4px 6px', textAlign: 'right', fontWeight: 800,
                  fontSize: roll ? 14 : 18, color: school.primary || '#1B3A6B',
                }}>{fmtCedi(receipt.amount)}</td>
              </tr>
              <tr>
                <td style={{ padding: '2px 6px' }}>Payment Method</td>
                <td style={{ padding: '2px 6px', textAlign: 'right' }}>{receipt.payment_method}</td>
              </tr>
              {receipt.reference && (
                <tr>
                  <td style={{ padding: '2px 6px' }}>Reference</td>
                  <td style={{ padding: '2px 6px', textAlign: 'right' }}>{receipt.reference}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div style={{ fontStyle: 'italic', fontSize: roll ? 9 : 10, marginTop: 6, color: '#333' }}>
          {receipt.amount_in_words}
        </div>

        {lines.length > 0 && (
          <Rows roll={roll} style={{ marginTop: 8 }}>
            {lines.map(([k, v]) => (
              <Row key={k} k={k} v={typeof v === 'number' ? fmtCedi(v) : String(v)} />
            ))}
          </Rows>
        )}

        {receipt.status && (
          <div style={{
            display: 'inline-block', marginTop: 6, padding: '1px 8px', borderRadius: 10,
            fontWeight: 700, fontSize: 10,
            background: `${school.accent || '#C9961A'}22`, color: school.accent || '#C9961A',
          }}>{receipt.status}</div>
        )}

        <div style={{ fontSize: roll ? 9 : 10, color: '#444', marginTop: 8 }}>
          Received by: {receipt.received_by || '—'}
        </div>
        {!roll && (
          <div style={{ marginTop: 28, textAlign: 'right', fontSize: 11 }}>
            _______________________<br />Authorised Signature
          </div>
        )}
        <div style={{ marginTop: 12, textAlign: 'center', fontSize: roll ? 9 : 10, color: '#555' }}>
          {school.footer}
        </div>
      </div>
    </div>
  );
}

function Rows({ children, roll, style }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: roll ? 10 : 12, ...style }}>
      <tbody>{children}</tbody>
    </table>
  );
}

function Row({ k, v, strong, accent }) {
  return (
    <tr>
      <td style={{ padding: '2px 3px', color: '#555', width: '42%' }}>{k}</td>
      <td style={{
        padding: '2px 3px', textAlign: 'right',
        fontWeight: strong ? 800 : 400, color: strong && accent ? accent : undefined,
      }}>{v}</td>
    </tr>
  );
}
