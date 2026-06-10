// Nickland Edusoft — Finance Audit & Tracker
// Scans all financial data across the system, flags non-conformities
import React, { useEffect, useState } from 'react';
import { useStore } from '../../store/index.js';
import { fmtCedi, fmtDate } from '../../lib/format.js';

export default function AuditTab() {
  const { currentTerm } = useStore();
  const [audit, setAudit] = useState(null);
  const [loading, setLoading] = useState(true);

  async function runAudit() {
    setLoading(true);

    const [income, expense, payments, canteenPayments, salaries] = await Promise.all([
      window.api.finance.listIncome({ termId: currentTerm?.id }),
      window.api.finance.listExpense({ termId: currentTerm?.id }),
      window.api.fees.dashboard(currentTerm?.id),
      window.api.canteen.dashboard(currentTerm?.id),
      window.api.payroll.bulkPreview(
        new Date().getMonth() + 1,
        new Date().getFullYear()
      ),
    ]);

    const findings = [];

    // Check 1: Income transactions without category
    const noCat = income.filter(r => !r.category);
    if (noCat.length > 0) {
      findings.push({
        severity: 'high',
        title: `${noCat.length} income transaction(s) without category`,
        description: 'Income transactions should always have a category for proper reporting. Edit each transaction and assign a category.',
        items: noCat.map(r => ({ id: r.id, label: `${fmtDate(r.transaction_date || r.date)} · ${fmtCedi(r.amount)} · ${r.description || 'No description'}` })),
      });
    }

    // Check 2: Expense transactions without description
    const noDesc = expense.filter(r => !r.description || !r.description.trim());
    if (noDesc.length > 0) {
      findings.push({
        severity: 'high',
        title: `${noDesc.length} expense transaction(s) without description`,
        description: 'Expenses without descriptions cannot be properly audited. Add descriptions to clarify what each expense was for.',
        items: noDesc.map(r => ({ id: r.id, label: `${fmtDate(r.transaction_date || r.date)} · ${fmtCedi(r.amount)} · ${labelize(r.category)}` })),
      });
    }

    // Check 3: Income vs school fee collections — cross-reference
    const feesIncome = income.filter(r => r.category === 'fees').reduce((s, r) => s + r.amount, 0);
    const feesActual = payments?.metrics?.total_collected || 0;
    const feesDiff = Math.abs(feesIncome - feesActual);
    if (feesDiff > 1) {  // Allow for 1 GHS rounding tolerance
      findings.push({
        severity: 'medium',
        title: 'School fees income does not match payments collected',
        description: `Income ledger shows ${fmtCedi(feesIncome)} from fees but the fees module shows ${fmtCedi(feesActual)} actually paid. This may indicate manual entries, reversals, or missed auto-records. Difference: ${fmtCedi(feesDiff)}.`,
        items: [],
      });
    }

    // Check 4: Canteen income vs canteen payments
    const canteenIncome = income.filter(r => r.category === 'canteen').reduce((s, r) => s + r.amount, 0);
    const canteenActual = canteenPayments?.metrics?.total_collected || 0;
    const canteenDiff = Math.abs(canteenIncome - canteenActual);
    if (canteenDiff > 1) {
      findings.push({
        severity: 'medium',
        title: 'Canteen income does not match canteen payments',
        description: `Income ledger shows ${fmtCedi(canteenIncome)} from canteen but the canteen module shows ${fmtCedi(canteenActual)} collected. Difference: ${fmtCedi(canteenDiff)}.`,
        items: [],
      });
    }

    // Check 5: Salary expenses vs payroll
    const salaryExp = expense.filter(r => r.category === 'salary').reduce((s, r) => s + r.amount, 0);
    const salaryPaid = salaries?.previews?.filter(p => p.is_paid).reduce((s, p) => s + (p.net_salary + (p.arrear_brought_forward || 0)), 0) || 0;
    if (Math.abs(salaryExp - salaryPaid) > 1 && salaryPaid > 0) {
      findings.push({
        severity: 'low',
        title: 'Salary expenses may not match payroll',
        description: `Expenses show ${fmtCedi(salaryExp)} for salaries while payroll shows ${fmtCedi(salaryPaid)} paid this month. This may be expected if payments span months; otherwise reconcile.`,
        items: [],
      });
    }

    // Check 6: Large unattributed transactions (>= GHS 5,000 without payer/payee)
    const largeNoParty = [
      ...income.filter(r => r.amount >= 5000 && !r.payer_name),
      ...expense.filter(r => r.amount >= 5000 && !r.payee_name),
    ];
    if (largeNoParty.length > 0) {
      findings.push({
        severity: 'medium',
        title: `${largeNoParty.length} large transaction(s) (≥ GHS 5,000) without payer/payee`,
        description: 'Large transactions should always identify the party involved for audit purposes.',
        items: largeNoParty.map(r => ({
          id: r.id,
          label: `${fmtDate(r.transaction_date || r.date)} · ${fmtCedi(r.amount)} · ${r.description || labelize(r.category)}`,
        })),
      });
    }

    // Check 7: Future-dated transactions (red flag)
    const today = new Date().toISOString().slice(0, 10);
    const future = [...income, ...expense].filter(r => (r.transaction_date || r.date) > today);
    if (future.length > 0) {
      findings.push({
        severity: 'high',
        title: `${future.length} transaction(s) dated in the future`,
        description: 'Transactions should not be dated in the future. These may be data-entry errors and should be corrected.',
        items: future.map(r => ({ id: r.id, label: `${fmtDate(r.transaction_date || r.date)} · ${fmtCedi(r.amount)} · ${r.description || labelize(r.category)}` })),
      });
    }

    // Check 8: Auto-recorded entries (those marked is_auto) reconciled?
    const autoIncome = income.filter(r => r.is_auto === 1).length;
    const autoExpense = expense.filter(r => r.is_auto === 1).length;

    // Summary computation
    const totalIncome = income.reduce((s, r) => s + r.amount, 0);
    const totalExpense = expense.reduce((s, r) => s + r.amount, 0);

    setAudit({
      generated_at: new Date(),
      term: currentTerm,
      summary: {
        total_income_records: income.length,
        total_expense_records: expense.length,
        total_income: totalIncome,
        total_expense: totalExpense,
        net: totalIncome - totalExpense,
        auto_income: autoIncome,
        auto_expense: autoExpense,
        manual_income: income.length - autoIncome,
        manual_expense: expense.length - autoExpense,
      },
      findings,
      health_score: Math.max(0, 100 - findings.reduce((s, f) => s + (f.severity === 'high' ? 25 : f.severity === 'medium' ? 10 : 3), 0)),
    });
    setLoading(false);
  }

  useEffect(() => { runAudit(); }, [currentTerm?.id]);

  if (loading || !audit) {
    return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" /></div>;
  }

  const healthColor = audit.health_score >= 80 ? 'var(--success)' : audit.health_score >= 60 ? 'var(--warning)' : 'var(--danger)';

  return (
    <div className="audit-tab">
      <div className="card">
        <div className="section-header">
          <div>
            <div className="section-title">Financial Audit & Tracker</div>
            <div className="text-sm text-muted">
              Automated scan of all financial data — generated {new Date(audit.generated_at).toLocaleString()}
            </div>
          </div>
          <button className="btn btn-primary btn-sm" onClick={runAudit}>↻ Re-run Audit</button>
        </div>
      </div>

      {/* Health score */}
      <div className="card" style={{ marginTop: 16, textAlign: 'center', padding: 32 }}>
        <div className="text-sm text-muted">Financial Data Health Score</div>
        <div style={{
          fontSize: 56,
          fontWeight: 700,
          color: healthColor,
          margin: '12px 0',
        }}>
          {audit.health_score}<span style={{ fontSize: 24, color: 'var(--muted)' }}> / 100</span>
        </div>
        <div className="text-sm">
          {audit.findings.length === 0
            ? '✓ No issues detected — all records are clean'
            : `${audit.findings.length} finding${audit.findings.length > 1 ? 's' : ''} require${audit.findings.length === 1 ? 's' : ''} attention`}
        </div>
      </div>

      {/* Summary stats */}
      <div className="dash-metrics" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginTop: 16 }}>
        <div className="metric-card">
          <div className="metric-body">
            <div className="metric-label">Income Records</div>
            <div className="metric-value">{audit.summary.total_income_records}</div>
            <div className="metric-sub">{audit.summary.auto_income} auto · {audit.summary.manual_income} manual</div>
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-body">
            <div className="metric-label">Expense Records</div>
            <div className="metric-value">{audit.summary.total_expense_records}</div>
            <div className="metric-sub">{audit.summary.auto_expense} auto · {audit.summary.manual_expense} manual</div>
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-body">
            <div className="metric-label">Total Movement</div>
            <div className="metric-value">{fmtCedi(audit.summary.total_income + audit.summary.total_expense)}</div>
            <div className="metric-sub">Combined inflow + outflow</div>
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-body">
            <div className="metric-label">Net Position</div>
            <div className="metric-value" style={{ color: audit.summary.net >= 0 ? 'var(--success)' : 'var(--danger)' }}>
              {fmtCedi(audit.summary.net)}
            </div>
            <div className="metric-sub">Income − Expenses</div>
          </div>
        </div>
      </div>

      {/* Findings */}
      {audit.findings.length === 0
        ? <div className="card" style={{ marginTop: 16, textAlign: 'center', padding: 40 }}>
            <div style={{ fontSize: 48 }}>✓</div>
            <div style={{ fontSize: 16, fontWeight: 600, marginTop: 12 }}>All clear</div>
            <div className="text-sm text-muted" style={{ marginTop: 6 }}>
              No non-conformities detected in your financial records.
            </div>
          </div>
        : <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {audit.findings.map((f, i) => (
              <div key={i} className={`card audit-finding audit-${f.severity}`}>
                <div className="audit-finding-header">
                  <div>
                    <span className={'badge badge-' + severityBadge(f.severity)}>{f.severity}</span>
                    <strong style={{ marginLeft: 10 }}>{f.title}</strong>
                  </div>
                </div>
                <div className="text-sm" style={{ marginTop: 8, lineHeight: 1.5 }}>{f.description}</div>
                {f.items.length > 0 && (
                  <details style={{ marginTop: 12 }}>
                    <summary style={{ cursor: 'pointer', fontWeight: 500, fontSize: 13 }}>
                      Affected records ({f.items.length})
                    </summary>
                    <ul style={{ marginTop: 8, marginLeft: 20, fontSize: 12 }}>
                      {f.items.slice(0, 50).map((item, j) => (
                        <li key={j} style={{ marginBottom: 4 }}>{item.label}</li>
                      ))}
                      {f.items.length > 50 && (
                        <li className="text-muted">…and {f.items.length - 50} more</li>
                      )}
                    </ul>
                  </details>
                )}
              </div>
            ))}
          </div>
      }
    </div>
  );
}

function severityBadge(s) {
  return { high: 'danger', medium: 'warning', low: 'info' }[s] || 'muted';
}

function labelize(s) {
  if (!s) return '';
  return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
