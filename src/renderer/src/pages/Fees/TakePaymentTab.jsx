// Nickland Edusoft — Taking one payment.
//
// The counter's screen. A parent arrives, says who they are and what they have
// come to pay for, hands over money, and leaves with a receipt. Everything on
// this screen exists because one of those four steps needs it.
//
// ── Finding the pupil ───────────────────────────────────────────────────────
//
// A search box on its own is not enough at a counter. What the person taking
// money actually has in front of them is "the Basic 5 parents, the ones still
// owing" — so the roll can be narrowed by class and by whether there is a
// balance, and each row already shows what is owed, because opening a record
// to find that out is what makes a queue.
//
// ── What is captured ────────────────────────────────────────────────────────
//
// The purpose (school fees, books, canteen, transport, an extra charge), the
// amount, how it was paid and — for anything but cash — the transaction
// reference, which is enforced rather than suggested: a mobile-money payment
// with no reference cannot be checked against anything when the parent says
// they paid and the school cannot find it.
//
// The date, the time and WHO TOOK THE MONEY are not typed in. They are the
// clock and the signed-in account, which is the only version anybody can rely
// on afterwards.
import React, { useEffect, useMemo, useState } from 'react';
import { useStore } from '../../store/index.js';
import { fmtCedi, fmtDate, fullName } from '../../lib/format.js';
import Receipt from './Receipt.jsx';

export default function TakePaymentTab() {
  const classes = useStore(s => s.classes);
  const currentTerm = useStore(s => s.currentTerm);
  const currentUser = useStore(s => s.currentUser);
  const showToast = useStore(s => s.showToast);

  const [config, setConfig] = useState({ purposes: [], methods: [], reference_required: [] });
  const [q, setQ] = useState('');
  const [classId, setClassId] = useState('');
  const [owing, setOwing] = useState('');
  const [roll, setRoll] = useState([]);
  const [loading, setLoading] = useState(false);

  const [selected, setSelected] = useState(null);
  const [account, setAccount] = useState(null);

  const [purpose, setPurpose] = useState('school_fees');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('Cash');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    window.api.payments.purposes().then(r => {
      if (!r?.ok) return;
      setConfig(r);
      if (r.purposes.length && !r.purposes.some(p => p.key === purpose)) {
        setPurpose(r.purposes[0].key);
      }
    }).catch(() => {});
  }, []);

  // The roll, narrowed. Debounced so typing a surname is not one query a
  // keystroke against a school of eight hundred.
  useEffect(() => {
    let live = true;
    setLoading(true);
    const id = setTimeout(async () => {
      const r = await window.api.payments.findStudents({
        q, classId: classId || undefined,
        owing: owing || undefined,
        termId: currentTerm?.id,
      });
      if (!live) return;
      setRoll(r?.students || []);
      setLoading(false);
    }, 220);
    return () => { live = false; clearTimeout(id); };
  }, [q, classId, owing, currentTerm?.id]);

  async function open(student) {
    setSelected(student);
    setReceipt(null);
    setAccount(null);
    const r = await window.api.payments.studentAccount({
      studentId: student.id, termId: currentTerm?.id,
    });
    if (!r?.ok) return showToast(r?.error || 'That account could not be read', 'error');
    setAccount(r);
    // Open on whatever they owe most for — which is nearly always what they
    // have come to pay.
    const biggest = (r.accounts || [])
      .filter(a => a.payable && (a.balance || 0) > 0)
      .sort((a, b) => b.balance - a.balance)[0];
    if (biggest) {
      setPurpose(biggest.purpose);
      setAmount(String(biggest.balance));
    } else {
      setAmount('');
    }
  }

  const chosen = useMemo(
    () => (account?.accounts || []).find(a => a.purpose === purpose) || null,
    [account, purpose]);

  const needsReference = (config.reference_required || []).includes(method);

  async function take() {
    if (!selected) return showToast('Choose the pupil first', 'warning');
    const value = parseFloat(amount);
    if (!(value > 0)) return showToast('Enter the amount handed over', 'warning');
    if (needsReference && !reference.trim()) {
      return showToast(`A ${method.toLowerCase()} payment needs its transaction reference`, 'warning');
    }
    if (chosen && chosen.balance != null && value > chosen.balance + 0.01) {
      const ok = window.confirm(
        `${fmtCedi(value)} is more than the ${fmtCedi(chosen.balance)} outstanding on `
        + `${chosen.label}.\n\nRecord it anyway? The extra stays as credit on the account.`);
      if (!ok) return;
    }

    setBusy(true);
    const res = await window.api.payments.take({
      studentId: selected.id,
      purpose,
      referenceId: chosen?.reference_id || undefined,
      amount: value,
      method,
      reference: reference.trim(),
      notes: notes.trim(),
      termId: currentTerm?.id,
    });
    setBusy(false);

    if (!res?.ok) return showToast(res?.error || 'The payment could not be recorded', 'error');

    setReceipt(res.receipt);
    setAmount(''); setReference(''); setNotes('');
    const sent = (res.delivered || []).length ? ` · sent by ${res.delivered.join(' & ')}` : '';
    showToast(`${fmtCedi(value)} receipted — ${res.receipt_number}${sent}`, 'success');
    // The balances behind the receipt have moved, and the roll's "owing"
    // column with them.
    open(selected);
    setQ(q => q);
  }

  async function print() {
    if (!receipt) return;
    setPrinting(true);
    const res = await window.api.receipts.print({
      paymentSource: receipt.source, paymentId: receipt.payment_id,
    });
    setPrinting(false);
    if (!res?.ok) return showToast(res?.error || 'The receipt could not be printed', 'error');
  }

  return (
    <div className="dash-row" style={{ gridTemplateColumns: '1.1fr 1fr', alignItems: 'start' }}>
      {/* ── Who is paying ──────────────────────────────────────────── */}
      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">Who is paying</div>
            <div className="text-sm text-muted">
              {loading ? 'Looking…' : `${roll.length} pupil(s)`}
              {owing === 'owing' ? ' still owing' : ''}
            </div>
          </div>
        </div>

        <div className="toolbar">
          <input className="input" style={{ flex: 2, minWidth: 180 }}
            placeholder="Surname, first name or admission number"
            value={q} onChange={e => setQ(e.target.value)} autoFocus />
          <select className="select" style={{ maxWidth: 170 }}
            value={classId} onChange={e => setClassId(e.target.value)}>
            <option value="">Every class</option>
            {classes.map(c => <option key={c.id} value={c.id ?? ''}>{c.name}</option>)}
          </select>
          <select className="select" style={{ maxWidth: 170 }}
            value={owing} onChange={e => setOwing(e.target.value)}>
            <option value="">Everyone</option>
            <option value="owing">Still owing</option>
            <option value="settled">Settled up</option>
            <option value="unbilled">Not billed yet</option>
          </select>
          {(q || classId || owing) && (
            <button className="btn btn-ghost btn-sm"
              onClick={() => { setQ(''); setClassId(''); setOwing(''); }}>Clear</button>
          )}
        </div>

        <div className="table-wrap" style={{ maxHeight: 460 }}>
          <table>
            <thead>
              <tr>
                <th>Index No</th><th>Name</th><th>Class</th>
                <th className="text-right">Fees owing</th><th></th>
              </tr>
            </thead>
            <tbody>
              {roll.map(s => (
                <tr key={s.id}
                  style={{
                    cursor: 'pointer',
                    background: selected?.id === s.id ? 'var(--primary-50)' : undefined,
                  }}
                  onClick={() => open(s)}>
                  <td className="bold">{s.index_number}</td>
                  <td>{fullName(s)}</td>
                  <td>{s.class_code || s.class_name}</td>
                  <td className="text-right bold"
                    style={{ color: (s.fees_balance || 0) > 0 ? 'var(--danger)' : 'var(--success)' }}>
                    {s.bill_id ? fmtCedi(s.fees_balance) : <span className="text-muted">no bill</span>}
                  </td>
                  <td className="text-right">
                    <button className="btn btn-ghost btn-sm">Take payment →</button>
                  </td>
                </tr>
              ))}
              {roll.length === 0 && !loading && (
                <tr>
                  <td colSpan="5">
                    <div className="empty-state">
                      <h3>Nobody matches that</h3>
                      <p>Try a different spelling, or clear the filters.</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── The payment ────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gap: 14 }}>
        {receipt ? (
          <Receipt receipt={receipt} busy={printing} onPrint={print}
            onClose={() => setReceipt(null)} />
        ) : null}

        {!selected ? (
          <div className="card">
            <div className="empty-state">
              <h3>Nobody chosen</h3>
              <p>
                Pick a pupil on the left. What they owe — school fees, books, the
                canteen, the bus — comes up here, and one form takes the money for
                any of it.
              </p>
            </div>
          </div>
        ) : (
          <>
            <div className="card">
              <div className="card-header">
                <div>
                  <div className="card-title">{fullName(selected)}</div>
                  <div className="text-sm text-muted">
                    {selected.index_number} · {selected.class_name}
                    {account?.student?.contact ? ` · ${account.student.contact}` : ''}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-muted">Owed in total</div>
                  <div className="bold" style={{
                    fontSize: 18,
                    color: (account?.total_balance || 0) > 0 ? 'var(--danger)' : 'var(--success)',
                  }}>{fmtCedi(account?.total_balance || 0)}</div>
                </div>
              </div>

              {/* What they owe, purpose by purpose. Clicking one is how the
                  purpose is chosen — nobody at a counter wants to read a
                  dropdown and a balance table and match them up by eye. */}
              <div style={{ display: 'grid', gap: 6 }}>
                {(account?.accounts || []).map(a => {
                  const on = purpose === a.purpose;
                  return (
                    <button key={a.purpose}
                      className={'btn ' + (on ? 'btn-primary' : 'btn-outline')}
                      style={{ textAlign: 'left', height: 'auto', padding: '10px 12px', display: 'block' }}
                      disabled={!a.payable}
                      title={a.payable ? '' : a.note}
                      onClick={() => {
                        setPurpose(a.purpose);
                        if (a.balance != null && a.balance > 0) setAmount(String(a.balance));
                      }}>
                      <div className="row gap-2" style={{ alignItems: 'baseline' }}>
                        <span className="bold">{a.label}</span>
                        <span className="flex-1"></span>
                        <span className="bold">
                          {a.balance == null ? 'on the term bill' : fmtCedi(a.balance)}
                        </span>
                      </div>
                      <div className="text-xs" style={{ opacity: 0.85 }}>
                        {a.note}
                        {a.billed > 0 && a.paid != null
                          ? ` · ${fmtCedi(a.paid)} of ${fmtCedi(a.billed)} paid`
                          : ''}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="card">
              <div className="card-title">The payment</div>

              <div className="form-row">
                <div className="form-group">
                  <label className="label">Payment purpose</label>
                  <select className="select" value={purpose} onChange={e => setPurpose(e.target.value)}>
                    {config.purposes.map(p => (
                      <option key={p.key} value={p.key}>{p.label}</option>
                    ))}
                  </select>
                  <div className="text-xs text-muted">
                    {config.purposes.find(p => p.key === purpose)?.note}
                  </div>
                </div>
                <div className="form-group">
                  <label className="label">Amount handed over</label>
                  <input className="input" type="number" step="0.01" min="0" value={amount}
                    placeholder="0.00"
                    onChange={e => setAmount(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') take(); }} />
                  {chosen && chosen.balance != null && (
                    <div className="text-xs text-muted">
                      {chosen.balance > 0
                        ? <>Outstanding {fmtCedi(chosen.balance)} ·{' '}
                            <button className="btn btn-ghost btn-sm" style={{ padding: '0 4px' }}
                              onClick={() => setAmount(String(chosen.balance))}>pay it all</button></>
                        : 'Settled — anything taken now stays as credit'}
                    </div>
                  )}
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="label">Mode of payment</label>
                  <select className="select" value={method} onChange={e => setMethod(e.target.value)}>
                    {config.methods.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="label">
                    Reference {needsReference ? <span style={{ color: 'var(--danger)' }}>*</span> : '(optional)'}
                  </label>
                  <input className="input" value={reference}
                    disabled={!needsReference && method === 'Cash'}
                    placeholder={needsReference ? 'Transaction ID from the SMS or slip' : 'Not needed for cash'}
                    onChange={e => setReference(e.target.value)} />
                  {needsReference && (
                    <div className="text-xs text-muted">
                      Required. Without it there is nothing to check against when the
                      payment is queried.
                    </div>
                  )}
                </div>
              </div>

              <div className="form-group">
                <label className="label">Note (optional)</label>
                <input className="input" value={notes} onChange={e => setNotes(e.target.value)}
                  placeholder="Anything the receipt should say" />
              </div>

              {/* What the system fills in itself, shown so nobody wonders
                  whether it was captured. */}
              <div className="row gap-2 text-xs text-muted"
                style={{ flexWrap: 'wrap', padding: '4px 0 10px' }}>
                <span>Dated {fmtDate(new Date())} at {new Date().toTimeString().slice(0, 5)}</span>
                <span>·</span>
                <span>Received by <b>{currentUser?.full_name || currentUser?.username || 'you'}</b></span>
                <span>·</span>
                <span>Receipt prints on {paperLabel(config.paper_size)}</span>
              </div>

              <button className="btn btn-primary" style={{ width: '100%', fontSize: 15, padding: '12px' }}
                disabled={busy || !amount} onClick={take}>
                {busy ? 'Recording…' : `Take ${amount ? fmtCedi(parseFloat(amount) || 0) : 'the payment'}`}
              </button>
            </div>

            {(account?.history || []).length > 0 && (
              <div className="card">
                <div className="card-title">What this pupil has already paid</div>
                <div className="table-wrap" style={{ maxHeight: 240 }}>
                  <table>
                    <thead>
                      <tr><th>Receipt</th><th>For</th><th>Date</th><th>How</th>
                        <th className="text-right">Amount</th></tr>
                    </thead>
                    <tbody>
                      {account.history.map(h => (
                        <tr key={`${h.source}-${h.id}`}>
                          <td className="text-sm" style={{ fontFamily: 'monospace' }}>{h.receipt_number || '—'}</td>
                          <td className="text-sm">{sourceLabel(h.source)}</td>
                          <td className="text-sm text-muted">{fmtDate(h.payment_date)}</td>
                          <td className="text-sm">
                            {h.payment_method}
                            {h.reference && <div className="text-xs text-muted">{h.reference}</div>}
                          </td>
                          <td className="text-right bold" style={{ color: 'var(--success)' }}>
                            {fmtCedi(h.amount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function sourceLabel(source) {
  return { fees: 'School fees', books: 'Books', canteen: 'Canteen', transport: 'Transport' }[source] || source;
}

function paperLabel(size) {
  return {
    roll80: 'an 80 mm thermal roll', roll58: 'a 58 mm thermal roll',
    A4: 'A4', A5: 'A5', Letter: 'Letter paper',
  }[size] || 'an 80 mm thermal roll';
}
