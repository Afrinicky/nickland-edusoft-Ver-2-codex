// Nickland Edusoft — Extra charges raised during the term.
//
// School fees are billed once a term. Everything else a Ghanaian school asks
// for mid-term — excursion, sports week, mock exams, BECE registration, speech
// day — is raised here and lands on the pupil's existing term bill as extra
// lines, so a parent still has one bill and one balance to settle rather than
// three pieces of paper and an argument at the gate.
//
// A charge is now written HERE rather than in a separate templates tab. It was
// the only tab that sent you somewhere else to do the first half of its own
// job, and "create it over there, then come back and raise it" is a step
// schools skipped, ending up with charges defined and never billed.
import React, { useEffect, useState } from 'react';
import { useStore } from '../../store/index.js';
import { fmtCedi, termLabel } from '../../lib/format.js';
import { previewBills } from '../../lib/printHelpers.js';
import Modal from '../../components/Modal.jsx';

export default function SupplementaryTab({ overview, perms = {}, onChanged }) {
  const currentTerm = useStore(s => s.currentTerm);
  const classes = useStore(s => s.classes);
  const showToast = useStore(s => s.showToast);
  const [templates, setTemplates] = useState([]);
  const [applying, setApplying] = useState(null);
  const [editing, setEditing] = useState(null);

  async function refresh() {
    const list = await window.api.fees.listTemplates({ billType: 'supplementary' });
    setTemplates((list || []).filter(t => t.is_active));
  }
  useEffect(() => { refresh(); }, [currentTerm, overview]);

  const appliedCounts = {};
  for (const t of (overview?.supplementary_templates || [])) appliedCounts[t.id] = t.applied_to || 0;

  async function withdraw(tpl) {
    if (!window.confirm(
      `Remove "${tpl.name}" from every bill it was added to this term?\n\n`
      + 'Each affected bill goes back to what it was before the charge was raised.'
    )) return;
    const res = await window.api.fees.removeSupplementary({ templateId: tpl.id, termId: currentTerm.id });
    if (!res?.ok) return showToast(res?.error || 'Could not withdraw the charge', 'error');
    showToast(`Withdrawn from ${res.removed} bill(s)`, 'success');
    refresh(); onChanged?.();
  }

  // A parent asked for an excursion fee wants the bill it appears on, and the
  // extras print on the term bill as Part D — so printing here prints the same
  // document the fees tab does, for the pupils who actually carry the charge.
  async function printCharged(tpl) {
    const bills = await window.api.fees.listBills({ termId: currentTerm.id });
    const ids = (bills || []).filter(b => (b.supplementary_total || 0) > 0).map(b => b.id);
    if (!ids.length) return showToast('No bill carries an extra charge yet', 'warning');
    const r = await previewBills(ids);
    if (!r.ok) return showToast(r.error, 'error');
    showToast(`${ids.length} bill(s) ready to print`, 'success');
  }

  return (
    <div className="card">
      <div className="card-header">
        <div>
          <div className="card-title">Extra charges — {termLabel(currentTerm, 'current term')}</div>
          <div className="text-sm text-muted">
            Added on top of each pupil's existing term bill, and printed on it as
            <b> Part D</b>. The term's school fees themselves are raised under
            <b> School Fees</b>.
          </div>
        </div>
        <div className="row gap-2">
          {templates.some(t => appliedCounts[t.id] > 0) && (
            <button className="btn btn-outline" onClick={printCharged}>🖨 Print charged bills</button>
          )}
          <button className="btn btn-primary" onClick={() => setEditing({
            bill_type: 'supplementary', name: '', class_group_id: '',
            term_id: currentTerm?.id || '', items: [{ item_number: 1, description: '', amount: '' }],
            is_active: 1,
          })}>+ New extra charge</button>
        </div>
      </div>

      {!perms.can_manage_issued_bills && (
        <div className="text-sm text-muted" style={{ padding: '0 0 10px' }}>
          Only the Proprietor or the Super Admin can raise or withdraw an extra charge,
          because it changes bills parents have already been given.
        </div>
      )}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Charge</th><th>Applies to</th>
              <th className="text-right">Per pupil</th>
              <th className="text-right">Bills charged</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {templates.map(t => (
              <tr key={t.id}>
                <td className="bold">{t.name}</td>
                <td>{t.class_name || 'All classes'} · {termLabel(t, 'Any term')}</td>
                <td className="text-right">{fmtCedi(t.total_amount || 0)}</td>
                <td className="text-right">
                  {appliedCounts[t.id] > 0
                    ? <span className="badge badge-success">{appliedCounts[t.id]}</span>
                    : <span className="text-muted">—</span>}
                </td>
                <td className="text-right">
                  <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
                    <button className="btn btn-ghost btn-sm" onClick={async () => {
                      const full = await window.api.fees.getTemplate(t.id);
                      setEditing(full);
                    }}>Edit</button>
                    {perms.can_manage_issued_bills && (
                      <>
                        <button className="btn btn-primary btn-sm" onClick={() => setApplying(t)}>
                          Raise charge
                        </button>
                        {appliedCounts[t.id] > 0 && (
                          <button className="btn btn-outline btn-sm" onClick={() => withdraw(t)}>Withdraw</button>
                        )}
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {templates.length === 0 && (
              <tr>
                <td colSpan="5">
                  <div className="empty-state">
                    <h3>Nothing raised on top of the term bill</h3>
                    <p>
                      Excursions, sports week, mock exams and BECE registration belong
                      here rather than in the term's school fees — a parent still gets
                      one bill and one balance.
                    </p>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <ChargeEditor charge={editing} classes={classes} currentTerm={currentTerm}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refresh(); onChanged?.(); showToast('Charge saved', 'success'); }} />
      )}
      {applying && (
        <ApplyModal template={applying} classes={classes} termId={currentTerm?.id}
          onClose={() => setApplying(null)}
          onDone={() => { setApplying(null); refresh(); onChanged?.(); }} />
      )}
    </div>
  );
}

// ── Writing a charge ────────────────────────────────────────────────────────
// Most extras are one line with one figure, so the editor opens as one line
// with one figure. The published list is offered because "what do other schools
// call this" is the question that stalls a bursar for ten minutes.
function ChargeEditor({ charge, classes, currentTerm, onClose, onSaved }) {
  const showToast = useStore(s => s.showToast);
  const [terms, setTerms] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [data, setData] = useState({
    ...charge,
    items: charge.items?.length ? charge.items : [{ item_number: 1, description: '', amount: '' }],
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    window.api.settings.listTerms().then(t => setTerms(t || [])).catch(() => {});
    window.api.fees.frameworks('supplementary')
      .then(list => setSuggestions((list?.[0]?.parts?.[0]?.items) || []))
      .catch(() => {});
  }, []);

  const total = data.items.reduce((s, i) => s + (parseFloat(i.amount) || 0), 0);

  async function save() {
    if (!String(data.name || '').trim()) return showToast('Give the charge a name', 'warning');
    const usable = data.items.filter(i => String(i.description || '').trim());
    if (!usable.length) return showToast('Add at least one line', 'warning');
    setBusy(true);
    const res = await window.api.fees.saveTemplate({
      ...data,
      bill_type: 'supplementary',
      items: usable,
      class_group_id: data.class_group_id || null,
      term_id: data.term_id || null,
    });
    setBusy(false);
    if (!res?.ok) return showToast(res?.error || 'Could not save', 'error');
    onSaved();
  }

  function setItem(i, field, value) {
    setData(d => ({ ...d, items: d.items.map((it, idx) => (idx === i ? { ...it, [field]: value } : it)) }));
  }

  return (
    <Modal title={data.id ? `Edit “${data.name}”` : 'A new extra charge'} onClose={onClose} size="md"
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={busy} onClick={save}>
          {busy ? 'Saving…' : 'Save the charge'}
        </button>
      </>}>
      <div className="form-group">
        <label className="label">What it is called</label>
        <input className="input" value={data.name ?? ''}
          placeholder="e.g. Excursion — Kakum National Park"
          onChange={e => setData(d => ({ ...d, name: e.target.value }))} />
        {suggestions.length > 0 && !data.id && (
          <div className="row gap-2" style={{ flexWrap: 'wrap', marginTop: 6 }}>
            {suggestions.map(s => (
              <button key={s.description} className="btn btn-outline btn-sm"
                onClick={() => setData(d => ({
                  ...d,
                  name: d.name || s.description,
                  items: [{ item_number: 1, description: s.description, amount: d.items[0]?.amount ?? '' }],
                }))}>{s.description}</button>
            ))}
          </div>
        )}
      </div>

      <div className="form-row">
        <div className="form-group">
          <label className="label">Class</label>
          <select className="select" value={data.class_group_id || ''}
            onChange={e => setData(d => ({ ...d, class_group_id: parseInt(e.target.value, 10) || null }))}>
            <option value="">— All classes —</option>
            {classes.map(c => <option key={c.id} value={c.id ?? ''}>{c.name}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="label">Term</label>
          <select className="select" value={data.term_id || ''}
            onChange={e => setData(d => ({ ...d, term_id: parseInt(e.target.value, 10) || null }))}>
            <option value="">— Any term —</option>
            {terms.map(t => <option key={t.id} value={t.id}>{termLabel(t)}</option>)}
          </select>
          <div className="text-xs text-muted">
            Every academic year has a term by the same name — check the year beside it.
          </div>
        </div>
      </div>

      <table className="table">
        <thead>
          <tr><th>What the parent is being asked for</th>
            <th className="text-right" style={{ width: 140 }}>Amount</th>
            <th style={{ width: 40 }}></th></tr>
        </thead>
        <tbody>
          {data.items.map((item, i) => (
            <tr key={i}>
              <td>
                <input className="input" value={item.description ?? ''}
                  onChange={e => setItem(i, 'description', e.target.value)} />
              </td>
              <td>
                <input className="input text-right" type="number" step="0.01" value={item.amount ?? ''}
                  onChange={e => setItem(i, 'amount', e.target.value)} />
              </td>
              <td>
                <button className="btn btn-ghost btn-sm"
                  onClick={() => setData(d => ({ ...d, items: d.items.filter((_, idx) => idx !== i) }))}>✕</button>
              </td>
            </tr>
          ))}
          <tr>
            <td className="text-right bold">Per pupil</td>
            <td className="text-right bold">{fmtCedi(total)}</td>
            <td></td>
          </tr>
        </tbody>
      </table>
      <button className="btn btn-outline btn-sm"
        onClick={() => setData(d => ({
          ...d, items: [...d.items, { item_number: d.items.length + 1, description: '', amount: '' }],
        }))}>+ Add a line</button>

      <p className="text-xs text-muted" style={{ marginTop: 10 }}>
        Saving does not charge anybody. The charge is raised against a class, or the
        whole school, from the list — and raising it twice cannot double-charge.
      </p>
    </Modal>
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
      `${template.name}: added to ${res.applied} bill(s)`
      + (res.skipped ? `, ${res.skipped} already had it` : ''),
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
        Pupils with no term bill yet are not charged — raise the term's school fees first,
        then raise the charge.
      </p>
    </Modal>
  );
}
