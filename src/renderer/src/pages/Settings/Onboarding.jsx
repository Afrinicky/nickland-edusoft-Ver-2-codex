// Nickland Edusoft — Onboarding: bringing a school's records across.
//
// A school arriving on the system already has its records. They are in Excel,
// in a ledger, or in both, and retyping four hundred pupils is the reason a
// school puts off moving for a term. This page is the way out of that: take a
// template, paste the school's own data into it, and bring it in.
//
// It is the finance workbook's shape, pointed the other way, and it keeps that
// page's rule about seeing before doing: nothing is written until the school
// has looked at what the import would do. Onboarding is the one moment there is
// no earlier state to go back to, so that rule matters more here than anywhere.
import React, { useEffect, useState } from 'react';
import { useStore } from '../../store/index.js';
import { fmtDate } from '../../lib/format.js';

export default function Onboarding() {
  const showToast = useStore(s => s.showToast);
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState('');
  const [picked, setPicked] = useState(null);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);

  async function refresh() {
    try { setStatus(await window.api.onboarding.status()); } catch (_) {}
  }
  useEffect(() => { refresh(); }, []);

  async function exportBook(filled) {
    setBusy(filled ? 'export-filled' : 'export-blank');
    const res = await window.api.onboarding.exportBook({ filled, saveAs: true });
    setBusy('');
    if (res?.cancelled) return;
    if (!res?.ok) return showToast(res?.error || 'The workbook could not be created', 'error');
    showToast(filled ? 'The school’s records are in the workbook' : 'Blank template saved', 'success');
    refresh();
  }

  async function choose() {
    const res = await window.api.onboarding.pickFile();
    if (res?.cancelled) return;
    if (!res?.ok) return showToast(res?.error || 'Could not open that file', 'error');
    setPicked(res.path);
    setPreview(null);
    setResult(null);
    runPreview(res.path);
  }

  async function runPreview(filePath) {
    setBusy('preview');
    const res = await window.api.onboarding.preview({ filePath });
    setBusy('');
    if (!res?.ok) return showToast(res?.error || 'That workbook could not be read', 'error');
    setPreview(res);
  }

  async function runImport() {
    if (!picked || !preview) return;
    const { created, updated } = preview.totals;
    if (!window.confirm(
      `Bring in ${created} new record${created === 1 ? '' : 's'} and correct ${updated}?\n\n` +
      `Each one is written exactly as if it had been typed into the app. ` +
      `You can import this file again afterwards to correct anything that came in wrong.`
    )) return;
    setBusy('import');
    const res = await window.api.onboarding.runImport({ filePath: picked });
    setBusy('');
    if (!res?.ok) return showToast(res?.error || 'The import failed', 'error');
    setResult(res);
    setPreview(null);
    showToast(
      `${res.totals.created} brought in, ${res.totals.updated} corrected`,
      res.totals.failed > 0 ? 'warning' : 'success');
    refresh();
  }

  const canEdit = status?.can_edit !== false;
  const h = status?.holdings;
  // A school with no pupils and no staff has not been set up yet, and should be
  // told where to start rather than shown six buttons.
  const fresh = h && !h.students && !h.staff;

  return (
    <div>
      <div className="card" style={{ background: 'var(--info-bg)', borderLeft: '3px solid var(--info)' }}>
        <strong>Bring the school's records across</strong>
        <div className="text-sm" style={{ marginTop: 6, lineHeight: 1.6 }}>
          One Excel file holds <b>the roll, the staff, the classes, the subjects, the
          grading scale, the fee schedule and what each pupil still owes</b>. Copy the
          school's existing records into it, bring it in here, and the school is running.
          {' '}Import the same file again whenever you find something wrong in it — it
          corrects what is already there rather than creating it twice.
        </div>
      </div>

      {fresh && (
        <div className="card" style={{ marginTop: 16, background: 'var(--warning-bg, #FFF8E1)',
                                       borderLeft: '3px solid var(--warning)' }}>
          <strong>This school has no pupils or staff yet</strong>
          <div className="text-sm" style={{ marginTop: 6, lineHeight: 1.6 }}>
            Start with <b>Download the template</b> below, fill in the tabs in the order
            they appear, and come back to step 3.
          </div>
        </div>
      )}

      {/* ── 1 · The template ───────────────────────────────────── */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-header">
          <div>
            <div className="card-title">1 · Take a template</div>
            <div className="text-sm text-muted">
              A blank workbook with every tab, its headings, and a worked example
              under each one showing what the column expects.
            </div>
          </div>
          <button className="btn btn-primary" disabled={busy === 'export-blank'}
            onClick={() => exportBook(false)}>
            {busy === 'export-blank' ? 'Building…' : '📘 Download the template'}
          </button>
        </div>

        {status?.sheets && (
          <div className="text-sm text-muted" style={{ paddingTop: 4, lineHeight: 1.7 }}>
            <b>The tabs, in the order they must be filled in:</b>{' '}
            {status.sheets.map((s, i) => (
              <span key={s.sheet}>{i > 0 && ' · '}<span title={s.help}>{s.sheet}</span></span>
            ))}
          </div>
        )}
      </div>

      {/* ── 2 · What the school already holds ──────────────────── */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-header">
          <div>
            <div className="card-title">2 · Or take out what is already here</div>
            <div className="text-sm text-muted">
              The same workbook, carrying everything the system currently holds. Correcting
              four hundred phone numbers is a two-minute job in Excel and an afternoon here.
            </div>
          </div>
          <button className="btn btn-outline" disabled={busy === 'export-filled'}
            onClick={() => exportBook(true)}>
            {busy === 'export-filled' ? 'Building…' : '📗 Export the school'}
          </button>
        </div>

        {h && (
          <div className="row gap-2" style={{ flexWrap: 'wrap', paddingTop: 4 }}>
            <Stat label="Pupils" value={h.students} />
            <Stat label="Staff" value={h.staff} />
            <Stat label="Classes" value={h.classes} />
            <Stat label="Subjects" value={h.subjects} />
            <Stat label="Parent accounts" value={h.parents} />
            <Stat label="Fee schedules" value={h.fee_templates} />
          </div>
        )}
      </div>

      {/* ── 3 · Bring it in ────────────────────────────────────── */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-header">
          <div>
            <div className="card-title">3 · Bring the filled-in workbook in</div>
            <div className="text-sm text-muted">
              Nothing is written until you have seen what it would do.
            </div>
          </div>
          <button className="btn btn-primary" disabled={!canEdit || busy === 'preview'}
            onClick={choose}>
            {busy === 'preview' ? 'Reading…' : '📥 Choose workbook…'}
          </button>
        </div>

        {!canEdit && (
          <div className="text-sm" style={{ color: 'var(--warning)' }}>
            You can take a template out, but only someone with permission to change the
            school's settings can bring one in.
          </div>
        )}

        {picked && (
          <div className="text-sm text-muted" style={{ paddingBottom: 8 }}>
            Selected: <b>{picked.split(/[\\/]/).pop()}</b>
          </div>
        )}

        {preview && <ImportReport report={preview} isPreview />}

        {preview && (preview.totals.created > 0 || preview.totals.updated > 0) && (
          <div className="row gap-2" style={{ marginTop: 10 }}>
            <button className="btn btn-primary" disabled={busy === 'import'} onClick={runImport}>
              {busy === 'import'
                ? 'Importing…'
                : `Bring in ${preview.totals.created} · correct ${preview.totals.updated}`}
            </button>
            <button className="btn btn-ghost" onClick={() => { setPicked(null); setPreview(null); }}>
              Cancel
            </button>
          </div>
        )}

        {preview && preview.totals.created === 0 && preview.totals.updated === 0 && (
          <div className="text-sm" style={{ marginTop: 8 }}>
            {preview.totals.failed > 0
              ? <>Nothing can be brought in until the problems listed above are fixed in the workbook.</>
              : <>Nothing to bring in. Fill in the tabs underneath the grey example rows, save the file, and choose it again.</>}
          </div>
        )}

        {result && <ImportReport report={result} />}
      </div>

      {status?.last_import && (
        <div className="text-sm text-muted" style={{ marginTop: 12 }}>
          Last import: {fmtDate(status.last_import.created_at)} — {status.last_import.justification}
        </div>
      )}
    </div>
  );
}

// ── The report ───────────────────────────────────────────────────────────
// The same component for the preview and the result, because they say the same
// thing and a school comparing "what it said it would do" against "what it did"
// should not have to compare two different layouts.
function ImportReport({ report, isPreview }) {
  const t = report.totals;
  const worked = report.sheets.filter(s => s.found > 0);
  return (
    <div style={{ marginTop: 12 }}>
      <div className="row gap-2" style={{ flexWrap: 'wrap' }}>
        <Stat label={isPreview ? 'Would be brought in' : 'Brought in'} value={t.created} tone="good" />
        <Stat label={isPreview ? 'Would be corrected' : 'Corrected'} value={t.updated} />
        <Stat label="Left alone" value={t.skipped} />
        <Stat label="Could not be read" value={t.failed} tone={t.failed ? 'warn' : undefined} />
      </div>

      {!worked.length && (
        <div className="text-sm text-muted" style={{ marginTop: 8 }}>
          None of the tabs had anything on them.
        </div>
      )}

      {worked.map(s => (
        <div key={s.sheet} style={{ marginTop: 10 }}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
            <b className="text-sm">{s.sheet}</b>
            <span className="text-sm text-muted">
              {s.created} new · {s.updated} corrected
              {s.skipped ? ` · ${s.skipped} left alone` : ''}
              {s.failed ? ` · ${s.failed} refused` : ''}
            </span>
          </div>

          {s.problems.length > 0 && (
            <ul className="text-sm" style={{ margin: '4px 0 0', paddingLeft: 18, color: 'var(--danger)' }}>
              {s.problems.slice(0, 25).map((p, i) => (
                <li key={i}>{p.row ? `Row ${p.row}: ` : ''}{p.error}</li>
              ))}
              {s.problems.length > 25 && (
                <li className="text-muted">…and {s.problems.length - 25} more.</li>
              )}
            </ul>
          )}
        </div>
      ))}

      {report.missing_sheets?.length > 0 && (
        <div className="text-sm text-muted" style={{ marginTop: 10 }}>
          Not in the file, so nothing was done for {report.missing_sheets.join(', ')}.
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }) {
  const colour = tone === 'good' ? 'var(--success)' : tone === 'warn' ? 'var(--warning)' : undefined;
  return (
    <div className="card" style={{ padding: '8px 12px', margin: 0, minWidth: 110 }}>
      <div className="text-sm text-muted">{label}</div>
      <div style={{ fontWeight: 600, fontSize: 18, color: colour }}>{value}</div>
    </div>
  );
}
