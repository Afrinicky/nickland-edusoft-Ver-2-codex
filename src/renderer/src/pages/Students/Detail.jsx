import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useStore } from '../../store/index.js';
import { fullName, initials, fmtDate, fmtCedi, displayAge } from '../../lib/format.js';
import Modal from '../../components/Modal.jsx';
import ConfirmDialog from '../../components/ConfirmDialog.jsx';
import StudentForm from './Form.jsx';

export default function StudentDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const currentTerm = useStore(s => s.currentTerm);
  const showToast = useStore(s => s.showToast);
  const [student, setStudent] = useState(null);
  const [tab, setTab] = useState('profile');
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [bill, setBill] = useState(null);
  const [payments, setPayments] = useState([]);
  const [canteen, setCanteen] = useState(null);

  useEffect(() => { load(); }, [id]);

  async function load() {
    const s = await window.api.students.get(parseInt(id));
    setStudent(s);
    if (currentTerm) {
      const bills = await window.api.fees.listBills({ studentId: parseInt(id), termId: currentTerm.id });
      if (bills.length > 0) {
        const full = await window.api.fees.getBill(bills[0].id);
        setBill(full);
      }
      const pays = await window.api.fees.listPayments(parseInt(id), currentTerm.id);
      setPayments(pays);
      const canteenP = await window.api.canteen.getStudentProfile(parseInt(id), currentTerm.id);
      setCanteen(canteenP);
    }
  }

  if (!student) return <div className="text-muted">Loading…</div>;

  return (
    <div>
      <div className="row gap-2 mb-3">
        <button className="btn btn-ghost btn-sm" onClick={() => navigate('/students')}>← Back</button>
      </div>

      <div className="card">
        <div className="row gap-4" style={{ alignItems: 'flex-start' }}>
          <div className="avatar avatar-lg">{initials(student)}</div>
          <div className="flex-1">
            <h2 style={{ margin: 0, fontSize: 22 }}>{fullName(student)}</h2>
            <div className="text-muted text-sm mt-1">
              <span className="bold" style={{ color: 'var(--accent)' }}>{student.index_number}</span> ·
              {' '}{student.class_name} · {student.gender} · Age {displayAge(student)}
            </div>
            <div className="row gap-2 mt-3">
              <span className="badge badge-success">{student.status}</span>
              {student.denomination && <span className="badge badge-muted">{student.denomination}</span>}
            </div>
          </div>
          <div className="row gap-2">
            <button className="btn btn-outline btn-sm" onClick={() => navigate(`/students/${student.id}/print`)}>
              🖨 Print Profile
            </button>
            <button className="btn btn-outline" onClick={() => setEditing(true)}>Edit</button>
            <button className="btn btn-danger btn-sm" onClick={() => setConfirm(true)}>Delete</button>
          </div>
        </div>
      </div>

      <div className="tabs mt-4">
        <button className={'tab' + (tab === 'profile' ? ' active' : '')} onClick={() => setTab('profile')}>Profile</button>
        <button className={'tab' + (tab === 'fees' ? ' active' : '')} onClick={() => setTab('fees')}>Fees & Payments</button>
        <button className={'tab' + (tab === 'canteen' ? ' active' : '')} onClick={() => setTab('canteen')}>Canteen</button>
        <button className={'tab' + (tab === 'academics' ? ' active' : '')} onClick={() => setTab('academics')}>Academics</button>
      </div>

      {tab === 'profile' && <ProfileView student={student} />}
      {tab === 'fees' && <FeesView student={student} bill={bill} payments={payments} onReload={load} />}
      {tab === 'canteen' && <CanteenView canteen={canteen} student={student} onReload={load} />}
      {tab === 'academics' && <AcademicsView student={student} />}

      {editing && (
        <Modal title="Edit student" onClose={() => setEditing(false)} size="lg">
          <StudentForm student={student}
            onSaved={() => { setEditing(false); load(); showToast('Student updated'); }}
            onCancel={() => setEditing(false)} />
        </Modal>
      )}
      <ConfirmDialog
        open={confirm}
        title="Delete student?"
        message={`This will permanently delete ${fullName(student)} and all related records.`}
        danger
        confirmLabel="Delete"
        onCancel={() => setConfirm(false)}
        onConfirm={async () => {
          await window.api.students.delete(student.id);
          showToast('Student deleted', 'success');
          navigate('/students');
        }}
      />
    </div>
  );
}

function ProfileView({ student }) {
  return (
    <div className="card">
      <h3 className="card-title">Personal details</h3>
      <table className="table">
        <tbody>
          <Row label="Date of birth">{fmtDate(student.date_of_birth)}</Row>
          <Row label="Place of birth">{student.place_of_birth || '—'}</Row>
          <Row label="Place of residence">{student.place_of_residence || '—'}</Row>
          <Row label="Denomination">{student.denomination || '—'}</Row>
          <Row label="NHIS number">{student.nhis_number || '—'}</Row>
        </tbody>
      </table>
      <h3 className="card-title mt-4">Parents / Guardian</h3>
      <table className="table">
        <tbody>
          <Row label="Father">{student.father_name || '—'} <span className="text-muted">{student.father_contact}</span></Row>
          <Row label="Mother">{student.mother_name || '—'} <span className="text-muted">{student.mother_contact}</span></Row>
          <Row label="Guardian">{student.guardian_name || '—'} <span className="text-muted">{student.guardian_contact}</span></Row>
        </tbody>
      </table>
      <h3 className="card-title mt-4">Address</h3>
      <table className="table">
        <tbody>
          <Row label="Street">{student.street_address || '—'}</Row>
          <Row label="House no">{student.house_number || '—'}</Row>
          <Row label="Digital (GPS)">{student.digital_address || '—'}</Row>
        </tbody>
      </table>
    </div>
  );
}

function Row({ label, children }) {
  return <tr><td style={{ width: 180, color: 'var(--muted)' }}>{label}</td><td>{children}</td></tr>;
}

function FeesView({ student, bill, payments, onReload }) {
  const currentTerm = useStore(s => s.currentTerm);
  const showToast = useStore(s => s.showToast);
  const [showPayment, setShowPayment] = useState(false);

  async function genBill() {
    if (!currentTerm) return;
    const res = await window.api.fees.generateBill(student.id, currentTerm.id);
    if (res.ok) { showToast('Bill generated'); onReload(); }
    else showToast(res.error || 'Failed', 'error');
  }

  async function printBill() {
    if (!bill) return;
    const res = await window.api.reports.generateBillsPdf({ billIds: [bill.id] });
    if (res.ok) showToast(`PDF saved: ${res.path.split(/[\\/]/).pop()}`);
  }

  return (
    <div className="card">
      <div className="card-header">
        <div>
          <div className="card-title">Bills & Payments — {currentTerm ? currentTerm.label : ''}</div>
        </div>
        <div className="row gap-2">
          {!bill && <button className="btn btn-primary" onClick={genBill}>Generate bill</button>}
          {bill && <>
            <button className="btn btn-outline" onClick={printBill}>🖨 Print bill</button>
            <button className="btn btn-primary" onClick={() => setShowPayment(true)}>+ Record payment</button>
          </>}
        </div>
      </div>

      {bill ? (
        <>
          <div className="stat-grid">
            <div className="stat-tile"><div className="stat-label">Total bill</div><div className="stat-value">{fmtCedi(bill.total_amount)}</div></div>
            <div className="stat-tile"><div className="stat-label">Paid</div><div className="stat-value" style={{ color: 'var(--success)' }}>{fmtCedi(bill.paid_amount)}</div></div>
            <div className="stat-tile"><div className="stat-label">Balance</div><div className="stat-value accent">{fmtCedi(bill.balance)}</div></div>
          </div>

          <h4 style={{ fontSize: 13, marginTop: 16 }}>Line items</h4>
          <table className="table">
            <thead><tr><th>#</th><th>Description</th><th className="text-right">Amount</th></tr></thead>
            <tbody>
              {(bill.items || []).map(item => (
                <tr key={item.id} style={item.is_arrear ? { background: 'var(--accent-50)' } : {}}>
                  <td>{item.item_number}</td>
                  <td>{item.description}</td>
                  <td className="text-right">{fmtCedi(item.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h4 style={{ fontSize: 13, marginTop: 16 }}>Payment history</h4>
          <table className="table">
            <thead><tr><th>Date</th><th>Receipt</th><th>Method</th><th className="text-right">Amount</th></tr></thead>
            <tbody>
              {payments.length === 0 ? (
                <tr><td colSpan="4" className="text-muted text-center">No payments yet</td></tr>
              ) : payments.map(p => (
                <tr key={p.id}>
                  <td>{fmtDate(p.payment_date)}</td>
                  <td>{p.receipt_number}</td>
                  <td>{p.payment_method}</td>
                  <td className="text-right">{fmtCedi(p.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : (
        <div className="empty-state">
          <h3>No bill for this term yet</h3>
          <p>Generate a bill to start recording payments.</p>
        </div>
      )}

      {showPayment && bill && (
        <PaymentModal bill={bill} student={student} term={currentTerm}
          onClose={() => setShowPayment(false)}
          onDone={() => { setShowPayment(false); onReload(); }}
        />
      )}
    </div>
  );
}

function PaymentModal({ bill, student, term, onClose, onDone }) {
  const showToast = useStore(s => s.showToast);
  const [data, setData] = useState({
    amount: bill.balance || 0,
    payment_date: new Date().toISOString().slice(0, 10),
    payment_method: 'Cash',
    reference: '',
    received_by: '',
    notes: '',
  });

  async function save() {
    const res = await window.api.fees.recordPayment({
      student_id: student.id,
      student_bill_id: bill.id,
      term_id: term.id,
      ...data,
      amount: parseFloat(data.amount),
    });
    if (res.ok) {
      showToast('Payment recorded · ' + res.receipt_number);
      // Generate & open receipt
      const r = await window.api.reports.generateReceipt(res.id, {});
      if (r.ok) showToast(`Receipt saved: ${r.path.split(/[\\/]/).pop()}`);
      onDone();
    }
  }

  return (
    <Modal title="Record payment" onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save}>Save & print receipt</button>
      </>}>
      <div className="form-row">
        <div className="form-group">
          <label className="label">Amount (GHS)</label>
          <input className="input" type="number" step="0.01" value={data.amount ?? ''}
            onChange={e => setData({ ...data, amount: e.target.value })} />
          <div className="helper">Balance: {fmtCedi(bill.balance)}</div>
        </div>
        <div className="form-group">
          <label className="label">Payment date</label>
          <input className="input" type="date" value={data.payment_date ?? ''}
            onChange={e => setData({ ...data, payment_date: e.target.value })} />
        </div>
      </div>
      <div className="form-row">
        <div className="form-group">
          <label className="label">Method</label>
          <select className="select" value={data.payment_method ?? ''}
            onChange={e => setData({ ...data, payment_method: e.target.value })}>
            <option>Cash</option><option>Mobile Money</option><option>Bank Transfer</option><option>Cheque</option>
          </select>
        </div>
        <div className="form-group">
          <label className="label">Reference</label>
          <input className="input" value={data.reference ?? ''}
            onChange={e => setData({ ...data, reference: e.target.value })} />
        </div>
      </div>
      <div className="form-group">
        <label className="label">Received by</label>
        <input className="input" value={data.received_by ?? ''}
          onChange={e => setData({ ...data, received_by: e.target.value })} />
      </div>
    </Modal>
  );
}

function CanteenView({ canteen, student, onReload }) {
  const currentTerm = useStore(s => s.currentTerm);
  const showToast = useStore(s => s.showToast);
  const [showPay, setShowPay] = useState(false);

  if (!canteen) return <div className="card empty-state">Loading…</div>;
  if (!canteen.calendar || canteen.calendar.length === 0) {
    return (
      <div className="card empty-state">
        <h3>No canteen calendar set up for this term</h3>
        <p>Go to Canteen → Calendar to generate the term schedule first.</p>
      </div>
    );
  }
  return (
    <div className="card">
      <div className="card-header">
        <div className="card-title">Canteen — {currentTerm ? currentTerm.label : ''}</div>
        <button className="btn btn-primary" onClick={() => setShowPay(true)}>+ Record canteen payment</button>
      </div>
      <div className="stat-grid">
        <div className="stat-tile"><div className="stat-label">Daily rate</div><div className="stat-value">{fmtCedi(canteen.daily_rate)}</div></div>
        <div className="stat-tile"><div className="stat-label">Paid days</div><div className="stat-value" style={{ color: 'var(--success)' }}>{canteen.summary.paid_days}</div></div>
        <div className="stat-tile"><div className="stat-label">Unpaid days</div><div className="stat-value accent">{canteen.summary.unpaid_days}</div></div>
        <div className="stat-tile"><div className="stat-label">Balance</div><div className="stat-value accent">{fmtCedi(canteen.summary.balance)}</div></div>
      </div>

      <h4 style={{ fontSize: 13, marginTop: 16 }}>Calendar</h4>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, 32px)', gap: 4 }}>
        {canteen.calendar.map(d => (
          <div key={d.date}
            title={`${d.date} · ${d.status}`}
            style={{
              width: 32, height: 32,
              border: '1px solid var(--border)',
              borderRadius: 4,
              fontSize: 10,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background:
                d.status === 'paid' ? 'var(--success)' :
                d.status === 'unpaid' ? '#fee2e2' :
                d.day_type !== 'school_day' ? 'var(--surface-3)' : 'transparent',
              color: d.status === 'paid' ? '#fff' : 'var(--muted)',
            }}>
            {new Date(d.date).getDate()}
          </div>
        ))}
      </div>

      <h4 style={{ fontSize: 13, marginTop: 16 }}>Payment history</h4>
      <table className="table">
        <thead><tr><th>Date</th><th>Days covered</th><th>Period</th><th className="text-right">Amount</th></tr></thead>
        <tbody>
          {(canteen.payments || []).length === 0 ? (
            <tr><td colSpan="4" className="text-muted text-center">No payments</td></tr>
          ) : canteen.payments.map(p => (
            <tr key={p.id}>
              <td>{fmtDate(p.payment_date)}</td>
              <td>{p.days_covered}</td>
              <td className="text-sm">{p.start_date} → {p.end_date}</td>
              <td className="text-right">{fmtCedi(p.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {showPay && (
        <CanteenPaymentModal student={student} term={currentTerm}
          onClose={() => setShowPay(false)}
          onDone={() => { setShowPay(false); onReload(); showToast('Canteen payment recorded'); }}
        />
      )}
    </div>
  );
}

function CanteenPaymentModal({ student, term, onClose, onDone }) {
  const [data, setData] = useState({
    amount: 0,
    payment_date: new Date().toISOString().slice(0, 10),
    received_by: '',
    notes: '',
  });
  async function save() {
    const res = await window.api.canteen.recordPayment({
      student_id: student.id,
      term_id: term.id,
      ...data,
      amount: parseFloat(data.amount),
    });
    if (res.ok) onDone();
  }
  return (
    <Modal title="Canteen payment" onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save}>Save</button>
      </>}>
      <div className="form-row">
        <div className="form-group">
          <label className="label">Amount (GHS)</label>
          <input className="input" type="number" value={data.amount ?? ''}
            onChange={e => setData({ ...data, amount: e.target.value })} />
        </div>
        <div className="form-group">
          <label className="label">Payment date</label>
          <input className="input" type="date" value={data.payment_date ?? ''}
            onChange={e => setData({ ...data, payment_date: e.target.value })} />
        </div>
      </div>
      <div className="form-group">
        <label className="label">Received by</label>
        <input className="input" value={data.received_by ?? ''}
          onChange={e => setData({ ...data, received_by: e.target.value })} />
      </div>
    </Modal>
  );
}

function AcademicsView({ student }) {
  const currentTerm = useStore(s => s.currentTerm);
  const [report, setReport] = useState(null);

  useEffect(() => {
    (async () => {
      if (currentTerm) {
        const r = await window.api.scores.getStudentReport(student.id, currentTerm.id);
        setReport(r);
      }
    })();
  }, [student.id, currentTerm]);

  async function printReportCard() {
    const res = await window.api.reports.generateReportCards({
      termId: currentTerm.id, scope: 'selected', studentIds: [student.id]
    });
    if (res.ok) await window.api.app.openFolder(res.path);
  }

  if (!report) return <div className="card empty-state">Loading…</div>;
  return (
    <div className="card">
      <div className="card-header">
        <div className="card-title">Academic record — {currentTerm ? currentTerm.label : ''}</div>
        <button className="btn btn-primary" onClick={printReportCard}>🖨 Print report card</button>
      </div>

      {report.scores && report.scores.length > 0 ? (
        <table className="table">
          <thead>
            <tr>
              <th>Subject</th>
              <th className="text-right">Class (40%)</th>
              <th className="text-right">Exam (60%)</th>
              <th className="text-right">Total</th>
              <th>Remark</th>
            </tr>
          </thead>
          <tbody>
            {report.scores.map(s => (
              <tr key={s.id}>
                <td>{s.subject_name}</td>
                <td className="text-right">{s.class_score?.toFixed(1)}</td>
                <td className="text-right">{s.exam_score?.toFixed(1)}</td>
                <td className="text-right bold">{s.total_score?.toFixed(1)}</td>
                <td><span className="badge badge-muted">{s.grade_remark}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="empty-state">No scores recorded yet for this term.</div>
      )}
    </div>
  );
}
