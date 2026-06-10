// Nickland Edusoft — Accounting-standard Financial Statement
// Supports date-range, termly, and annual reporting.
// Layout follows a Statement of Income & Expenditure with opening
// balance, category groupings, surplus/deficit, and closing balance.
import React, { useEffect, useState } from 'react';
import { useStore } from '../../store/index.js';
import { fmtCedi } from '../../lib/format.js';

const CATEGORY_LABELS = {
  fees:        'School Fees',
  canteen:     'Canteen',
  books:       'Books',
  uniforms:    'Uniforms',
  transport:   'Transport',
  donation:    'Donations',
  grant:       'Grants',
  other:       'Other Income',
  salary:      'Staff Salaries',
  utilities:   'Utilities',
  maintenance: 'Maintenance & Repairs',
  supplies:    'Supplies & Stationery',
  food:        'Food & Catering',
  rent:        'Rent',
  taxes:       'Statutory (SSNIT/PAYE)',
  transport_exp: 'Transport',
  events:      'Events & Activities',
  ssnit:       'SSNIT Contributions',
  paye:        'PAYE Tax',
};
const labelOf = (k) => CATEGORY_LABELS[k] || (k || 'Uncategorised').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

export default function FinancialStatementTab() {
  const { currentTerm, settings } = useStore();
  const showToast = useStore(s => s.showToast);
  const [terms, setTerms] = useState([]);
  const [years, setYears] = useState([]);
  const [rangeType, setRangeType] = useState('term');
  const [termId, setTermId] = useState('');
  const [academicYearId, setAcademicYearId] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      const [ts, ys] = await Promise.all([
        window.api.settings.listTerms(),
        window.api.settings.listAcademicYears(),
      ]);
      setTerms(ts || []);
      setYears(ys || []);
      // Default selections
      if (currentTerm?.id) setTermId(currentTerm.id);
      const curY = (ys || []).find(y => y.is_current);
      if (curY) setAcademicYearId(curY.id);
      // Default date range = current term
      if (currentTerm) {
        setFromDate(currentTerm.start_date || '');
        setToDate(currentTerm.end_date || '');
      }
    })();
  }, []);

  async function generate() {
    const params = { rangeType };
    if (rangeType === 'term') {
      if (!termId) { showToast('Pick a term', 'warning'); return; }
      params.termId = parseInt(termId);
    } else if (rangeType === 'annual') {
      if (!academicYearId) { showToast('Pick an academic year', 'warning'); return; }
      params.academicYearId = parseInt(academicYearId);
    } else {
      if (!fromDate || !toDate) { showToast('Choose from and to dates', 'warning'); return; }
      params.fromDate = fromDate;
      params.toDate = toDate;
    }
    setLoading(true);
    const res = await window.api.finance.financialStatement(params);
    setLoading(false);
    if (!res.ok) {
      showToast(res.error || 'Could not generate statement', 'error');
      return;
    }
    setData(res);
  }

  useEffect(() => {
    if (rangeType === 'term' && termId) generate();
    if (rangeType === 'annual' && academicYearId) generate();
  }, [rangeType, termId, academicYearId]);

  const schoolName = settings.school?.school_name || 'School';

  return (
    <div className="financial-statement-tab">
      <div className="card no-print">
        <div className="section-header">
          <div>
            <div className="section-title">Financial Statement</div>
            <div className="text-sm text-muted">
              Accounting-standard statement of income & expenditure. Choose a date range, a term, or an academic year.
            </div>
          </div>
          <button className="btn btn-outline btn-sm" onClick={() => window.print()}>🖨 Print Statement</button>
        </div>
        <div className="form-row" style={{ marginTop: 14, alignItems: 'flex-end' }}>
          <div className="form-group">
            <label>Report period</label>
            <select value={rangeType} onChange={e => setRangeType(e.target.value)}>
              <option value="term">Termly</option>
              <option value="annual">Annual (academic year)</option>
              <option value="date">Date Range</option>
            </select>
          </div>
          {rangeType === 'term' && (
            <div className="form-group">
              <label>Term</label>
              <select value={termId} onChange={e => setTermId(e.target.value)}>
                <option value="">— Select term —</option>
                {terms.map(t => <option key={t.id} value={t.id}>{t.label} ({t.year_label || ''})</option>)}
              </select>
            </div>
          )}
          {rangeType === 'annual' && (
            <div className="form-group">
              <label>Academic Year</label>
              <select value={academicYearId} onChange={e => setAcademicYearId(e.target.value)}>
                <option value="">— Select year —</option>
                {years.map(y => <option key={y.id} value={y.id}>{y.label}</option>)}
              </select>
            </div>
          )}
          {rangeType === 'date' && (
            <>
              <div className="form-group">
                <label>From</label>
                <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} />
              </div>
              <div className="form-group">
                <label>To</label>
                <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} />
              </div>
              <div className="form-group">
                <label>&nbsp;</label>
                <button className="btn btn-primary" onClick={generate}>Generate</button>
              </div>
            </>
          )}
        </div>
      </div>

      {loading
        ? <div className="card" style={{ marginTop: 16, padding: 40, textAlign: 'center' }}><div className="spinner" /></div>
        : !data
          ? <div className="card empty-state" style={{ marginTop: 16, padding: 40 }}>Choose a range to generate the statement</div>
          : <StatementReport data={data} schoolName={schoolName} />
      }
    </div>
  );
}

function StatementReport({ data, schoolName }) {
  const incomeRows = data.income_by_category;
  const expenseRows = data.expense_by_category;

  return (
    <div className="card statement-report" style={{ marginTop: 16, padding: '24px 28px' }}>
      <div style={{ textAlign: 'center', marginBottom: 18 }}>
        <h2 style={{ margin: 0, fontSize: 18, letterSpacing: 0.5 }}>{schoolName.toUpperCase()}</h2>
        <div style={{ fontWeight: 600, marginTop: 4 }}>STATEMENT OF INCOME &amp; EXPENDITURE</div>
        <div className="text-sm text-muted" style={{ marginTop: 3 }}>
          {data.period_kind}: <strong>{data.period_label}</strong>
        </div>
        <div className="text-xs text-muted">
          {data.from_date} to {data.to_date}
        </div>
      </div>

      {/* Opening balance */}
      <table className="statement-table">
        <tbody>
          <tr style={{ background: 'var(--surface-2)' }}>
            <td colSpan="2" style={{ fontWeight: 700, padding: '6px 10px' }}>
              Opening Balance
            </td>
            <td className="text-right" style={{ fontWeight: 700, padding: '6px 10px' }}>
              {fmtCedi(data.opening_balance)}
            </td>
          </tr>
        </tbody>
      </table>

      {/* Income section */}
      <table className="statement-table" style={{ marginTop: 10 }}>
        <thead>
          <tr>
            <th colSpan="3" className="statement-section-header" style={{ background: '#15803D' }}>
              INCOME
            </th>
          </tr>
        </thead>
        <tbody>
          {incomeRows.length === 0
            ? <tr><td colSpan="3" className="text-center text-muted" style={{ padding: 14 }}>No income recorded in this period</td></tr>
            : incomeRows.map(r => (
                <tr key={r.category}>
                  <td style={{ paddingLeft: 24 }}>{labelOf(r.category)}</td>
                  <td className="text-center text-xs text-muted">{r.count} entr{r.count === 1 ? 'y' : 'ies'}</td>
                  <td className="text-right">{fmtCedi(r.total)}</td>
                </tr>
              ))
          }
          <tr style={{ borderTop: '2px solid #333', background: '#dcfce7', fontWeight: 700 }}>
            <td style={{ paddingLeft: 12 }}>TOTAL INCOME</td>
            <td></td>
            <td className="text-right">{fmtCedi(data.total_income)}</td>
          </tr>
        </tbody>
      </table>

      {/* Expenditure section */}
      <table className="statement-table" style={{ marginTop: 10 }}>
        <thead>
          <tr>
            <th colSpan="3" className="statement-section-header" style={{ background: '#b91c1c' }}>
              EXPENDITURE
            </th>
          </tr>
        </thead>
        <tbody>
          {expenseRows.length === 0
            ? <tr><td colSpan="3" className="text-center text-muted" style={{ padding: 14 }}>No expenditure recorded in this period</td></tr>
            : expenseRows.map(r => (
                <tr key={r.category}>
                  <td style={{ paddingLeft: 24 }}>{labelOf(r.category)}</td>
                  <td className="text-center text-xs text-muted">{r.count} entr{r.count === 1 ? 'y' : 'ies'}</td>
                  <td className="text-right">{fmtCedi(r.total)}</td>
                </tr>
              ))
          }
          <tr style={{ borderTop: '2px solid #333', background: '#fee2e2', fontWeight: 700 }}>
            <td style={{ paddingLeft: 12 }}>TOTAL EXPENDITURE</td>
            <td></td>
            <td className="text-right">{fmtCedi(data.total_expense)}</td>
          </tr>
        </tbody>
      </table>

      {/* Net + Closing balance */}
      <table className="statement-table" style={{ marginTop: 14 }}>
        <tbody>
          <tr style={{
            background: data.net_surplus >= 0 ? '#dcfce7' : '#fee2e2',
            fontWeight: 700, fontSize: 14,
          }}>
            <td colSpan="2" style={{ padding: '8px 10px' }}>
              {data.net_surplus >= 0 ? 'NET SURPLUS' : 'NET DEFICIT'} (Income − Expenditure)
            </td>
            <td className="text-right" style={{ padding: '8px 10px' }}>
              {fmtCedi(data.net_surplus)}
            </td>
          </tr>
          <tr style={{
            background: 'var(--primary)', color: '#fff',
            fontWeight: 700, fontSize: 14,
          }}>
            <td colSpan="2" style={{ padding: '10px' }}>CLOSING BALANCE (carried forward)</td>
            <td className="text-right" style={{ padding: '10px' }}>{fmtCedi(data.closing_balance)}</td>
          </tr>
        </tbody>
      </table>

      {/* Income by payment method */}
      {data.income_by_method && data.income_by_method.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Income Receipt Methods</div>
          <table className="statement-table">
            <thead>
              <tr>
                <th>Method</th>
                <th className="text-right">Amount</th>
                <th className="text-right" style={{ width: 80 }}>% of Income</th>
              </tr>
            </thead>
            <tbody>
              {data.income_by_method.map(m => (
                <tr key={m.method}>
                  <td>{m.method}</td>
                  <td className="text-right">{fmtCedi(m.total)}</td>
                  <td className="text-right">
                    {data.total_income > 0 ? Math.round((m.total / data.total_income) * 100) : 0}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Sub-period breakdown */}
      {data.sub_periods && data.sub_periods.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>
            {data.period_kind === 'Annual' ? 'By Term' : 'By Month'}
          </div>
          <table className="statement-table">
            <thead>
              <tr>
                <th>{data.period_kind === 'Annual' ? 'Term' : 'Month'}</th>
                <th className="text-right">Income</th>
                <th className="text-right">Expenditure</th>
                <th className="text-right">Net</th>
              </tr>
            </thead>
            <tbody>
              {data.sub_periods.map((sp, i) => (
                <tr key={i}>
                  <td>{sp.label}</td>
                  <td className="text-right">{fmtCedi(sp.income)}</td>
                  <td className="text-right">{fmtCedi(sp.expense)}</td>
                  <td className="text-right" style={{ fontWeight: 600, color: sp.net >= 0 ? '#15803D' : '#b91c1c' }}>
                    {fmtCedi(sp.net)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ marginTop: 30, display: 'flex', justifyContent: 'space-between' }}>
        <div style={{ width: '40%', borderTop: '1px solid #333', paddingTop: 4, textAlign: 'center', fontSize: 11 }}>
          Prepared by (Accountant/Bursar) — Signature & Date
        </div>
        <div style={{ width: '40%', borderTop: '1px solid #333', paddingTop: 4, textAlign: 'center', fontSize: 11 }}>
          Approved by (Proprietor/Headmaster) — Signature & Date
        </div>
      </div>
      <div className="text-xs text-muted" style={{ marginTop: 18, textAlign: 'center' }}>
        Generated on {new Date().toLocaleString('en-GB')}
      </div>
    </div>
  );
}
