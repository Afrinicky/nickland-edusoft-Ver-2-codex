// Nickland Edusoft — School fees.
//
// Everything about the term's school fee, in one place: the schedules that
// have been written, the bills standing against them, and the one button that
// raises a new one.
//
// ── Why the builder opens here and not somewhere else ───────────────────────
//
// "Write a template" and "generate bills" were two tabs apart, and a school
// that did the first without the second had parents who had been charged
// nothing. Raising the fee is one decision, so it is one action, taken on the
// screen that shows what raising it would change — and the window opens over
// this tab rather than navigating away, so the bills behind it are still there
// when it closes.
//
// ── The rule ────────────────────────────────────────────────────────────────
//
// A term has ONE school fees bill. Raising a second replaces the first: the
// old schedule is retired, balances are recalculated, and money already
// received stays exactly where it is. The prompt says so in those words,
// because "Replace?" on its own is not something anybody in a school office
// is willing to press.
import React, { useEffect, useMemo, useState } from 'react';
import { useStore } from '../../store/index.js';
import { fmtCedi, fmtDate, termLabel } from '../../lib/format.js';
import { previewBills } from '../../lib/printHelpers.js';
import Modal from '../../components/Modal.jsx';
import BillDetail from './BillDetail.jsx';

export default function SchoolFeesTab({ overview, perms = {}, onChanged }) {
  const currentTerm = useStore(s => s.currentTerm);
  const classes = useStore(s => s.classes);
  const showToast = useStore(s => s.showToast);

  const [bills, setBills] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [classFilter, setClassFilter] = useState('');
  const [owingOnly, setOwingOnly] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [openedBillId, setOpenedBillId] = useState(null);
  // `null` = closed. An object = open, optionally seeded from the schedule
  // being amended, because "change the tuition figure" and "raise a new bill"
  // are the same operation: the term's bill is replaced and rebuilt.
  const [building, setBuilding] = useState(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    if (!currentTerm) return;
    const [list, tpls] = await Promise.all([
      window.api.fees.listBills({
        termId: currentTerm.id,
        classId: classFilter || undefined,
        owing: owingOnly || undefined,
      }),
      window.api.fees.listTemplates({ billType: 'school_fees' }),
    ]);
    setBills(list || []);
    setSchedules((tpls || []).filter(t => t.is_active
      && (t.term_id === currentTerm.id || t.term_id === null)));
    setSelected(new Set());
  }
  useEffect(() => { refresh(); }, [currentTerm, classFilter, owingOnly]);

  const totals = useMemo(() => bills.reduce((a, b) => ({
    billed: a.billed + (b.total_billed || 0),
    paid: a.paid + (b.total_paid || 0),
    balance: a.balance + (b.balance || 0),
  }), { billed: 0, paid: 0, balance: 0 }), [bills]);

  function toggle(id) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected(prev => (prev.size === bills.length ? new Set() : new Set(bills.map(b => b.id))));
  }

  // ── Printing ─────────────────────────────────────────────────────────────
  // Three ways a school actually prints bills: the lot for a class before
  // reopening, a handful for the parents who came in this morning, and one for
  // the parent standing at the counter. All three go through the same printout
  // the system already produces — nothing about the bill's design changes.
  async function print(ids, what) {
    if (!ids.length) return showToast('Nothing selected to print', 'warning');
    setBusy(true);
    const r = await previewBills(ids);
    setBusy(false);
    if (!r.ok) return showToast(r.error, 'error');
    showToast(`${ids.length} ${what} ready to print`, 'success');
  }

  if (openedBillId) {
    return (
      <BillDetail billId={openedBillId} perms={perms}
        onClose={() => { setOpenedBillId(null); refresh(); onChanged?.(); }} />
    );
  }

  const className = classes.find(c => String(c.id) === String(classFilter))?.name;

  return (
    <div>
      {/* ── The schedule this term is billed from ───────────────────── */}
      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">
              School fees — {termLabel(currentTerm) || 'no term running'}
            </div>
            <div className="text-sm text-muted">
              {schedules.length === 0
                ? 'No schedule written for this term yet, so nobody can be billed.'
                : `${schedules.length} schedule${schedules.length === 1 ? '' : 's'} in force · `
                  + `${bills.length} bill${bills.length === 1 ? '' : 's'} raised`}
            </div>
          </div>
          <div className="row gap-2">
            {schedules.length > 0 && (
              <button className="btn btn-outline" disabled={busy}
                onClick={() => print(bills.map(b => b.id), 'bill(s)')}>
                🖨 Print every bill
              </button>
            )}
            <button className="btn btn-primary" onClick={() => setBuilding({})}>
              + New school fees
            </button>
          </div>
        </div>

        {schedules.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Schedule</th><th>Class</th><th>Term</th>
                  <th className="text-right">Lines</th>
                  <th className="text-right">Per pupil</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {schedules.map(t => (
                  <tr key={t.id}>
                    <td className="bold">{t.name}</td>
                    <td>{t.class_name || 'Every class'}</td>
                    <td>{termLabel(t, 'Any term — standing default')}</td>
                    <td className="text-right">{t.item_count ?? '—'}</td>
                    <td className="text-right bold">{fmtCedi(t.total_amount || 0)}</td>
                    <td className="text-right">
                      <button className="btn btn-outline btn-sm"
                        title="Change the figures — the term's bill is rebuilt and balances recalculated"
                        onClick={() => setBuilding({ templateId: t.id })}>Amend</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {schedules.length === 0 && (
          <div className="empty-state">
            <h3>Nothing has been charged for this term</h3>
            <p>
              Start from the school's own bill, from a published framework, or from
              last term's — whichever is nearest. You can change every figure before
              anything is raised.
            </p>
            <button className="btn btn-primary" onClick={() => setBuilding({})}>
              Build this term's bill
            </button>
          </div>
        )}
      </div>

      {/* ── The bills standing against it ───────────────────────────── */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="toolbar">
          <select className="select" value={classFilter}
            onChange={e => setClassFilter(e.target.value)} style={{ maxWidth: 200 }}>
            <option value="">All classes</option>
            {classes.map(c => <option key={c.id} value={c.id ?? ''}>{c.name}</option>)}
          </select>
          <label className="row gap-2">
            <input type="checkbox" checked={owingOnly} onChange={e => setOwingOnly(e.target.checked)} />
            Owing only
          </label>
          <div className="flex-1"></div>
          {selected.size > 0 && (
            <button className="btn btn-primary btn-sm" disabled={busy}
              onClick={() => print([...selected], 'bill(s)')}>
              🖨 Print {selected.size} selected
            </button>
          )}
          {bills.length > 0 && classFilter && (
            <button className="btn btn-outline btn-sm" disabled={busy}
              onClick={() => print(bills.map(b => b.id), `${className} bill(s)`)}>
              🖨 Print all of {className}
            </button>
          )}
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ width: 34 }}>
                  <input type="checkbox" title="Select every bill listed"
                    checked={bills.length > 0 && selected.size === bills.length}
                    onChange={toggleAll} />
                </th>
                <th>Index No</th><th>Name</th><th>Class</th>
                <th className="text-right">Billed</th>
                <th className="text-right">Paid</th>
                <th className="text-right">Balance</th>
                <th>Raised</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {bills.map(b => (
                <tr key={b.id}>
                  <td onClick={e => e.stopPropagation()}>
                    <input type="checkbox" checked={selected.has(b.id)} onChange={() => toggle(b.id)} />
                  </td>
                  <td className="bold" style={{ cursor: 'pointer' }} onClick={() => setOpenedBillId(b.id)}>
                    {b.index_number}
                  </td>
                  <td style={{ cursor: 'pointer' }} onClick={() => setOpenedBillId(b.id)}>
                    {b.surname} {b.first_name}
                    {(b.supplementary_total || 0) > 0 && (
                      <span className="badge badge-muted" style={{ marginLeft: 6 }}
                        title="Includes charges raised during the term">
                        +{fmtCedi(b.supplementary_total)}
                      </span>
                    )}
                  </td>
                  <td>{b.class_name}</td>
                  <td className="text-right">{fmtCedi(b.total_billed || 0)}</td>
                  <td className="text-right" style={{ color: 'var(--success)' }}>
                    {fmtCedi(b.total_paid || 0)}
                  </td>
                  <td className="text-right bold"
                    style={{ color: (b.balance || 0) > 0 ? 'var(--danger)' : 'var(--success)' }}>
                    {fmtCedi(b.balance || 0)}
                  </td>
                  <td className="text-sm text-muted">{fmtDate(b.generated_at)}</td>
                  <td className="text-right">
                    <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
                      <button className="btn btn-ghost btn-sm" title="Print this pupil's bill"
                        disabled={busy} onClick={() => print([b.id], 'bill')}>🖨</button>
                      <button className="btn btn-outline btn-sm"
                        onClick={() => setOpenedBillId(b.id)}>Open</button>
                    </div>
                  </td>
                </tr>
              ))}
              {bills.length === 0 && (
                <tr>
                  <td colSpan="9">
                    <div className="empty-state">
                      <h3>No bills for this term yet</h3>
                      <p>Raising the term's school fees bills every active pupil in one action.</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
            {bills.length > 0 && (
              <tfoot>
                <tr style={{ fontWeight: 700 }}>
                  <td colSpan="4">{bills.length} bill(s)</td>
                  <td className="text-right">{fmtCedi(totals.billed)}</td>
                  <td className="text-right" style={{ color: 'var(--success)' }}>{fmtCedi(totals.paid)}</td>
                  <td className="text-right" style={{ color: 'var(--danger)' }}>{fmtCedi(totals.balance)}</td>
                  <td colSpan="2"></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {building && (
        <BillBuilder
          term={currentTerm}
          amending={building.templateId || null}
          onClose={() => setBuilding(null)}
          onDone={(msg) => { setBuilding(null); showToast(msg, 'success'); refresh(); onChanged?.(); }}
        />
      )}
    </div>
  );
}

// ══ The builder ═════════════════════════════════════════════════════════════
//
// Three ways in, because schools arrive from three different places, and the
// choice is made first so the rest of the window can be about the figures
// rather than about the software.

const SOURCES = [
  { id: 'framework', label: 'From a framework',
    hint: 'A published bill — the particulars already written, in the order they print.' },
  { id: 'previous', label: 'From a previous term',
    hint: 'Last term’s bill, optionally uplifted. What most schools want most terms.' },
  { id: 'scratch', label: 'From scratch',
    hint: 'Type it out. For a bill nothing else resembles.' },
];

function BillBuilder({ term, amending, onClose, onDone }) {
  const classes = useStore(s => s.classes);
  const showToast = useStore(s => s.showToast);

  const [step, setStep] = useState(amending ? 'lines' : 'source');   // source → lines → scope
  const [source, setSource] = useState(null);
  const [frameworks, setFrameworks] = useState([]);
  const [previous, setPrevious] = useState([]);
  const [frameworkId, setFrameworkId] = useState('');
  const [sourceTemplateId, setSourceTemplateId] = useState('');
  const [adjust, setAdjust] = useState('0');
  const [name, setName] = useState('');
  const [items, setItems] = useState([{ item_number: 1, description: '', amount: '' }]);
  const [bookItems, setBookItems] = useState([]);
  const [scope, setScope] = useState('school');
  const [classIds, setClassIds] = useState([]);
  const [plan, setPlan] = useState(null);
  const [clash, setClash] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    window.api.fees.frameworks('school_fees').then(f => setFrameworks(f || [])).catch(() => {});
    window.api.fees.copyableTemplates({ termId: term?.id })
      .then(list => setPrevious((list || []).filter(t => (t.bill_type || 'school_fees') === 'school_fees')))
      .catch(() => {});
  }, [term?.id]);

  useEffect(() => {
    if (!term) return;
    window.api.fees.schoolFeesPlan({
      termId: term.id,
      scope: scope === 'school' ? 'school' : 'classes',
      classIds: scope === 'school' ? [] : classIds,
    }).then(p => setPlan(p && p.ok ? p : null)).catch(() => {});
  }, [term?.id, scope, classIds.join(',')]);

  useEffect(() => {
    if (!name && term) setName(`${term.label} school fees — ${term.year_label || ''}`.trim());
  }, [term]);

  // Amending opens straight on the figures, seeded from the schedule in force.
  // Raising then REPLACES it, which is the only correct outcome: a schedule
  // that has already produced bills cannot be edited underneath them without
  // the bills and the schedule saying different things.
  useEffect(() => {
    if (!amending) return;
    (async () => {
      const full = await window.api.fees.getTemplate(amending);
      if (!full) return;
      setName(full.name || '');
      setItems((full.items || []).map((it, i) => ({
        item_number: it.item_number || (i + 1),
        description: it.description,
        amount: it.amount,
      })));
      if (full.class_group_id) { setScope('classes'); setClassIds([full.class_group_id]); }
    })();
  }, [amending]);

  const total = items.reduce((s, i) => s + (parseFloat(i.amount) || 0), 0);

  function chooseFramework(id) {
    setFrameworkId(id);
    const fw = frameworks.find(f => f.id === id);
    if (!fw) return;
    let n = 0;
    const lines = [];
    const books = [];
    for (const part of fw.parts) {
      for (const it of part.items) {
        if (part.kind === 'books') books.push({ title: it.description, amount: it.amount });
        else lines.push({ item_number: ++n, description: it.description, amount: it.amount });
      }
    }
    setItems(lines.length ? lines : [{ item_number: 1, description: '', amount: '' }]);
    setBookItems(books);
  }

  async function choosePrevious(id) {
    setSourceTemplateId(id);
    if (!id) return;
    const full = await window.api.fees.getTemplate(parseInt(id, 10));
    const factor = 1 + ((parseFloat(adjust) || 0) / 100);
    setItems((full?.items || []).map((it, i) => ({
      item_number: it.item_number || (i + 1),
      description: it.description,
      amount: Math.round((it.amount || 0) * factor * 100) / 100,
    })));
    setBookItems([]);
  }

  // Re-uplifting has to work off the ORIGINAL amounts, not the ones already
  // uplifted, or typing "10" twice raises the fee by 21%.
  async function reapplyAdjust(pct) {
    setAdjust(pct);
    if (!sourceTemplateId) return;
    const full = await window.api.fees.getTemplate(parseInt(sourceTemplateId, 10));
    const factor = 1 + ((parseFloat(pct) || 0) / 100);
    setItems((full?.items || []).map((it, i) => ({
      item_number: it.item_number || (i + 1),
      description: it.description,
      amount: Math.round((it.amount || 0) * factor * 100) / 100,
    })));
  }

  function setItem(i, field, value) {
    setItems(list => list.map((it, idx) => (idx === i ? { ...it, [field]: value } : it)));
  }

  async function raise(confirmReplace) {
    const usable = items.filter(i => String(i.description || '').trim());
    if (!usable.length) return showToast('A bill needs at least one line', 'warning');
    if (scope === 'classes' && classIds.length === 0) {
      return showToast('Choose at least one class', 'warning');
    }
    setBusy(true);
    const res = await window.api.fees.raiseSchoolFees({
      termId: term.id,
      scope: scope === 'school' ? 'school' : 'classes',
      classIds: scope === 'school' ? [] : classIds,
      name: name.trim(),
      items: usable.map((i, n) => ({
        item_number: Number(i.item_number) || (n + 1),
        description: String(i.description).trim(),
        amount: parseFloat(i.amount) || 0,
      })),
      bookItems,
      confirmReplace: !!confirmReplace,
    });
    setBusy(false);

    if (!res.ok && res.code === 'REPLACE_REQUIRED') { setClash(res); return; }
    if (!res.ok) return showToast(res.error || 'The bill could not be raised', 'error');

    const parts = [`${res.generated} bill(s) raised at ${fmtCedi(res.per_pupil)} a pupil`];
    if (res.replaced) parts.push(`${res.replaced} previous schedule(s) replaced`);
    if (res.skipped) {
      parts.push(`${res.skipped} could not be: ${(res.problems || []).map(p => p.reason).join(' ')}`);
    }
    onDone(parts.join(' · '));
  }

  const stepTitle = step === 'source' ? 'Where does this bill start from?'
    : step === 'lines' ? 'What is on the bill'
    : 'Who it is raised against';

  return (
    <Modal title={`New school fees — ${termLabel(term)}`} onClose={onClose} size="lg"
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        {step !== 'source' && (
          <button className="btn btn-outline"
            onClick={() => setStep(step === 'scope' ? 'lines' : 'source')}>← Back</button>
        )}
        {step === 'lines' && (
          <button className="btn btn-primary" onClick={() => setStep('scope')}>
            Next — who pays it →
          </button>
        )}
        {step === 'scope' && (
          <button className="btn btn-primary" disabled={busy} onClick={() => raise(false)}>
            {busy ? 'Raising…' : `Raise it${plan ? ` for ${plan.student_count} pupil(s)` : ''}`}
          </button>
        )}
      </>}>

      <div className="text-sm text-muted" style={{ marginBottom: 12 }}>{stepTitle}</div>

      {/* ── Step 1 — the starting point ─────────────────────────────── */}
      {step === 'source' && (
        <div style={{ display: 'grid', gap: 10 }}>
          {SOURCES.map(s => (
            <button key={s.id}
              className={'btn ' + (source === s.id ? 'btn-primary' : 'btn-outline')}
              style={{ textAlign: 'left', padding: '12px 14px', height: 'auto', display: 'block' }}
              onClick={() => {
                setSource(s.id);
                if (s.id === 'scratch') {
                  setItems([{ item_number: 1, description: '', amount: '' }]);
                  setBookItems([]);
                  setStep('lines');
                }
              }}>
              <div className="bold">{s.label}</div>
              <div className="text-xs" style={{ opacity: 0.85 }}>{s.hint}</div>
            </button>
          ))}

          {source === 'framework' && (
            <div className="card" style={{ marginTop: 4 }}>
              <div className="text-sm text-muted" style={{ marginBottom: 8 }}>
                A framework is a bill somebody has already argued about. Adopt it and
                change the figures — nothing is raised until you say so.
              </div>
              {frameworks.map(f => (
                <label key={f.id} className="row gap-2"
                  style={{ alignItems: 'flex-start', padding: '8px 0', borderTop: '1px solid var(--border)' }}>
                  <input type="radio" name="fw" checked={frameworkId === f.id}
                    onChange={() => chooseFramework(f.id)} style={{ marginTop: 4 }} />
                  <div className="flex-1">
                    <div className="bold">{f.name}</div>
                    <div className="text-xs text-muted">{f.description}</div>
                    <div className="text-xs" style={{ marginTop: 3 }}>
                      {f.item_count} particular(s)
                      {f.fees_total > 0 && <> · <b>{fmtCedi(f.fees_total)}</b> school fees</>}
                      {f.books_total > 0 && <> · {fmtCedi(f.books_total)} textbooks</>}
                      {f.origin && <> · <i>{f.origin}</i></>}
                    </div>
                  </div>
                </label>
              ))}
              <button className="btn btn-primary btn-sm" style={{ marginTop: 10 }}
                disabled={!frameworkId} onClick={() => setStep('lines')}>
                Use this framework →
              </button>
            </div>
          )}

          {source === 'previous' && (
            <div className="card" style={{ marginTop: 4 }}>
              <div className="form-group">
                <label className="label">Copy from</label>
                <select className="select" value={sourceTemplateId}
                  onChange={e => choosePrevious(e.target.value)}>
                  <option value="">— Choose a previous bill —</option>
                  {previous.map(t => (
                    <option key={t.id} value={t.id}>
                      {t.name} · {t.class_name || 'All classes'} · {termLabel(t, 'All terms')}
                      {' · '}{fmtCedi(t.total_amount || 0)}
                    </option>
                  ))}
                </select>
                {previous.length === 0 && (
                  <div className="text-xs text-muted">
                    There is no earlier bill to copy yet. Start from a framework or from scratch.
                  </div>
                )}
              </div>
              <div className="form-group">
                <label className="label">Adjust every amount by (%)</label>
                <input className="input" type="number" step="0.5" value={adjust}
                  onChange={e => reapplyAdjust(e.target.value)} />
                <div className="text-xs text-muted">
                  Leave at 0 to carry the amounts over unchanged.
                </div>
              </div>
              <button className="btn btn-primary btn-sm" disabled={!sourceTemplateId}
                onClick={() => setStep('lines')}>
                Use this bill →
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Step 2 — the particulars ────────────────────────────────── */}
      {step === 'lines' && (
        <div>
          <div className="form-group">
            <label className="label">What this bill is called</label>
            <input className="input" value={name} onChange={e => setName(e.target.value)}
              placeholder={`e.g. ${term?.label || 'First Term'} Bills ${term?.year_label || ''}`} />
            <div className="text-xs text-muted">
              The academic year belongs in the name — every year has a term by the same name.
            </div>
          </div>

          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 60 }}>#</th>
                <th>Particulars</th>
                <th className="text-right" style={{ width: 140 }}>Amount</th>
                <th style={{ width: 40 }}></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => (
                <tr key={i}>
                  <td>
                    <input className="input" style={{ width: 60 }} type="number"
                      value={item.item_number ?? ''}
                      onChange={e => setItem(i, 'item_number', parseInt(e.target.value, 10))} />
                  </td>
                  <td>
                    <input className="input" value={item.description ?? ''}
                      placeholder="e.g. Tuition Fee"
                      onChange={e => setItem(i, 'description', e.target.value)} />
                  </td>
                  <td>
                    <input className="input text-right" type="number" step="0.01"
                      value={item.amount ?? ''}
                      onChange={e => setItem(i, 'amount', e.target.value)} />
                  </td>
                  <td>
                    <button className="btn btn-ghost btn-sm"
                      onClick={() => setItems(list => list.filter((_, idx) => idx !== i))}>✕</button>
                  </td>
                </tr>
              ))}
              <tr>
                <td colSpan="2" className="text-right bold">Total per pupil</td>
                <td className="text-right bold">{fmtCedi(total)}</td>
                <td></td>
              </tr>
            </tbody>
          </table>
          <button className="btn btn-outline btn-sm"
            onClick={() => setItems(list => [...list, { item_number: list.length + 1, description: '', amount: '' }])}>
            + Add a particular
          </button>

          {bookItems.length > 0 && (
            <div className="card" style={{ marginTop: 14 }}>
              <div className="bold">Part B — textbooks</div>
              <div className="text-sm text-muted">
                Textbooks are charged once for the academic year and carried into the
                other two terms as arrears, so they are not billed on the term fee.
                These lines are seeded into the Books tab instead.
              </div>
              <table className="table" style={{ marginTop: 8 }}>
                <tbody>
                  {bookItems.map((b, i) => (
                    <tr key={i}>
                      <td>{b.title}</td>
                      <td className="text-right">{fmtCedi(b.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Step 3 — who it is raised against ───────────────────────── */}
      {step === 'scope' && (
        <div>
          <div className="form-group">
            <label className="label">Raise it for</label>
            <div className="row gap-2">
              <button className={'btn ' + (scope === 'school' ? 'btn-primary' : 'btn-outline')}
                onClick={() => setScope('school')}>The whole school</button>
              <button className={'btn ' + (scope === 'classes' ? 'btn-primary' : 'btn-outline')}
                onClick={() => setScope('classes')}>Chosen classes</button>
            </div>
          </div>

          {scope === 'classes' && (
            <div className="card" style={{ marginBottom: 12 }}>
              <div className="row gap-2" style={{ flexWrap: 'wrap' }}>
                {classes.map(c => {
                  const on = classIds.includes(c.id);
                  return (
                    <button key={c.id} className={'btn btn-sm ' + (on ? 'btn-primary' : 'btn-outline')}
                      onClick={() => setClassIds(ids =>
                        on ? ids.filter(x => x !== c.id) : [...ids, c.id])}>
                      {c.name}
                    </button>
                  );
                })}
              </div>
              <div className="text-xs text-muted" style={{ marginTop: 8 }}>
                Naming every class is the same instruction as "the whole school", and
                produces one standing schedule rather than one per class.
              </div>
            </div>
          )}

          {plan && (
            <div className="card">
              <div className="row gap-2" style={{ flexWrap: 'wrap' }}>
                <Fact label="Pupils affected" value={plan.student_count} />
                <Fact label="Per pupil" value={fmtCedi(total)} />
                <Fact label="Expected in total" value={fmtCedi(total * plan.student_count)} />
                {plan.replaces && <Fact label="Schedules replaced" value={plan.existing_schedules.length} tone="warn" />}
              </div>
              {plan.replaces && (
                <div className="text-sm" style={{
                  marginTop: 10, padding: 10, borderRadius: 6,
                  background: 'var(--warning-bg, #fffbeb)', color: 'var(--warning)',
                }}>
                  <b>This replaces the term's existing school fees bill.</b>{' '}
                  {plan.existing_schedules.map(e => `“${e.name}”`).join(', ')} will be retired,
                  {' '}{plan.bills_already_raised} bill(s) rebuilt, and every balance recalculated.
                  The {fmtCedi(plan.already_paid)} already received stays exactly where it is —
                  a parent who has paid is credited against the new figure, not asked for it twice.
                </div>
              )}
            </div>
          )}

          {clash && (
            <div className="card" style={{
              marginTop: 12, borderColor: 'var(--warning)',
              background: 'var(--warning-bg, #fffbeb)',
            }}>
              <div className="bold">A school fees bill already exists for this term</div>
              <div className="text-sm" style={{ margin: '4px 0 10px' }}>{clash.error}</div>
              <div className="row gap-2">
                <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => raise(true)}>
                  {busy ? 'Replacing…' : 'Replace it — recalculate the balances'}
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => setClash(null)}>Leave it alone</button>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function Fact({ label, value, tone }) {
  return (
    <div style={{ flex: '1 1 130px', minWidth: 120 }}>
      <div className="text-xs text-muted" style={{ textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div className="bold" style={{ fontSize: 18, color: tone === 'warn' ? 'var(--warning)' : 'var(--fg)' }}>
        {value}
      </div>
    </div>
  );
}
