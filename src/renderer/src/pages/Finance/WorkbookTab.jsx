// Nickland Edusoft — Finance Workbook (offline continuity).
//
// One Excel file holding everything to do with money — fees, canteen, books,
// transport, other income, expenses and payroll. If the computer running the
// system is down, the school keeps trading in the workbook; when the system is
// back, the workbook is imported and nothing is lost.
//
// Import is deliberately two steps. Money must never move on a click whose
// consequences the user has not seen, so Preview runs the entire import —
// parsing, validation, duplicate detection — and reports exactly what would
// happen before anything is written.
import React, { useEffect, useState } from 'react';
import { useStore } from '../../store/index.js';
import { fmtCedi, fmtDate } from '../../lib/format.js';

export default function WorkbookTab() {
  const showToast = useStore(s => s.showToast);
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState('');
  const [picked, setPicked] = useState(null);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);

  async function refresh() {
    try {
      const s = await window.api.workbook.status();
      setStatus(s);
    } catch (_) { /* the tab still works without the status strip */ }
  }
  useEffect(() => { refresh(); }, []);

  async function exportBook(saveAs) {
    setBusy('export');
    const res = await window.api.workbook.exportBook({ saveAs });
    setBusy('');
    if (res?.cancelled) return;
    if (!res?.ok) return showToast(res?.error || 'The workbook could not be created', 'error');
    showToast(`Workbook ready — ${res.students} pupil(s) across ${res.sheets.length} sheets`, 'success');
    refresh();
  }

  async function choose() {
    const res = await window.api.workbook.pickFile();
    if (res?.cancelled) return;
    if (!res?.ok) return showToast(res?.error || 'Could not open that file', 'error');
    setPicked(res.path);
    setPreview(null);
    setResult(null);
    runPreview(res.path);
  }

  async function runPreview(filePath) {
    setBusy('preview');
    const res = await window.api.workbook.previewImport({ filePath });
    setBusy('');
    if (!res?.ok) return showToast(res?.error || 'That workbook could not be read', 'error');
    setPreview(res);
  }

  async function runImport() {
    if (!picked || !preview) return;
    if (!window.confirm(
      `Bring in ${preview.totals.imported} entr${preview.totals.imported === 1 ? 'y' : 'ies'} ` +
      `worth ${fmtCedi(preview.totals.amount)}?\n\n` +
      `Each one is recorded exactly as if it had been typed into the app: bills update, ` +
      `receipts are issued, and everything posts to the finance ledger.`
    )) return;
    setBusy('import');
    const res = await window.api.workbook.runImport({ filePath: picked });
    setBusy('');
    if (!res?.ok) return showToast(res?.error || 'The import failed', 'error');
    setResult(res);
    setPreview(null);
    showToast(
      `Imported ${res.totals.imported} entr${res.totals.imported === 1 ? 'y' : 'ies'} — ${fmtCedi(res.totals.amount)}`,
      res.totals.failed > 0 ? 'warning' : 'success'
    );
    refresh();
  }

  async function loadHistory() {
    const rows = await window.api.workbook.history(200);
    setHistory(rows || []);
    setShowHistory(true);
  }

  const canEdit = status?.can_edit !== false;

  return (
    <div className="workbook-tab">
      <div className="card" style={{ background: 'var(--info-bg)', borderLeft: '3px solid var(--info)' }}>
        <strong>Keep running when the system is down</strong>
        <div className="text-sm" style={{ marginTop: 6, lineHeight: 1.6 }}>
          The finance workbook is one Excel file holding <b>fees, canteen, books, transport,
          other income, expenses and payroll</b>. Export it and keep a copy on another
          computer or a memory stick. If this machine fails, carry on collecting in the
          workbook — then import it here and the system picks up exactly where the
          workbook left off. It is also included in every backup automatically.
        </div>
      </div>

      {/* ── Export ─────────────────────────────────────────────── */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-header">
          <div>
            <div className="card-title">1 · Take the workbook out</div>
            <div className="text-sm text-muted">
              A fresh copy of every money record as it stands right now, with blank rows ready for offline entry.
            </div>
          </div>
          <div className="row gap-2">
            <button className="btn btn-outline" disabled={busy === 'export'}
              onClick={() => exportBook(false)}>
              {busy === 'export' ? 'Building…' : 'Refresh copy'}
            </button>
            <button className="btn btn-primary" disabled={busy === 'export'}
              onClick={() => exportBook(true)}>
              📗 Export workbook
            </button>
          </div>
        </div>

        {status && (
          <div className="row gap-2" style={{ flexWrap: 'wrap', paddingTop: 4 }}>
            <Stat label="Last built"
              value={status.built_at ? fmtDate(status.built_at) : 'Never'}
              tone={status.built_at ? undefined : 'warn'} />
            <Stat label="Size" value={status.size ? `${Math.round(status.size / 1024)} KB` : '—'} />
            <Stat label="Kept in" value={status.folder} small />
            {status.path && (
              <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'center' }}
                onClick={() => window.api.workbook.reveal()}>Show the file</button>
            )}
          </div>
        )}
      </div>

      {/* ── Import ─────────────────────────────────────────────── */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-header">
          <div>
            <div className="card-title">2 · Bring the workbook back in</div>
            <div className="text-sm text-muted">
              Everything typed on the green rows is added to the system. Rows already
              here are skipped — importing the same file twice can never charge anyone twice.
            </div>
          </div>
          <button className="btn btn-primary" disabled={!canEdit || busy === 'preview'}
            onClick={choose}>
            {busy === 'preview' ? 'Reading…' : '📥 Choose workbook…'}
          </button>
        </div>

        {!canEdit && (
          <div className="text-sm" style={{ color: 'var(--warning)' }}>
            You can export the workbook, but only someone with permission to change
            finance records can import one.
          </div>
        )}

        {picked && (
          <div className="text-sm text-muted" style={{ paddingBottom: 8 }}>
            Selected: <b>{picked.split(/[\\/]/).pop()}</b>
          </div>
        )}

        {preview && <ImportReport report={preview} isPreview />}

        {preview && preview.totals.imported > 0 && (
          <div className="row gap-2" style={{ marginTop: 10 }}>
            <button className="btn btn-primary" disabled={busy === 'import'} onClick={runImport}>
              {busy === 'import'
                ? 'Importing…'
                : `Import ${preview.totals.imported} entr${preview.totals.imported === 1 ? 'y' : 'ies'} · ${fmtCedi(preview.totals.amount)}`}
            </button>
            <button className="btn btn-ghost" onClick={() => { setPicked(null); setPreview(null); }}>Cancel</button>
          </div>
        )}

        {preview && preview.totals.imported === 0 && (
          <div className="text-sm" style={{ marginTop: 8 }}>
            {preview.totals.duplicates > 0
              ? <>Nothing new to bring in — all {preview.totals.duplicates} entr{preview.totals.duplicates === 1 ? 'y is' : 'ies are'} already in the system.</>
              : <>No new entries were found. Type them on the green rows of the workbook's payment sheets, save, and choose the file again.</>}
          </div>
        )}

        {result && <ImportReport report={result} />}
      </div>

      {/* ── History ────────────────────────────────────────────── */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-header">
          <div>
            <div className="card-title">What has come in from Excel</div>
            <div className="text-sm text-muted">Every entry ever imported from a workbook, newest first.</div>
          </div>
          <button className="btn btn-outline btn-sm" onClick={loadHistory}>
            {showHistory ? 'Reload' : 'Show history'}
          </button>
        </div>
        {showHistory && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Imported</th><th>Sheet</th><th>Entry</th>
                  <th className="text-right">Amount</th><th>From file</th><th>By</th>
                </tr>
              </thead>
              <tbody>
                {history.map(h => (
                  <tr key={h.id}>
                    <td className="text-sm text-muted">{fmtDate(h.imported_at)}</td>
                    <td className="text-sm">{h.sheet}</td>
                    <td>{h.summary || '—'}</td>
                    <td className="text-right">{fmtCedi(h.amount || 0)}</td>
                    <td className="text-sm text-muted">{h.source_file}</td>
                    <td className="text-sm">{h.imported_by_name || '—'}</td>
                  </tr>
                ))}
                {history.length === 0 && (
                  <tr><td colSpan="6"><div className="empty-state">
                    <p>Nothing has been imported from a workbook yet.</p>
                  </div></td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function ImportReport({ report, isPreview }) {
  const t = report.totals;
  const active = (report.sheets || []).filter(s => s.found > 0);

  return (
    <div style={{
      marginTop: 12, padding: 12, borderRadius: 8,
      border: '1px solid var(--border)',
      background: isPreview ? 'var(--surface-2)' : 'var(--success-bg, #ECFDF5)',
    }}>
      <div className="bold" style={{ marginBottom: 8 }}>
        {isPreview ? 'Preview — nothing has been saved yet' : 'Imported'}
      </div>

      <div className="row gap-2" style={{ flexWrap: 'wrap', marginBottom: 10 }}>
        <Stat label={isPreview ? 'Will be added' : 'Added'} value={t.imported} tone="good" />
        <Stat label="Value" value={fmtCedi(t.amount)} />
        <Stat label="Already here" value={t.duplicates}
          tone={t.duplicates > 0 ? 'warn' : undefined} />
        <Stat label="Problems" value={t.failed} tone={t.failed > 0 ? 'bad' : undefined} />
      </div>

      {active.length > 0 && (
        <table className="table" style={{ marginBottom: 6 }}>
          <thead>
            <tr>
              <th>Sheet</th>
              <th className="text-right">Rows found</th>
              <th className="text-right">{isPreview ? 'To add' : 'Added'}</th>
              <th className="text-right">Already here</th>
              <th className="text-right">Problems</th>
              <th className="text-right">Value</th>
            </tr>
          </thead>
          <tbody>
            {active.map(s => (
              <tr key={s.sheet}>
                <td className="bold">{s.sheet}</td>
                <td className="text-right">{s.found}</td>
                <td className="text-right" style={{ color: s.imported ? 'var(--success)' : undefined }}>{s.imported}</td>
                <td className="text-right text-muted">{s.duplicates}</td>
                <td className="text-right" style={{ color: s.failed ? 'var(--danger)' : undefined }}>{s.failed}</td>
                <td className="text-right">{fmtCedi(s.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Problems are listed row by row so the user can fix the workbook and
          re-import — a count alone would leave them guessing. */}
      {active.some(s => s.problems.length > 0) && (
        <div style={{ marginTop: 8 }}>
          <div className="bold text-sm" style={{ color: 'var(--danger)', marginBottom: 4 }}>
            Rows that could not be brought in
          </div>
          <div style={{ maxHeight: 200, overflowY: 'auto' }}>
            {active.flatMap(s => s.problems.map((p, i) => (
              <div key={`${s.sheet}-${i}`} className="text-sm"
                style={{ padding: '3px 0', borderBottom: '1px solid var(--border)' }}>
                <b>{s.sheet}</b>, row {p.row}: {p.error}
              </div>
            )))}
          </div>
          <div className="text-xs text-muted" style={{ marginTop: 6 }}>
            Correct these in the workbook and import it again — everything that succeeded
            is remembered, so only the fixed rows will come in.
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone, small }) {
  const color = tone === 'good' ? 'var(--success)'
    : tone === 'bad' ? 'var(--danger)'
    : tone === 'warn' ? 'var(--warning)'
    : 'var(--fg)';
  return (
    <div style={{ flex: '1 1 150px', minWidth: 130 }}>
      <div className="text-xs text-muted" style={{ textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div className="bold" style={{ fontSize: small ? 11 : 18, color, lineHeight: 1.35, wordBreak: 'break-all' }}>
        {value}
      </div>
    </div>
  );
}
