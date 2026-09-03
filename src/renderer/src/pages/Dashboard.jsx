// Nickland Edusoft — Dashboard Page
// Exact replica of Image 1 — main analytics dashboard
import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/index.js';

// ── Helpers ─────────────────────────────────────────────
function ghs(n) {
  if (n === null || n === undefined) return 'GHS 0.00';
  return 'GHS ' + Number(n).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return `Today, ${time}`;
  if (isYesterday) return `Yesterday, ${time}`;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) + `, ${time}`;
}
function initials(surname, firstName) {
  return ((surname?.[0] || '') + (firstName?.[0] || '')).toUpperCase();
}

// ── Main Dashboard Component ─────────────────────────────
export default function Dashboard() {
  const navigate = useNavigate();
  const { currentTerm, settings } = useStore();
  const school = settings.school || {};
  const branding = settings.branding || {};
  const [data, setData] = useState(null);
  const [schedule, setSchedule] = useState([]);
  const [loading, setLoading] = useState(true);

  const schoolName = school.school_name || 'Your School Name';
  const schoolMotto = school.school_motto || '';

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [summary, today] = await Promise.all([
        window.api.dashboard.summary(currentTerm?.id),
        window.api.dashboard.todaySchedule(),
      ]);
      setData(summary);
      setSchedule(today);
      setLoading(false);
    })();
  }, [currentTerm?.id]);

  if (loading || !data) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 80 }}>
        <div className="spinner" />
      </div>
    );
  }

  const m = data.metrics;

  return (
    <div className="dashboard">
      {/* School identity banner */}
      <div className="dash-banner">
        <h1 className="dash-school-name">{schoolName}</h1>
        {schoolMotto && <div className="dash-school-motto">{schoolMotto}</div>}
      </div>

      {/* Top metric cards — 5 cards across */}
      <div className="dash-metrics">
        <MetricCard
          icon={<IconStudents />}
          color="blue"
          label="Total Students"
          value={m.student_total ?? ''}
          sub={`${m.class_count} Classes`}
          link="View all students →"
          onClick={() => navigate('/students')}
        />
        <MetricCard
          icon={<IconCash />}
          color="green"
          label="Total Income"
          value={ghs(m.income_total)}
          sub="This Term"
          link="View income report →"
          valueClass="success"
          onClick={() => navigate('/finance')}
        />
        <MetricCard
          icon={<IconReceipt />}
          color="red"
          label="Outstanding Fees"
          value={ghs(m.fees_outstanding)}
          sub={`${m.debtor_count} Students`}
          link="View debtors →"
          valueClass="danger"
          onClick={() => navigate('/fees')}
        />
        <MetricCard
          icon={<IconCutlery />}
          color="orange"
          label="Canteen Owed"
          value={ghs(m.canteen_owed)}
          sub={`${m.canteen_unpaid_students} Students`}
          link="View canteen debtors →"
          valueClass="accent"
          onClick={() => navigate('/canteen')}
        />
        <MetricCard
          icon={<IconUser />}
          color="purple"
          label="Staff Members"
          value={m.staff_active ?? ''}
          sub="Active Staff"
          link="View staff →"
          onClick={() => navigate('/staff')}
        />
      </div>

      {/* Middle row — 3 charts */}
      <div className="dash-row dash-row-3">
        <div className="card">
          <div className="section-header">
            <div className="section-title">Income vs Expenses (This Term)</div>
          </div>
          <IncomeExpenseChart
            income={data.charts.income_by_month}
            expense={data.charts.expense_by_month}
          />
        </div>

        <div className="card">
          <div className="section-header">
            <div className="section-title">Fee Collection Summary</div>
          </div>
          <FeeCollectionDonut
            collected={m.fees_collected}
            outstanding={m.fees_outstanding}
            total={m.total_billed}
            pct={m.collection_pct}
          />
        </div>

        <div className="card">
          <div className="section-header">
            <div className="section-title">Recent Payments</div>
            <span className="section-view-all" onClick={() => navigate('/finance')}>View all →</span>
          </div>
          <div className="payments-list">
            {data.recent_payments.length === 0
              ? <div className="empty-state">No payments yet</div>
              : data.recent_payments.map(p => (
                <div key={`${p.payment_type}-${p.id}`} className="payment-row">
                  <div className="payment-row-left">
                    <div className="payment-row-meta">{p.index_number || ''}</div>
                    <div className="payment-row-name">{p.surname} {p.first_name}</div>
                    <div className="payment-row-type">{p.payment_type}</div>
                  </div>
                  <div className="payment-row-right">
                    <div className="payment-row-amount">{ghs(p.amount)}</div>
                    <div className="payment-row-date">{fmtTime(p.payment_date)}</div>
                  </div>
                </div>
              ))
            }
          </div>
        </div>
      </div>

      {/* Bottom row — 3 panels */}
      <div className="dash-row dash-row-3">
        <div className="card">
          <div className="section-header">
            <div className="section-title">Top Fee Debtors</div>
            <span className="section-view-all" onClick={() => navigate('/fees')}>View all →</span>
          </div>
          <DebtorsList
            data={data.top_fee_debtors}
            amountKey="balance"
            daysKey="days_outstanding"
            daysSuffix="days"
            onClickRow={(id) => navigate(`/students/${id}`)}
          />
        </div>

        <div className="card">
          <div className="section-header">
            <div className="section-title">Canteen Debtors</div>
            <span className="section-view-all" onClick={() => navigate('/canteen')}>View all →</span>
          </div>
          <DebtorsList
            data={data.top_canteen_debtors}
            amountKey="amount_owed"
            daysKey="unpaid_days"
            daysSuffix="days"
            onClickRow={(id) => navigate(`/students/${id}`)}
          />
        </div>

        <div className="card">
          <div className="section-header">
            <div className="section-title">
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <rect x="3" y="5" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.8"/>
                  <path d="M3 9h18M8 3v4M16 3v4" stroke="currentColor" strokeWidth="1.8"/>
                </svg>
                Today's Schedule
              </span>
            </div>
          </div>
          <div className="schedule-list">
            {schedule.map(item => (
              <div key={item.id} className="schedule-item">
                <div className="schedule-time">{item.start} — {item.end}</div>
                <div>
                  <div className="schedule-title">{item.title}</div>
                  <div className="schedule-sub">{item.sub}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="section-footer">
            <span className="section-view-all">View full academic calendar →</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Metric Card Component ───────────────────────────────
function MetricCard({ icon, color, label, value, sub, link, valueClass, onClick }) {
  return (
    <div className="metric-card">
      <div className={`metric-icon ${color}`}>{icon}</div>
      <div className="metric-body">
        <div className="metric-label">{label}</div>
        <div className={`metric-value ${valueClass || ''}`}>{value}</div>
        <div className="metric-sub">{sub}</div>
        {link && <div className="metric-link" onClick={onClick}>{link}</div>}
      </div>
    </div>
  );
}

// ── Debtors List Component ──────────────────────────────
function DebtorsList({ data, amountKey, daysKey, daysSuffix, onClickRow }) {
  if (!data || data.length === 0) {
    return <div className="empty-state">No debtors</div>;
  }
  return (
    <div className="debtors-list">
      {data.map(d => (
        <div key={d.student_id} className="debtor-row" onClick={() => onClickRow(d.student_id)}>
          <div className="avatar avatar-sm">
            {initials(d.surname, d.first_name)}
          </div>
          <div className="debtor-info">
            <div className="debtor-id">{d.index_number}</div>
            <div className="debtor-name">{d.surname} {d.first_name}</div>
            <div className="debtor-class">{d.class_code || ''}</div>
          </div>
          <div className="debtor-amount-col">
            <div className="debtor-amount">{ghs(d[amountKey])}</div>
            <div className="debtor-days">{d[daysKey]} {daysSuffix}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Income vs Expenses Chart (SVG line chart) ───────────
function IncomeExpenseChart({ income, expense }) {
  const monthLabels = useMemo(() => {
    const months = new Set();
    income.forEach(d => months.add(d.ym));
    expense.forEach(d => months.add(d.ym));
    return Array.from(months).sort();
  }, [income, expense]);

  if (monthLabels.length === 0) {
    return <div className="empty-state" style={{ height: 200 }}>No data this term yet</div>;
  }

  const incomeMap = Object.fromEntries(income.map(d => [d.ym, d.total]));
  const expenseMap = Object.fromEntries(expense.map(d => [d.ym, d.total]));
  const incomeData = monthLabels.map(m => incomeMap[m] || 0);
  const expenseData = monthLabels.map(m => expenseMap[m] || 0);

  const maxVal = Math.max(...incomeData, ...expenseData, 1);
  const W = 100, H = 60;
  const points = (arr) => arr.map((v, i) => {
    const x = monthLabels.length === 1 ? W / 2 : (i / (monthLabels.length - 1)) * W;
    const y = H - (v / maxVal) * H;
    return `${x},${y}`;
  }).join(' ');

  const monthName = ym => {
    const [y, m] = ym.split('-');
    return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][parseInt(m, 10) - 1];
  };

  return (
    <div className="chart-container">
      <div className="chart-legend">
        <span className="legend-item"><span className="legend-dot" style={{ background: '#3B82F6' }} /> Income (GHS)</span>
        <span className="legend-item"><span className="legend-dot" style={{ background: '#F59E0B' }} /> Expenses (GHS)</span>
      </div>
      <div className="chart-svg-wrap">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" width="100%" height="200">
          {/* Grid lines */}
          {[0.25, 0.5, 0.75].map(y => (
            <line key={y} x1="0" y1={H * y} x2={W} y2={H * y} stroke="#E5E7EB" strokeWidth="0.2" strokeDasharray="0.5,0.5" />
          ))}
          {/* Expense area */}
          <polygon
            points={`0,${H} ${points(expenseData)} ${W},${H}`}
            fill="#F59E0B" fillOpacity="0.15"
          />
          {/* Income area */}
          <polygon
            points={`0,${H} ${points(incomeData)} ${W},${H}`}
            fill="#3B82F6" fillOpacity="0.15"
          />
          {/* Lines */}
          <polyline points={points(expenseData)} fill="none" stroke="#F59E0B" strokeWidth="0.5" />
          <polyline points={points(incomeData)} fill="none" stroke="#3B82F6" strokeWidth="0.5" />
          {/* Points */}
          {incomeData.map((v, i) => {
            const x = monthLabels.length === 1 ? W / 2 : (i / (monthLabels.length - 1)) * W;
            const y = H - (v / maxVal) * H;
            return <circle key={`inc-${i}`} cx={x} cy={y} r="0.7" fill="#3B82F6" />;
          })}
          {expenseData.map((v, i) => {
            const x = monthLabels.length === 1 ? W / 2 : (i / (monthLabels.length - 1)) * W;
            const y = H - (v / maxVal) * H;
            return <circle key={`exp-${i}`} cx={x} cy={y} r="0.7" fill="#F59E0B" />;
          })}
        </svg>
      </div>
      <div className="chart-x-labels">
        {monthLabels.map(ym => (
          <div key={ym} className="chart-x-label">{monthName(ym)}</div>
        ))}
      </div>
      <div className="chart-y-labels">
        <div>{(maxVal / 1000).toFixed(0)}K</div>
        <div>{(maxVal * 0.75 / 1000).toFixed(0)}K</div>
        <div>{(maxVal * 0.5 / 1000).toFixed(0)}K</div>
        <div>{(maxVal * 0.25 / 1000).toFixed(0)}K</div>
        <div>0</div>
      </div>
    </div>
  );
}

// ── Fee Collection Donut Chart ──────────────────────────
function FeeCollectionDonut({ collected, outstanding, total, pct }) {
  // SVG donut: circumference based on collection %
  const radius = 60;
  const stroke = 18;
  const normalizedRadius = radius - stroke / 2;
  const circumference = 2 * Math.PI * normalizedRadius;
  const collectedStroke = (pct / 100) * circumference;

  return (
    <div className="donut-container">
      <div className="donut-svg-wrap">
        <svg width="160" height="160" viewBox="0 0 160 160">
          {/* Background ring (outstanding) */}
          <circle
            cx="80" cy="80" r={normalizedRadius}
            stroke="#EF4444" strokeWidth={stroke} fill="none"
            transform="rotate(-90 80 80)"
          />
          {/* Collected segment */}
          <circle
            cx="80" cy="80" r={normalizedRadius}
            stroke="#22C55E" strokeWidth={stroke} fill="none"
            strokeDasharray={`${collectedStroke} ${circumference}`}
            transform="rotate(-90 80 80)"
            strokeLinecap="butt"
          />
          {/* Center text */}
          <text x="80" y="78" textAnchor="middle" fontSize="28" fontWeight="700" fill="var(--fg)">
            {pct}%
          </text>
          <text x="80" y="98" textAnchor="middle" fontSize="11" fill="var(--muted)">
            Collected
          </text>
        </svg>
      </div>
      <div className="donut-legend">
        <div className="legend-row">
          <span className="legend-dot" style={{ background: '#22C55E' }} />
          <div className="legend-text">
            <div className="legend-label">Collected</div>
            <div className="legend-val">{ghs(collected)} ({pct}%)</div>
          </div>
        </div>
        <div className="legend-row">
          <span className="legend-dot" style={{ background: '#EF4444' }} />
          <div className="legend-text">
            <div className="legend-label">Outstanding</div>
            <div className="legend-val">{ghs(outstanding)} ({100 - pct}%)</div>
          </div>
        </div>
        <div className="legend-total">
          Total Fees<br />
          <span className="legend-total-val">{ghs(total)}</span>
        </div>
      </div>
    </div>
  );
}

// ── Inline SVG Icons ────────────────────────────────────
function IconStudents() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <circle cx="9" cy="8" r="4" fill="currentColor"/>
      <circle cx="17" cy="8" r="3" fill="currentColor" opacity="0.7"/>
      <path d="M1 20c0-4 4-7 8-7s8 3 8 7" stroke="currentColor" strokeWidth="2" fill="none"/>
      <path d="M18 16c3 1 5 3 5 5" stroke="currentColor" strokeWidth="2" fill="none" opacity="0.7"/>
    </svg>
  );
}
function IconCash() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" fill="currentColor"/>
      <text x="12" y="16" textAnchor="middle" fontSize="11" fill="#fff" fontWeight="700">₵</text>
    </svg>
  );
}
function IconReceipt() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path d="M5 2h14v20l-3-2-2 2-2-2-2 2-2-2-3 2V2Z" fill="currentColor"/>
      <path d="M9 8h6M9 12h6M9 16h4" stroke="#fff" strokeWidth="1.5"/>
    </svg>
  );
}
function IconCutlery() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path d="M7 2v8M7 10c-2 0-3-1-3-3V2M10 2v8c0 1 1 2-1 2v10" stroke="currentColor" strokeWidth="1.8" fill="none"/>
      <path d="M17 2c-2 0-3 3-3 6s1 4 3 4v10" stroke="currentColor" strokeWidth="1.8" fill="none"/>
    </svg>
  );
}
function IconUser() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="8" r="4" fill="currentColor"/>
      <path d="M4 21c0-4 4-7 8-7s8 3 8 7" stroke="currentColor" strokeWidth="2" fill="none"/>
    </svg>
  );
}
