// Nickland Edusoft — Fee templates.
//
// A template is the schedule a bill is made from. Two kinds, matching how
// Ghanaian private schools bill:
//
//   • School fees — one per class per term. The system refuses a second one
//     for the same class and term and offers to replace it instead, because
//     two live school-fees schedules for one term is always a mistake.
//   • Extra charge — an in-term levy (excursion, sports week, BECE
//     registration) raised on top of pupils' existing term bills.
//
// Starting a template is the step schools stall on, so there are three ways in:
// copy last term's and adjust, pick from a preset list of the line items
// Ghanaian schools actually bill, or type it out.
import React, { useEffect, useState } from 'react';
import { useStore } from '../../store/index.js';
import { fmtCedi } from '../../lib/format.js';
import Modal from '../../components/Modal.jsx';

const SCHOOL_FEES = 'school_fees';
const SUPPLEMENTARY = 'supplementary';

export default function TemplatesTab({ onChanged }) {
  const showToast = useStore(s => s.showToast);
  const currentTerm = useStore(s => s.currentTerm);
  const [templates, setTemplates] = useState([]);
  const [terms, setTerms] = useState([]);
  const [editing, setEditing] = useState(null);
  const [copying, setCopying] = useState(false);
  const [showInactive, setShowInactive] = useState(false);

  async function refresh() {
    const [list, ts] = await Promise.all([
      window.api.fees.listTemplates(),
      window.api.settings.listTerms ? window.api.settings.listTerms() : Promise.resolve([]),
    ]);
    setTemplates(list || []);
    setTerms(ts || []);
  }
  useEffect(() => { refresh(); }, []);

  function openNew(billType) {
    setEditing({
      name: '', class_group_id: '', term_id: currentTerm?.id || '',
      bill_type: billType, items: [], is_active: 1,
    });
  }
  async function openEdit(tpl) {
    const full = await window.api.fees.getTemplate(tpl.id);
    setEditing(full);
  }
  async function remove(tpl) {
    if (!window.confirm(`Delete the template "${tpl.name}"?`)) return;
    const res = await window.api.fees.deleteTemplate(tpl.id);
    if (!res?.ok) return showToast(res?.error || 'Could not delete', 'error');
    // A template that has already produced bills is retired instead of deleted,
    // so say which happened rather than reporting a delete that did not occur.
    showToast(res.message || 'Template deleted', res.retired ? 'warning' : 'success');
    refresh(); onChanged?.();
  }

  const visible = templates.filter(t => showInactive || t.is_active);
  const fees = visible.filter(t => (t.bill_type || SCHOOL_FEES) === SCHOOL_FEES);
  const extras = visible.filter(t => t.bill_type === SUPPLEMENTARY);

  return (
    <div>
      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">School fees schedules</div>
            <div className="text-sm text-muted">
              What every pupil in a class is billed for the term. One per class per term.
            </div>
          </div>
          <div className="row gap-2">
            <label className="row gap-2 text-sm">
              <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
              Show retired
            </label>
            <button className="btn btn-outline" onClick={() => setCopying(true)}>
              ⇄ Copy a previous term
            </button>
            <button className="btn btn-primary" onClick={() => openNew(SCHOOL_FEES)}>
              + New school fees
            </button>
          </div>
        </div>
        <TemplateTable rows={fees} onEdit={openEdit} onDelete={remove} emptyHint={
          <>No fee schedule yet — pupils cannot be billed until one exists. Start from a
          previous term, or create one and pick the standard items from the preset list.</>
        } />
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-header">
          <div>
            <div className="card-title">Extra charges</div>
            <div className="text-sm text-muted">
              In-term levies added on top of existing bills. Raise them from
              <b> Bills → Extra Charges</b>.
            </div>
          </div>
          <button className="btn btn-outline" onClick={() => openNew(SUPPLEMENTARY)}>
            + New extra charge
          </button>
        </div>
        <TemplateTable rows={extras} onEdit={openEdit} onDelete={remove}
          emptyHint={<>Nothing set up. Excursions, sports week, mock exams and BECE
            registration belong here, not in the term's school fees.</>} />
      </div>

      {editing && (
        <TemplateEditor template={editing} terms={terms}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refresh(); onChanged?.(); showToast('Template saved', 'success'); }}
        />
      )}
      {copying && (
        <CopyForwardModal terms={terms}
          onClose={() => setCopying(false)}
          onDone={() => { setCopying(false); refresh(); onChanged?.(); }} />
      )}
    </div>
  );
}

function TemplateTable({ rows, onEdit, onDelete, emptyHint }) {
  return (
    <table className="table">
      <thead>
        <tr>
          <th>Name</th><th>Class</th><th>Term</th>
          <th className="text-right">Items</th>
          <th className="text-right">Total per pupil</th>
          <th>Status</th><th></th>
        </tr>
      </thead>
      <tbody>
        {rows.map(t => (
          <tr key={t.id}>
            <td className="bold">{t.name}</td>
            <td>{t.class_name || 'All classes'}</td>
            <td>{t.term_label || 'All terms'}</td>
            <td className="text-right">{t.item_count ?? '—'}</td>
            <td className="text-right bold">{fmtCedi(t.total_amount || 0)}</td>
            <td>
              {t.is_active
                ? <span className="badge badge-success">Active</span>
                : <span className="badge badge-muted">Retired</span>}
            </td>
            <td className="text-right">
              <button className="btn btn-outline btn-sm" onClick={() => onEdit(t)}>Edit</button>
              <button className="btn btn-ghost btn-sm" onClick={() => onDelete(t)}>Delete</button>
            </td>
          </tr>
        ))}
        {rows.length === 0 && (
          <tr><td colSpan="7"><div className="empty-state"><p>{emptyHint}</p></div></td></tr>
        )}
      </tbody>
    </table>
  );
}

function TemplateEditor({ template, terms, onClose, onSaved }) {
  const classes = useStore(s => s.classes);
  const showToast = useStore(s => s.showToast);
  const [data, setData] = useState({
    bill_type: SCHOOL_FEES,
    ...template,
    items: template.items && template.items.length > 0
      ? template.items
      : [{ item_number: 1, description: '', amount: '' }],
  });
  const [presets, setPresets] = useState([]);
  const [showPresets, setShowPresets] = useState(false);
  const [clash, setClash] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    window.api.fees.templatePresets().then(p => setPresets(p || [])).catch(() => {});
  }, []);

  function addItem() {
    setData(d => ({ ...d, items: [...d.items, { item_number: d.items.length + 1, description: '', amount: '' }] }));
  }
  function removeItem(i) {
    setData(d => ({ ...d, items: d.items.filter((_, idx) => idx !== i) }));
  }
  function setItem(i, field, value) {
    setData(d => ({ ...d, items: d.items.map((it, idx) => idx === i ? { ...it, [field]: value } : it) }));
  }
  function addPreset(desc) {
    setData(d => {
      // Adding the same preset twice would bill the parent for it twice.
      if (d.items.some(it => (it.description || '').trim().toLowerCase() === desc.toLowerCase())) return d;
      const items = d.items.filter(it => (it.description || '').trim() || (it.amount !== '' && it.amount != null));
      return { ...d, items: [...items, { item_number: items.length + 1, description: desc, amount: '' }] };
    });
  }

  async function save(confirmReplace = false) {
    if (!data.name?.trim()) return showToast('Give the template a name', 'warning');
    const usable = data.items.filter(it => (it.description || '').trim());
    if (usable.length === 0) return showToast('Add at least one line item', 'warning');

    setBusy(true);
    const res = await window.api.fees.saveTemplate({
      ...data,
      items: usable,
      class_group_id: data.class_group_id || null,
      term_id: data.term_id || null,
      confirm_replace: confirmReplace,
      replaces_template_id: confirmReplace ? clash?.id : undefined,
    });
    setBusy(false);

    // "There can't be two school fees in the same term" — surface the existing
    // one and let the user choose, rather than quietly creating a second.
    if (!res.ok && res.code === 'DUPLICATE_SCHOOL_FEES') { setClash(res.existing); return; }
    if (!res.ok) return showToast(res.error || 'Could not save', 'error');
    onSaved();
  }

  const total = data.items.reduce((s, i) => s + (parseFloat(i.amount) || 0), 0);
  const isExtra = data.bill_type === SUPPLEMENTARY;
  const relevantPresets = presets.filter(g => (g.bill_type || SCHOOL_FEES) === data.bill_type);

  return (
    <Modal title={data.id ? `Edit "${data.name}"` : (isExtra ? 'New extra charge' : 'New school fees schedule')}
      onClose={onClose} size="lg"
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={busy} onClick={() => save(false)}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </>}>

      {clash && (
        <div style={{
          padding: 12, borderRadius: 8, marginBottom: 14,
          background: 'var(--warning-bg, #fffbeb)', color: 'var(--warning)',
        }}>
          <div className="bold">A school fees schedule already exists for this term</div>
          <div className="text-sm" style={{ margin: '4px 0 10px' }}>
            “{clash.name}” already covers {clash.class_name || 'all classes'} for {clash.term_label}.
            A term can only have one school fees bill.
          </div>
          <div className="row gap-2">
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => save(true)}>
              Replace it with this one
            </button>
            <button className="btn btn-outline btn-sm" onClick={() => {
              setData(d => ({ ...d, bill_type: SUPPLEMENTARY }));
              setClash(null);
            }}>
              Make this an extra charge instead
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setClash(null)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="form-row">
        <div className="form-group">
          <label className="label">Type</label>
          <select className="select" value={data.bill_type}
            onChange={e => setData({ ...data, bill_type: e.target.value })}>
            <option value={SCHOOL_FEES}>School fees — billed once for the term</option>
            <option value={SUPPLEMENTARY}>Extra charge — added on top during the term</option>
          </select>
        </div>
        <div className="form-group">
          <label className="label">Name</label>
          <input className="input" value={data.name ?? ''}
            placeholder={isExtra ? 'e.g. Excursion — Kakum National Park' : 'e.g. First Term Bills 2026/2027'}
            onChange={e => setData({ ...data, name: e.target.value })} />
        </div>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label className="label">Class</label>
          <select className="select" value={data.class_group_id || ''}
            onChange={e => setData({ ...data, class_group_id: parseInt(e.target.value) || null })}>
            <option value="">— All classes —</option>
            {classes.map(c => <option key={c.id} value={c.id ?? ''}>{c.name}</option>)}
          </select>
          <div className="text-xs text-muted">
            A schedule written for a specific class always wins over an "all classes" one.
          </div>
        </div>
        <div className="form-group">
          <label className="label">Term</label>
          <select className="select" value={data.term_id || ''}
            onChange={e => setData({ ...data, term_id: parseInt(e.target.value) || null })}>
            <option value="">— All terms (standing default) —</option>
            {terms.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
          <div className="text-xs text-muted">
            Pick the term when the amounts are specific to it. "All terms" is a fallback
            used by any term with no schedule of its own.
          </div>
        </div>
      </div>

      <div className="row gap-2" style={{ alignItems: 'center', marginTop: 6 }}>
        <h4 style={{ fontSize: 13, margin: 0 }}>Line items</h4>
        <div className="flex-1"></div>
        <button className="btn btn-ghost btn-sm" onClick={() => setShowPresets(v => !v)}>
          {showPresets ? 'Hide' : 'Pick from'} common items
        </button>
      </div>

      {showPresets && (
        <div style={{ padding: '8px 0 12px' }}>
          {relevantPresets.map(g => (
            <div key={g.group} style={{ marginBottom: 8 }}>
              <div className="text-xs text-muted" style={{ marginBottom: 4 }}>{g.group}</div>
              <div className="row gap-2" style={{ flexWrap: 'wrap' }}>
                {g.items.map(it => (
                  <button key={it.description} className="btn btn-outline btn-sm"
                    onClick={() => addPreset(it.description)}>+ {it.description}</button>
                ))}
              </div>
            </div>
          ))}
          <div className="text-xs text-muted">
            Amounts are left blank on purpose — put in your school's own figures.
          </div>
        </div>
      )}

      <table className="table">
        <thead><tr><th style={{ width: 60 }}>#</th><th>Description</th><th className="text-right" style={{ width: 140 }}>Amount</th><th style={{ width: 40 }}></th></tr></thead>
        <tbody>
          {data.items.map((item, i) => (
            <tr key={i}>
              <td><input className="input" style={{ width: 60 }} type="number" value={item.item_number ?? ''}
                onChange={e => setItem(i, 'item_number', parseInt(e.target.value))} /></td>
              <td><input className="input" value={item.description ?? ''}
                onChange={e => setItem(i, 'description', e.target.value)} /></td>
              <td><input className="input text-right" type="number" step="0.01" value={item.amount ?? ''}
                onChange={e => setItem(i, 'amount', e.target.value)} /></td>
              <td><button className="btn btn-ghost btn-sm" onClick={() => removeItem(i)}>✕</button></td>
            </tr>
          ))}
          <tr>
            <td colSpan="2" className="text-right bold">Total per pupil</td>
            <td className="text-right bold">{fmtCedi(total)}</td>
            <td></td>
          </tr>
        </tbody>
      </table>
      <button className="btn btn-outline btn-sm" onClick={addItem}>+ Add line item</button>
    </Modal>
  );
}

// Copying last term forward is the shortcut schools ask for by name: the
// schedule barely changes term to term, so retyping fifteen lines per class is
// the main reason bills go out late.
function CopyForwardModal({ terms, onClose, onDone }) {
  const showToast = useStore(s => s.showToast);
  const currentTerm = useStore(s => s.currentTerm);
  const [sources, setSources] = useState([]);
  const [sourceId, setSourceId] = useState('');
  const [name, setName] = useState('');
  const [termId, setTermId] = useState(currentTerm?.id || '');
  const [adjust, setAdjust] = useState('0');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    window.api.fees.copyableTemplates({ termId: currentTerm?.id })
      .then(list => setSources(list || [])).catch(() => {});
  }, []);

  const source = sources.find(s => String(s.id) === String(sourceId));
  const newTotal = source ? (source.total_amount || 0) * (1 + (parseFloat(adjust) || 0) / 100) : 0;

  async function copy() {
    if (!sourceId) return showToast('Choose the template to copy', 'warning');
    setBusy(true);
    const res = await window.api.fees.copyTemplate({
      sourceId: parseInt(sourceId),
      name: name.trim() || undefined,
      termId: termId || null,
      adjustPercent: parseFloat(adjust) || 0,
    });
    setBusy(false);
    if (!res?.ok) {
      if (res?.code === 'DUPLICATE_SCHOOL_FEES') {
        return showToast(`${res.error} Edit that one instead, or delete it first.`, 'warning');
      }
      return showToast(res?.error || 'Could not copy', 'error');
    }
    showToast('Copied — check the amounts before generating bills', 'success');
    onDone();
  }

  return (
    <Modal title="Copy a previous term's bill" onClose={onClose} size="md"
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={busy || !sourceId} onClick={copy}>
          {busy ? 'Copying…' : 'Copy forward'}
        </button>
      </>}>
      <div className="form-group">
        <label className="label">Copy from</label>
        <select className="select" value={sourceId} onChange={e => {
          setSourceId(e.target.value);
          const s = sources.find(x => String(x.id) === String(e.target.value));
          if (s && !name) setName(s.name.replace(/\(copy\)\s*$/i, '').trim());
        }}>
          <option value="">— Choose a template —</option>
          {sources.map(s => (
            <option key={s.id} value={s.id}>
              {s.name} · {s.class_name || 'All classes'} · {s.term_label || 'All terms'} · {fmtCedi(s.total_amount || 0)}
            </option>
          ))}
        </select>
      </div>
      <div className="form-row">
        <div className="form-group">
          <label className="label">New name</label>
          <input className="input" value={name} onChange={e => setName(e.target.value)}
            placeholder="e.g. Second Term Bills 2026/2027" />
        </div>
        <div className="form-group">
          <label className="label">For which term</label>
          <select className="select" value={termId} onChange={e => setTermId(e.target.value)}>
            <option value="">— All terms —</option>
            {terms.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </div>
      </div>
      <div className="form-group">
        <label className="label">Adjust every amount by (%)</label>
        <input className="input" type="number" step="0.5" value={adjust}
          onChange={e => setAdjust(e.target.value)} />
        <div className="text-xs text-muted">
          Leave at 0 to copy the amounts unchanged. Use it for an across-the-board increase.
        </div>
      </div>
      {source && (
        <div className="text-sm" style={{ padding: '8px 0' }}>
          {source.item_count} line item(s) · <b>{fmtCedi(source.total_amount || 0)}</b> per pupil
          {(parseFloat(adjust) || 0) !== 0 && <> → <b>{fmtCedi(newTotal)}</b> after the adjustment</>}
        </div>
      )}
      <p className="text-xs text-muted">
        The copy is a draft: nothing is billed until you generate bills for the term.
      </p>
    </Modal>
  );
}
