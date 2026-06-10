// Nickland Edusoft — Finance modals shared between tabs
import React, { useState } from 'react';
import { useStore } from '../../store/index.js';
import Modal from '../../components/Modal.jsx';

export function IncomeModal({ onClose, onDone }) {
  const { currentTerm } = useStore();
  const [data, setData] = useState({
    transaction_date: new Date().toISOString().slice(0, 10),
    category: 'other',
    subcategory: '',
    description: '',
    amount: 0,
    payer_name: '',
    payment_method: 'Cash',
    reference: '',
  });
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!data.amount || data.amount <= 0) return;
    setSaving(true);
    await window.api.finance.recordIncome({
      ...data,
      amount: parseFloat(data.amount),
      term_id: currentTerm?.id || null,
    });
    setSaving(false);
    onDone();
  }

  return (
    <Modal title="Record Income" onClose={onClose}>
      <div className="form-row">
        <div className="form-group">
          <label>Date</label>
          <input type="date" value={data.transaction_date ?? ''}
            onChange={e => setData({ ...data, transaction_date: e.target.value })} />
        </div>
        <div className="form-group">
          <label>Category</label>
          <select value={data.category ?? ''}
            onChange={e => setData({ ...data, category: e.target.value })}>
            <option value="fees">School Fees</option>
            <option value="canteen">Canteen</option>
            <option value="admission">Admission Fee</option>
            <option value="donation">Donation</option>
            <option value="grant">Grant / Subvention</option>
            <option value="sales">Sales (Books/Uniform)</option>
            <option value="fundraising">Fundraising</option>
            <option value="rental">Rental Income</option>
            <option value="other">Other Income</option>
          </select>
        </div>
        <div className="form-group">
          <label>Subcategory (optional)</label>
          <input type="text" value={data.subcategory ?? ''}
            onChange={e => setData({ ...data, subcategory: e.target.value })}
            placeholder="e.g. Uniform, PTA Levy" />
        </div>
        <div className="form-group">
          <label>Amount (GHS)</label>
          <input type="number" step="0.01" value={data.amount ?? ''}
            onChange={e => setData({ ...data, amount: e.target.value })} autoFocus />
        </div>
      </div>
      <div className="form-group">
        <label>Description</label>
        <input type="text" value={data.description ?? ''}
          onChange={e => setData({ ...data, description: e.target.value })} />
      </div>
      <div className="form-row">
        <div className="form-group">
          <label>Payer Name</label>
          <input type="text" value={data.payer_name ?? ''}
            onChange={e => setData({ ...data, payer_name: e.target.value })} />
        </div>
        <div className="form-group">
          <label>Payment Method</label>
          <select value={data.payment_method ?? ''}
            onChange={e => setData({ ...data, payment_method: e.target.value })}>
            <option>Cash</option><option>Mobile Money</option><option>Bank</option>
            <option>Cheque</option><option>Card</option>
          </select>
        </div>
        <div className="form-group">
          <label>Reference</label>
          <input type="text" value={data.reference ?? ''}
            onChange={e => setData({ ...data, reference: e.target.value })}
            placeholder="MoMo TXN ID, cheque #, etc." />
        </div>
      </div>
      <div className="modal-footer">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={saving || !data.amount}>
          {saving ? 'Saving…' : 'Record Income'}
        </button>
      </div>
    </Modal>
  );
}

export function ExpenseModal({ onClose, onDone }) {
  const { currentTerm, currentUser } = useStore();
  const [data, setData] = useState({
    transaction_date: new Date().toISOString().slice(0, 10),
    category: 'operations',
    subcategory: '',
    description: '',
    amount: 0,
    payee_name: '',
    payment_method: 'Cash',
    reference: '',
  });
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!data.amount || data.amount <= 0) return;
    if (!data.description.trim()) return;
    setSaving(true);
    await window.api.finance.recordExpense({
      ...data,
      amount: parseFloat(data.amount),
      term_id: currentTerm?.id || null,
      recorded_by: currentUser?.id || null,
    });
    setSaving(false);
    onDone();
  }

  return (
    <Modal title="Record Expense" onClose={onClose}>
      <div className="form-row">
        <div className="form-group">
          <label>Date</label>
          <input type="date" value={data.transaction_date ?? ''}
            onChange={e => setData({ ...data, transaction_date: e.target.value })} />
        </div>
        <div className="form-group">
          <label>Category</label>
          <select value={data.category ?? ''}
            onChange={e => setData({ ...data, category: e.target.value })}>
            <option value="salary">Salary</option>
            <option value="utilities">Utilities (Electricity/Water)</option>
            <option value="rent">Rent</option>
            <option value="supplies">Supplies / Stationery</option>
            <option value="canteen_supplies">Canteen Supplies</option>
            <option value="maintenance">Maintenance / Repairs</option>
            <option value="transport">Transport / Fuel</option>
            <option value="operations">Operations</option>
            <option value="welfare">Welfare</option>
            <option value="taxes_levies">Taxes / Levies</option>
            <option value="ssnit_remittance">SSNIT Remittance</option>
            <option value="paye_remittance">PAYE Remittance</option>
            <option value="construction">Construction / Capital</option>
            <option value="training">Staff Training</option>
            <option value="marketing">Marketing</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div className="form-group">
          <label>Subcategory (optional)</label>
          <input type="text" value={data.subcategory ?? ''}
            onChange={e => setData({ ...data, subcategory: e.target.value })}
            placeholder="e.g. ECG, GWCL" />
        </div>
        <div className="form-group">
          <label>Amount (GHS)</label>
          <input type="number" step="0.01" value={data.amount ?? ''}
            onChange={e => setData({ ...data, amount: e.target.value })} autoFocus />
        </div>
      </div>
      <div className="form-group">
        <label>Description <span className="text-danger">*</span></label>
        <input type="text" value={data.description ?? ''}
          onChange={e => setData({ ...data, description: e.target.value })}
          placeholder="What was this payment for?" />
      </div>
      <div className="form-row">
        <div className="form-group">
          <label>Payee Name</label>
          <input type="text" value={data.payee_name ?? ''}
            onChange={e => setData({ ...data, payee_name: e.target.value })} />
        </div>
        <div className="form-group">
          <label>Payment Method</label>
          <select value={data.payment_method ?? ''}
            onChange={e => setData({ ...data, payment_method: e.target.value })}>
            <option>Cash</option><option>Mobile Money</option><option>Bank</option>
            <option>Cheque</option><option>Card</option>
          </select>
        </div>
        <div className="form-group">
          <label>Reference</label>
          <input type="text" value={data.reference ?? ''}
            onChange={e => setData({ ...data, reference: e.target.value })} />
        </div>
      </div>
      <div className="modal-footer">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save}
          disabled={saving || !data.amount || !data.description.trim()}>
          {saving ? 'Saving…' : 'Record Expense'}
        </button>
      </div>
    </Modal>
  );
}
