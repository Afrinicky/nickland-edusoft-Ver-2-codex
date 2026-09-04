// Nickland Edusoft — Extra charges raised during the term.
//
// School fees are billed once a term. Everything else a Ghanaian school asks
// for mid-term — excursion, sports week, mock exams, BECE registration, speech
// day — is raised here and lands on the pupil's existing term bill as extra
// lines, so a parent still has one bill and one balance to settle.
import React, { useEffect, useState } from 'react';
import { useStore } from '../../store/index.js';
import { fmtCedi } from '../../lib/format.js';
import Modal from '../../components/Modal.jsx';

export default function SupplementaryTab({ overview, perms = {}, onChanged, onGoToTemplates }) {
  const currentTerm = useStore(s => s.currentTerm);
  const classes = useStore(s => s.classes);
  const showToast = useStore(s => s.showToast);
  const [templates, setTemplates] = useState([]);
  const [applying, setApplying] = useState(null);

  async function refresh() {
    const list = await window.api.fees.listTemplates({ billType: 'supplementary' });
    setTemplates(list || []);
  }
  useEffect(() => { refresh(); }, [currentTerm, overview]);

  const appliedCounts = {};
  for (const t of (overview?.supplementary_templates || [])) appliedCounts[t.id] = t.applied_to || 0;

  async function withdraw(tpl) {
    if (!window.confirm(
      `Remove "${tpl.name}" from every bill it was added to this term?\n\n` +
      `Each affected bill goes back to what it was before the charge was raised.`
    )) return;
    const res = await window.api.fees.removeSupplementary({ templateId: tpl.id, termId: currentTerm.id });
    if (!res?.ok) return showToast(res?.error || 'Could not withdraw the charge', 'error');
    showToast(`Withdrawn from ${res.removed} bill(s)`, 'success');
    refresh(); onChanged?.();
  }

  return (
    <div className="card">
      <div className="card-header">
        <div>
          <div className="card-title">Extra charges — {currentTerm?.label || 'current term'}</div>
          <div className="text-sm text-muted">
            Added on top of each pupil's existing term bill. School fees themselves are
            billed once per term from <b>Fee Templates</b>.
          </div>
        </div>
        <button className="btn btn-outline" onClick={onGoToTemplates}>+ New extra charge</button>
      </div>

      {!perms.can_manage_issued_bills && (
        <div className="text-sm text-muted" style={{ padding: '0 0 10px' }}>
          Only the Proprietor or the Super Admin can raise or withdraw an extra charge,
          because it changes bills parents have already been given.
        </div>
      )}

      <table className="table">
        <thead>
          <tr>
            <th>Charge</th><th>Applies to</th>
            <th className="text-right">Amount per pupil</th>
            <th className="text-right">Bills charged</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {templates.map(t => (
            <tr key={t.id}>
              <td className="bold">{t.name}</td>
              <td>{t.class_name || 'All classes'} · {t.term_label || 'Any term'}</td>
              <td className="text-right">{fmtCedi(t.total_amount || 0)}</td>
              <td className="text-right">
                {appliedCounts[t.id] > 0
                  ? <span className="badge badge-success">{appliedCounts[t.id]}</span>
                  : <span className="text-muted">—</span>}
              </td>
              <td className="text-right">
                {perms.can_manage_issued_bills && (
                  <>
                    <button className="btn btn-primary btn-sm" onClick={() => setApplying(t)}>
                      Raise charge
                    </button>
                    {appliedCounts[t.id] > 0 && (
                      <button className="btn btn-ghost btn-sm" onClick={() => withdraw(t)}>Withdraw</button>
                    )}
                  </>
                )}
              </td>
            </tr>
          ))}
          {templates.length === 0 && (
            <tr>
              <td colSpan="5">
                <div className="empty-state">
                  <h3>No extra charges set up</h3>
                  <p>
                    Create one in <b>Fee Templates</b> and choose the type
                    “Extra charge”. Excursions, sports week, mock exams and
                    BECE registration all belong here rather than in the term's school fees.
                  </p>
                  <button className="btn btn-outline btn-sm" onClick={onGoToTemplates}>
                    Open Fee Templates
                  </button>
                </div>
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {applying && (
        <ApplyModal template={applying} classes={classes} termId={currentTerm?.id}
          onClose={() => setApplying(null)}
          onDone={() => { setApplying(null); refresh(); onChanged?.(); }} />
      )}
    </div>
  );
}

function ApplyModal({ template, classes, termId, onClose, onDone }) {
  const showToast = useStore(s => s.showToast);
  const [scope, setScope] = useState('all');
  const [classId, setClassId] = useState('');
  const [busy, setBusy] = useState(false);

  async function apply() {
    setBusy(true);
    const res = await window.api.fees.applySupplementary({
      templateId: template.id, termId, scope,
      classId: scope === 'class' ? classId : undefined,
    });
    setBusy(false);
    if (!res?.ok) return showToast(res?.error || 'Could not raise the charge', 'error');
    showToast(
      `${template.name}: added to ${res.applied} bill(s)` +
      (res.skipped ? `, ${res.skipped} already had it` : ''),
      'success'
    );
    onDone();
  }

  return (
    <Modal title={`Raise "${template.name}"`} onClose={onClose} size="sm"
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={busy || (scope === 'class' && !classId)} onClick={apply}>
          {busy ? 'Working…' : 'Raise charge'}
        </button>
      </>}>
      <p className="text-sm">
        <b>{fmtCedi(template.total_amount || 0)}</b> per pupil is added to each matching
        term bill. Pupils who already carry this charge are skipped, so raising it twice
        by mistake cannot double-charge anyone.
      </p>
      <div className="form-group">
        <label className="label">Who is being charged?</label>
        <select className="select" value={scope} onChange={e => setScope(e.target.value)}>
          <option value="all">Every pupil with a bill this term</option>
          <option value="class">One class</option>
        </select>
      </div>
      {scope === 'class' && (
        <div className="form-group">
          <label className="label">Class</label>
          <select className="select" value={classId} onChange={e => setClassId(e.target.value)}>
            <option value="">— Choose a class —</option>
            {classes.map(c => <option key={c.id} value={c.id ?? ''}>{c.name}</option>)}
          </select>
        </div>
      )}
      <p className="text-xs text-muted">
        Pupils with no term bill yet are not charged — generate their bills first,
        then raise the charge.
      </p>
    </Modal>
  );
}
