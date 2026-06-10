// Nickland Edusoft — Budgets Tab
// Termly, Monthly, Quarterly, Annual budgets with manual item addition
// Accountant-grade: projected vs actual, variance analysis
import React, { useEffect, useState } from 'react';
import { useStore } from '../../store/index.js';
import { fmtCedi, fmtDate } from '../../lib/format.js';

export default function BudgetsTab() {
  const showToast = useStore(s => s.showToast);
  const [budgets, setBudgets] = useState([]);
  const [typeFilter, setTypeFilter] = useState('');
  const [openId, setOpenId] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    const list = await window.api.finance.listBudgets({
      budgetType: typeFilter || undefined,
    });
    setBudgets(list);
    setLoading(false);
  }
  useEffect(() => { refresh(); }, [typeFilter]);

  if (openId) {
    return <BudgetDetail
      budgetId={openId}
      onClose={() => { setOpenId(null); refresh(); }}
    />;
  }

  return (
    <div className="budgets-tab">
      <div className="card">
        <div className="section-header">
          <div>
            <div className="section-title">Budgets</div>
            <div className="text-sm text-muted">
              Plan and track income and expenses across different time periods
            </div>
          </div>
          <button className="btn btn-primary" onClick={() => setShowAdd(true)}>+ New Budget</button>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>Budget Type</label>
            <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
              <option value="">All Types</option>
              <option value="term">Termly</option>
              <option value="month">Monthly</option>
              <option value="quarter">Quarterly</option>
              <option value="year">Annual</option>
              <option value="project">Project</option>
            </select>
          </div>
        </div>
      </div>

      {loading
        ? <div style={{ padding: 30, textAlign: 'center' }}><div className="spinner" /></div>
        : budgets.length === 0
          ? <div className="card empty-state" style={{ marginTop: 16 }}>
              No budgets yet. Create your first budget to plan finances for a period.
            </div>
          : <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
              {budgets.map(b => (
                <BudgetCard key={b.id} budget={b} onOpen={() => setOpenId(b.id)} />
              ))}
            </div>
      }

      {showAdd && (
        <BudgetFormModal
          onClose={() => setShowAdd(false)}
          onSaved={(id) => { setShowAdd(false); setOpenId(id); }}
        />
      )}
    </div>
  );
}

// ── Budget Card ────────────────────────────────────────
function BudgetCard({ budget, onOpen }) {
  return (
    <div className="budget-card" onClick={onOpen}>
      <div className="budget-card-header">
        <div className="budget-card-title">{budget.title}</div>
        <span className={'badge badge-' + statusBadge(budget.status)}>{budget.status}</span>
      </div>
      <div className="budget-card-type">
        <span className="badge badge-primary">{labelize(budget.budget_type)}</span>
        {budget.period_label && <span className="text-xs text-muted" style={{ marginLeft: 6 }}>{budget.period_label}</span>}
      </div>
      {(budget.term_label || budget.year_label) && (
        <div className="text-xs text-muted" style={{ marginTop: 6 }}>
          {budget.year_label} {budget.term_label && `· ${budget.term_label}`}
        </div>
      )}
      {(budget.start_date || budget.end_date) && (
        <div className="text-xs text-muted">
          {budget.start_date && fmtDate(budget.start_date)}
          {budget.end_date && ` → ${fmtDate(budget.end_date)}`}
        </div>
      )}
      {budget.notes && <div className="text-sm" style={{ marginTop: 8 }}>{budget.notes}</div>}
      <div className="budget-card-action">Open →</div>
    </div>
  );
}

function statusBadge(s) {
  return { draft: 'muted', active: 'success', closed: 'info' }[s] || 'muted';
}

// ── Budget Detail (line items editor) ──────────────────
function BudgetDetail({ budgetId, onClose }) {
  const showToast = useStore(s => s.showToast);
  const [budget, setBudget] = useState(null);
  const [editingItem, setEditingItem] = useState(null);

  async function refresh() {
    const b = await window.api.finance.getBudget(budgetId);
    setBudget(b);
  }
  useEffect(() => { refresh(); }, [budgetId]);

  async function deleteItem(id) {
    if (!confirm('Delete this line item?')) return;
    await window.api.finance.deleteBudgetItem(id);
    showToast('Item deleted', 'success');
    refresh();
  }

  async function deleteBudget() {
    if (!confirm('Delete this entire budget and all its line items? This cannot be undone.')) return;
    await window.api.finance.deleteBudget(budgetId);
    showToast('Budget deleted', 'success');
    onClose();
  }

  if (!budget) return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" /></div>;

  const incomeItems = budget.items.filter(i => i.item_type === 'income');
  const expenseItems = budget.items.filter(i => i.item_type === 'expense');
  const projIncome = incomeItems.reduce((s, i) => s + (i.projected_amount || 0), 0);
  const actIncome = incomeItems.reduce((s, i) => s + (i.actual_amount || 0), 0);
  const projExpense = expenseItems.reduce((s, i) => s + (i.projected_amount || 0), 0);
  const actExpense = expenseItems.reduce((s, i) => s + (i.actual_amount || 0), 0);
  const projNet = projIncome - projExpense;
  const actNet = actIncome - actExpense;

  return (
    <div className="budget-detail">
      <div className="card no-print">
        <div className="row gap-2 mb-2">
          <button className="btn btn-ghost btn-sm" onClick={onClose}>← Back to Budgets</button>
        </div>
        <div className="section-header">
          <div>
            <h2 style={{ margin: 0 }}>{budget.title}</h2>
            <div className="text-sm text-muted" style={{ marginTop: 4 }}>
              <span className="badge badge-primary">{labelize(budget.budget_type)}</span>
              {' '}{budget.period_label}
              {budget.term_label && ` · ${budget.term_label} (${budget.year_label})`}
              {budget.start_date && ` · ${fmtDate(budget.start_date)}`}
              {budget.end_date && ` → ${fmtDate(budget.end_date)}`}
            </div>
          </div>
          <div className="row gap-2">
            <button className="btn btn-outline btn-sm" onClick={() => window.print()}>🖨 Print</button>
            <button className="btn btn-danger btn-sm" onClick={deleteBudget}>Delete Budget</button>
          </div>
        </div>
      </div>

      {/* Summary cards */}
      <div className="dash-metrics" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginTop: 16 }}>
        <SummaryCard label="Projected Income" value={projIncome} color="var(--success)" />
        <SummaryCard label="Actual Income" value={actIncome} color="var(--success)" sub={varianceLabel(actIncome, projIncome)} />
        <SummaryCard label="Projected Expenses" value={projExpense} color="var(--danger)" />
        <SummaryCard label="Actual Expenses" value={actExpense} color="var(--danger)" sub={varianceLabel(actExpense, projExpense)} />
      </div>
      <div className="dash-metrics" style={{ gridTemplateColumns: 'repeat(2, 1fr)', marginTop: 14 }}>
        <SummaryCard label="Projected Net" value={projNet} color={projNet >= 0 ? 'var(--success)' : 'var(--danger)'} />
        <SummaryCard label="Actual Net" value={actNet} color={actNet >= 0 ? 'var(--success)' : 'var(--danger)'}
          sub={projNet !== 0 ? `${Math.round(((actNet - projNet) / Math.abs(projNet)) * 100)}% vs plan` : ''} />
      </div>

      {/* Line items — income section */}
      <BudgetItemsSection
        title="Income Line Items"
        items={incomeItems}
        budgetId={budgetId}
        itemType="income"
        accent="var(--success)"
        onEdit={(item) => setEditingItem({ ...item, item_type: 'income' })}
        onDelete={deleteItem}
      />

      {/* Line items — expense section */}
      <BudgetItemsSection
        title="Expense Line Items"
        items={expenseItems}
        budgetId={budgetId}
        itemType="expense"
        accent="var(--danger)"
        onEdit={(item) => setEditingItem({ ...item, item_type: 'expense' })}
        onDelete={deleteItem}
      />

      {editingItem && (
        <BudgetItemModal
          item={editingItem}
          budgetId={budgetId}
          onClose={() => setEditingItem(null)}
          onSaved={() => { setEditingItem(null); refresh(); showToast('Item saved', 'success'); }}
        />
      )}
    </div>
  );
}

function SummaryCard({ label, value, color, sub }) {
  return (
    <div className="metric-card">
      <div className="metric-body">
        <div className="metric-label">{label}</div>
        <div className="metric-value" style={{ color }}>{fmtCedi(value)}</div>
        {sub && <div className="metric-sub">{sub}</div>}
      </div>
    </div>
  );
}

function varianceLabel(actual, projected) {
  if (projected === 0) return actual > 0 ? 'No baseline set' : '';
  const variance = ((actual - projected) / projected) * 100;
  const sign = variance >= 0 ? '+' : '';
  return `${sign}${variance.toFixed(1)}% vs projected`;
}

function BudgetItemsSection({ title, items, budgetId, itemType, accent, onEdit, onDelete }) {
  const [showAddItem, setShowAddItem] = useState(false);
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="section-header">
        <div className="section-title" style={{ color: accent }}>{title}</div>
        <button className="btn btn-outline btn-sm" onClick={() => setShowAddItem(true)}>+ Add Line</button>
      </div>
      {items.length === 0
        ? <div className="empty-state">No {itemType} items yet</div>
        : <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Description</th>
                  <th className="text-right">Projected</th>
                  <th className="text-right">Actual</th>
                  <th className="text-right">Variance</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.map(item => {
                  const variance = item.actual_amount - item.projected_amount;
                  const vPct = item.projected_amount > 0
                    ? ((item.actual_amount - item.projected_amount) / item.projected_amount) * 100
                    : 0;
                  return (
                    <tr key={item.id}>
                      <td><span className="badge badge-muted">{item.category}</span></td>
                      <td><strong>{item.description}</strong>{item.notes && <div className="text-xs text-muted">{item.notes}</div>}</td>
                      <td className="text-right">{fmtCedi(item.projected_amount)}</td>
                      <td className="text-right">{fmtCedi(item.actual_amount)}</td>
                      <td className="text-right" style={{
                        color: itemType === 'income'
                          ? (variance >= 0 ? 'var(--success)' : 'var(--danger)')
                          : (variance <= 0 ? 'var(--success)' : 'var(--danger)')
                      }}>
                        {variance >= 0 ? '+' : ''}{fmtCedi(variance)}
                        {item.projected_amount > 0 && (
                          <div className="text-xs">{vPct >= 0 ? '+' : ''}{vPct.toFixed(1)}%</div>
                        )}
                      </td>
                      <td>
                        <button className="btn btn-ghost btn-sm" onClick={() => onEdit(item)}>Edit</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => onDelete(item.id)}>×</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
      }
      {showAddItem && (
        <BudgetItemModal
          item={{ item_type: itemType }}
          budgetId={budgetId}
          onClose={() => setShowAddItem(false)}
          onSaved={() => { setShowAddItem(false); window.location.reload(); }}
        />
      )}
    </div>
  );
}

// ── Budget Form Modal (create new budget) ──────────────
function BudgetFormModal({ onClose, onSaved }) {
  const { currentUser, currentTerm } = useStore();
  const [terms, setTerms] = useState([]);
  const [years, setYears] = useState([]);
  const [form, setForm] = useState({
    title: '',
    budget_type: 'term',
    academic_year_id: '',
    term_id: currentTerm?.id || '',
    period_label: '',
    start_date: '',
    end_date: '',
    notes: '',
    status: 'draft',
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const [t, y] = await Promise.all([
        window.api.settings.listTerms(),
        window.api.settings.listAcademicYears(),
      ]);
      setTerms(t);
      setYears(y);
    })();
  }, []);

  async function save() {
    if (!form.title.trim()) return;
    setSaving(true);
    const res = await window.api.finance.saveBudget({
      ...form,
      academic_year_id: form.academic_year_id || null,
      term_id: form.term_id || null,
      created_by: currentUser?.id || null,
    });
    setSaving(false);
    if (res.ok) onSaved(res.id);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">New Budget</div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="form-group">
          <label>Budget Title</label>
          <input type="text" value={form.title ?? ''} autoFocus
            onChange={e => setForm({ ...form, title: e.target.value })}
            placeholder="e.g. Second Term Budget 2025/2026" />
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>Budget Type</label>
            <select value={form.budget_type ?? ''} onChange={e => setForm({ ...form, budget_type: e.target.value })}>
              <option value="term">Termly</option>
              <option value="month">Monthly</option>
              <option value="quarter">Quarterly</option>
              <option value="year">Annual</option>
              <option value="project">Project / Specific</option>
            </select>
          </div>
          <div className="form-group">
            <label>Period Label (optional)</label>
            <input type="text" value={form.period_label ?? ''}
              onChange={e => setForm({ ...form, period_label: e.target.value })}
              placeholder="e.g. January 2026, Q1 2026" />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>Academic Year</label>
            <select value={form.academic_year_id ?? ''} onChange={e => setForm({ ...form, academic_year_id: e.target.value })}>
              <option value="">— Optional —</option>
              {years.map(y => <option key={y.id} value={y.id ?? ''}>{y.label}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Term</label>
            <select value={form.term_id ?? ''} onChange={e => setForm({ ...form, term_id: e.target.value })}>
              <option value="">— Optional —</option>
              {terms.map(t => <option key={t.id} value={t.id ?? ''}>{t.label} ({t.year_label || ''})</option>)}
            </select>
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>Start Date</label>
            <input type="date" value={form.start_date ?? ''}
              onChange={e => setForm({ ...form, start_date: e.target.value })} />
          </div>
          <div className="form-group">
            <label>End Date</label>
            <input type="date" value={form.end_date ?? ''}
              onChange={e => setForm({ ...form, end_date: e.target.value })} />
          </div>
        </div>

        <div className="form-group">
          <label>Notes</label>
          <textarea rows="3" value={form.notes ?? ''}
            onChange={e => setForm({ ...form, notes: e.target.value })}
            placeholder="Strategic context, assumptions, key priorities…" />
        </div>

        <div className="form-group">
          <label>Status</label>
          <select value={form.status ?? ''} onChange={e => setForm({ ...form, status: e.target.value })}>
            <option value="draft">Draft</option>
            <option value="active">Active</option>
            <option value="closed">Closed</option>
          </select>
        </div>

        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving || !form.title.trim()}>
            {saving ? 'Creating…' : 'Create & Add Line Items'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Budget Item Modal (add/edit line item) ─────────────
function BudgetItemModal({ item, budgetId, onClose, onSaved }) {
  const [form, setForm] = useState({
    id: item.id || null,
    item_type: item.item_type || 'expense',
    category: item.category || '',
    description: item.description || '',
    projected_amount: item.projected_amount || 0,
    actual_amount: item.actual_amount || 0,
    notes: item.notes || '',
  });
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!form.category.trim() || !form.description.trim()) return;
    setSaving(true);
    await window.api.finance.saveBudgetItem({
      ...form,
      budget_id: budgetId,
      projected_amount: parseFloat(form.projected_amount) || 0,
      actual_amount: parseFloat(form.actual_amount) || 0,
    });
    setSaving(false);
    onSaved();
  }

  const incomeCategories = ['Fees', 'Canteen', 'Admission', 'Donation', 'Grant', 'Sales', 'Fundraising', 'Rental', 'Other Income'];
  const expenseCategories = ['Salary', 'Utilities', 'Rent', 'Supplies', 'Canteen Supplies', 'Maintenance', 'Transport', 'Operations', 'Welfare', 'Taxes/Levies', 'SSNIT Remittance', 'PAYE Remittance', 'Construction', 'Training', 'Marketing', 'Other'];

  const suggestions = form.item_type === 'income' ? incomeCategories : expenseCategories;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">{form.id ? 'Edit' : 'Add'} {form.item_type === 'income' ? 'Income' : 'Expense'} Line</div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>Type</label>
            <select value={form.item_type ?? ''} onChange={e => setForm({ ...form, item_type: e.target.value })}>
              <option value="income">Income</option>
              <option value="expense">Expense</option>
            </select>
          </div>
          <div className="form-group">
            <label>Category</label>
            <input type="text" list="cat-list" value={form.category ?? ''}
              onChange={e => setForm({ ...form, category: e.target.value })}
              placeholder="Type or choose…" autoFocus />
            <datalist id="cat-list">
              {suggestions.map(s => <option key={s} value={s} />)}
            </datalist>
          </div>
        </div>
        <div className="form-group">
          <label>Description (any custom line item) <span className="text-danger">*</span></label>
          <input type="text" value={form.description ?? ''}
            onChange={e => setForm({ ...form, description: e.target.value })}
            placeholder="e.g. Roofing repairs for Block A" />
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>Projected Amount (GHS)</label>
            <input type="number" step="0.01" value={form.projected_amount ?? ''}
              onChange={e => setForm({ ...form, projected_amount: e.target.value })} />
          </div>
          <div className="form-group">
            <label>Actual Amount (GHS, optional)</label>
            <input type="number" step="0.01" value={form.actual_amount ?? ''}
              onChange={e => setForm({ ...form, actual_amount: e.target.value })} />
          </div>
        </div>
        <div className="form-group">
          <label>Notes</label>
          <textarea rows="2" value={form.notes ?? ''}
            onChange={e => setForm({ ...form, notes: e.target.value })} />
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save}
            disabled={saving || !form.category.trim() || !form.description.trim()}>
            {saving ? 'Saving…' : 'Save Line'}
          </button>
        </div>
      </div>
    </div>
  );
}

function labelize(s) {
  if (!s) return '';
  return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
