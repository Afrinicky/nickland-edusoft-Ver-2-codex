// Nickland Edusoft — Terminal Report view
// Renders the SAME HTML template that the PDF generator produces, so the user
// sees the exact terminal-report layout before printing (#14, #15).
//
// F8b additions:
//   • Loads the four qualitative fields (Conduct / Interests / Talents /
//     Remarks) via window.api.scores.getTermSummary and pre-fills the editor.
//   • Inline editor card sits between the meta/print card and the preview.
//     Saves via window.api.scores.saveTermSummary, which UPSERTs ONLY the
//     qualitative columns (numeric fields are live-computed by F8a).
//   • After a successful save, the preview is re-fetched so the user sees
//     the change reflected immediately.
import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useStore } from '../../store/index.js';

const QUAL_FIELDS = ['conduct_traits', 'learner_interests', 'learner_talents', 'teacher_remarks'];
const EMPTY_QUAL = { conduct_traits: '', learner_interests: '', learner_talents: '', teacher_remarks: '' };

export default function ScoresReport() {
  const { studentId } = useParams();
  const navigate = useNavigate();
  const currentTerm = useStore(s => s.currentTerm);
  const showToast = useStore(s => s.showToast);

  // Preview state
  const [html, setHtml] = useState('');
  const [styles, setStyles] = useState('');
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [printing, setPrinting] = useState(false);

  // Editor state (F8b)
  const [qual, setQual] = useState(EMPTY_QUAL);
  const [lastSaved, setLastSaved] = useState(EMPTY_QUAL); // snapshot for dirty detection + discard
  const [saving, setSaving] = useState(false);
  const [editorLoading, setEditorLoading] = useState(true);

  // Re-loadable preview fetcher — invoked on mount AND after a successful save
  // so the rendered card reflects newly-saved qualitative fields.
  const loadPreview = useCallback(async () => {
    if (!currentTerm) return;
    const res = await window.api.reports.renderCardHtml({
      studentId: parseInt(studentId),
      termId: currentTerm.id,
    });
    if (res?.ok) {
      setHtml(res.html);
      setStyles(res.styles);
      setMeta(res.meta);
    } else {
      showToast(res?.error || 'Could not load report', 'error');
    }
  }, [studentId, currentTerm?.id]);

  // Initial preview load
  useEffect(() => {
    (async () => {
      setLoading(true);
      await loadPreview();
      setLoading(false);
    })();
  }, [loadPreview]);

  // Initial editor load — fetch persisted qualitative fields
  useEffect(() => {
    (async () => {
      if (!currentTerm) return;
      setEditorLoading(true);
      const res = await window.api.scores.getTermSummary(parseInt(studentId), currentTerm.id);
      const row = res?.row || {};
      const next = {
        conduct_traits:    row.conduct_traits    || '',
        learner_interests: row.learner_interests || '',
        learner_talents:   row.learner_talents   || '',
        teacher_remarks:   row.teacher_remarks   || '',
      };
      setQual(next);
      setLastSaved(next);
      setEditorLoading(false);
    })();
  }, [studentId, currentTerm?.id]);

  // Dirty flag — true if any field differs from the last saved snapshot
  const dirty = QUAL_FIELDS.some(f => (qual[f] || '') !== (lastSaved[f] || ''));

  function updateField(field, value) {
    setQual(prev => ({ ...prev, [field]: value }));
  }

  function discardChanges() {
    setQual(lastSaved);
  }

  async function saveQualitative() {
    if (!currentTerm) return;
    setSaving(true);
    const res = await window.api.scores.saveTermSummary({
      studentId: parseInt(studentId),
      termId: currentTerm.id,
      ...qual,
    });
    setSaving(false);
    if (res?.ok) {
      setLastSaved(qual);
      showToast('Qualitative assessment saved', 'success');
      // Re-fetch the preview so it reflects the newly-saved fields
      await loadPreview();
    } else {
      showToast(res?.error || 'Could not save assessment', 'error');
    }
  }

  async function printSingle() {
    setPrinting(true);
    const res = await window.api.reports.generateReportCards({
      termId: currentTerm.id,
      scope: 'selected',
      studentIds: [parseInt(studentId)],
    });
    setPrinting(false);
    if (res?.ok) {
      await window.api.app.openPdfPreview(res.path);
    } else {
      showToast(res?.error || 'Could not generate PDF', 'error');
    }
  }

  // Status pill shown next to the editor title
  const statusLabel = saving
    ? 'Saving…'
    : dirty
      ? 'Unsaved changes'
      : (editorLoading ? 'Loading…' : 'Saved');
  const statusColor = saving
    ? '#1e40af'
    : dirty
      ? '#b45309'
      : (editorLoading ? '#6b7280' : '#15803d');

  return (
    <div className="terminal-report-view">
      <div className="card no-print" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button className="btn btn-ghost btn-sm" onClick={() => navigate(-1)}>← Back</button>
        <div style={{ flex: 1 }}>
          {meta && (
            <div>
              <strong>{meta.student_name}</strong>
              <span className="text-sm text-muted">
                {' · '}{meta.class_name || '—'}{' · '}Index {meta.index_number || '—'}
              </span>
              {meta.scores_count === 0 && (
                <div className="text-xs" style={{ color: '#b45309', marginTop: 2 }}>
                  No scores recorded yet — template still renders so you can preview the layout.
                </div>
              )}
            </div>
          )}
        </div>
        <button className="btn btn-primary" onClick={printSingle} disabled={printing}>
          {printing ? 'Preparing…' : '🖨 Print Terminal Report (PDF)'}
        </button>
      </div>

      {/* F8b — Teacher's Qualitative Assessment editor */}
      <div className="card no-print" style={{ marginTop: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>
            Teacher's Qualitative Assessment
          </h3>
          <span className="text-xs" style={{ color: statusColor, fontWeight: 600 }}>
            {statusLabel}
          </span>
          <div style={{ flex: 1 }} />
          <button
            className="btn btn-ghost btn-sm"
            onClick={discardChanges}
            disabled={!dirty || saving}
            title="Restore the last saved values"
          >
            Discard changes
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={saveQualitative}
            disabled={!dirty || saving || editorLoading}
          >
            {saving ? 'Saving…' : '💾 Save'}
          </button>
        </div>
        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 10 }}>
          These four fields appear on the printed terminal report. Numeric fields
          (Position, Number on Roll, Attendance) are computed automatically — you
          don't need to enter them here.
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>Conduct Traits</label>
            <textarea
              rows="3"
              value={qual.conduct_traits}
              onChange={e => updateField('conduct_traits', e.target.value)}
              placeholder="e.g. Punctual, respectful, cooperative in class activities."
              disabled={editorLoading}
            />
          </div>
          <div className="form-group">
            <label>Learner Interests</label>
            <textarea
              rows="3"
              value={qual.learner_interests}
              onChange={e => updateField('learner_interests', e.target.value)}
              placeholder="e.g. Reading, athletics, environmental club."
              disabled={editorLoading}
            />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>Learner Talents</label>
            <textarea
              rows="3"
              value={qual.learner_talents}
              onChange={e => updateField('learner_talents', e.target.value)}
              placeholder="e.g. Public speaking, drawing, problem solving."
              disabled={editorLoading}
            />
          </div>
          <div className="form-group">
            <label>Teacher's Remarks</label>
            <textarea
              rows="3"
              value={qual.teacher_remarks}
              onChange={e => updateField('teacher_remarks', e.target.value)}
              placeholder="e.g. A bright and motivated learner. Keep it up."
              disabled={editorLoading}
            />
          </div>
        </div>
      </div>

      {loading
        ? <div className="card" style={{ padding: 40, textAlign: 'center' }}><div className="spinner" /></div>
        : (
          <div className="card" style={{ marginTop: 14, padding: 0, overflow: 'hidden' }}>
            <style dangerouslySetInnerHTML={{ __html: scopedReportStyles(styles) }} />
            <div className="report-card-frame"
                 dangerouslySetInnerHTML={{ __html: html }} />
          </div>
        )}
    </div>
  );
}

// Scope the print-only @page rules so they don't bleed into the rest of the app.
// We render the template inside a fixed-width A4-proportioned frame.
function scopedReportStyles(rawStyles) {
  return `
    .report-card-frame {
      background: #fff;
      max-width: 210mm;
      margin: 0 auto;
      padding: 12mm;
      box-shadow: 0 2px 8px rgba(0,0,0,0.08);
    }
    .report-card-frame .page { page-break-after: auto !important; padding: 0; }
    ${rawStyles}
  `;
}
